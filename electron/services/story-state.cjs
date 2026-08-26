const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ensureDir,
  readJson,
  safeFileSegment,
  sha256,
  stableId,
  writeJsonAtomic,
} = require("./project-storage.cjs");

const STORY_STATE_VERSION = 2;
const FACT_STATUSES = new Set(["AI识别", "已确认", "已忽略"]);
const FORESHADOW_STATUSES = new Set(["AI候选", "已确认埋下", "持续强化", "等待回收", "已经回收", "已废弃"]);
const ledgerReadCache = new Map();

function nowIso() {
  return new Date().toISOString();
}

function getStoryRoot(projectPath) {
  return path.join(projectPath, "analysis", "story-state");
}

function getLedgerDir(projectPath) {
  return path.join(getStoryRoot(projectPath), "chapters");
}

function getLedgerPath(projectPath, chapterId) {
  return path.join(getLedgerDir(projectPath), `${safeFileSegment(chapterId, "chapter")}.json`);
}

function getStoryIndexPath(projectPath) {
  return path.join(getStoryRoot(projectPath), "index.json");
}

function getForeshadowsPath(projectPath) {
  return path.join(getStoryRoot(projectPath), "foreshadows.json");
}

function getManualFactsPath(projectPath) {
  return path.join(getStoryRoot(projectPath), "manual-facts.json");
}

function getCharacterStateDir(projectPath) {
  return path.join(getStoryRoot(projectPath), "character-states");
}

function getBoardsDir(projectPath) {
  return path.join(getStoryRoot(projectPath), "boards");
}

function getBoardPath(projectPath, chapterId) {
  return path.join(getBoardsDir(projectPath), `${safeFileSegment(chapterId, "chapter")}.json`);
}

async function readLedgerCached(projectPath, chapterId) {
  const filePath = getLedgerPath(projectPath, chapterId);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) {
    ledgerReadCache.delete(filePath);
    return null;
  }
  const signature = `${stat.size}|${stat.mtimeMs}|${stat.ctimeMs}`;
  const cached = ledgerReadCache.get(filePath);
  if (cached?.signature === signature) return cached.value;
  const value = await readJson(filePath, null);
  ledgerReadCache.set(filePath, { signature, value });
  if (ledgerReadCache.size > 2000) ledgerReadCache.delete(ledgerReadCache.keys().next().value);
  return value;
}

async function ensureStoryState(projectPath) {
  await Promise.all([
    ensureDir(getLedgerDir(projectPath)),
    ensureDir(getCharacterStateDir(projectPath)),
    ensureDir(getBoardsDir(projectPath)),
  ]);
  const indexPath = getStoryIndexPath(projectPath);
  const foreshadowsPath = getForeshadowsPath(projectPath);
  try {
    await fs.access(indexPath);
  } catch {
    await writeJsonAtomic(indexPath, {
      version: STORY_STATE_VERSION,
      updatedAt: "",
      chapters: [],
      factCount: 0,
      characterStateCount: 0,
      foreshadowCount: 0,
    });
  }
  try {
    await fs.access(foreshadowsPath);
  } catch {
    await writeJsonAtomic(foreshadowsPath, { version: STORY_STATE_VERSION, updatedAt: "", items: [] });
  }
  try {
    await fs.access(getManualFactsPath(projectPath));
  } catch {
    await writeJsonAtomic(getManualFactsPath(projectPath), { version: STORY_STATE_VERSION, updatedAt: "", items: [] });
  }
}

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
    items.push({ quote: quote.slice(0, 360), start: match.index, end: match.index + match[0].length });
  }
  return items.slice(0, 1200);
}

function namesInSentence(sentence, characters) {
  return characters.filter((item) => item.name && sentence.includes(item.name)).map((item) => item.name).slice(0, 12);
}

function matchFirst(text, expression) {
  const match = String(text || "").match(expression);
  return String(match?.[1] || "").trim().slice(0, 30);
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
  if (/(知道|得知|发现|意识到|明白|获悉|认出|误以为|隐瞒|透露)/.test(text)) return "知情变化";
  if (/(获得|拿到|拾起|交给|递给|夺走|丢失|遗失|损坏|使用|持有)/.test(text)) return "物品变化";
  if (/(来到|进入|抵达|返回|赶往|离开|逃离|身处|位于)/.test(text)) return "地点变化";
  if (/(受伤|中毒|昏迷|死亡|复活|疲惫|虚弱|恢复|突破|晋升)/.test(text)) return "状态变化";
  if (/(信任|怀疑|背叛|结盟|合作|敌对|喜欢|爱上|憎恨|原谅)/.test(text)) return "关系变化";
  return "剧情事件";
}

