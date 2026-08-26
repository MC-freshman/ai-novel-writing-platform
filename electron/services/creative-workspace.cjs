const path = require("node:path");
const { ensureDir, readJson, stableId, writeJsonAtomic } = require("./project-storage.cjs");

const WORKSPACE_VERSION = 1;
const COLLECTION_LIMITS = {
  scenes: 5000,
  causalNodes: 12000,
  causalEdges: 20000,
  arcs: 5000,
  annotations: 10000,
  memories: 3000,
  revisions: 500,
  agentRuns: 80,
  statisticsHistory: 40,
};
const writeQueues = new Map();

function nowIso() {
  return new Date().toISOString();
}

function workspacePath(projectPath) {
  return path.join(projectPath, "analysis", "creative-workspace", "state.json");
}

function emptyState() {
  return {
    version: WORKSPACE_VERSION,
    updatedAt: "",
    scenes: [],
    causalNodes: [],
    causalEdges: [],
    arcs: [],
    annotations: [],
    memories: [],
    revisions: [],
    agentRuns: [],
    statisticsHistory: [],
  };
}

function cleanText(value, limit = 2000) {
  return String(value || "").trim().slice(0, limit);
}

function cleanRefs(value) {
  return (Array.isArray(value) ? value : []).slice(0, 30).map((item) => ({
    chapterId: cleanText(item?.chapterId, 100),
    chapterTitle: cleanText(item?.chapterTitle, 120),
    volume: cleanText(item?.volume, 120),
    heading: cleanText(item?.heading, 120),
    quote: cleanText(item?.quote, 500),
    start: Number.isFinite(Number(item?.start)) ? Number(item.start) : -1,
    end: Number.isFinite(Number(item?.end)) ? Number(item.end) : -1,
  })).filter((item) => item.chapterId || item.quote);
}

