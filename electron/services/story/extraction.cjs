"use strict";
const {
  STORY_STATE_VERSION,
  nowIso,
  sha256,
  stableId,
} = require("./dependencies.cjs");

function cleanText(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitSentences(text) {
  const items = [];
  const expression = /[^。！？!?\n]+[。！？!?]?/g;
  let match;
  while ((match = expression.exec(text))) {
    const quote = match[0].trim();
    if (quote.length < 4) continue;
    items.push({
      quote: quote.slice(0, 360),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return items.slice(0, 1200);
}

function namesInSentence(sentence, characters) {
  return characters
    .filter((item) => item.name && sentence.includes(item.name))
    .map((item) => item.name)
    .slice(0, 12);
}

function matchFirst(text, expression) {
  const match = String(text || "").match(expression);
  return String(match?.[1] || "")
    .trim()
    .slice(0, 30);
}

function makeEvidence(chapter, sentence) {
  return {
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    volume: chapter.volume || "未分卷",
    heading: "",
    quote: sentence.quote,
    start: sentence.start,
    end: sentence.end,
  };
}

function factTypeForSentence(text) {
  if (/(知道|得知|发现|意识到|明白|获悉|认出|误以为|隐瞒|透露)/.test(text))
    return "知情变化";
  if (/(获得|拿到|拾起|交给|递给|夺走|丢失|遗失|损坏|使用|持有)/.test(text))
    return "物品变化";
  if (/(来到|进入|抵达|返回|赶往|离开|逃离|身处|位于)/.test(text))
    return "地点变化";
  if (/(受伤|中毒|昏迷|死亡|复活|疲惫|虚弱|恢复|突破|晋升)/.test(text))
    return "状态变化";
  if (/(信任|怀疑|背叛|结盟|合作|敌对|喜欢|爱上|憎恨|原谅)/.test(text))
    return "关系变化";
  return "剧情事件";
}

function localFactCandidates(chapter, sentences, characters) {
  const eventExpression =
    /(决定|开始|继续|发现|知道|得知|进入|来到|抵达|返回|离开|攻击|杀死|救下|交给|获得|失去|答应|拒绝|承诺|背叛|合作|追踪|调查|寻找|逃离|受伤|死亡|出现|消失|打开|关闭|破坏|阻止)/;
  const facts = [];
  for (const sentence of sentences) {
    if (!eventExpression.test(sentence.quote)) continue;
    const names = namesInSentence(sentence.quote, characters);
    const subject =
      names[0] ||
      matchFirst(
        sentence.quote,
        /^([\u4e00-\u9fffA-Za-z·]{2,12})(?:决定|开始|继续|发现|知道|进入|来到|攻击|救下|获得|失去)/,
      );
    const type = factTypeForSentence(sentence.quote);
    facts.push({
      id: stableId(
        "fact",
        `${chapter.id}|${sentence.start}|${type}|${sentence.quote}`,
      ),
      type,
      subject: subject || "未明确",
      predicate: type,
      object: sentence.quote,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      volume: chapter.volume || "未分卷",
      confidence: names.length ? 0.74 : 0.58,
      status: "AI识别",
      evidence: [makeEvidence(chapter, sentence)],
      sourceRevision: "",
      updatedAt: nowIso(),
    });
    if (facts.length >= 240) break;
  }
  return facts;
}

function localCharacterStates(chapter, sentences, characters, sourceRevision) {
  const states = [];
  for (const character of characters) {
    const mentions = sentences.filter((sentence) =>
      sentence.quote.includes(character.name),
    );
    if (!mentions.length) continue;
    const recent = mentions.slice(-8);
    const combined = recent.map((item) => item.quote).join(" ");
    const location = matchFirst(
      combined,
      /(?:来到|进入|抵达|返回|赶往|身处|位于|在)([\u4e00-\u9fffA-Za-z0-9·]{2,18}?)(?:中|里|内|外|附近|旁|，|。|；|$)/,
    );
    const route = recent
      .filter((item) =>
        /(?:来到|进入|抵达|返回|赶往|离开|逃离|穿过|前往)/.test(item.quote),
      )
      .map((item) => item.quote)
      .slice(-6);
    const physical = [
      ...new Set(
        combined.match(/受伤|中毒|昏迷|死亡|疲惫|虚弱|恢复|突破|健康|失控/g) ||
          [],
      ),
    ];
    const mental = [
      ...new Set(
        combined.match(
          /恐惧|害怕|紧张|愤怒|悲伤|绝望|犹豫|坚定|怀疑|震惊|冷静|兴奋|焦虑|崩溃/g,
        ) || [],
      ),
    ];
    const abilities = recent
      .filter((item) =>
        /(能力|力量|法术|招式|施展|发动|突破|失控|恢复|封印|异能|魔法|灵力)/.test(
          item.quote,
        ),
      )
      .map((item) => item.quote)
      .slice(-5);
    const goals = recent
      .filter((item) =>
        /(想要|希望|准备|打算|决定|必须|寻找|调查|追踪)/.test(item.quote),
      )
      .map((item) => item.quote)
      .slice(-3);
    const obstacles = recent
      .filter((item) =>
        /(但是|然而|却|阻止|无法|困难|阻碍|危险|失败|受限|来不及)/.test(
          item.quote,
        ),
      )
      .map((item) => item.quote)
      .slice(-4);
    const knowledge = recent
      .filter((item) =>
        /(知道|得知|发现|意识到|明白|获悉|认出|怀疑)/.test(item.quote),
      )
      .map((item) => item.quote)
      .slice(-5);
    const knowledgeSources = knowledge.map((item) => item).slice(-5);
    const possessions = recent
      .filter((item) =>
        /(获得|拿到|拾起|持有|交给|夺走|丢失|使用)/.test(item.quote),
      )
      .map((item) => item.quote)
      .slice(-5);
    const relationshipChanges = recent
      .filter((item) =>
        /(信任|怀疑|背叛|结盟|合作|敌对|喜欢|爱上|憎恨|原谅|疏远|和解)/.test(
          item.quote,
        ),
      )
      .map((item) => item.quote)
      .slice(-5);
    const lastMention = recent[recent.length - 1];
    states.push({
      id: stableId("state", `${character.id}|${chapter.id}|${sourceRevision}`),
      characterId: character.id,
      characterName: character.name,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      chapterOrder: Number(chapter.order || 0),
      volume: chapter.volume || "未分卷",
      location,
      route,
      physical,
      mental,
      abilities,
      goals,
      obstacles,
      knowledge,
      knowledgeSources,
      possessions,
      relationships: relationshipChanges,
      relationshipChanges,
      lastAppearance: lastMention?.quote || "",
      lastAppearancePosition: lastMention
        ? { start: lastMention.start, end: lastMention.end }
        : undefined,
      evidence: recent.slice(-5).map((item) => makeEvidence(chapter, item)),
      sourceRevision,
      confidence: 0.62,
      updatedAt: nowIso(),
    });
  }
  return states;
}

function localForeshadows(chapter, sentences, sourceRevision) {
  const candidates = sentences
    .filter((sentence) =>
      /(伏笔|线索|预兆|异常|秘密|谜团|不对劲|似乎|隐约|未曾注意|没有发现|尚不知道|奇怪|反常)/.test(
        sentence.quote,
      ),
    )
    .slice(0, 80);
  return candidates.map((sentence) => ({
    id: stableId(
      "foreshadow",
      `${chapter.id}|${sentence.start}|${sentence.quote}`,
    ),
    title: sentence.quote.replace(/[。！？!?]$/g, "").slice(0, 36),
    description: sentence.quote,
    status: "AI候选",
    plantedAt: [makeEvidence(chapter, sentence)],
    reinforcedAt: [],
    payoffAt: [],
    plannedPayoff: "",
    relatedCharacters: [],
    sourceRevision,
    confidence: 0.58,
    updatedAt: nowIso(),
  }));
}

function analyzeChapterLocally({ chapter, content, characters = [] }) {
  const plain = cleanText(content);
  const sourceRevision = sha256(Buffer.from(String(content || ""), "utf8"));
  const sentences = splitSentences(plain);
  const facts = localFactCandidates(chapter, sentences, characters).map(
    (item) => ({ ...item, sourceRevision }),
  );
  const characterStates = localCharacterStates(
    chapter,
    sentences,
    characters,
    sourceRevision,
  );
  const foreshadows = localForeshadows(chapter, sentences, sourceRevision);
  return {
    version: STORY_STATE_VERSION,
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    volume: chapter.volume || "未分卷",
    sourceRevision,
    analysisMode: "local",
    analyzedAt: nowIso(),
    facts,
    characterStates,
    foreshadows,
  };
}

function normalizeEvidence(value, chapter) {
  const evidence = Array.isArray(value) ? value : value ? [value] : [];
  return evidence
    .slice(0, 8)
    .map((item) => {
      if (typeof item === "string")
        return {
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          volume: chapter.volume || "未分卷",
          heading: "",
          quote: item.slice(0, 360),
          start: -1,
          end: -1,
        };
      return {
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        volume: chapter.volume || "未分卷",
        heading: String(item?.heading || "").slice(0, 80),
        quote: String(item?.quote || item?.text || "").slice(0, 360),
        start: Number.isFinite(Number(item?.start)) ? Number(item.start) : -1,
        end: Number.isFinite(Number(item?.end)) ? Number(item.end) : -1,
      };
    })
    .filter((item) => item.quote);
}

function normalizeAiChapterAnalysis(
  payload,
  chapter,
  sourceRevision,
  characters = [],
) {
  const characterByName = new Map(characters.map((item) => [item.name, item]));
  const facts = (Array.isArray(payload?.facts) ? payload.facts : [])
    .slice(0, 320)
    .map((item, index) => ({
      id: stableId(
        "fact",
        `${chapter.id}|ai|${index}|${item.type}|${item.subject}|${item.object || item.detail}`,
      ),
      type: String(item.type || "剧情事件").slice(0, 20),
      subject: String(item.subject || "未明确").slice(0, 80),
      predicate: String(item.predicate || item.type || "发生").slice(0, 80),
      object: String(item.object || item.detail || "").slice(0, 500),
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      volume: chapter.volume || "未分卷",
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.72)),
      status: "AI识别",
      evidence: normalizeEvidence(item.evidence || item.quote, chapter),
      sourceRevision,
      updatedAt: nowIso(),
    }))
    .filter((item) => item.object && item.evidence.length);
  const characterStates = (
    Array.isArray(payload?.characterStates) ? payload.characterStates : []
  )
    .slice(0, 120)
    .map((item, index) => {
      const name = String(item.characterName || item.name || "").trim();
      const card = characterByName.get(name);
      return {
        id: stableId("state", `${card?.id || name}|${chapter.id}|ai|${index}`),
        characterId: card?.id || stableId("character", name),
        characterName: name,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOrder: Number(chapter.order || 0),
        volume: chapter.volume || "未分卷",
        location: String(item.location || "").slice(0, 80),
        route: Array.isArray(item.route)
          ? item.route.map(String).slice(0, 12)
          : [String(item.route || "")].filter(Boolean),
        physical: Array.isArray(item.physical)
          ? item.physical.map(String).slice(0, 12)
          : [String(item.physical || "")].filter(Boolean),
        mental: Array.isArray(item.mental)
          ? item.mental.map(String).slice(0, 12)
          : [String(item.mental || "")].filter(Boolean),
        abilities: Array.isArray(item.abilities)
          ? item.abilities.map(String).slice(0, 12)
          : [String(item.abilities || "")].filter(Boolean),
        goals: Array.isArray(item.goals)
          ? item.goals.map(String).slice(0, 12)
          : [String(item.goals || "")].filter(Boolean),
        obstacles: Array.isArray(item.obstacles)
          ? item.obstacles.map(String).slice(0, 12)
          : [String(item.obstacles || "")].filter(Boolean),
        knowledge: Array.isArray(item.knowledge)
          ? item.knowledge.map(String).slice(0, 20)
          : [String(item.knowledge || "")].filter(Boolean),
        knowledgeSources: Array.isArray(item.knowledgeSources)
          ? item.knowledgeSources.map(String).slice(0, 20)
          : [String(item.knowledgeSource || "")].filter(Boolean),
        possessions: Array.isArray(item.possessions)
          ? item.possessions.map(String).slice(0, 20)
          : [String(item.possessions || "")].filter(Boolean),
        relationships: Array.isArray(item.relationships)
          ? item.relationships.map(String).slice(0, 20)
          : [],
        relationshipChanges: Array.isArray(item.relationshipChanges)
          ? item.relationshipChanges.map(String).slice(0, 20)
          : Array.isArray(item.relationships)
            ? item.relationships.map(String).slice(0, 20)
            : [],
        lastAppearance: String(item.lastAppearance || "").slice(0, 360),
        lastAppearancePosition:
          item.lastAppearancePosition &&
          typeof item.lastAppearancePosition === "object"
            ? {
                start: Number.isFinite(
                  Number(item.lastAppearancePosition.start),
                )
                  ? Number(item.lastAppearancePosition.start)
                  : -1,
                end: Number.isFinite(Number(item.lastAppearancePosition.end))
                  ? Number(item.lastAppearancePosition.end)
                  : -1,
              }
            : undefined,
        evidence: normalizeEvidence(item.evidence, chapter),
        sourceRevision,
        confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.72)),
        updatedAt: nowIso(),
      };
    })
    .filter((item) => item.characterName);
  const foreshadows = (
    Array.isArray(payload?.foreshadows) ? payload.foreshadows : []
  )
    .slice(0, 120)
    .map((item, index) => ({
      id: stableId(
        "foreshadow",
        `${chapter.id}|ai|${index}|${item.title}|${item.description}`,
      ),
      title: String(item.title || `伏笔候选 ${index + 1}`).slice(0, 80),
      description: String(item.description || item.detail || "").slice(0, 500),
      status: "AI候选",
      plantedAt:
        /强化/.test(String(item.stage || item.status || "")) ||
        /回收/.test(String(item.stage || item.status || ""))
          ? []
          : normalizeEvidence(item.evidence || item.plantedAt, chapter),
      reinforcedAt: /强化/.test(String(item.stage || item.status || ""))
        ? normalizeEvidence(item.evidence || item.reinforcedAt, chapter)
        : normalizeEvidence(item.reinforcedAt, chapter),
      payoffAt: /回收/.test(String(item.stage || item.status || ""))
        ? normalizeEvidence(item.evidence || item.payoffAt, chapter)
        : normalizeEvidence(item.payoffAt, chapter),
      plannedPayoff: String(item.plannedPayoff || "").slice(0, 500),
      relatedCharacters: Array.isArray(item.relatedCharacters)
        ? item.relatedCharacters.map(String).slice(0, 20)
        : [],
      sourceRevision,
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.7)),
      updatedAt: nowIso(),
    }))
    .filter(
      (item) =>
        item.description &&
        [...item.plantedAt, ...item.reinforcedAt, ...item.payoffAt].length,
    );
  return {
    version: STORY_STATE_VERSION,
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    volume: chapter.volume || "未分卷",
    sourceRevision,
    analysisMode: "ai",
    analyzedAt: nowIso(),
    facts,
    characterStates,
    foreshadows,
  };
}

module.exports = {
  cleanText,
  splitSentences,
  namesInSentence,
  matchFirst,
  makeEvidence,
  factTypeForSentence,
  localFactCandidates,
  localCharacterStates,
  localForeshadows,
  analyzeChapterLocally,
  normalizeEvidence,
  normalizeAiChapterAnalysis,
};