function localFactCandidates(chapter, sentences, characters) {
  const eventExpression = /(决定|开始|继续|发现|知道|得知|进入|来到|抵达|返回|离开|攻击|杀死|救下|交给|获得|失去|答应|拒绝|承诺|背叛|合作|追踪|调查|寻找|逃离|受伤|死亡|出现|消失|打开|关闭|破坏|阻止)/;
  const facts = [];
  for (const sentence of sentences) {
    if (!eventExpression.test(sentence.quote)) continue;
    const names = namesInSentence(sentence.quote, characters);
    const subject = names[0] || matchFirst(sentence.quote, /^([\u4e00-\u9fffA-Za-z·]{2,12})(?:决定|开始|继续|发现|知道|进入|来到|攻击|救下|获得|失去)/);
    const type = factTypeForSentence(sentence.quote);
    facts.push({
      id: stableId("fact", `${chapter.id}|${sentence.start}|${type}|${sentence.quote}`),
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
    const mentions = sentences.filter((sentence) => sentence.quote.includes(character.name));
    if (!mentions.length) continue;
    const recent = mentions.slice(-8);
    const combined = recent.map((item) => item.quote).join(" ");
    const location = matchFirst(combined, /(?:来到|进入|抵达|返回|赶往|身处|位于|在)([\u4e00-\u9fffA-Za-z0-9·]{2,18}?)(?:中|里|内|外|附近|旁|，|。|；|$)/);
    const route = recent.filter((item) => /(?:来到|进入|抵达|返回|赶往|离开|逃离|穿过|前往)/.test(item.quote)).map((item) => item.quote).slice(-6);
    const physical = [...new Set((combined.match(/受伤|中毒|昏迷|死亡|疲惫|虚弱|恢复|突破|健康|失控/g) || []))];
    const mental = [...new Set((combined.match(/恐惧|害怕|紧张|愤怒|悲伤|绝望|犹豫|坚定|怀疑|震惊|冷静|兴奋|焦虑|崩溃/g) || []))];
    const abilities = recent.filter((item) => /(能力|力量|法术|招式|施展|发动|突破|失控|恢复|封印|异能|魔法|灵力)/.test(item.quote)).map((item) => item.quote).slice(-5);
    const goals = recent.filter((item) => /(想要|希望|准备|打算|决定|必须|寻找|调查|追踪)/.test(item.quote)).map((item) => item.quote).slice(-3);
    const obstacles = recent.filter((item) => /(但是|然而|却|阻止|无法|困难|阻碍|危险|失败|受限|来不及)/.test(item.quote)).map((item) => item.quote).slice(-4);
    const knowledge = recent.filter((item) => /(知道|得知|发现|意识到|明白|获悉|认出|怀疑)/.test(item.quote)).map((item) => item.quote).slice(-5);
    const knowledgeSources = knowledge.map((item) => item).slice(-5);
    const possessions = recent.filter((item) => /(获得|拿到|拾起|持有|交给|夺走|丢失|使用)/.test(item.quote)).map((item) => item.quote).slice(-5);
    const relationshipChanges = recent.filter((item) => /(信任|怀疑|背叛|结盟|合作|敌对|喜欢|爱上|憎恨|原谅|疏远|和解)/.test(item.quote)).map((item) => item.quote).slice(-5);
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
      lastAppearancePosition: lastMention ? { start: lastMention.start, end: lastMention.end } : undefined,
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
    .filter((sentence) => /(伏笔|线索|预兆|异常|秘密|谜团|不对劲|似乎|隐约|未曾注意|没有发现|尚不知道|奇怪|反常)/.test(sentence.quote))
    .slice(0, 80);
  return candidates.map((sentence) => ({
    id: stableId("foreshadow", `${chapter.id}|${sentence.start}|${sentence.quote}`),
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
  const facts = localFactCandidates(chapter, sentences, characters).map((item) => ({ ...item, sourceRevision }));
  const characterStates = localCharacterStates(chapter, sentences, characters, sourceRevision);
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
  return evidence.slice(0, 8).map((item) => {
    if (typeof item === "string") return { chapterId: chapter.id, chapterTitle: chapter.title, volume: chapter.volume || "未分卷", heading: "", quote: item.slice(0, 360), start: -1, end: -1 };
    return {
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      volume: chapter.volume || "未分卷",
      heading: String(item?.heading || "").slice(0, 80),
      quote: String(item?.quote || item?.text || "").slice(0, 360),
      start: Number.isFinite(Number(item?.start)) ? Number(item.start) : -1,
      end: Number.isFinite(Number(item?.end)) ? Number(item.end) : -1,
    };
  }).filter((item) => item.quote);
}

function normalizeAiChapterAnalysis(payload, chapter, sourceRevision, characters = []) {
  const characterByName = new Map(characters.map((item) => [item.name, item]));
  const facts = (Array.isArray(payload?.facts) ? payload.facts : []).slice(0, 320).map((item, index) => ({
    id: stableId("fact", `${chapter.id}|ai|${index}|${item.type}|${item.subject}|${item.object || item.detail}`),
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
  })).filter((item) => item.object && item.evidence.length);
  const characterStates = (Array.isArray(payload?.characterStates) ? payload.characterStates : []).slice(0, 120).map((item, index) => {
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
      route: Array.isArray(item.route) ? item.route.map(String).slice(0, 12) : [String(item.route || "")].filter(Boolean),
      physical: Array.isArray(item.physical) ? item.physical.map(String).slice(0, 12) : [String(item.physical || "")].filter(Boolean),
      mental: Array.isArray(item.mental) ? item.mental.map(String).slice(0, 12) : [String(item.mental || "")].filter(Boolean),
      abilities: Array.isArray(item.abilities) ? item.abilities.map(String).slice(0, 12) : [String(item.abilities || "")].filter(Boolean),
      goals: Array.isArray(item.goals) ? item.goals.map(String).slice(0, 12) : [String(item.goals || "")].filter(Boolean),
      obstacles: Array.isArray(item.obstacles) ? item.obstacles.map(String).slice(0, 12) : [String(item.obstacles || "")].filter(Boolean),
      knowledge: Array.isArray(item.knowledge) ? item.knowledge.map(String).slice(0, 20) : [String(item.knowledge || "")].filter(Boolean),
      knowledgeSources: Array.isArray(item.knowledgeSources) ? item.knowledgeSources.map(String).slice(0, 20) : [String(item.knowledgeSource || "")].filter(Boolean),
      possessions: Array.isArray(item.possessions) ? item.possessions.map(String).slice(0, 20) : [String(item.possessions || "")].filter(Boolean),
      relationships: Array.isArray(item.relationships) ? item.relationships.map(String).slice(0, 20) : [],
      relationshipChanges: Array.isArray(item.relationshipChanges) ? item.relationshipChanges.map(String).slice(0, 20) : Array.isArray(item.relationships) ? item.relationships.map(String).slice(0, 20) : [],
      lastAppearance: String(item.lastAppearance || "").slice(0, 360),
      lastAppearancePosition: item.lastAppearancePosition && typeof item.lastAppearancePosition === "object" ? {
        start: Number.isFinite(Number(item.lastAppearancePosition.start)) ? Number(item.lastAppearancePosition.start) : -1,
        end: Number.isFinite(Number(item.lastAppearancePosition.end)) ? Number(item.lastAppearancePosition.end) : -1,
      } : undefined,
      evidence: normalizeEvidence(item.evidence, chapter),
      sourceRevision,
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.72)),
      updatedAt: nowIso(),
    };
  }).filter((item) => item.characterName);
  const foreshadows = (Array.isArray(payload?.foreshadows) ? payload.foreshadows : []).slice(0, 120).map((item, index) => ({
    id: stableId("foreshadow", `${chapter.id}|ai|${index}|${item.title}|${item.description}`),
    title: String(item.title || `伏笔候选 ${index + 1}`).slice(0, 80),
    description: String(item.description || item.detail || "").slice(0, 500),
    status: "AI候选",
    plantedAt: /强化/.test(String(item.stage || item.status || "")) || /回收/.test(String(item.stage || item.status || "")) ? [] : normalizeEvidence(item.evidence || item.plantedAt, chapter),
    reinforcedAt: /强化/.test(String(item.stage || item.status || "")) ? normalizeEvidence(item.evidence || item.reinforcedAt, chapter) : normalizeEvidence(item.reinforcedAt, chapter),
    payoffAt: /回收/.test(String(item.stage || item.status || "")) ? normalizeEvidence(item.evidence || item.payoffAt, chapter) : normalizeEvidence(item.payoffAt, chapter),
    plannedPayoff: String(item.plannedPayoff || "").slice(0, 500),
    relatedCharacters: Array.isArray(item.relatedCharacters) ? item.relatedCharacters.map(String).slice(0, 20) : [],
    sourceRevision,
    confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.7)),
    updatedAt: nowIso(),
  })).filter((item) => item.description && [...item.plantedAt, ...item.reinforcedAt, ...item.payoffAt].length);
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

function mergePreservingStatus(nextItems, previousItems, allowedStatuses, defaultStatus) {
  const previousById = new Map((previousItems || []).map((item) => [item.id, item]));
  const previousByEvidence = new Map((previousItems || []).map((item) => [`${item.type || ""}\u0000${item.evidence?.[0]?.quote || item.plantedAt?.[0]?.quote || ""}`, item]));
  return nextItems.map((item) => {
    const signature = `${item.type || ""}\u0000${item.evidence?.[0]?.quote || item.plantedAt?.[0]?.quote || ""}`;
    const previous = previousById.get(item.id) || previousByEvidence.get(signature);
    const status = allowedStatuses.has(previous?.status) ? previous.status : defaultStatus;
    const userEditedFields = Array.isArray(previous?.userEditedFields) ? previous.userEditedFields : [];
    const preservedEdits = Object.fromEntries(userEditedFields.filter((field) => Object.hasOwn(previous || {}, field)).map((field) => [field, previous[field]]));
    return { ...item, ...preservedEdits, status, stale: false, userNote: previous?.userNote || item.userNote || "", userEditedFields };
  });
}

function mergeEvidence(...groups) {
  const seen = new Set();
  const merged = [];
  for (const item of groups.flat()) {
    if (!item?.quote) continue;
    const key = `${item.chapterId || ""}\u0000${item.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.slice(0, 120);
}

function foreshadowMergeKey(item) {
  const title = String(item?.title || "").replace(/[\s，。！？、,.!?：:；;“”"'《》()（）\[\]]/g, "").toLowerCase();
  return title.length >= 4 ? title : `${title}|${String(item?.description || "").slice(0, 28)}`;
}

function collapseForeshadowLifecycle(items) {
  const merged = new Map();
  for (const item of items) {
    const key = foreshadowMergeKey(item);
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, { ...item, plantedAt: mergeEvidence(item.plantedAt || []), reinforcedAt: mergeEvidence(item.reinforcedAt || []), payoffAt: mergeEvidence(item.payoffAt || []) });
      continue;
    }
    const manualWins = previous.origin === "manual" || item.origin !== "manual";
    const combined = {
      ...(manualWins ? item : previous),
      ...(manualWins ? previous : item),
      id: manualWins ? previous.id : item.id,
      status: previous.status !== "AI候选" ? previous.status : item.status,
      plantedAt: mergeEvidence(previous.plantedAt || [], item.plantedAt || []),
      reinforcedAt: mergeEvidence(previous.reinforcedAt || [], item.reinforcedAt || []),
      payoffAt: mergeEvidence(previous.payoffAt || [], item.payoffAt || []),
      relatedCharacters: [...new Set([...(previous.relatedCharacters || []), ...(item.relatedCharacters || [])])].slice(0, 40),
      updatedAt: nowIso(),
    };
    if (combined.payoffAt.length && combined.status === "AI候选") combined.status = "已经回收";
    else if (combined.reinforcedAt.length && combined.status === "AI候选") combined.status = "持续强化";
    merged.set(key, combined);
  }
  return [...merged.values()];
}

async function saveChapterLedger(projectPath, ledger) {
  await ensureStoryState(projectPath);
  const ledgerPath = getLedgerPath(projectPath, ledger.chapterId);
  const previous = await readJson(ledgerPath, null);
  const mergedFacts = mergePreservingStatus(ledger.facts || [], previous?.facts, FACT_STATUSES, "AI识别");
  const mergedFactSignatures = new Set(mergedFacts.map((item) => `${item.type || ""}\u0000${item.evidence?.[0]?.quote || ""}`));
  const preservedFacts = (previous?.facts || [])
    .filter((item) => ["已确认", "已忽略"].includes(item.status))
    .filter((item) => !mergedFactSignatures.has(`${item.type || ""}\u0000${item.evidence?.[0]?.quote || ""}`))
    .filter((item) => item.status === "已确认" || item.sourceRevision === ledger.sourceRevision)
    .map((item) => ({ ...item, stale: item.origin === "manual" ? false : item.sourceRevision !== ledger.sourceRevision, updatedAt: nowIso() }));
  const nextLedger = {
    ...ledger,
    facts: [...preservedFacts, ...mergedFacts],
  };
  await writeJsonAtomic(ledgerPath, nextLedger);
  ledgerReadCache.delete(ledgerPath);

  const foreshadowData = await readJson(getForeshadowsPath(projectPath), { version: STORY_STATE_VERSION, items: [] });
  const retainedForeshadows = (foreshadowData.items || []).filter((item) => item.plantedAt?.[0]?.chapterId !== ledger.chapterId);
  const mergedForeshadows = mergePreservingStatus(ledger.foreshadows || [], foreshadowData.items, FORESHADOW_STATUSES, "AI候选");
  const mergedForeshadowEvidence = new Set(mergedForeshadows.map((item) => item.plantedAt?.[0]?.quote || item.id));
  const preservedForeshadows = (foreshadowData.items || [])
    .filter((item) => item.plantedAt?.[0]?.chapterId === ledger.chapterId)
    .filter((item) => item.status !== "AI候选")
    .filter((item) => !mergedForeshadowEvidence.has(item.plantedAt?.[0]?.quote || item.id))
    .map((item) => ({ ...item, stale: item.origin === "manual" ? false : item.sourceRevision !== ledger.sourceRevision, updatedAt: nowIso() }));
  const allForeshadows = collapseForeshadowLifecycle([...retainedForeshadows, ...preservedForeshadows, ...mergedForeshadows]);
  await writeJsonAtomic(getForeshadowsPath(projectPath), { version: STORY_STATE_VERSION, updatedAt: nowIso(), items: allForeshadows });

  const affectedCharacterIds = new Set([
    ...(previous?.characterStates || []).map((item) => item.characterId),
    ...(nextLedger.characterStates || []).map((item) => item.characterId),
  ].filter(Boolean));
  for (const characterId of affectedCharacterIds) {
    const statePath = path.join(getCharacterStateDir(projectPath), `${safeFileSegment(characterId, "character")}.json`);
    const data = await readJson(statePath, null);
    if (!data?.states?.some((item) => item.chapterId === ledger.chapterId)) continue;
    const states = data.states.filter((item) => item.chapterId !== ledger.chapterId);
    if (!states.length) await fs.rm(statePath, { force: true });
    else await writeJsonAtomic(statePath, { ...data, updatedAt: nowIso(), states });
  }
  for (const state of nextLedger.characterStates || []) {
    const statePath = path.join(getCharacterStateDir(projectPath), `${safeFileSegment(state.characterId, "character")}.json`);
    const data = await readJson(statePath, { version: STORY_STATE_VERSION, characterId: state.characterId, characterName: state.characterName, states: [] });
    const states = [...(data.states || []).filter((item) => item.chapterId !== ledger.chapterId), state]
      .sort((a, b) => Number(a.chapterOrder || 0) - Number(b.chapterOrder || 0) || String(a.updatedAt).localeCompare(String(b.updatedAt)));
    await writeJsonAtomic(statePath, { ...data, characterName: state.characterName, updatedAt: nowIso(), states });
  }

  const index = await readJson(getStoryIndexPath(projectPath), { version: STORY_STATE_VERSION, chapters: [] });
  const chapterEntry = {
    chapterId: ledger.chapterId,
    chapterTitle: ledger.chapterTitle,
    volume: ledger.volume,
    sourceRevision: ledger.sourceRevision,
    analysisMode: ledger.analysisMode,
    analyzedAt: ledger.analyzedAt,
    factCount: nextLedger.facts.length,
    characterStateCount: nextLedger.characterStates.length,
    foreshadowCount: mergedForeshadows.length,
  };
  const chapters = [...(index.chapters || []).filter((item) => item.chapterId !== ledger.chapterId), chapterEntry];
  await writeJsonAtomic(getStoryIndexPath(projectPath), {
    version: STORY_STATE_VERSION,
    updatedAt: nowIso(),
    chapters,
    factCount: chapters.reduce((sum, item) => sum + Number(item.factCount || 0), 0),
    characterStateCount: chapters.reduce((sum, item) => sum + Number(item.characterStateCount || 0), 0),
    foreshadowCount: allForeshadows.length,
  });
  return nextLedger;
}

async function removeChapterLedger(projectPath, chapterId) {
  await ensureStoryState(projectPath);
  const ledger = await readJson(getLedgerPath(projectPath, chapterId), null);
  await fs.rm(getLedgerPath(projectPath, chapterId), { force: true });
  ledgerReadCache.delete(getLedgerPath(projectPath, chapterId));
  const foreshadowData = await readJson(getForeshadowsPath(projectPath), { version: STORY_STATE_VERSION, items: [] });
  const items = (foreshadowData.items || []).filter((item) => item.plantedAt?.[0]?.chapterId !== chapterId);
  await writeJsonAtomic(getForeshadowsPath(projectPath), { ...foreshadowData, updatedAt: nowIso(), items });
  const manualFacts = await readJson(getManualFactsPath(projectPath), { version: STORY_STATE_VERSION, items: [] });
  const retainedManualFacts = (manualFacts.items || []).filter((item) => item.chapterId !== chapterId);
  if (retainedManualFacts.length !== (manualFacts.items || []).length) {
    await writeJsonAtomic(getManualFactsPath(projectPath), { ...manualFacts, updatedAt: nowIso(), items: retainedManualFacts });
  }
  const index = await readJson(getStoryIndexPath(projectPath), { version: STORY_STATE_VERSION, chapters: [] });
  const chapters = (index.chapters || []).filter((item) => item.chapterId !== chapterId);
  await writeJsonAtomic(getStoryIndexPath(projectPath), {
    ...index,
    updatedAt: nowIso(),
    chapters,
    factCount: chapters.reduce((sum, item) => sum + Number(item.factCount || 0), 0),
    characterStateCount: chapters.reduce((sum, item) => sum + Number(item.characterStateCount || 0), 0),
    foreshadowCount: items.length,
  });
  const knownCharacterIds = new Set((ledger?.characterStates || []).map((item) => item.characterId).filter(Boolean));
  const stateFiles = knownCharacterIds.size
    ? [...knownCharacterIds].map((characterId) => `${safeFileSegment(characterId, "character")}.json`)
    : (await fs.readdir(getCharacterStateDir(projectPath)).catch(() => [])).filter((item) => item.endsWith(".json"));
  for (const file of stateFiles) {
    const statePath = path.join(getCharacterStateDir(projectPath), file);
    const data = await readJson(statePath, null);
    if (!data?.states?.some((item) => item.chapterId === chapterId)) continue;
    const states = data.states.filter((item) => item.chapterId !== chapterId);
    if (!states.length) await fs.rm(statePath, { force: true });
    else await writeJsonAtomic(statePath, { ...data, updatedAt: nowIso(), states });
  }
}

async function listCharacterStates(projectPath) {
  await ensureStoryState(projectPath);
  const files = (await fs.readdir(getCharacterStateDir(projectPath)).catch(() => [])).filter((item) => item.endsWith(".json"));
  const records = await Promise.all(files.map((file) => readJson(path.join(getCharacterStateDir(projectPath), file), null)));
  return records.filter(Boolean).map((record) => {
    const states = (Array.isArray(record.states) ? record.states : []).map((item) => ({
      ...item,
      route: Array.isArray(item.route) ? item.route : [],
      physical: Array.isArray(item.physical) ? item.physical : [],
      mental: Array.isArray(item.mental) ? item.mental : [],
      abilities: Array.isArray(item.abilities) ? item.abilities : [],
      goals: Array.isArray(item.goals) ? item.goals : [],
      obstacles: Array.isArray(item.obstacles) ? item.obstacles : [],
      knowledge: Array.isArray(item.knowledge) ? item.knowledge : [],
      knowledgeSources: Array.isArray(item.knowledgeSources) ? item.knowledgeSources : [],
      possessions: Array.isArray(item.possessions) ? item.possessions : [],
      relationships: Array.isArray(item.relationships) ? item.relationships : [],
      relationshipChanges: Array.isArray(item.relationshipChanges) ? item.relationshipChanges : Array.isArray(item.relationships) ? item.relationships : [],
    }));
    return {
    characterId: record.characterId,
    characterName: record.characterName,
    states,
    latest: states.length ? states[states.length - 1] : null,
  };
  });
}

async function getStoryOverview(projectPath, options = {}) {
  await ensureStoryState(projectPath);
  const index = await readJson(getStoryIndexPath(projectPath), { version: STORY_STATE_VERSION, chapters: [] });
  const selectedChapterIds = new Set((options.chapterIds || []).map(String));
  const chapterEntries = selectedChapterIds.size ? (index.chapters || []).filter((item) => selectedChapterIds.has(item.chapterId)) : index.chapters || [];
  const ledgerLimit = Math.max(1, Math.min(500, Number(options.chapterLimit) || 120));
  const ledgers = (await Promise.all(chapterEntries.slice(-ledgerLimit).map((item) => readLedgerCached(projectPath, item.chapterId)))).filter(Boolean);
  const manualFacts = (await readJson(getManualFactsPath(projectPath), { items: [] })).items || [];
  let facts = [...ledgers.flatMap((item) => item.facts || []), ...manualFacts];
  if (selectedChapterIds.size) facts = facts.filter((item) => selectedChapterIds.has(item.chapterId));
  if (options.volume) facts = facts.filter((item) => item.volume === options.volume);
  if (options.factStatus) facts = facts.filter((item) => item.status === options.factStatus);
  if (options.query) {
    const query = String(options.query).toLowerCase();
    facts = facts.filter((item) => `${item.subject} ${item.predicate} ${item.object} ${item.chapterTitle}`.toLowerCase().includes(query));
  }
  const allForeshadows = (await readJson(getForeshadowsPath(projectPath), { items: [] })).items || [];
  let foreshadows = allForeshadows;
  if (selectedChapterIds.size) foreshadows = foreshadows.filter((item) => [...(item.plantedAt || []), ...(item.reinforcedAt || []), ...(item.payoffAt || [])].some((evidence) => selectedChapterIds.has(evidence.chapterId)));
  if (options.volume) foreshadows = foreshadows.filter((item) => [...(item.plantedAt || []), ...(item.reinforcedAt || []), ...(item.payoffAt || [])].some((evidence) => evidence.volume === options.volume));
  if (options.foreshadowStatus) foreshadows = foreshadows.filter((item) => item.status === options.foreshadowStatus);
  if (options.query) {
    const query = String(options.query).toLowerCase();
    foreshadows = foreshadows.filter((item) => `${item.title} ${item.description} ${item.userNote || ""}`.toLowerCase().includes(query));
  }
  let characters = await listCharacterStates(projectPath);
  characters = characters.map((record) => {
    let states = record.states || [];
    if (selectedChapterIds.size) states = states.filter((item) => selectedChapterIds.has(item.chapterId));
    if (options.volume) states = states.filter((item) => item.volume === options.volume);
    return { ...record, states, latest: states.length ? states[states.length - 1] : null };
  }).filter((record) => record.states.length);
  if (options.query) {
    const query = String(options.query).toLowerCase();
    characters = characters.filter((record) => `${record.characterName} ${record.states.map((item) => `${item.location} ${item.route?.join(" ")} ${item.physical?.join(" ")} ${item.mental?.join(" ")} ${item.abilities?.join(" ")} ${item.goals?.join(" ")} ${item.obstacles?.join(" ")} ${item.knowledge?.join(" ")} ${item.relationshipChanges?.join(" ")}`).join(" ")}`.toLowerCase().includes(query));
  }
  const covered = new Set((index.chapters || []).map((item) => item.chapterId));
  const projectChapterIds = (options.projectChapters || []).map((item) => item.id);
  return {
    updatedAt: index.updatedAt || "",
    counts: {
      chapters: (index.chapters || []).length,
      facts: Number(index.factCount || 0) + manualFacts.length,
      characterStates: Number(index.characterStateCount || 0),
      foreshadows: allForeshadows.length,
      boards: (await fs.readdir(getBoardsDir(projectPath)).catch(() => [])).filter((item) => item.endsWith(".json")).length,
    },
    coverage: {
      total: projectChapterIds.length,
      analyzed: projectChapterIds.filter((id) => covered.has(id)).length,
      stale: (index.chapters || []).filter((entry) => {
        const chapter = (options.projectChapters || []).find((item) => item.id === entry.chapterId);
        return chapter?.revision && chapter.revision !== entry.sourceRevision;
      }).map((item) => item.chapterId),
      missing: projectChapterIds.filter((id) => !covered.has(id)),
    },
    chapterEntries: index.chapters || [],
    facts: facts.slice(Math.max(0, Number(options.factOffset) || 0), Math.max(0, Number(options.factOffset) || 0) + Math.max(20, Math.min(2000, Number(options.factLimit) || 400))),
    characterStates: characters.slice(Math.max(0, Number(options.characterOffset) || 0), Math.max(0, Number(options.characterOffset) || 0) + Math.max(20, Math.min(500, Number(options.characterLimit) || 200))),
    foreshadows: foreshadows.slice(Math.max(0, Number(options.foreshadowOffset) || 0), Math.max(0, Number(options.foreshadowOffset) || 0) + Math.max(20, Math.min(1000, Number(options.foreshadowLimit) || 300))),
    pageInfo: {
      facts: { total: facts.length, offset: Math.max(0, Number(options.factOffset) || 0), limit: Math.max(20, Math.min(2000, Number(options.factLimit) || 400)) },
      characters: { total: characters.length, offset: Math.max(0, Number(options.characterOffset) || 0), limit: Math.max(20, Math.min(500, Number(options.characterLimit) || 200)) },
      foreshadows: { total: foreshadows.length, offset: Math.max(0, Number(options.foreshadowOffset) || 0), limit: Math.max(20, Math.min(1000, Number(options.foreshadowLimit) || 300)) },
    },
  };
}

async function updateFact(projectPath, factId, patch = {}) {
  await ensureStoryState(projectPath);
  const manualData = await readJson(getManualFactsPath(projectPath), { version: STORY_STATE_VERSION, items: [] });
  const manualIndex = manualData.items.findIndex((item) => item.id === factId);
  if (manualIndex >= 0) {
    const current = manualData.items[manualIndex];
    manualData.items[manualIndex] = {
      ...current,
      type: String(patch.type ?? current.type).slice(0, 30),
      subject: String(patch.subject ?? current.subject).slice(0, 100),
      predicate: String(patch.predicate ?? current.predicate).slice(0, 100),
      object: String(patch.object ?? current.object).slice(0, 2000),
      status: FACT_STATUSES.has(patch.status) ? patch.status : current.status,
      userNote: String(patch.userNote ?? current.userNote ?? "").slice(0, 2000),
      updatedAt: nowIso(),
    };
    manualData.updatedAt = nowIso();
    await writeJsonAtomic(getManualFactsPath(projectPath), manualData);
    return manualData.items[manualIndex];
  }
  const index = await readJson(getStoryIndexPath(projectPath), { chapters: [] });
  for (const chapter of index.chapters || []) {
    const filePath = getLedgerPath(projectPath, chapter.chapterId);
    const ledger = await readJson(filePath, null);
    const itemIndex = ledger?.facts?.findIndex((item) => item.id === factId) ?? -1;
    if (itemIndex < 0) continue;
    const current = ledger.facts[itemIndex];
    const status = FACT_STATUSES.has(patch.status) ? patch.status : current.status;
    const editedFields = ["type", "subject", "predicate", "object"].filter((field) => patch[field] !== undefined);
    ledger.facts[itemIndex] = {
      ...current,
      type: String(patch.type ?? current.type).slice(0, 30),
      subject: String(patch.subject ?? current.subject).slice(0, 100),
      predicate: String(patch.predicate ?? current.predicate).slice(0, 100),
      object: String(patch.object ?? current.object).slice(0, 2000),
      status,
      userNote: String(patch.userNote ?? current.userNote ?? "").slice(0, 2000),
      userEditedFields: [...new Set([...(current.userEditedFields || []), ...editedFields])],
      updatedAt: nowIso(),
    };
    await writeJsonAtomic(filePath, ledger);
    ledgerReadCache.delete(filePath);
    return ledger.facts[itemIndex];
  }
  throw new Error("没有找到这条剧情事实。它可能已经随章节重新分析而更新。");
}

async function createManualFact(projectPath, payload = {}) {
  await ensureStoryState(projectPath);
  const createdAt = nowIso();
  const item = {
    id: stableId("fact-manual", `${createdAt}|${Math.random()}|${payload.chapterId}|${payload.subject}|${payload.object}`),
    type: String(payload.type || "剧情事件").slice(0, 30),
    subject: String(payload.subject || "未明确").trim().slice(0, 100) || "未明确",
    predicate: String(payload.predicate || payload.type || "发生").trim().slice(0, 100) || "发生",
    object: String(payload.object || "").trim().slice(0, 2000),
    chapterId: String(payload.chapterId || ""),
    chapterTitle: String(payload.chapterTitle || "未关联章节").slice(0, 120),
    volume: String(payload.volume || "未分卷").slice(0, 120),
    confidence: 1,
    status: "已确认",
    evidence: Array.isArray(payload.evidence) && payload.evidence.length ? payload.evidence.slice(0, 8) : [{ chapterId: String(payload.chapterId || ""), chapterTitle: String(payload.chapterTitle || "未关联章节").slice(0, 120), volume: String(payload.volume || "未分卷").slice(0, 120), heading: "人工记录", quote: String(payload.object || "人工记录").slice(0, 360), start: -1, end: -1 }],
    sourceRevision: "manual",
    origin: "manual",
    userNote: String(payload.userNote || "").slice(0, 2000),
    stale: false,
    updatedAt: createdAt,
  };
  if (!item.object) throw new Error("请填写剧情事实内容。");
  const data = await readJson(getManualFactsPath(projectPath), { version: STORY_STATE_VERSION, items: [] });
  data.items = [item, ...(data.items || [])].slice(0, 20000);
  data.updatedAt = createdAt;
  await writeJsonAtomic(getManualFactsPath(projectPath), data);
  return item;
}

async function deleteFact(projectPath, factId) {
  await ensureStoryState(projectPath);
  const data = await readJson(getManualFactsPath(projectPath), { version: STORY_STATE_VERSION, items: [] });
  const item = (data.items || []).find((candidate) => candidate.id === factId);
  if (!item) throw new Error("自动识别的事实不能直接删除，请改为“已忽略”；只有人工新增的事实可以删除。");
  data.items = data.items.filter((candidate) => candidate.id !== factId);
  data.updatedAt = nowIso();
  await writeJsonAtomic(getManualFactsPath(projectPath), data);
  return { removed: true, factId };
}

async function updateForeshadow(projectPath, foreshadowId, patch = {}) {
  await ensureStoryState(projectPath);
  const data = await readJson(getForeshadowsPath(projectPath), { version: STORY_STATE_VERSION, items: [] });
  const index = data.items.findIndex((item) => item.id === foreshadowId);
  if (index < 0) throw new Error("没有找到这条伏笔。它可能已经随章节重新分析而更新。");
  const current = data.items[index];
  const editedFields = ["title", "description", "plannedPayoff", "plantedAt", "reinforcedAt", "payoffAt", "relatedCharacters"].filter((field) => patch[field] !== undefined);
  const normalizePatchedEvidence = (field) => Array.isArray(patch[field])
    ? mergeEvidence(patch[field].map((item) => ({
      chapterId: String(item?.chapterId || ""), chapterTitle: String(item?.chapterTitle || "").slice(0, 120), volume: String(item?.volume || "未分卷").slice(0, 120),
      heading: String(item?.heading || "").slice(0, 80), quote: String(item?.quote || "").slice(0, 360),
      start: Number.isFinite(Number(item?.start)) ? Number(item.start) : -1,
      end: Number.isFinite(Number(item?.end)) ? Number(item.end) : -1,
    })))
    : current[field] || [];
  data.items[index] = {
    ...current,
    status: FORESHADOW_STATUSES.has(patch.status) ? patch.status : current.status,
    title: String(patch.title ?? current.title).slice(0, 80),
    description: String(patch.description ?? current.description).slice(0, 1000),
    plannedPayoff: String(patch.plannedPayoff ?? current.plannedPayoff ?? "").slice(0, 1000),
    plantedAt: normalizePatchedEvidence("plantedAt"),
    reinforcedAt: normalizePatchedEvidence("reinforcedAt"),
    payoffAt: normalizePatchedEvidence("payoffAt"),
    relatedCharacters: Array.isArray(patch.relatedCharacters) ? patch.relatedCharacters.map(String).slice(0, 40) : current.relatedCharacters || [],
    userNote: String(patch.userNote ?? current.userNote ?? "").slice(0, 1000),
    userEditedFields: [...new Set([...(current.userEditedFields || []), ...editedFields])],
    updatedAt: nowIso(),
  };
  data.updatedAt = nowIso();
  await writeJsonAtomic(getForeshadowsPath(projectPath), data);
  return data.items[index];
}

async function createManualForeshadow(projectPath, payload = {}) {
  await ensureStoryState(projectPath);
  const createdAt = nowIso();
  const evidence = {
    chapterId: String(payload.chapterId || ""),
    chapterTitle: String(payload.chapterTitle || "未关联章节").slice(0, 120),
    volume: String(payload.volume || "未分卷").slice(0, 120),
    heading: "人工记录",
    quote: String(payload.evidenceQuote || payload.description || "人工记录").slice(0, 360),
    start: -1,
    end: -1,
  };
  const item = {
    id: stableId("foreshadow-manual", `${createdAt}|${Math.random()}|${payload.chapterId}|${payload.title}`),
    title: String(payload.title || "").trim().slice(0, 80),
    description: String(payload.description || "").trim().slice(0, 1000),
    status: FORESHADOW_STATUSES.has(payload.status) ? payload.status : "已确认埋下",
    plantedAt: [evidence],
    reinforcedAt: [],
    payoffAt: [],
    plannedPayoff: String(payload.plannedPayoff || "").slice(0, 1000),
    relatedCharacters: Array.isArray(payload.relatedCharacters) ? payload.relatedCharacters.map(String).slice(0, 20) : [],
    sourceRevision: "manual",
    origin: "manual",
    confidence: 1,
    userNote: String(payload.userNote || "").slice(0, 2000),
    stale: false,
    updatedAt: createdAt,
  };
  if (!item.title || !item.description) throw new Error("请填写伏笔标题和内容。");
  const data = await readJson(getForeshadowsPath(projectPath), { version: STORY_STATE_VERSION, items: [] });
  data.items = [item, ...(data.items || [])].slice(0, 20000);
  data.updatedAt = createdAt;
  await writeJsonAtomic(getForeshadowsPath(projectPath), data);
  return item;
}

async function deleteForeshadow(projectPath, foreshadowId) {
  await ensureStoryState(projectPath);
  const data = await readJson(getForeshadowsPath(projectPath), { version: STORY_STATE_VERSION, items: [] });
  const item = (data.items || []).find((candidate) => candidate.id === foreshadowId);
  if (!item) return { removed: false, foreshadowId };
  if (item.origin !== "manual") throw new Error("自动识别的伏笔不能直接删除，请改为“已废弃”；只有人工新增的伏笔可以删除。");
  data.items = data.items.filter((candidate) => candidate.id !== foreshadowId);
  data.updatedAt = nowIso();
  await writeJsonAtomic(getForeshadowsPath(projectPath), data);
  return { removed: true, foreshadowId };
}

function boardItemsFromContext(chapter, nextChapter, ledger, foreshadows) {
  const characterNames = [...new Set((ledger?.characterStates || []).map((item) => item.characterName))].slice(0, 8);
  const openForeshadows = (foreshadows || []).filter((item) => !["已经回收", "已废弃"].includes(item.status)).slice(0, 5);
  const target = nextChapter?.title || `${chapter.title}之后`;
  const rawItems = [
    ["章节目标", `明确《${target}》要改变什么局面，避免只重复上一章信息。`, "目标"],
    ["承接结果", `用一个短场景承接《${chapter.title}》造成的直接后果。`, "节奏"],
    ["人物表现", characterNames.length ? `让${characterNames.join("、")}至少一人的选择推动事件。` : "让主要人物通过选择推动事件，而不是只被动听取信息。", "人物"],
    ["冲突升级", "增加一个与主线目标直接相关的新阻碍，并让角色付出明确代价。", "冲突"],
    ["信息释放", "只释放完成本章目标所需的信息，其余设定继续保留悬念。", "信息"],
    ["伏笔处理", openForeshadows.length ? `考虑强化或回收：${openForeshadows.map((item) => item.title).join("、")}` : "检查是否需要埋下一处可在后文验证的异常细节。", "伏笔"],
    ["结尾钩子", "以新决定、新发现或迫近危险结束，让下一章目标自然成立。", "结尾"],
  ];
  return rawItems.map(([title, detail, type], index) => ({
    id: stableId("beat", `${chapter.id}|${index}|${title}`),
    type,
    title,
    detail,
    order: index,
    locked: false,
    completed: false,
    sourceRefs: [],
  }));
}

async function getBoard(projectPath, chapterId) {
  await ensureStoryState(projectPath);
  return readJson(getBoardPath(projectPath, chapterId), null);
}

async function saveBoard(projectPath, board) {
  if (!board?.chapterId) throw new Error("筹备板缺少来源章节。");
  const items = (Array.isArray(board.items) ? board.items : []).slice(0, 80).map((item, index) => ({
    id: String(item.id || stableId("beat", `${board.chapterId}|${index}|${item.title}`)),
    type: String(item.type || "事件").slice(0, 20),
    title: String(item.title || `筹备项 ${index + 1}`).slice(0, 100),
    detail: String(item.detail || "").slice(0, 2000),
    order: index,
    locked: Boolean(item.locked),
    completed: Boolean(item.completed),
    sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs.slice(0, 20) : [],
  }));
  const next = { ...board, version: STORY_STATE_VERSION, items, updatedAt: nowIso() };
  await writeJsonAtomic(getBoardPath(projectPath, board.chapterId), next);
  return next;
}

async function generateLocalBoard(projectPath, chapter, nextChapter) {
  await ensureStoryState(projectPath);
  const previous = await getBoard(projectPath, chapter.id);
  const ledger = await readJson(getLedgerPath(projectPath, chapter.id), null);
  const foreshadows = (await readJson(getForeshadowsPath(projectPath), { items: [] })).items || [];
  const generated = boardItemsFromContext(chapter, nextChapter, ledger, foreshadows);
  const locked = (previous?.items || []).filter((item) => item.locked);
  const lockedIds = new Set(locked.map((item) => item.id));
  const items = [...locked, ...generated.filter((item) => !lockedIds.has(item.id))];
  return saveBoard(projectPath, {
    id: previous?.id || stableId("board", chapter.id),
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    targetChapterId: nextChapter?.id || "",
    targetChapterTitle: nextChapter?.title || "下一章",
    status: previous?.status || "筹备中",
    generatedAt: nowIso(),
    items,
  });
}

async function getAgentContext(projectPath, chapterId, characterNames = [], contextIds = []) {
  await ensureStoryState(projectPath);
  const ledger = await readLedgerCached(projectPath, chapterId);
  const foreshadows = (await readJson(getForeshadowsPath(projectPath), { items: [] })).items || [];
  const manualFacts = (await readJson(getManualFactsPath(projectPath), { items: [] })).items || [];
  const characterStates = await listCharacterStates(projectPath);
  const selectedCharacters = characterStates.filter((item) => !characterNames.length || characterNames.includes(item.characterName));
  const selectedIds = new Set((contextIds || []).map(String));
  let selectedFacts = [];
  if (selectedIds.size) {
    const index = await readJson(getStoryIndexPath(projectPath), { chapters: [] });
    const ledgers = (await Promise.all((index.chapters || []).map((item) => readLedgerCached(projectPath, item.chapterId)))).filter(Boolean);
    selectedFacts = [...ledgers.flatMap((item) => item.facts || []), ...manualFacts].filter((item) => selectedIds.has(item.id));
  }
  const baseFacts = [...(ledger?.facts || []), ...manualFacts.filter((item) => item.chapterId === chapterId)].filter((item) => item.status !== "已忽略");
  const facts = [...selectedFacts, ...baseFacts.filter((item) => !selectedFacts.some((selected) => selected.id === item.id))];
  const prioritizedCharacters = selectedIds.size
    ? characterStates.filter((record) => selectedIds.has(record.characterId) || record.states.some((state) => selectedIds.has(state.id)))
    : [];
  const characterContext = [...prioritizedCharacters, ...selectedCharacters.filter((record) => !prioritizedCharacters.some((selected) => selected.characterId === record.characterId))];
  const openForeshadows = foreshadows.filter((item) => !["已经回收", "已废弃"].includes(item.status));
  const prioritizedForeshadows = selectedIds.size ? foreshadows.filter((item) => selectedIds.has(item.id)) : [];
  return {
    ledger,
    facts: facts.slice(0, 120),
    characterStates: characterContext.map((item) => item.states.find((state) => selectedIds.has(state.id)) || item.latest).filter(Boolean).slice(0, 50),
    foreshadows: [...prioritizedForeshadows, ...openForeshadows.filter((item) => !prioritizedForeshadows.some((selected) => selected.id === item.id))].slice(0, 60),
  };
}

module.exports = {
  FACT_STATUSES,
  FORESHADOW_STATUSES,
  STORY_STATE_VERSION,
  analyzeChapterLocally,
  createManualFact,
  createManualForeshadow,
  deleteFact,
  deleteForeshadow,
  ensureStoryState,
  generateLocalBoard,
  getAgentContext,
  getBoard,
  getStoryOverview,
  normalizeAiChapterAnalysis,
  removeChapterLedger,
  saveBoard,
  saveChapterLedger,
  updateFact,
  updateForeshadow,
};