function normalizeItem(collection, payload = {}, index = 0) {
  const updatedAt = nowIso();
  const base = {
    ...payload,
    id: cleanText(payload.id, 120) || stableId(collection.slice(0, -1), `${updatedAt}|${Math.random()}|${index}`),
    createdAt: cleanText(payload.createdAt, 40) || updatedAt,
    updatedAt,
  };
  if (collection === "scenes") return {
    ...base,
    chapterId: cleanText(payload.chapterId, 100), chapterTitle: cleanText(payload.chapterTitle, 120),
    title: cleanText(payload.title || `场景 ${index + 1}`, 120), order: Math.max(0, Number(payload.order) || 0),
    pov: cleanText(payload.pov, 80), location: cleanText(payload.location, 100), time: cleanText(payload.time, 100),
    goal: cleanText(payload.goal), conflict: cleanText(payload.conflict), turn: cleanText(payload.turn), outcome: cleanText(payload.outcome),
    status: ["计划中", "写作中", "已完成", "暂缓"].includes(payload.status) ? payload.status : "计划中",
    foreshadowIds: (Array.isArray(payload.foreshadowIds) ? payload.foreshadowIds : []).map(String).slice(0, 30),
    sourceRefs: cleanRefs(payload.sourceRefs),
  };
  if (collection === "causalNodes") return {
    ...base,
    chapterId: cleanText(payload.chapterId, 100), chapterTitle: cleanText(payload.chapterTitle, 120), volume: cleanText(payload.volume, 120),
    type: ["事件", "伏笔", "选择", "结果"].includes(payload.type) ? payload.type : "事件",
    title: cleanText(payload.title, 140), detail: cleanText(payload.detail), order: Number(payload.order) || 0,
    origin: payload.origin === "manual" ? "manual" : "generated", locked: Boolean(payload.locked), sourceRefs: cleanRefs(payload.sourceRefs),
    x: Number.isFinite(Number(payload.x)) ? Number(payload.x) : undefined,
    y: Number.isFinite(Number(payload.y)) ? Number(payload.y) : undefined,
    color: cleanText(payload.color || "", 24),
  };
  if (collection === "causalEdges") return {
    ...base,
    source: cleanText(payload.source, 120), target: cleanText(payload.target, 120),
    relation: cleanText(payload.relation || "导致", 40), detail: cleanText(payload.detail, 1000),
    origin: payload.origin === "manual" ? "manual" : "generated", locked: Boolean(payload.locked),
    color: cleanText(payload.color || "#65758b", 24),
    direction: ["forward", "backward", "both", "none"].includes(payload.direction) ? payload.direction : "forward",
  };
  if (collection === "arcs") return {
    ...base,
    characterId: cleanText(payload.characterId, 120), characterName: cleanText(payload.characterName, 100),
    chapterId: cleanText(payload.chapterId, 100), chapterTitle: cleanText(payload.chapterTitle, 120), order: Number(payload.order) || 0,
    stage: cleanText(payload.stage || "当前阶段", 80), desire: cleanText(payload.desire), fear: cleanText(payload.fear),
    misbelief: cleanText(payload.misbelief), change: cleanText(payload.change), status: cleanText(payload.status || "进行中", 40),
    origin: payload.origin === "manual" ? "manual" : "generated", locked: Boolean(payload.locked), sourceRefs: cleanRefs(payload.sourceRefs),
  };
  if (collection === "annotations") return {
    ...base,
    chapterId: cleanText(payload.chapterId, 100), chapterTitle: cleanText(payload.chapterTitle, 120), quote: cleanText(payload.quote, 3000),
    comment: cleanText(payload.comment, 3000), type: ["作者批注", "待核对", "AI建议", "资料提醒"].includes(payload.type) ? payload.type : "作者批注",
    status: ["待处理", "已完成", "暂不处理"].includes(payload.status) ? payload.status : "待处理",
    sourceRevision: cleanText(payload.sourceRevision, 100), origin: payload.origin === "ai" ? "ai" : "manual",
  };
  if (collection === "memories") return {
    ...base,
    scope: ["全书", "分卷", "章节", "会话"].includes(payload.scope) ? payload.scope : "全书",
    scopeId: cleanText(payload.scopeId, 120), scopeLabel: cleanText(payload.scopeLabel, 120),
    title: cleanText(payload.title, 120), content: cleanText(payload.content, 6000), locked: Boolean(payload.locked),
    sourceRefs: cleanRefs(payload.sourceRefs),
  };
  if (collection === "revisions") return {
    ...base,
    chapterId: cleanText(payload.chapterId, 100), chapterTitle: cleanText(payload.chapterTitle, 120),
    action: cleanText(payload.action || "润色", 40), instruction: cleanText(payload.instruction, 1200),
    original: cleanText(payload.original, 20000), replacement: cleanText(payload.replacement, 30000),
    sourceRevision: cleanText(payload.sourceRevision, 100), status: ["生成中", "待确认", "部分采纳", "已采纳", "已拒绝", "已失效", "生成失败"].includes(payload.status) ? payload.status : "待确认",
    error: cleanText(payload.error, 2000), appliedAt: cleanText(payload.appliedAt, 40),
    acceptedParts: (Array.isArray(payload.acceptedParts) ? payload.acceptedParts : []).slice(0, 300).map((part) => ({
      original: cleanText(part?.original, 20000), replacement: cleanText(part?.replacement, 20000), appliedAt: cleanText(part?.appliedAt, 40),
    })),
  };
  if (collection === "agentRuns") return {
    ...base,
    chapterId: cleanText(payload.chapterId, 100), chapterTitle: cleanText(payload.chapterTitle, 120),
    scopeType: ["chapter", "volume", "book"].includes(payload.scopeType) ? payload.scopeType : "chapter",
    scopeIds: (Array.isArray(payload.scopeIds) ? payload.scopeIds : []).map(String).slice(0, 10000),
    scopeLabel: cleanText(payload.scopeLabel, 180), scopeRecommended: Boolean(payload.scopeRecommended),
    mode: ["next", "plot", "foreshadow"].includes(payload.mode) ? payload.mode : "next",
    objective: cleanText(payload.objective, 1600), status: ["待确认", "等待中", "运行中", "已完成", "失败", "已取消", "已中断"].includes(payload.status) ? payload.status : "待确认",
    permissionLevel: ["只读分析", "可创建规划", "可生成修订候选"].includes(payload.permissionLevel) ? payload.permissionLevel : "只读分析",
    selectedText: cleanText(payload.selectedText, 20000), selectedTextRevision: cleanText(payload.selectedTextRevision, 100),
    contextIds: (Array.isArray(payload.contextIds) ? payload.contextIds : []).map(String).slice(0, 60),
    includeSourceIds: (Array.isArray(payload.includeSourceIds) ? payload.includeSourceIds : []).map(String).slice(0, 500),
    excludeSourceIds: (Array.isArray(payload.excludeSourceIds) ? payload.excludeSourceIds : []).map(String).slice(0, 500),
    memoryIds: (Array.isArray(payload.memoryIds) ? payload.memoryIds : []).map(String).slice(0, 60),
    steps: (Array.isArray(payload.steps) ? payload.steps : []).slice(0, 20).map((item) => ({ tool: cleanText(item?.tool, 80), label: cleanText(item?.label, 120), reason: cleanText(item?.reason, 600) })),
    toolStates: (Array.isArray(payload.toolStates) ? payload.toolStates : []).slice(0, 20).map((item) => ({
      tool: cleanText(item?.tool, 80), label: cleanText(item?.label, 120),
      status: ["等待中", "运行中", "已完成", "已跳过", "失败"].includes(item?.status) ? item.status : "等待中",
      detail: cleanText(item?.detail, 3000), partialOutput: cleanText(item?.partialOutput, 12000), error: cleanText(item?.error, 2000),
    })),
    stageCheckpoints: (Array.isArray(payload.stageCheckpoints) ? payload.stageCheckpoints : []).slice(0, 30).map((item) => ({
      id: cleanText(item?.id, 100), label: cleanText(item?.label, 140),
      status: ["等待中", "运行中", "已完成", "已跳过", "失败"].includes(item?.status) ? item.status : "等待中",
      startedAt: cleanText(item?.startedAt, 40), completedAt: cleanText(item?.completedAt, 40),
      detail: cleanText(item?.detail, 3000), error: cleanText(item?.error, 2000),
    })),
    stageSummary: payload.stageSummary && typeof payload.stageSummary === "object" ? {
      completed: (Array.isArray(payload.stageSummary.completed) ? payload.stageSummary.completed : []).map(String).slice(0, 30),
      failed: (Array.isArray(payload.stageSummary.failed) ? payload.stageSummary.failed : []).map(String).slice(0, 30),
      skipped: (Array.isArray(payload.stageSummary.skipped) ? payload.stageSummary.skipped : []).map(String).slice(0, 30),
    } : { completed: [], failed: [], skipped: [] },
    taskId: cleanText(payload.taskId, 120), partialOutput: cleanText(payload.partialOutput, 240000),
    outputs: payload.outputs && typeof payload.outputs === "object" ? payload.outputs : {},
    retrievalAudit: payload.retrievalAudit && typeof payload.retrievalAudit === "object" ? payload.retrievalAudit : null,
    result: payload.result && typeof payload.result === "object" ? payload.result : null,
    error: cleanText(payload.error, 3000),
  };
  if (collection === "statisticsHistory") return {
    ...base,
    label: cleanText(payload.label || "创作诊断", 120),
    metrics: Array.isArray(payload.metrics) ? payload.metrics.slice(0, 5000) : [],
    povShares: Array.isArray(payload.povShares) ? payload.povShares.slice(0, 500) : [],
    characterDensity: Array.isArray(payload.characterDensity) ? payload.characterDensity.slice(0, 2000) : [],
    foreshadowSummary: payload.foreshadowSummary && typeof payload.foreshadowSummary === "object" ? payload.foreshadowSummary : { open: 0, closed: 0, recoveryRate: 0 },
    arcAlerts: Array.isArray(payload.arcAlerts) ? payload.arcAlerts.slice(0, 2000) : [],
  };
  throw new Error(`不支持的创作工作区集合：${collection}`);
}

