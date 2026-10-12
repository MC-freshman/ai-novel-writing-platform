"use strict";
const {
  buildStructuringMaterials,
  callStructuredChatWithProgress,
  contentToPlainText,
  extractJsonFromModelText,
  extractMetadata,
  fs,
  getChapterPath,
  loadProjectSources,
  makeIdSet,
  stableHash,
} = require("./dependencies.cjs");

function extractTimeHints(text) {
  const matches = String(text || "").match(
    /(?:第[一二三四五六七八九十百千万零\d]+(?:年|月|日|天|夜|幕|卷|章)|[一二三四五六七八九十百千万零\d]+(?:年前|年后|个月前|个月后|日后|天后)|多年后|多年以前|很久以前|彼时|此后|后来|此前|清晨|黎明|上午|正午|午后|黄昏|傍晚|深夜|午夜|今日|昨日|明日|当天|当夜|同年|次年|翌日|\d{1,4}年(?:\d{1,2}月)?(?:\d{1,2}日)?)/g,
  );
  return [...new Set(matches || [])].slice(0, 4);
}

async function buildTimelineEvents(projectPath, options = {}) {
  const { chapters, characters } = await loadProjectSources(projectPath);
  const chapterIds = makeIdSet(options.chapterIds);
  const visibleChapters = chapterIds.size
    ? chapters.filter((chapter) => chapterIds.has(chapter.id))
    : chapters;
  const characterNames = characters.map((item) => item.name).filter(Boolean);
  const events = [];
  let order = 0;

  for (const chapter of visibleChapters) {
    const content = await fs
      .readFile(getChapterPath(projectPath, chapter), "utf8")
      .catch(() => "");
    const plain = contentToPlainText(content);
    const paragraphs = plain
      .split(/\n+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 8);
    const candidates = [];
    for (const paragraph of paragraphs) {
      const timeHints = extractTimeHints(paragraph);
      if (timeHints.length)
        candidates.push({
          title: timeHints[0],
          summary: paragraph,
          timeHint: timeHints.join("、"),
        });
      if (candidates.length >= 5) break;
    }

    if (
      !candidates.length &&
      Array.isArray(chapter.outline) &&
      chapter.outline.length > 1
    ) {
      for (const outline of chapter.outline.slice(1, 6)) {
        candidates.push({
          title: outline.title,
          summary: `章节小标题：${outline.title}`,
          timeHint: "",
        });
      }
    }

    if (!candidates.length && paragraphs[0]) {
      candidates.push({
        title: chapter.title,
        summary: paragraphs[0],
        timeHint: "",
      });
    }

    for (const candidate of candidates) {
      const metadata = extractMetadata(candidate.summary, characterNames);
      events.push({
        id: `event_${chapter.id}_${order}`,
        order,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        volume: chapter.volume || "未分卷",
        title: candidate.title || chapter.title,
        timeHint: candidate.timeHint,
        summary: candidate.summary.slice(0, 220),
        characters: metadata.characters.slice(0, 8),
      });
      order += 1;
    }
  }

  return {
    events: events.slice(0, 300),
    options: {
      mode: "local",
      chapterIds: [...chapterIds],
      knowledgeSourceIds: Array.isArray(options.knowledgeSourceIds)
        ? options.knowledgeSourceIds
        : [],
    },
  };
}

function normalizeTimelinePayload(payload, chapters, characterNames) {
  const items = Array.isArray(payload?.events) ? payload.events : [];
  return items
    .map((item, index) => {
      const chapterTitle = String(item.chapterTitle || "").trim();
      const chapter =
        chapters.find((chapter) => chapter.title === chapterTitle) ||
        chapters.find(
          (chapter) => chapterTitle && chapter.title.includes(chapterTitle),
        ) ||
        chapters[Math.min(index, Math.max(0, chapters.length - 1))];
      const summary = String(item.summary || item.detail || "").trim();
      const characters = Array.isArray(item.characters)
        ? item.characters
            .map((name) => String(name || "").trim())
            .filter(Boolean)
        : characterNames.filter((name) => summary.includes(name)).slice(0, 8);
      return {
        id: `ai_event_${stableHash(`${index}_${item.title}_${summary}`)}`,
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
        chapterId: chapter?.id || "",
        chapterTitle: chapter?.title || chapterTitle || "未指定章节",
        volume: chapter?.volume || String(item.volume || "未分卷"),
        title: String(
          item.title || item.timeHint || chapter?.title || "剧情事件",
        ).trim(),
        timeHint: String(item.timeHint || "").trim(),
        summary: summary.slice(0, 260),
        characters: characters.slice(0, 8),
      };
    })
    .filter((item) => item.summary)
    .sort((a, b) => a.order - b.order)
    .slice(0, 300)
    .map((item, index) => ({ ...item, order: index }));
}

async function buildAiTimelineEvents(projectPath, options = {}, control = {}) {
  const materials = await buildStructuringMaterials(
    projectPath,
    "时间线 事件 起因 结果 转折 冲突 章节顺序",
    options,
  );
  const { chapters, characters } = await loadProjectSources(projectPath);
  const characterNames = characters.map((item) => item.name).filter(Boolean);
  const systemPrompt = `你是长篇小说剧情时间线整理助手。请只基于用户提供的材料，提取真实剧情事件，不要把目录标题当作事件。只输出 JSON，不要解释。
JSON 格式必须是：
{"events":[{"order":0,"title":"","timeHint":"","chapterTitle":"","volume":"","summary":"","characters":[""]}]}
要求：
1. 按剧情发生顺序排序。
2. title 写事件名，不要只写章节名。
3. summary 写起因、行动、结果，尽量具体。
4. timeHint 没有明确时间就留空。
5. 不要编造材料中没有的事件。`;
  const question = `请从下面材料整理小说真实剧情时间线，最多 120 个事件。

【检索片段】
${materials.retrieved || "无"}

【大纲与正文】
${materials.corpus}`;
  const answer = await callStructuredChatWithProgress(
    materials.config,
    systemPrompt,
    question,
    control,
    "AI 正在识别剧情事件",
  );
  const events = normalizeTimelinePayload(
    extractJsonFromModelText(answer),
    chapters,
    characterNames,
  );
  if (!events.length) throw new Error("AI 没有返回可识别的剧情事件。");
  return {
    events,
    contextCount: materials.search.chunks.length,
    apiError: "",
    options: {
      mode: "ai",
      chapterIds: Array.isArray(options.chapterIds) ? options.chapterIds : [],
      knowledgeSourceIds: Array.isArray(options.knowledgeSourceIds)
        ? options.knowledgeSourceIds
        : [],
    },
  };
}

module.exports = {
  extractTimeHints,
  buildTimelineEvents,
  normalizeTimelinePayload,
  buildAiTimelineEvents,
};
