const { stableId } = require("./project-storage.cjs");

function nowIso() {
  return new Date().toISOString();
}

function plainText(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let position = 0;
  while ((position = text.indexOf(needle, position)) >= 0) {
    count += 1;
    position += Math.max(1, needle.length);
  }
  return count;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

function chapterMetrics(chapter, rawContent, characters, scenes, foreshadows) {
  const text = plainText(rawContent);
  const length = Math.max(1, text.replace(/\s/g, "").length);
  const sentences = text.split(/[。！？!?]+/).map((item) => item.trim()).filter(Boolean);
  const paragraphs = text.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const dialogueChars = [...text.matchAll(/[“\"]([^”\"]+)[”\"]/g)].reduce((sum, match) => sum + String(match[1] || "").length, 0);
  const actionMatches = text.match(/(?:走|跑|冲|追|打|击|砍|刺|抓|推|拉|转身|抬手|举起|落下|跃|闪|躲|扑|挡|退|进|开|关|拿|放|掷|踢|挥)/g) || [];
  const actionChars = Math.min(length - dialogueChars, actionMatches.length * 4);
  const dialogueRatio = clamp((dialogueChars / length) * 100);
  const actionRatio = clamp((actionChars / length) * 100);
  const descriptionRatio = clamp(100 - dialogueRatio - actionRatio);
  const averageSentence = sentences.length ? length / sentences.length : length;
  const sceneBoost = Math.min(20, scenes.length * 4);
  const pacing = clamp(72 - Math.min(42, averageSentence * 0.72) + actionRatio * 0.8 + dialogueRatio * 0.25 + sceneBoost);
  const characterMentions = {};
  for (const card of characters) {
    const count = countOccurrences(text, String(card.name || ""));
    if (count) characterMentions[card.name] = count;
  }
  const pov = scenes.find((item) => item.pov)?.pov
    || Object.entries(characterMentions).sort((a, b) => b[1] - a[1])[0]?.[0]
    || (/\b我\b|我[们的在想看说]/.test(text) ? "第一人称/待确认" : "未识别");
  const ending = paragraphs.slice(-2).join(" ");
  const planted = foreshadows.filter((item) => item.plantedAt?.some((evidence) => evidence.chapterId === chapter.id)).length;
  const closed = foreshadows.filter((item) => item.payoffAt?.some((evidence) => evidence.chapterId === chapter.id)).length;
  const sceneText = scenes.map((item) => `${item.goal} ${item.conflict} ${item.turn} ${item.outcome}`).join(" ");
  return {
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    volume: chapter.volume || "未分卷",
    wordCount: length,
    pacing,
    dialogueRatio,
    actionRatio,
    descriptionRatio,
    pov,
    characterMentions,
    foreshadowsOpen: planted,
    foreshadowsClosed: closed,
    quality: {
      goal: Boolean(scenes.some((item) => item.goal) || /(为了|目标|决定|必须|想要|希望|准备)/.test(text)),
      conflict: Boolean(scenes.some((item) => item.conflict) || /(但是|然而|却|阻止|冲突|袭击|拒绝|危险|困难|无法)/.test(text)),
      turn: Boolean(scenes.some((item) => item.turn) || /(突然|没想到|原来|反而|就在这时|出乎意料|真相)/.test(text)),
      information: Boolean(/(发现|得知|知道|意识到|透露|说明|线索|秘密|真相)/.test(text)),
      characterAction: Boolean(actionMatches.length >= 3 || scenes.some((item) => item.outcome)),
      endingHook: Boolean(/[？?]$/.test(ending) || /(突然|却发现|与此同时|不知道|没想到|真正的|仍在|正在逼近|来不及)/.test(ending)),
    },
  };
}

function buildArcAlerts(chapters, characterStates, arcs) {
  const ordered = chapters.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const orderById = new Map(ordered.map((chapter, index) => [chapter.id, index]));
  const lastIndex = Math.max(0, ordered.length - 1);
  const alerts = [];
  for (const history of characterStates || []) {
    const states = (history.states || []).slice().sort((a, b) => Number(a.chapterOrder || 0) - Number(b.chapterOrder || 0));
    const latest = states[states.length - 1];
    if (!latest) continue;
    const latestIndex = orderById.get(latest.chapterId) ?? Number(latest.chapterOrder || 0);
    if (lastIndex - latestIndex >= 5) alerts.push({
      characterId: history.characterId,
      characterName: history.characterName,
      type: "长期未出场",
      detail: `距最近一次正文出场已过去 ${lastIndex - latestIndex} 份文档，最近出现在《${latest.chapterTitle}》。`,
      chapterId: latest.chapterId,
    });
    if (states.length >= 2 && !(latest.goals || []).length && (states[states.length - 2].goals || []).length) alerts.push({
      characterId: history.characterId,
      characterName: history.characterName,
      type: "动机中断",
      detail: `《${latest.chapterTitle}》没有延续上一状态中的目标，需要确认是完成、放弃还是遗漏。`,
      chapterId: latest.chapterId,
    });
    if ((latest.knowledge || []).length && !(latest.knowledgeSources || []).length && !(latest.evidence || []).length) alerts.push({
      characterId: history.characterId,
      characterName: history.characterName,
      type: "知情异常",
      detail: `《${latest.chapterTitle}》记录了知情变化，但缺少信息来源或原文证据。`,
      chapterId: latest.chapterId,
    });
    const planned = (arcs || []).filter((item) => item.characterId === history.characterId || item.characterName === history.characterName).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    const latestPlan = planned[planned.length - 1];
    if (latestPlan?.desire && !(latest.goals || []).some((goal) => String(goal).includes(latestPlan.desire) || latestPlan.desire.includes(String(goal)))) alerts.push({
      characterId: history.characterId,
      characterName: history.characterName,
      type: "规划偏离",
      detail: `人物弧线计划“${latestPlan.desire}”尚未在最近正文目标中体现。`,
      chapterId: latest.chapterId,
    });
  }
  return alerts.slice(0, 2000);
}

function analyzeProjectStatistics({ chapters = [], contents = {}, characters = [], workspace = {}, storyOverview = {}, label = "" } = {}) {
  const metrics = chapters
    .slice()
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .map((chapter) => chapterMetrics(
      chapter,
      contents[chapter.id] || "",
      characters,
      (workspace.scenes || []).filter((item) => item.chapterId === chapter.id),
      storyOverview.foreshadows || [],
    ));
  const povCounts = new Map();
  const density = new Map(characters.map((card) => [card.name, { id: card.id, name: card.name, total: 0, chapters: 0 }]));
  for (const metric of metrics) {
    povCounts.set(metric.pov, (povCounts.get(metric.pov) || 0) + 1);
    for (const [name, total] of Object.entries(metric.characterMentions)) {
      const item = density.get(name) || { id: stableId("character", name), name, total: 0, chapters: 0 };
      item.total += total;
      item.chapters += 1;
      density.set(name, item);
    }
  }
  const foreshadows = storyOverview.foreshadows || [];
  const closed = foreshadows.filter((item) => item.status === "已经回收").length;
  const open = foreshadows.filter((item) => !["已经回收", "已废弃"].includes(item.status)).length;
  return {
    id: `statistics_${Date.now().toString(36)}`,
    label: label || `诊断 ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    metrics,
    povShares: [...povCounts.entries()].map(([name, count]) => ({ name, chapters: count, ratio: metrics.length ? Math.round((count / metrics.length) * 100) : 0 })).sort((a, b) => b.chapters - a.chapters),
    characterDensity: [...density.values()].filter((item) => item.total).sort((a, b) => b.total - a.total),
    foreshadowSummary: { open, closed, recoveryRate: open + closed ? Math.round((closed / (open + closed)) * 100) : 0 },
    arcAlerts: buildArcAlerts(chapters, storyOverview.characterStates || [], workspace.arcs || []),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

module.exports = {
  analyzeProjectStatistics,
  buildArcAlerts,
  chapterMetrics,
  plainText,
};