async function ensureWorkspace(projectPath) {
  const filePath = workspacePath(projectPath);
  await ensureDir(path.dirname(filePath));
  const data = await readJson(filePath, null);
  if (!data) await writeJsonAtomic(filePath, emptyState());
}

async function loadWorkspace(projectPath) {
  await ensureWorkspace(projectPath);
  const data = await readJson(workspacePath(projectPath), emptyState());
  const fallback = emptyState();
  for (const key of Object.keys(COLLECTION_LIMITS)) fallback[key] = Array.isArray(data?.[key]) ? data[key] : [];
  return { ...fallback, ...data, version: WORKSPACE_VERSION };
}

async function mutate(projectPath, mutator) {
  const key = path.resolve(projectPath);
  const previous = writeQueues.get(key) || Promise.resolve();
  const next = previous.catch(() => null).then(async () => {
    const state = await loadWorkspace(projectPath);
    const result = await mutator(state);
    state.updatedAt = nowIso();
    await writeJsonAtomic(workspacePath(projectPath), state);
    return result === undefined ? state : result;
  });
  writeQueues.set(key, next);
  try {
    return await next;
  } finally {
    if (writeQueues.get(key) === next) writeQueues.delete(key);
  }
}

async function upsertItem(projectPath, collection, payload) {
  if (!Object.hasOwn(COLLECTION_LIMITS, collection)) throw new Error("不支持的创作工作区数据类型。");
  return mutate(projectPath, (state) => {
    const items = state[collection];
    const existingIndex = payload?.id ? items.findIndex((item) => item.id === payload.id) : -1;
    const normalized = normalizeItem(collection, existingIndex >= 0 ? { ...items[existingIndex], ...payload } : payload, existingIndex >= 0 ? existingIndex : items.length);
    if (existingIndex >= 0) items[existingIndex] = normalized;
    else items.unshift(normalized);
    state[collection] = items.slice(0, COLLECTION_LIMITS[collection]);
    return normalized;
  });
}

