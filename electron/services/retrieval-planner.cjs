const path = require("node:path");
const { readJson, sha256, writeJsonAtomic } = require("./project-storage.cjs");

const CACHE_VERSION = 1;

function compact(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[《》“”"'‘’：:，,。.!！?？、；;（）()[\]{}【】\s·_\-—]/g, "");
}

function unique(values, limit = Infinity) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, limit);
}

function queryTerms(value) {
  const raw = String(value || "");
  const words = raw.match(/[\u4e00-\u9fff]{2,12}|[a-zA-Z][a-zA-Z0-9_-]{2,}/g) || [];
  const terms = [];
  for (const word of words) {
    terms.push(word.toLowerCase());
    if (/^[\u4e00-\u9fff]+$/.test(word) && word.length >= 4) {
      for (let index = 0; index < word.length - 1; index += 1) terms.push(word.slice(index, index + 2));
    }
  }
  return unique(terms, 100);
}

function decomposeQuery(question, mode = "normal") {
  const text = String(question || "").trim();
  const clauses = text
    .split(/[\n。！？!?；;]/)
    .map((item) => item.replace(/^\s*(?:\d+[.、]|[-*•])\s*/, "").trim())
    .filter((item) => item.length >= 4);
  const inferred = [];
  const add = (kind, label, query) => inferred.push({ kind, label, query });
  if (/(人物|角色|动机|成长|弧光|关系|性格)/.test(text)) add("character", "人物与动机", `${text} 人物 动机 状态 关系 成长 选择`);
  if (/(时间|先后|顺序|时间线|日期|年龄)/.test(text)) add("timeline", "时间与顺序", `${text} 时间 顺序 前后 日期 事件`);
  if (/(伏笔|线索|悬念|回收|铺垫|预兆)/.test(text)) add("foreshadow", "伏笔与线索", `${text} 伏笔 线索 埋设 强化 回收`);
  if (/(因果|合理|逻辑|矛盾|一致性|冲突|漏洞)/.test(text)) add("causality", "因果与一致性", `${text} 原因 结果 动机 冲突 一致性`);
  if (/(节奏|剧情|事件|推进|转折|高潮|场景)/.test(text)) add("plot", "情节与节奏", `${text} 事件 推进 转折 节奏 场景`);
  if (/(世界观|设定|地点|势力|物品|规则|能力)/.test(text)) add("setting", "设定与规则", `${text} 世界观 地点 势力 物品 规则 限制`);
  if (mode === "book") {
    add("coverage", "全书结构覆盖", `${text} 全书 各卷 各章 主线 支线 阶段`);
    if (!inferred.some((item) => item.kind === "causality")) add("causality", "全书因果", `${text} 全书 因果 动机 结果 一致性`);
  }
  const clauseItems = clauses.slice(0, 5).map((query, index) => ({ kind: "clause", label: `问题 ${index + 1}`, query }));
  const candidates = [{ kind: "primary", label: "主要问题", query: text }, ...clauseItems, ...inferred];
  const seen = new Set();
  return candidates.filter((item) => {
    const key = compact(item.query);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8).map((item, index) => ({ id: `query_${index + 1}`, ...item, terms: queryTerms(item.query) }));
}

function extractQuerySignals(question, characters = [], worldDocs = []) {
  const text = String(question || "");
  const charactersFound = characters.map((item) => item.name).filter((name) => name && text.includes(name));
  const settings = worldDocs.filter((item) => item.title && text.includes(item.title));
  const locations = [...text.matchAll(/([\u4e00-\u9fa5]{2,10}(?:城|镇|村|山|河|湖|海|宫|殿|阁|府|院|国|洲|谷|林|岛))/g)].map((match) => match[1]);
  const timeHints = [...text.matchAll(/(清晨|黎明|上午|正午|午后|黄昏|傍晚|午夜|昨日|今天|明日|次日|第[一二三四五六七八九十百\d]+天|[一二三四五六七八九十百\d]+年前|[一二三四五六七八九十百\d]+年后)/g)].map((match) => match[1]);
  return {
    characters: unique(charactersFound, 40),
    locations: unique([...locations, ...settings.map((item) => item.title)], 40),
    timeHints: unique(timeHints, 30),
    sourceIds: unique([...characters.filter((item) => charactersFound.includes(item.name)).map((item) => item.id), ...settings.map((item) => item.id)], 80),
  };
}

function countIntersections(left = [], right = []) {
  const wanted = right.map(compact).filter(Boolean);
  return unique(left).filter((item) => wanted.some((target) => compact(item).includes(target) || target.includes(compact(item)))).length;
}

function scoreMetadata(item, signals = {}) {
  const metadata = item.metadata || {};
  const characterHits = countIntersections(metadata.characters, signals.characters);
  const locationHits = countIntersections(metadata.locations, signals.locations);
  const timeHits = countIntersections(metadata.timeHints, signals.timeHints);
  const directSource = (signals.sourceIds || []).includes(item.sourceId);
  return Math.min(0.9, characterHits * 0.22 + locationHits * 0.16 + timeHits * 0.12 + (directSource ? 0.35 : 0));
}

function buildChapterAdjacency(chapters = [], anchorIds = []) {
  const ordered = chapters.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const positions = new Map(ordered.map((chapter, index) => [String(chapter.id), index]));
  const anchors = unique(anchorIds).map((id) => positions.get(id)).filter(Number.isInteger);
  const scores = {};
  for (let index = 0; index < ordered.length; index += 1) {
    if (!anchors.length) break;
    const distance = Math.min(...anchors.map((anchor) => Math.abs(anchor - index)));
    if (distance === 0) scores[ordered[index].id] = 0.42;
    else if (distance === 1) scores[ordered[index].id] = 0.24;
    else if (distance === 2) scores[ordered[index].id] = 0.1;
  }
  return scores;
}

function sourceRefsFromWorkspace(workspace = {}, storyContext = {}) {
  const entries = [];
  const add = (sourceId, text, weight) => {
    if (sourceId) entries.push({ sourceId: String(sourceId), text: String(text || ""), weight });
  };
  for (const item of workspace.causalNodes || []) add(item.chapterId, `${item.title} ${item.detail} ${item.type}`, 0.3);
  for (const item of workspace.arcs || []) add(item.chapterId, `${item.characterName} ${item.stage} ${item.desire} ${item.fear} ${item.change}`, 0.28);
  for (const item of storyContext.facts || []) for (const ref of item.evidence || []) add(ref.chapterId, `${item.subject} ${item.predicate} ${item.object}`, 0.26);
  for (const item of storyContext.characterStates || []) for (const ref of item.evidence || []) add(ref.chapterId, `${item.characterName} ${(item.goals || []).join(" ")} ${(item.knowledge || []).join(" ")}`, 0.24);
  for (const item of storyContext.foreshadows || []) {
    const refs = [...(item.plantedAt || []), ...(item.reinforcedAt || []), ...(item.payoffAt || [])];
    for (const ref of refs) add(ref.chapterId, `${item.title} ${item.description} ${item.status}`, 0.32);
  }
  return entries;
}

function buildStoryBoosts(workspace, storyContext, subQueries = []) {
  const terms = unique(subQueries.flatMap((item) => item.terms || []), 160);
  const scores = {};
  for (const entry of sourceRefsFromWorkspace(workspace, storyContext)) {
    const haystack = compact(entry.text);
    const hits = terms.filter((term) => haystack.includes(compact(term))).length;
    const value = hits ? entry.weight + Math.min(0.18, hits * 0.03) : entry.weight * 0.35;
    scores[entry.sourceId] = Math.min(0.75, (scores[entry.sourceId] || 0) + value);
  }
  return scores;
}

function scoreSubQueries(item, subQueries = [], lexicalScore = () => 0) {
  let best = 0;
  let matched = "";
  for (const query of subQueries) {
    const score = Number(lexicalScore(item, query.query) || 0);
    if (score > best) {
      best = score;
      matched = query.label;
    }
  }
  return { score: Math.min(0.65, best * 0.45), matched };
}

function scoreCandidate(item, context = {}) {
  const entityScore = scoreMetadata(item, context.signals);
  const adjacencyScore = Number(context.adjacencyScores?.[item.sourceId] || 0);
  const storyScore = Number(context.storyScores?.[item.sourceId] || 0);
  const subQuery = scoreSubQueries(item, context.subQueries, context.lexicalScore);
  return { entityScore, adjacencyScore, storyScore, subQueryScore: subQuery.score, matchedSubQuery: subQuery.matched };
}

function selectionReasons(item) {
  const reasons = [];
  if (Number(item.vectorScore || 0) >= 0.2) reasons.push("语义相近");
  if (Number(item.keywordScore || 0) >= 0.16) reasons.push("关键词命中");
  if (Number(item.entityScore || 0) > 0) reasons.push("人物/地点/时间命中");
  if (Number(item.adjacencyScore || 0) > 0) reasons.push("相邻章节");
  if (Number(item.storyScore || 0) > 0) reasons.push("剧情事实/伏笔/因果关联");
  if (Number(item.hierarchyBoost || 0) > 0) reasons.push("分层摘要路由");
  if (Number(item.subQueryScore || 0) > 0 && item.matchedSubQuery) reasons.push(`命中“${item.matchedSubQuery}”`);
  return reasons.length ? reasons : ["综合相关度入选"];
}

function sourceGroup(source, configById = new Map()) {
  const chapter = configById.get(String(source.sourceId));
  return chapter?.volume || source.volume || source.category || (source.sourceType === "character" ? "角色卡" : source.sourceType === "world" ? "世界观" : "未分卷");
}

function buildCoverageAudit(chunks = [], config = {}, summaries = {}, manifest = {}) {
  const configById = new Map((config.chapters || []).map((chapter) => [String(chapter.id), chapter]));
  const manifestSources = Array.isArray(manifest.sources) ? manifest.sources : [];
  const selectedBySource = new Map();
  for (const chunk of chunks) selectedBySource.set(String(chunk.sourceId), (selectedBySource.get(String(chunk.sourceId)) || 0) + 1);
  const groups = new Map();
  for (const source of manifestSources) {
    const group = sourceGroup(source, configById);
    if (!groups.has(group)) groups.set(group, { volume: group, indexedSources: 0, selectedSources: 0, selectedChunks: 0, summaryAvailable: false });
    const entry = groups.get(group);
    entry.indexedSources += 1;
    const count = selectedBySource.get(String(source.sourceId)) || 0;
    if (count) entry.selectedSources += 1;
    entry.selectedChunks += count;
  }
  const summaryGroups = new Set((summaries.volumes || []).map((item) => String(item.title || "")));
  for (const entry of groups.values()) entry.summaryAvailable = summaryGroups.has(entry.volume);
  const coverageByVolume = [...groups.values()].sort((a, b) => String(a.volume).localeCompare(String(b.volume), "zh-CN"));
  const warnings = [];
  for (const entry of coverageByVolume) {
    if (!entry.selectedSources && !entry.summaryAvailable) warnings.push(`${entry.volume}没有进入本次上下文，也没有可用分卷摘要`);
  }
  const bodyChapters = (config.chapters || []).filter((chapter) => (chapter.knowledgeRole || "正文") === "正文");
  const selectedBody = bodyChapters.filter((chapter) => selectedBySource.has(String(chapter.id))).length;
  return {
    coverageByVolume,
    rawChapterCoverage: { selected: selectedBody, total: bodyChapters.length },
    coverageWarnings: warnings.slice(0, 30),
  };
}

function buildSourceReasons(chunks = [], manifest = {}, config = {}, limit = 160) {
  const configById = new Map((config.chapters || []).map((chapter) => [String(chapter.id), chapter]));
  const selectedGroups = new Map();
  for (const chunk of chunks) {
    const sourceId = String(chunk.sourceId);
    if (!selectedGroups.has(sourceId)) selectedGroups.set(sourceId, []);
    selectedGroups.get(sourceId).push(chunk);
  }
  const selectedSourceReasons = [...selectedGroups.entries()].map(([sourceId, entries]) => {
    const best = entries.slice().sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
    return { sourceId, title: best.title, group: sourceGroup(best, configById), reasons: selectionReasons(best), chunks: entries.length, score: Number(best.score || 0) };
  }).sort((a, b) => b.score - a.score).slice(0, limit);
  const selectedIds = new Set(selectedGroups.keys());
  const skippedSourceReasons = (manifest.sources || []).filter((item) => !selectedIds.has(String(item.sourceId))).map((item) => ({
    sourceId: String(item.sourceId),
    title: item.title,
    group: sourceGroup(item, configById),
    reason: "相关度、片段上限或上下文预算不足",
  })).slice(0, 500);
  return { selectedSourceReasons, skippedSourceReasons };
}

function cachePath(projectPath) {
  return path.join(projectPath, "analysis", "retrieval", "volume-cache.json");
}

async function ensureVolumeCache(projectPath, { manifest = {}, summaries = {}, config = {} } = {}) {
  const fingerprint = sha256(JSON.stringify({ manifestUpdatedAt: manifest.updatedAt || "", summaryUpdatedAt: summaries.updatedAt || "", chapterCount: (config.chapters || []).length }));
  const previous = await readJson(cachePath(projectPath), null);
  if (previous?.version === CACHE_VERSION && previous.fingerprint === fingerprint) return { ...previous, reused: true };
  const summaryByGroup = new Map((summaries.volumes || []).map((item) => [String(item.title || ""), item]));
  const chapterById = new Map((config.chapters || []).map((item) => [String(item.id), item]));
  const groups = new Map();
  for (const source of manifest.sources || []) {
    const chapter = chapterById.get(String(source.sourceId));
    const group = chapter?.volume || source.volume || source.category || (source.sourceType === "character" ? "角色卡" : source.sourceType === "world" ? "世界观" : "未分卷");
    if (!groups.has(group)) groups.set(group, { title: group, sourceIds: [], documentCount: 0, chunkCount: 0, summary: summaryByGroup.get(group)?.summary || "" });
    const entry = groups.get(group);
    entry.sourceIds.push(String(source.sourceId));
    entry.documentCount += 1;
    entry.chunkCount += Number(source.chunkCount || 0);
  }
  const cache = { version: CACHE_VERSION, fingerprint, updatedAt: new Date().toISOString(), groups: [...groups.values()], reused: false };
  await writeJsonAtomic(cachePath(projectPath), cache);
  return cache;
}

function rankVolumeCache(cache, subQueries = [], mode = "normal", lexicalScore = () => 0) {
  const groups = (cache?.groups || []).map((item) => {
    const candidate = { title: item.title, volume: item.title, text: item.summary, category: item.title };
    const scores = subQueries.map((query) => lexicalScore(candidate, query.query));
    return { ...item, score: scores.length ? Math.max(...scores) : 0 };
  }).sort((a, b) => b.score - a.score || b.chunkCount - a.chunkCount);
  if (mode === "book" || mode === "inventory") return groups;
  const relevant = groups.filter((item) => item.score > 0).slice(0, 12);
  return relevant.length ? relevant : groups.slice(0, 6);
}

function buildEvidenceTargets({ subQueries = [], signals = {}, routedVolumes = [], requiredSourceIds = [], mode = "normal" } = {}) {
  const targets = [];
  const add = (kind, label, value, required = true) => {
    const normalized = String(value || "").trim();
    if (!normalized) return;
    targets.push({ id: `${kind}_${compact(normalized).slice(0, 80)}`, kind, label: String(label || normalized), value: normalized, required });
  };
  for (const item of subQueries.slice(0, mode === "book" ? 12 : 8)) add("query", item.label, item.query, item.kind !== "primary" || subQueries.length === 1);
  for (const name of signals.characters || []) add("character", `角色：${name}`, name);
  for (const name of signals.locations || []) add("location", `地点/设定：${name}`, name);
  for (const hint of signals.timeHints || []) add("time", `时间：${hint}`, hint);
  for (const volume of routedVolumes.slice(0, mode === "book" ? 80 : 12)) add("volume", `分卷/分类：${volume}`, volume, mode === "book");
  for (const sourceId of requiredSourceIds || []) add("source", `指定资料：${sourceId}`, sourceId);
  const seen = new Set();
  return targets.filter((item) => {
    const key = `${item.kind}:${compact(item.value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 120);
}

function targetMatchScore(chunk, target, lexicalScore = () => 0) {
  if (!chunk || !target) return 0;
  const metadata = chunk.metadata || {};
  const haystack = compact(`${chunk.title || ""} ${chunk.volume || ""} ${chunk.category || ""} ${chunk.text || ""}`);
  const wanted = compact(target.value);
  if (target.kind === "source") return String(chunk.sourceId) === String(target.value) ? 1 : 0;
  if (target.kind === "volume") {
    const groups = [chunk.volume, chunk.category].map(compact).filter(Boolean);
    return groups.some((group) => group === wanted || group.includes(wanted) || wanted.includes(group)) ? 0.9 : 0;
  }
  if (target.kind === "character") return countIntersections(metadata.characters, [target.value]) ? 1 : haystack.includes(wanted) ? 0.75 : 0;
  if (target.kind === "location") return countIntersections(metadata.locations, [target.value]) ? 1 : haystack.includes(wanted) ? 0.75 : 0;
  if (target.kind === "time") return countIntersections(metadata.timeHints, [target.value]) ? 1 : haystack.includes(wanted) ? 0.75 : 0;
  if (target.kind === "query") {
    if (chunk.matchedSubQuery === target.label && Number(chunk.subQueryScore || 0) > 0) return Math.min(1, 0.55 + Number(chunk.subQueryScore || 0));
    return Math.min(1, Number(lexicalScore(chunk, target.value) || 0));
  }
  return wanted && haystack.includes(wanted) ? 0.6 : 0;
}

function auditEvidenceCoverage(chunks = [], targets = [], lexicalScore = () => 0) {
  const targetResults = targets.map((target) => {
    let best = null;
    let bestScore = 0;
    for (const chunk of chunks) {
      const score = targetMatchScore(chunk, target, lexicalScore);
      if (score > bestScore) {
        best = chunk;
        bestScore = score;
      }
    }
    const threshold = target.kind === "query" ? 0.08 : 0.55;
    return {
      id: target.id,
      kind: target.kind,
      label: target.label,
      required: target.required !== false,
      covered: bestScore >= threshold,
      score: bestScore,
      sourceId: bestScore >= threshold ? String(best?.sourceId || "") : "",
      sourceTitle: bestScore >= threshold ? String(best?.title || "") : "",
    };
  });
  const required = targetResults.filter((item) => item.required);
  const covered = required.filter((item) => item.covered).length;
  const ratio = required.length ? covered / required.length : chunks.length ? 1 : 0;
  const averageScore = required.length ? required.reduce((sum, item) => sum + (item.covered ? item.score : 0), 0) / required.length : ratio;
  const confidence = ratio >= 0.9 && averageScore >= 0.35 ? "高" : ratio >= 0.65 ? "中" : "低";
  return {
    targets: targetResults,
    coveredTargets: covered,
    requiredTargets: required.length,
    coverageRatio: Number(ratio.toFixed(3)),
    evidenceConfidence: confidence,
    uncoveredTargets: required.filter((item) => !item.covered).map((item) => item.label),
  };
}

function addCoverageSecondPass({ firstPass = [], candidates = [], targets = [], maxChunks = 100, maxChars = 130000, lexicalScore = () => 0 } = {}) {
  const selected = firstPass.map((item) => ({ ...item, retrievalPass: Number(item.retrievalPass || 1) }));
  const selectedIds = new Set(selected.map((item) => String(item.id)));
  let totalChars = selected.reduce((sum, item) => sum + String(item.text || "").length, 0);
  const before = auditEvidenceCoverage(selected, targets, lexicalScore);
  const additions = [];

  for (const targetResult of before.targets.filter((item) => item.required && !item.covered)) {
    if (selected.length >= maxChunks) break;
    const target = targets.find((item) => item.id === targetResult.id);
    if (!target) continue;
    let best = null;
    let bestMatch = 0;
    for (const candidate of candidates) {
      if (selectedIds.has(String(candidate.id))) continue;
      const match = targetMatchScore(candidate, target, lexicalScore);
      if (match > bestMatch || (match === bestMatch && Number(candidate.score || 0) > Number(best?.score || 0))) {
        best = candidate;
        bestMatch = match;
      }
    }
    const threshold = target.kind === "query" ? 0.08 : 0.55;
    if (!best || bestMatch < threshold) continue;
    const chars = String(best.text || "").length;
    if (totalChars + chars > maxChars) continue;
    const addition = { ...best, retrievalPass: 2, coverageTarget: target.label };
    selected.push(addition);
    additions.push(addition);
    selectedIds.add(String(best.id));
    totalChars += chars;
  }

  const after = auditEvidenceCoverage(selected, targets, lexicalScore);
  return {
    chunks: selected,
    audit: {
      firstPassCount: firstPass.length,
      secondPassCount: additions.length,
      addedSources: unique(additions.map((item) => item.title), 80),
      ...after,
    },
  };
}

async function inspectVolumeCache(projectPath, { manifest = {}, summaries = {}, config = {} } = {}) {
  const expectedFingerprint = sha256(JSON.stringify({ manifestUpdatedAt: manifest.updatedAt || "", summaryUpdatedAt: summaries.updatedAt || "", chapterCount: (config.chapters || []).length }));
  const cache = await readJson(cachePath(projectPath), null);
  return {
    exists: Boolean(cache),
    valid: Boolean(cache?.version === CACHE_VERSION && cache?.fingerprint === expectedFingerprint && Array.isArray(cache?.groups)),
    version: Number(cache?.version || 0),
    updatedAt: String(cache?.updatedAt || ""),
    groups: Array.isArray(cache?.groups) ? cache.groups.length : 0,
    expectedFingerprint,
    actualFingerprint: String(cache?.fingerprint || ""),
  };
}

module.exports = {
  addCoverageSecondPass,
  auditEvidenceCoverage,
  buildChapterAdjacency,
  buildCoverageAudit,
  buildEvidenceTargets,
  buildSourceReasons,
  buildStoryBoosts,
  decomposeQuery,
  ensureVolumeCache,
  extractQuerySignals,
  inspectVolumeCache,
  rankVolumeCache,
  scoreCandidate,
  selectionReasons,
};