async function deleteItem(projectPath, collection, itemId) {
  if (!Object.hasOwn(COLLECTION_LIMITS, collection)) throw new Error("不支持的创作工作区数据类型。");
  return mutate(projectPath, (state) => {
    const before = state[collection].length;
    state[collection] = state[collection].filter((item) => item.id !== itemId);
    if (collection === "causalNodes") state.causalEdges = state.causalEdges.filter((edge) => edge.source !== itemId && edge.target !== itemId);
    return { removed: state[collection].length !== before, state };
  });
}

async function reorderScenes(projectPath, chapterId, sceneIds) {
  return mutate(projectPath, (state) => {
    const positions = new Map((sceneIds || []).map((id, index) => [String(id), index]));
    const chapterScenes = state.scenes.filter((item) => item.chapterId === chapterId)
      .sort((a, b) => (positions.get(a.id) ?? a.order) - (positions.get(b.id) ?? b.order))
      .map((item, index) => ({ ...item, order: index, updatedAt: nowIso() }));
    const byId = new Map(chapterScenes.map((item) => [item.id, item]));
    state.scenes = state.scenes.map((item) => byId.get(item.id) || item);
    return chapterScenes;
  });
}

async function rebuildCausality(projectPath, payload = {}) {
  return mutate(projectPath, (state) => {
    const lockedNodes = state.causalNodes.filter((item) => item.origin === "manual" || item.locked);
    const lockedEdges = state.causalEdges.filter((item) => item.origin === "manual" || item.locked);
    const generatedNodes = [];
    for (const [index, fact] of (payload.facts || []).filter((item) => item.status !== "已忽略").entries()) {
      generatedNodes.push(normalizeItem("causalNodes", {
        id: `causal_${fact.id}`, chapterId: fact.chapterId, chapterTitle: fact.chapterTitle, volume: fact.volume,
        type: "事件", title: `${fact.subject}：${fact.object}`.slice(0, 140), detail: fact.object, order: Number(payload.chapterOrder?.[fact.chapterId] || 0) * 1000 + index,
        origin: "generated", sourceRefs: fact.evidence || [],
      }, index));
    }
    for (const [index, item] of (payload.foreshadows || []).filter((candidate) => !["已废弃"].includes(candidate.status)).entries()) {
      const evidence = item.plantedAt?.[0] || {};
      generatedNodes.push(normalizeItem("causalNodes", {
        id: `causal_${item.id}`, chapterId: evidence.chapterId, chapterTitle: evidence.chapterTitle, volume: evidence.volume,
        type: "伏笔", title: item.title, detail: item.description, order: Number(payload.chapterOrder?.[evidence.chapterId] || 0) * 1000 + 500 + index,
        origin: "generated", sourceRefs: item.plantedAt || [],
      }, index));
    }
    const lockedIds = new Set(lockedNodes.map((item) => item.id));
    state.causalNodes = [...lockedNodes, ...generatedNodes.filter((item) => !lockedIds.has(item.id))].slice(0, COLLECTION_LIMITS.causalNodes);
    const eventNodes = state.causalNodes.filter((item) => item.type !== "伏笔").sort((a, b) => a.order - b.order);
    const generatedEdges = eventNodes.slice(1).map((item, index) => normalizeItem("causalEdges", {
      id: stableId("causal-edge", `${eventNodes[index].id}|${item.id}|先于`), source: eventNodes[index].id, target: item.id,
      relation: "先于", detail: "按目录与正文事实顺序自动建立，需作者确认是否存在直接因果。", origin: "generated",
    }, index));
    const lockedEdgeIds = new Set(lockedEdges.map((item) => item.id));
    state.causalEdges = [...lockedEdges, ...generatedEdges.filter((item) => !lockedEdgeIds.has(item.id))].slice(0, COLLECTION_LIMITS.causalEdges);
    return { nodes: state.causalNodes, edges: state.causalEdges };
  });
}

async function generateArcs(projectPath, characterStates = []) {
  return mutate(projectPath, (state) => {
    const locked = state.arcs.filter((item) => item.origin === "manual" || item.locked);
    const lockedIds = new Set(locked.map((item) => item.id));
    const generated = [];
    for (const record of characterStates) {
      for (const [index, item] of (record.states || []).entries()) {
        const arc = normalizeItem("arcs", {
          id: `arc_${item.id}`, characterId: record.characterId, characterName: record.characterName,
          chapterId: item.chapterId, chapterTitle: item.chapterTitle, order: Number(item.chapterOrder || index),
          stage: "正文状态", desire: (item.goals || []).join("；"), fear: "", misbelief: "",
          change: [item.location ? `位置：${item.location}` : "", item.physical?.length ? `状态：${item.physical.join("、")}` : ""].filter(Boolean).join("；"),
          status: "进行中", origin: "generated", sourceRefs: item.evidence || [],
        }, index);
        if (!lockedIds.has(arc.id)) generated.push(arc);
      }
    }
    state.arcs = [...locked, ...generated].slice(0, COLLECTION_LIMITS.arcs);
    return state.arcs;
  });
}

function relevantMemories(state, chapter = null) {
  const volume = chapter?.volume || "";
  return state.memories.filter((item) => {
    if (item.scope === "全书") return true;
    if (item.scope === "分卷") return item.scopeId === volume || item.scopeLabel === volume;
    if (item.scope === "章节") return item.scopeId === chapter?.id;
    return false;
  }).sort((a, b) => Number(b.locked) - Number(a.locked) || String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 80);
}

function qualityReport(state, chapters = [], storyOverview = {}) {
  const facts = storyOverview.facts || [];
  const characters = storyOverview.characterStates || [];
  const foreshadows = storyOverview.foreshadows || [];
  return chapters.map((chapter) => {
    const scenes = state.scenes.filter((item) => item.chapterId === chapter.id);
    const chapterFacts = facts.filter((item) => item.chapterId === chapter.id && item.status !== "已忽略");
    const chapterCharacters = characters.filter((record) => record.states?.some((item) => item.chapterId === chapter.id));
    const chapterForeshadows = foreshadows.filter((item) => item.plantedAt?.some((evidence) => evidence.chapterId === chapter.id));
    const concerns = [];
    if (Number(chapter.wordCount || 0) < 800) concerns.push("篇幅较短，请确认它是完整章节还是提纲/片段。");
    if (!chapterFacts.length) concerns.push("尚无可核验的剧情事实，可能未分析或事件推进较少。");
    if (!chapterCharacters.length) concerns.push("没有识别到角色状态变化，请确认本章人物行动是否明确。");
    if (!scenes.length) concerns.push("尚未规划场景，无法检查场景目标、冲突和转折是否重复。");
    if (scenes.length && scenes.every((item) => !item.conflict.trim())) concerns.push("已有场景都没有记录冲突。");
    if (scenes.length && scenes.every((item) => !item.outcome.trim())) concerns.push("已有场景都没有记录结果，可能难以承接下一场。");
    const latestStats = state.statisticsHistory?.[0]?.metrics?.find((item) => item.chapterId === chapter.id);
    const quality = latestStats?.quality || {};
    const previous = chapters.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0)).find((item) => Number(item.order || 0) === Number(chapter.order || 0) - 1);
    const previousStats = state.statisticsHistory?.[0]?.metrics?.find((item) => item.chapterId === previous?.id);
    if (latestStats && previousStats && Math.abs(Number(latestStats.pacing || 0) - Number(previousStats.pacing || 0)) < 8) concerns.push("与相邻章节的节奏形态接近，请确认是否需要形成变化。");
    return {
      chapterId: chapter.id, chapterTitle: chapter.title, volume: chapter.volume || "未分卷", wordCount: Number(chapter.wordCount || 0),
      signals: {
        scenes: scenes.length, facts: chapterFacts.length, characters: chapterCharacters.length, foreshadows: chapterForeshadows.length,
        goal: Boolean(quality.goal || scenes.some((item) => item.goal.trim())),
        conflict: Boolean(quality.conflict || scenes.some((item) => item.conflict.trim())),
        turn: Boolean(quality.turn || scenes.some((item) => item.turn.trim())),
        information: Boolean(quality.information || chapterFacts.length),
        characterAction: Boolean(quality.characterAction || chapterCharacters.length),
        endingHook: Boolean(quality.endingHook),
      },
      adjacentComparison: latestStats && previousStats ? `较上一章节奏 ${latestStats.pacing > previousStats.pacing ? "更快" : latestStats.pacing < previousStats.pacing ? "更慢" : "接近"}` : "",
      concerns,
    };
  });
}

async function removeChapterReferences(projectPath, chapterId) {
  return mutate(projectPath, (state) => {
    state.scenes = state.scenes.filter((item) => item.chapterId !== chapterId);
    const removedNodeIds = new Set(state.causalNodes.filter((item) => item.chapterId === chapterId).map((item) => item.id));
    state.causalNodes = state.causalNodes.filter((item) => item.chapterId !== chapterId);
    state.causalEdges = state.causalEdges.filter((item) => !removedNodeIds.has(item.source) && !removedNodeIds.has(item.target));
    state.arcs = state.arcs.filter((item) => item.chapterId !== chapterId);
    state.annotations = state.annotations.filter((item) => item.chapterId !== chapterId);
    state.memories = state.memories.filter((item) => item.scope !== "章节" || item.scopeId !== chapterId);
    state.revisions = state.revisions.filter((item) => item.chapterId !== chapterId);
    state.agentRuns = state.agentRuns.filter((item) => item.chapterId !== chapterId);
    return state;
  });
}

async function mergeImportedWorkspace(projectPath, imported = {}, chapterIdMap = new Map()) {
  return mutate(projectPath, (state) => {
    for (const collection of Object.keys(COLLECTION_LIMITS)) {
      if (!Array.isArray(imported[collection])) continue;
      const existingIds = new Set(state[collection].map((item) => item.id));
      const nextItems = imported[collection].map((item, index) => {
        const remapped = { ...item };
        if (remapped.chapterId && chapterIdMap.has(remapped.chapterId)) remapped.chapterId = chapterIdMap.get(remapped.chapterId);
        if (remapped.scope === "章节" && chapterIdMap.has(remapped.scopeId)) remapped.scopeId = chapterIdMap.get(remapped.scopeId);
        if (existingIds.has(remapped.id)) remapped.id = stableId(`${collection}-import`, `${remapped.id}|${nowIso()}|${index}`);
        return normalizeItem(collection, remapped, index);
      });
      state[collection] = [...nextItems, ...state[collection]].slice(0, COLLECTION_LIMITS[collection]);
    }
    return state;
  });
}

module.exports = {
  COLLECTION_LIMITS,
  WORKSPACE_VERSION,
  deleteItem,
  ensureWorkspace,
  generateArcs,
  loadWorkspace,
  mergeImportedWorkspace,
  qualityReport,
  rebuildCausality,
  relevantMemories,
  removeChapterReferences,
  reorderScenes,
  upsertItem,
};
