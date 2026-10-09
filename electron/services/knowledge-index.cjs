// 本文件由 P2 重构自 electron/main.cjs 机械搬迁（scripts/refactor-split.cjs），逻辑未改动。
"use strict";

const vectorShards = require("./vector-shards.cjs");
const creativeWorkspace = require("./creative-workspace.cjs");
const retrievalPlanner = require("./retrieval-planner.cjs");
const knowledgeFreshness = require("./knowledge-freshness.cjs");
const { VECTOR_DIMENSIONS, CHUNK_SIZE, CHUNK_OVERLAP, MAX_RETRIEVAL_TOP_K, MAX_RETRIEVAL_SCAN_K, DEFAULT_RETRIEVAL_SCAN_K, CHAT_CONTEXT_CHAR_BUDGET, EMBEDDING_INDEX_CONCURRENCY } = require("./constants.cjs");
const { state, sendRendererEvent } = require("./runtime-state.cjs");
const __dep0 = require("./project-files.cjs");
const __dep1 = require("./credentials.cjs");
const __dep2 = require("./retrieval-pipeline.cjs");
const __dep3 = require("./analysis-tools.cjs");
const __dep4 = require("./project-content.cjs");
const __dep5 = require("./task-runtime.cjs");
const __dep6 = require("./project-ops.cjs");
const fs = require("node:fs/promises");
const path = require("node:path");

function nowIso(...args) { return __dep0.nowIso.apply(null, args); }
function makeId(...args) { return __dep0.makeId(...args); }
function normalizeCategory(...args) { return __dep0.normalizeCategory(...args); }
function clampNumber(...args) { return __dep0.clampNumber(...args); }
function mapWithConcurrency(...args) { return __dep0.mapWithConcurrency(...args); }
function countWords(...args) { return __dep0.countWords(...args); }
function ensureDir(...args) { return __dep0.ensureDir(...args); }
function readJson(...args) { return __dep0.readJson(...args); }
function writeJson(...args) { return __dep0.writeJson(...args); }
function getKnowledgeSummariesPath(...args) { return __dep0.getKnowledgeSummariesPath(...args); }
function getMaterialsDir(...args) { return __dep0.getMaterialsDir(...args); }
function getChapterPath(...args) { return __dep0.getChapterPath(...args); }
function contentRevision(...args) { return __dep0.contentRevision(...args); }
function normalizeDataId(...args) { return __dep0.normalizeDataId(...args); }
function getMaterialPath(...args) { return __dep0.getMaterialPath(...args); }
function contentToPlainText(...args) { return __dep0.contentToPlainText(...args); }
function getCharacterPath(...args) { return __dep0.getCharacterPath(...args); }
function getWorldDocPath(...args) { return __dep0.getWorldDocPath(...args); }
function loadProjectSources(...args) { return __dep0.loadProjectSources(...args); }
function stableHash(...args) { return __dep0.stableHash(...args); }
function formatBytes(...args) { return __dep0.formatBytes(...args); }
function loadCharacters(...args) { return __dep0.loadCharacters(...args); }
function loadWorldDocs(...args) { return __dep0.loadWorldDocs(...args); }
function extractOutline(...args) { return __dep0.extractOutline(...args); }
function getKnowledgeRole(...args) { return __dep0.getKnowledgeRole(...args); }
function knowledgeRoleLabel(...args) { return __dep0.knowledgeRoleLabel(...args); }
function normalizeKnowledgeRole(...args) { return __dep0.normalizeKnowledgeRole(...args); }
function characterToMarkdown(...args) { return __dep0.characterToMarkdown(...args); }
function runtimeSecret(...args) { return __dep1.runtimeSecret(...args); }
function safeEndpointLabel(...args) { return __dep2.safeEndpointLabel(...args); }
function fetchJsonWithDiagnostics(...args) { return __dep2.fetchJsonWithDiagnostics(...args); }
function queryTokens(...args) { return __dep3.queryTokens(...args); }
function calculateTotalWords(...args) { return __dep4.calculateTotalWords(...args); }
function getProjectTaskCenter(...args) { return __dep5.getProjectTaskCenter(...args); }
function loadConfig(...args) { return __dep6.loadConfig(...args); }
function saveConfig(...args) { return __dep6.saveConfig(...args); }
function buildAppState(...args) { return __dep6.buildAppState(...args); }
function indexSources(...args) { return __dep6.indexSources(...args); }
function updateKnowledgeSummaries(...args) { return __dep6.updateKnowledgeSummaries(...args); }
function removeSourceFromKnowledgeSummaries(...args) { return __dep6.removeSourceFromKnowledgeSummaries(...args); }

function chapterToKnowledgeItem(chapter) {
  return {
    id: chapter.id,
    sourceId: chapter.id,
    sourceType: "chapter",
    title: chapter.title,
    volume: chapter.volume || "未分卷",
    knowledgeRole: getKnowledgeRole(chapter),
    order: chapter.order,
    wordCount: chapter.wordCount || 0,
    updatedAt: chapter.updatedAt || "",
  };
}


async function loadMaterials(projectPath) {
  const dir = getMaterialsDir(projectPath);
  await ensureDir(dir);
  const files = await fs.readdir(dir).catch(() => []);
  const items = [];
  for (const file of files.filter((item) => item.endsWith(".json"))) {
    const item = await readJson(path.join(dir, file), null);
    if (item?.id) items.push(item);
  }
  return items.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}


async function saveMaterial(projectPath, payload) {
  const id = normalizeDataId(payload.id) || makeId("material");
  const item = {
    id,
    title: String(payload.title || "未命名素材").trim() || "未命名素材",
    category: normalizeCategory(payload.category || "灵感"),
    content: String(payload.content || "").trim(),
    createdAt: payload.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  await writeJson(getMaterialPath(projectPath, item.id), item);
  return item;
}


async function deleteMaterial(projectPath, materialId) {
  const id = normalizeDataId(materialId);
  if (!id) return;
  await fs.rm(getMaterialPath(projectPath, id), { force: true });
}


async function listKnowledgeItems(projectPath) {
  const config = await loadConfig(projectPath);
  return config.chapters.slice().sort((a, b) => a.order - b.order).map(chapterToKnowledgeItem);
}


async function updateVectorKnowledgeMetadata(projectPath, chapters) {
  const metadata = new Map(chapters.map((chapter) => [String(chapter.id), {
    title: chapter.title,
    volume: chapter.volume || "未分卷",
    category: chapter.volume || "未分卷",
    knowledgeRole: getKnowledgeRole(chapter),
  }]));
  await vectorShards.updateSourcesMetadata(projectPath, metadata);
}


async function updateKnowledgeItemsUnlocked(projectPath, items) {
  const updates = new Map((Array.isArray(items) ? items : []).map((item) => [String(item.id || item.sourceId || ""), item]));
  const config = await loadConfig(projectPath);
  let changed = false;
  const changedChapterIds = new Set();
  config.chapters = config.chapters.map((chapter) => {
    const patch = updates.get(chapter.id);
    if (!patch) return chapter;
    const nextVolume = String(patch.volume || chapter.volume || "未分卷").trim() || "未分卷";
    const nextRole = normalizeKnowledgeRole(patch.knowledgeRole || chapter.knowledgeRole);
    if (nextVolume === chapter.volume && nextRole === getKnowledgeRole(chapter)) return chapter;
    changed = true;
    changedChapterIds.add(chapter.id);
    return {
      ...chapter,
      volume: nextVolume,
      knowledgeRole: nextRole,
      updatedAt: nowIso(),
    };
  });
  if (changed) {
    await calculateTotalWords(projectPath, config);
    await saveConfig(projectPath, config);
    await updateVectorKnowledgeMetadata(projectPath, config.chapters.filter((chapter) => changedChapterIds.has(chapter.id)));
    const projectSources = await loadProjectSources(projectPath);
    await updateKnowledgeSummaries(
      projectPath,
      projectSources.sources.map((source) => ({
        id: source.id,
        type: source.sourceType,
        title: source.title,
        volume: source.volume,
        category: source.category,
        knowledgeRole: source.knowledgeRole,
        content: source.rawContent,
      })),
      { replaceAll: true },
    );
  }
  return {
    items: await listKnowledgeItems(projectPath),
    state: await buildAppState(projectPath),
  };
}


async function buildKnowledgeSourceDescriptors(projectPath, supplied = {}) {
  const config = supplied.config || await loadConfig(projectPath);
  const characters = supplied.characters || await loadCharacters(projectPath);
  const worldDocs = supplied.worldDocs || await loadWorldDocs(projectPath);
  const descriptors = config.chapters.slice().sort((a, b) => a.order - b.order).map((chapter) => ({
    sourceId: chapter.id,
    sourceType: "chapter",
    title: chapter.title,
    volume: chapter.volume || "未分卷",
    category: chapter.volume || "未分卷",
    group: chapter.volume || "未分卷",
    knowledgeRole: getKnowledgeRole(chapter),
    filePath: getChapterPath(projectPath, chapter),
    getContent: () => fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => ""),
  }));
  for (const card of characters) {
    descriptors.push({
      sourceId: card.id,
      sourceType: "character",
      title: card.name,
      category: normalizeCategory(card.category),
      group: `角色卡/${normalizeCategory(card.category)}`,
      filePath: getCharacterPath(projectPath, card),
      content: characterToMarkdown(card),
    });
  }
  for (const doc of worldDocs) {
    descriptors.push({
      sourceId: doc.id,
      sourceType: "world",
      title: doc.title,
      category: normalizeCategory(doc.category),
      group: `世界观/${normalizeCategory(doc.category)}`,
      filePath: getWorldDocPath(projectPath, doc),
      content: doc.content,
    });
  }
  return { config, characters, worldDocs, descriptors };
}


async function inspectKnowledgeFreshness(projectPath, supplied = {}) {
  const sourceSet = await buildKnowledgeSourceDescriptors(projectPath, supplied);
  const manifest = supplied.manifest || await vectorShards.migrateLegacyIfNeeded(projectPath);
  const summaries = supplied.summaries || await loadKnowledgeSummaries(projectPath);
  const freshness = await knowledgeFreshness.inspectSources(projectPath, sourceSet.descriptors, {
    vectorManifest: manifest,
    summaries,
    normalizeContent: contentToPlainText,
    persist: supplied.persist !== false,
  });
  return {
    ...freshness,
    hierarchy: {
      sourceSummaries: summaries.sources.length,
      volumeSummaries: summaries.volumes.length,
      hasBookSummary: Boolean(summaries.book?.summary),
      updatedAt: summaries.updatedAt,
    },
    sourceSet,
    manifest,
    summaries,
  };
}


async function indexFreshnessItems(projectPath, sourceSet, sourceIds, options = {}) {
  const wanted = new Set((sourceIds || []).map(String));
  const selected = sourceSet.descriptors.filter((item) => wanted.has(String(item.sourceId)));
  const sources = [];
  for (const descriptor of selected) {
    const content = typeof descriptor.getContent === "function" ? await descriptor.getContent() : String(descriptor.content || "");
    if (!contentToPlainText(content).trim()) continue;
    sources.push({
      id: descriptor.sourceId,
      type: descriptor.sourceType,
      title: descriptor.title,
      volume: descriptor.volume,
      category: descriptor.category,
      knowledgeRole: descriptor.knowledgeRole,
      content,
    });
  }
  if (sources.length) await indexSources(projectPath, sources, options);
  return sources.map((item) => item.id);
}


async function ensureKnowledgeFreshnessForRetrieval(projectPath, options = {}) {
  const before = await inspectKnowledgeFreshness(projectPath, options);
  const stale = before.items.filter((item) => ["未索引", "等待更新", "摘要待更新"].includes(item.status));
  if (!stale.length) {
    return { checked: true, checkedAt: before.checkedAt, staleSourceCount: 0, repairedSourceCount: 0, deferredSourceCount: 0, repairedSourceIds: [], deferredSources: [], reusedHashes: before.reusedHashes, recalculatedHashes: before.recalculatedHashes };
  }
  const explicitIds = new Set([
    ...(options.sourceIds || []),
    ...(options.candidateSourceIds || []),
    ...(options.boostSourceIds || []),
    ...(options.requiredSourceIds || []),
  ].map(String));
  const question = String(options.question || "");
  const broad = ["book", "inventory"].includes(options.mode) || options.repairAll === true;
  const relevant = stale.filter((item) => broad
    || explicitIds.has(String(item.sourceId))
    || lexicalRelevanceScore({ title: item.title, volume: item.group, category: item.group, text: "" }, question) > 0);
  if (!relevant.length && stale.length <= 3) relevant.push(...stale);
  const repairedSourceIds = await indexFreshnessItems(projectPath, before.sourceSet, relevant.map((item) => item.sourceId), { signal: options.signal });
  const repairedSet = new Set(repairedSourceIds);
  const deferredSources = stale.filter((item) => !repairedSet.has(item.sourceId)).map((item) => ({ sourceId: item.sourceId, title: item.title, status: item.status }));
  return {
    checked: true,
    checkedAt: before.checkedAt,
    staleSourceCount: stale.length,
    repairedSourceCount: repairedSourceIds.length,
    deferredSourceCount: deferredSources.length,
    repairedSourceIds,
    deferredSources,
    reusedHashes: before.reusedHashes,
    recalculatedHashes: before.recalculatedHashes,
  };
}


async function getKnowledgeSyncStatus(projectPath) {
  const result = await inspectKnowledgeFreshness(projectPath);
  return {
    updatedAt: result.checkedAt,
    counts: result.counts,
    items: result.items,
    orphanSourceIds: result.orphanSourceIds,
    hierarchy: result.hierarchy,
    freshness: {
      reusedHashes: result.reusedHashes,
      recalculatedHashes: result.recalculatedHashes,
    },
  };
}


async function repairKnowledgeSync(projectPath) {
  const inspection = await inspectKnowledgeFreshness(projectPath);
  const before = {
    counts: inspection.counts,
    items: inspection.items,
    orphanSourceIds: inspection.orphanSourceIds,
  };
  const pending = before.items.filter((item) => !["已同步", "空文档", "文件缺失"].includes(item.status));
  sendRendererEvent("index:progress", { active: true, phase: "补齐知识库", current: 0, total: pending.length, detail: "检查遗漏与过期文档" });
  await indexFreshnessItems(projectPath, inspection.sourceSet, pending.map((item) => item.sourceId), {
    onProgress: (progress) => sendRendererEvent("index:progress", { active: true, phase: "整理待更新资料", ...progress }),
  });
  for (const sourceId of before.orphanSourceIds) await removeSourceFromIndex(projectPath, sourceId);
  const status = await getKnowledgeSyncStatus(projectPath);
  sendRendererEvent("index:progress", { active: false, phase: "完成", current: status.counts.synced, total: status.counts.total, detail: "知识库已校验" });
  return { status, state: await buildAppState(projectPath) };
}


async function getMaintenanceDiagnostics(projectPath) {
  const [config, status, manifest, summaries, workspaceState, taskList] = await Promise.all([
    loadConfig(projectPath),
    getKnowledgeSyncStatus(projectPath),
    vectorShards.migrateLegacyIfNeeded(projectPath),
    loadKnowledgeSummaries(projectPath),
    creativeWorkspace.loadWorkspace(projectPath),
    getProjectTaskCenter(projectPath).then((center) => center.list()),
  ]);
  const [retrievalCache, freshnessCache] = await Promise.all([
    retrievalPlanner.inspectVolumeCache(projectPath, { manifest, summaries, config }),
    knowledgeFreshness.cacheHealth(projectPath, status.items.map((item) => item.sourceId)),
  ]);
  const taskIds = new Set(taskList.tasks.map((item) => item.id));
  const runIds = new Set(workspaceState.agentRuns.map((item) => item.id));
  const invalidReferences = [];
  for (const run of workspaceState.agentRuns) {
    if (run.taskId && !taskIds.has(run.taskId)) invalidReferences.push({ type: "Agent", id: run.id, title: run.chapterTitle, detail: "Agent 记录指向的后台任务已不存在" });
    const missingScopeIds = (run.scopeIds || []).filter((id) => !config.chapters.some((item) => item.id === id));
    if (missingScopeIds.length) invalidReferences.push({ type: "Agent", id: run.id, title: run.chapterTitle, detail: `分析范围中有 ${missingScopeIds.length} 个已删除文档` });
  }
  for (const task of taskList.tasks.filter((item) => item.type === "agent-workflow")) {
    const runId = String(task.options?.runId || "");
    if (runId && !runIds.has(runId)) invalidReferences.push({ type: "任务", id: task.id, title: task.title, detail: "后台任务对应的 Agent 记录已不存在" });
  }
  const interruptedAgentRuns = workspaceState.agentRuns.filter((item) => ["已中断", "失败"].includes(item.status)).map((item) => ({ id: item.id, title: item.chapterTitle, status: item.status, updatedAt: item.updatedAt }));
  const staleSourceCount = status.items.filter((item) => ["未索引", "等待更新", "摘要待更新"].includes(item.status)).length;
  const issues = [
    ...(!retrievalCache.valid ? ["分卷检索缓存需要刷新"] : []),
    ...(staleSourceCount ? [`${staleSourceCount} 份资料等待更新`] : []),
    ...(status.counts.orphans ? [`${status.counts.orphans} 个孤立索引来源`] : []),
    ...(freshnessCache.missingEntries.length || freshnessCache.orphanEntries.length ? ["新鲜度缓存与当前目录不一致"] : []),
    ...(invalidReferences.length ? [`${invalidReferences.length} 条任务/Agent 引用异常`] : []),
  ];
  return {
    checkedAt: nowIso(),
    healthy: issues.length === 0,
    issues,
    staleSourceCount,
    interruptedAgentRuns,
    invalidReferences,
    retrievalCache,
    freshnessCache,
    vectorIndex: { sources: manifest.sources.length, chunks: Number(manifest.totalChunks || 0), updatedAt: manifest.updatedAt || "" },
  };
}


async function repairMaintenance(projectPath) {
  const knowledge = await repairKnowledgeSync(projectPath);
  const [config, manifest, summaries] = await Promise.all([loadConfig(projectPath), vectorShards.migrateLegacyIfNeeded(projectPath), loadKnowledgeSummaries(projectPath)]);
  await retrievalPlanner.ensureVolumeCache(projectPath, { manifest, summaries, config });
  const workspaceState = await creativeWorkspace.loadWorkspace(projectPath);
  const center = await getProjectTaskCenter(projectPath);
  const taskList = await center.list();
  const taskIds = new Set(taskList.tasks.map((item) => item.id));
  const runIds = new Set(workspaceState.agentRuns.map((item) => item.id));
  for (const run of workspaceState.agentRuns) {
    const validScopeIds = (run.scopeIds || []).filter((id) => config.chapters.some((item) => item.id === id));
    const taskMissing = Boolean(run.taskId && !taskIds.has(run.taskId));
    if (!taskMissing && validScopeIds.length === (run.scopeIds || []).length) continue;
    const active = taskMissing && ["等待中", "运行中"].includes(run.status);
    await creativeWorkspace.upsertItem(projectPath, "agentRuns", {
      ...run,
      scopeIds: validScopeIds.length ? validScopeIds : config.chapters.some((item) => item.id === run.chapterId) ? [run.chapterId] : [],
      taskId: taskMissing ? "" : run.taskId,
      status: active ? "已中断" : run.status,
      error: active ? "原后台任务记录已丢失，已标记为中断；可重新准备计划。" : run.error,
    });
  }
  for (const task of taskList.tasks.filter((item) => item.type === "agent-workflow" && item.options?.runId && !runIds.has(String(item.options.runId)))) {
    if (["等待中", "已暂停"].includes(task.status)) await center.cancel(task.id);
    const latest = (await center.list()).tasks.find((item) => item.id === task.id);
    if (latest && !["等待中", "运行中", "正在停止", "已暂停"].includes(latest.status)) await center.remove(task.id);
  }
  return { diagnostics: await getMaintenanceDiagnostics(projectPath), status: knowledge.status, state: await buildAppState(projectPath) };
}


function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(clean.length, start + chunkSize);
    const slice = clean.slice(start, end).trim();
    if (slice) chunks.push({ text: slice, start, end });
    if (end >= clean.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}


function hashToken(token) {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}


function localEmbedding(text) {
  const vector = new Array(VECTOR_DIMENSIONS).fill(0);
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  const tokens = [];
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (char.trim()) tokens.push(char);
    if (i < normalized.length - 1) {
      const bigram = normalized.slice(i, i + 2).trim();
      if (bigram.length === 2) tokens.push(bigram);
    }
  }
  for (const token of tokens) {
    const hash = hashToken(token);
    const index = hash % VECTOR_DIMENSIONS;
    vector[index] += (hash & 1) === 0 ? 1 : -1;
  }
  const length = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;
  return vector.map((item) => item / length);
}


async function remoteEmbedding(text, apiConfig, options = {}) {
  const embeddingKey = runtimeSecret(apiConfig, "embedding");
  const chatKey = runtimeSecret(apiConfig, "chat");
  const baseUrl = (apiConfig.embeddingBaseUrl || apiConfig.baseUrl || "").replace(/\/$/, "");
  const chatBaseUrl = (apiConfig.baseUrl || "").replace(/\/$/, "");
  const model = apiConfig.embeddingModel || "text-embedding-3-small";
  const isLocal = baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
  const canReuseChatKey = chatKey && baseUrl && chatBaseUrl && baseUrl === chatBaseUrl;
  const apiKey = embeddingKey || (canReuseChatKey ? chatKey : "");
  if (!baseUrl || !model || (!apiKey && !isLocal)) {
    return null;
  }

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const { response, bodyBytes } = await fetchJsonWithDiagnostics(`${baseUrl}/embeddings`, { model, input: text }, headers, "向量 API ", { signal: options.signal });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Embedding API 请求失败：${response.status} ${detail.slice(0, 300)}\n请求地址：${safeEndpointLabel(`${baseUrl}/embeddings`)}\n请求体大小：${formatBytes(bodyBytes)}`);
  }
  const data = /** @type {any} */ (await response.json());
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) throw new Error("Embedding API 返回格式不正确");
  return embedding;
}


async function getEmbedding(text, apiConfig, options = {}) {
  try {
    const remote = await remoteEmbedding(text, apiConfig, options);
    if (remote) {
      embeddingFallback.active = false;
      embeddingFallback.message = "";
      return { vector: remote, source: "api", identity: embeddingIdentity(apiConfig, "api"), warning: "" };
    }
  } catch (error) {
    if (options.signal?.aborted || error?.name === "AbortError") throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
    embeddingFallback.active = true;
    embeddingFallback.message = String(error.message || error).slice(0, 400);
    embeddingFallback.at = nowIso();
    return { vector: localEmbedding(text), source: "local", identity: embeddingIdentity(apiConfig, "local"), warning: embeddingFallback.message };
  }
  return { vector: localEmbedding(text), source: "local", identity: embeddingIdentity(apiConfig, "local"), warning: "" };
}


const embeddingFallback = { active: false, message: "", at: "" };


function embeddingIdentity(apiConfig = {}, source = "local") {
  if (source !== "api") return "local-hash-v1";
  const baseUrl = String(apiConfig.embeddingBaseUrl || apiConfig.baseUrl || "").replace(/\/$/, "").toLowerCase();
  const model = String(apiConfig.embeddingModel || "text-embedding-3-small").trim().toLowerCase();
  return `api:${baseUrl}:${model}`;
}


function extractMetadata(text, characterNames = []) {
  const characters = new Set();
  const locations = new Set();
  const timeHints = new Set();
  for (const name of characterNames) {
    if (name && text.includes(name)) characters.add(name);
  }

  const speakerMatches = text.matchAll(/([\u4e00-\u9fa5]{2,4})(?:说|问|道|喊|答|笑道|低声)/g);
  for (const match of speakerMatches) characters.add(match[1]);

  const locationMatches = text.matchAll(/([\u4e00-\u9fa5]{2,8}(?:城|镇|村|山|河|湖|海|宫|殿|阁|府|院|国|洲|谷|林|岛))/g);
  for (const match of locationMatches) locations.add(match[1]);

  const timeMatches = text.matchAll(/(清晨|黎明|上午|正午|午后|黄昏|傍晚|午夜|昨日|今天|明日|次日|第[一二三四五六七八九十百\d]+天|[一二三四五六七八九十百\d]+年前|[一二三四五六七八九十百\d]+年后)/g);
  for (const match of timeMatches) timeHints.add(match[1]);

  return {
    characters: [...characters],
    locations: [...locations],
    timeHints: [...timeHints],
  };
}


function cosineSimilarity(a, b) {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}


function compatibleVectorScore(queryEmbedding, localQueryVector, item) {
  const itemVector = Array.isArray(item?.embedding) ? item.embedding : [];
  const itemSource = item?.embeddingSource === "api" ? "api" : "local";
  if (itemSource === "local") {
    return itemVector.length === localQueryVector.length ? cosineSimilarity(localQueryVector, itemVector) : 0;
  }
  if (queryEmbedding.source !== "api" || itemVector.length !== queryEmbedding.vector.length) return 0;
  if (item.embeddingIdentity && item.embeddingIdentity !== queryEmbedding.identity) return 0;
  return cosineSimilarity(queryEmbedding.vector, itemVector);
}


function compactSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[《》“”"'‘’：:，,。.!！?？、；;（）()[\]{}【】\s·_\-—]/g, "");
}


function lexicalRelevanceScore(item, question) {
  const tokens = queryTokens(question)
    .map((token) => String(token || "").trim())
    .filter((token) => token.length >= 2);
  if (!tokens.length) return 0;
  const title = String(item.title || "").toLowerCase();
  const titleCompact = compactSearchText(item.title);
  const meta = `${item.volume || ""} ${item.category || ""} ${knowledgeRoleLabel(item.knowledgeRole || "")}`.toLowerCase();
  const text = String(item.text || "").toLowerCase();
  const questionCompact = compactSearchText(question);
  let score = 0;
  let titleHits = 0;
  for (const token of tokens) {
    const tokenCompact = compactSearchText(token);
    if (!tokenCompact) continue;
    if (title.includes(token) || titleCompact.includes(tokenCompact)) {
      score += tokenCompact.length >= 4 ? 0.42 : 0.28;
      titleHits += 1;
    }
    if (meta.includes(token) || compactSearchText(meta).includes(tokenCompact)) score += 0.1;
    if (text.includes(token) || compactSearchText(text).includes(tokenCompact)) score += tokenCompact.length >= 4 ? 0.16 : 0.08;
  }
  if (questionCompact && titleCompact && (titleCompact.includes(questionCompact) || questionCompact.includes(titleCompact))) score += 0.75;
  if (titleHits >= Math.min(2, tokens.length)) score += 0.35;
  return Math.min(score, 1.8);
}


async function loadVectorStore(projectPath) {
  return vectorShards.loadStore(projectPath);
}




async function loadKnowledgeSummaries(projectPath) {
  const fallback = { version: 2, updatedAt: "", sources: [], volumes: [], book: null };
  const data = await readJson(getKnowledgeSummariesPath(projectPath), fallback);
  return {
    version: 2,
    updatedAt: String(data?.updatedAt || ""),
    sources: Array.isArray(data?.sources) ? data.sources : [],
    volumes: Array.isArray(data?.volumes) ? data.volumes : [],
    book: data?.book && typeof data.book === "object" ? data.book : null,
  };
}


function summarizeSourceText(source) {
  const plain = contentToPlainText(source.content || "").replace(/\s+/g, " ").trim();
  const outline = extractOutline(source.content || "")
    .slice(0, 24)
    .map((item) => item.title)
    .filter(Boolean);
  const paragraphs = contentToPlainText(source.content || "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 12);
  const selected = [...paragraphs.slice(0, 4), ...paragraphs.slice(-2)];
  const body = selected.join(" ").slice(0, 1600) || plain.slice(0, 1600);
  return [outline.length ? `小标题：${outline.join("；")}` : "", body].filter(Boolean).join("\n").slice(0, 2000);
}


function rebuildSummaryHierarchy(sources, projectTitle = "") {
  const grouped = new Map();
  for (const item of sources) {
    const group = item.volume || item.category || (item.sourceType === "character" ? "角色卡" : item.sourceType === "world" ? "世界观" : "未分卷");
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(item);
  }
  const volumes = [...grouped.entries()].map(([title, items]) => ({
    id: `volume_${stableHash(title)}`,
    title,
    sourceIds: items.map((item) => item.sourceId),
    documentCount: items.length,
    summary: items.map((item) => `${item.title}：${item.summary}`).join("\n").slice(0, 8000),
    updatedAt: nowIso(),
  }));
  const book = {
    id: "book_summary",
    title: projectTitle || "全书",
    documentCount: sources.length,
    volumeCount: volumes.length,
    summary: volumes.map((item) => `【${item.title}】${item.summary}`).join("\n").slice(0, 16000),
    updatedAt: nowIso(),
  };
  return { volumes, book };
}


async function updateKnowledgeSummariesUnlocked(projectPath, sources, options = {}) {
  const config = await loadConfig(projectPath);
  const previous = options.replaceAll ? { sources: [] } : await loadKnowledgeSummaries(projectPath);
  const sourceMap = new Map((previous.sources || []).map((item) => [item.sourceId, item]));
  for (const source of Array.isArray(sources) ? sources : []) {
    const plain = contentToPlainText(source.content || "");
    sourceMap.set(source.id, {
      sourceId: source.id,
      sourceType: source.type,
      title: source.title,
      volume: source.volume || "",
      category: source.category || "",
      knowledgeRole: source.type === "chapter" ? normalizeKnowledgeRole(source.knowledgeRole || "正文") : "",
      contentHash: contentRevision(plain),
      wordCount: countWords(plain),
      summary: summarizeSourceText(source),
      updatedAt: nowIso(),
    });
  }
  const sourceSummaries = [...sourceMap.values()].sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "zh-CN"));
  const hierarchy = rebuildSummaryHierarchy(sourceSummaries, config.title);
  const next = { version: 2, updatedAt: nowIso(), sources: sourceSummaries, ...hierarchy };
  await writeJson(getKnowledgeSummariesPath(projectPath), next);
  return next;
}


async function removeSourceFromKnowledgeSummariesUnlocked(projectPath, sourceId) {
  const config = await loadConfig(projectPath);
  const previous = await loadKnowledgeSummaries(projectPath);
  const sources = previous.sources.filter((item) => item.sourceId !== sourceId);
  const hierarchy = rebuildSummaryHierarchy(sources, config.title);
  await writeJson(getKnowledgeSummariesPath(projectPath), { version: 2, updatedAt: nowIso(), sources, ...hierarchy });
}


async function indexSource(projectPath, source) {
  return indexSources(projectPath, [source]);
}


async function buildIndexEntries(source, config, characterNames, options = {}) {
  const indexContent = contentToPlainText(source.content);
  const sourceHash = contentRevision(indexContent);
  const chunks = chunkText(indexContent);
  const embeddings = await mapWithConcurrency(chunks, EMBEDDING_INDEX_CONCURRENCY, async (chunk, index) => {
    if (options.signal?.aborted) throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
    if (index % 12 === 0) await new Promise((resolve) => setImmediate(resolve));
    return getEmbedding(chunk.text, config.api, { signal: options.signal });
  });
  return chunks.map((chunk, index) => {
    const embedding = embeddings[index];
    return {
      id: `${source.id}_${index}`,
      projectTitle: config.title,
      sourceId: source.id,
      sourceType: source.type,
      title: source.title,
      volume: source.volume || source.category || "",
      category: source.category || source.volume || "",
      knowledgeRole: normalizeKnowledgeRole(source.knowledgeRole || "正文"),
      chunkIndex: index,
      text: chunk.text,
      embedding: embedding.vector,
      embeddingSource: embedding.source,
      embeddingIdentity: embedding.identity,
      embeddingWarning: embedding.warning,
      metadata: extractMetadata(chunk.text, characterNames),
      sourceHash,
      updatedAt: nowIso(),
    };
  });
}


async function indexSourcesUnlocked(projectPath, sources, options = {}) {
  const safeSources = Array.isArray(sources) ? sources.filter(Boolean) : [];
  if (!safeSources.length) {
    const stats = await vectorShards.stats(projectPath);
    return { chunks: 0, totalChunks: stats.chunks };
  }
  const config = await loadConfig(projectPath);
  const characters = await loadCharacters(projectPath);
  const characterNames = characters.map((item) => item.name).filter(Boolean);
  let indexedChunks = 0;
  const entriesBySource = new Map();
  for (let sourceIndex = 0; sourceIndex < safeSources.length; sourceIndex += 1) {
    if (options.signal?.aborted) throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
    const source = safeSources[sourceIndex];
    if (typeof options.onProgress === "function") await options.onProgress({ current: sourceIndex, total: safeSources.length, detail: source.title || source.id });
    const entries = await buildIndexEntries(source, config, characterNames, options);
    indexedChunks += entries.length;
    entriesBySource.set(source.id, entries);
    if (typeof options.onProgress === "function") await options.onProgress({ current: sourceIndex + 1, total: safeSources.length, detail: source.title || source.id });
  }

  if (options.signal?.aborted) throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
  const manifest = options.replaceAllIndex
    ? await vectorShards.replaceSources(projectPath, entriesBySource)
    : await vectorShards.upsertSources(projectPath, entriesBySource);
  await updateKnowledgeSummaries(projectPath, safeSources, { replaceAll: Boolean(options.replaceSummaries) });
  return { chunks: indexedChunks, totalChunks: manifest.totalChunks };
}


async function removeSourceFromIndex(projectPath, sourceId) {
  await vectorShards.removeSource(projectPath, sourceId);
  await removeSourceFromKnowledgeSummaries(projectPath, sourceId);
}


function selectUsefulChunks(chunks, options = {}) {
  const safeChunks = Array.isArray(chunks) ? chunks.filter((item) => Number.isFinite(Number(item.score))) : [];
  if (!safeChunks.length) return [];
  const maxChunks = Math.max(1, Math.floor(options.maxChunks || safeChunks.length));
  const minKeep = Math.min(maxChunks, Math.max(0, Math.floor(options.minKeep ?? 3)));
  const maxChars = Math.max(1000, Math.floor(options.maxChars || CHAT_CONTEXT_CHAR_BUDGET));
  const topScore = Number(safeChunks[0]?.score || 0);
  const minScore = Number.isFinite(Number(options.minScore))
    ? Number(options.minScore)
    : topScore >= 0.4
      ? Math.max(0.18, topScore * 0.55)
      : topScore >= 0.2
        ? Math.max(0.1, topScore * 0.45)
        : 0.08;
  const selected = [];
  let totalChars = 0;
  for (let index = 0; index < safeChunks.length && selected.length < maxChunks; index += 1) {
    const chunk = safeChunks[index];
    const textLength = String(chunk.text || "").length;
    const relevant = index < minKeep || (Number(chunk.score) > 0 && Number(chunk.score) >= minScore);
    if (!relevant) continue;
    if (selected.length >= minKeep && totalChars + textLength > maxChars) break;
    selected.push(chunk);
    totalChars += textLength;
  }
  return selected;
}


async function rebuildIndex(projectPath, options = {}) {
  const config = await loadConfig(projectPath);
  const sources = [];
  sendRendererEvent("index:progress", { active: true, phase: "整理章节", current: 0, total: config.chapters.length, detail: "" });

  for (let index = 0; index < config.chapters.length; index += 1) {
    if (options.signal?.aborted) throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
    const chapter = config.chapters[index];
    sendRendererEvent("index:progress", { active: true, phase: "整理章节", current: index + 1, total: config.chapters.length, detail: chapter.title });
    const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
    sources.push({
      id: chapter.id,
      type: "chapter",
      title: chapter.title,
      volume: chapter.volume || "未分卷",
      category: chapter.volume || "未分卷",
      knowledgeRole: getKnowledgeRole(chapter),
      content,
    });
  }

  const characters = await loadCharacters(projectPath);
  for (const card of characters) {
    const content = characterToMarkdown(card);
    sources.push({
      id: card.id,
      type: "character",
      title: card.name,
      content,
    });
  }

  const worldDocs = await loadWorldDocs(projectPath);
  for (const doc of worldDocs) {
    sources.push({
      id: doc.id,
      type: "world",
      title: doc.title,
      content: doc.content,
    });
  }

  const estimatedChunks = sources.reduce((sum, source) => sum + chunkText(contentToPlainText(source.content || "")).length, 0);
  sendRendererEvent("index:progress", { active: true, phase: "建立知识库", current: 0, total: estimatedChunks, detail: `预计 ${estimatedChunks} 个片段，${sources.length} 个来源` });
  const result = await indexSources(projectPath, sources, {
    replaceSummaries: true,
    replaceAllIndex: true,
    signal: options.signal,
    onProgress: options.onProgress,
  });
  sendRendererEvent("index:progress", { active: false, phase: "完成", current: result.totalChunks, total: result.totalChunks, detail: `${result.totalChunks} 个片段` });
  return { chunks: result.totalChunks };
}


async function searchRelevantChunks(projectPath, question, topK, options = {}) {
  const config = await loadConfig(projectPath);
  const safeTopK = Math.floor(clampNumber(topK, 1, MAX_RETRIEVAL_TOP_K, 5));
  const safeScanLimit = Math.floor(clampNumber(options.scanLimit || config.api.scanK || Math.max(safeTopK * 4, DEFAULT_RETRIEVAL_SCAN_K), safeTopK, MAX_RETRIEVAL_SCAN_K, DEFAULT_RETRIEVAL_SCAN_K));
  const sourceIds = new Set((Array.isArray(options.sourceIds) ? options.sourceIds : []).map((id) => String(id || "")).filter(Boolean));
  const candidateSourceIds = new Set((Array.isArray(options.candidateSourceIds) ? options.candidateSourceIds : []).map((id) => String(id || "")).filter(Boolean));
  const excludedSourceIds = new Set((Array.isArray(options.excludeSourceIds) ? options.excludeSourceIds : []).map((id) => String(id || "")).filter(Boolean));
  const freshness = options.freshness || (options.skipFreshnessCheck ? null : await ensureKnowledgeFreshnessForRetrieval(projectPath, {
    config,
    question,
    mode: options.mode || "normal",
    sourceIds: [...sourceIds],
    candidateSourceIds: [...candidateSourceIds],
    boostSourceIds: options.boostSourceIds || [],
    requiredSourceIds: options.retrievalContext?.requiredSourceIds || [],
    signal: options.signal,
  }));
  const loadSourceIds = [...new Set([...sourceIds, ...candidateSourceIds, ...(Array.isArray(options.additionalLoadSourceIds) ? options.additionalLoadSourceIds : [])].map(String).filter(Boolean))];
  // P4: 常驻 Float32Array 索引 —— 首次检索加载分片并驻留，后续检索零 IO；
  // 任何索引写操作都会刷新清单 updatedAt 使缓存键失效并重建。
  const index = await vectorShards.loadVectorIndex(projectPath, loadSourceIds.length ? { sourceIds: loadSourceIds } : {});
  const embedding = await getEmbedding(question, config.api);
  const localQueryVector = embedding.source === "local" ? embedding.vector : localEmbedding(question);
  const boostSourceIds = new Set((Array.isArray(options.boostSourceIds) ? options.boostSourceIds : []).map((id) => String(id || "")).filter(Boolean));
  const scored = [];
  for (const shard of index.shards) {
    for (let row = 0; row < shard.count; row += 1) {
      const item = shard.meta[row];
      const vectorScore = vectorShards.indexVectorScore(embedding, localQueryVector, shard, row);
      const keywordScore = lexicalRelevanceScore(item, question);
      const hierarchyBoost = boostSourceIds.has(item.sourceId) ? 0.2 : 0;
      const hybrid = retrievalPlanner.scoreCandidate(item, {
        signals: options.retrievalContext?.signals,
        adjacencyScores: options.retrievalContext?.adjacencyScores,
        storyScores: options.retrievalContext?.storyScores,
        subQueries: options.retrievalContext?.subQueries,
        lexicalScore: lexicalRelevanceScore,
      });
      scored.push({
        ...item,
        score: vectorScore + keywordScore + hierarchyBoost + hybrid.entityScore + hybrid.adjacencyScore + hybrid.storyScore + hybrid.subQueryScore,
        vectorScore,
        keywordScore,
        hierarchyBoost,
        ...hybrid,
      });
    }
  }
  const candidates = scored
    .filter((item) => !excludedSourceIds.has(String(item.sourceId)) && (!sourceIds.size || sourceIds.has(item.sourceId)))
    .sort((a, b) => b.score - a.score)
    .slice(0, safeScanLimit);
  const evidenceTargets = retrievalPlanner.buildEvidenceTargets({
    subQueries: options.retrievalContext?.subQueries || [],
    signals: options.retrievalContext?.signals || {},
    routedVolumes: options.retrievalContext?.routedVolumes || [],
    requiredSourceIds: options.retrievalContext?.requiredSourceIds || [],
    mode: options.mode || "normal",
  });
  const reserveForCoverage = Math.min(Math.max(0, safeTopK - Math.max(1, Number(options.minKeep || 3))), Math.min(24, Math.ceil(evidenceTargets.length * 1.5), Math.ceil(safeTopK * 0.2)));
  const firstPass = selectUsefulChunks(candidates, {
    maxChunks: Math.max(1, safeTopK - reserveForCoverage),
    minKeep: options.minKeep,
    minScore: options.minScore,
    maxChars: options.maxChars,
  });
  const secondPass = retrievalPlanner.addCoverageSecondPass({
    firstPass,
    candidates,
    targets: evidenceTargets,
    maxChunks: safeTopK,
    maxChars: options.maxChars || CHAT_CONTEXT_CHAR_BUDGET,
    lexicalScore: lexicalRelevanceScore,
  });
  return {
    chunks: secondPass.chunks,
    candidateCount: candidates.length,
    scannedCount: index.itemCount,
    totalIndexedCount: Number(index.totalChunks || index.itemCount),
    embeddingSource: embedding.source,
    embeddingWarning: embedding.warning,
    coveragePass: secondPass.audit,
    freshness,
    _store: index.storeView,
  };
}


const __moduleExports = {
  chapterToKnowledgeItem,
  loadMaterials,
  saveMaterial,
  deleteMaterial,
  listKnowledgeItems,
  updateVectorKnowledgeMetadata,
  updateKnowledgeItemsUnlocked,
  buildKnowledgeSourceDescriptors,
  inspectKnowledgeFreshness,
  indexFreshnessItems,
  ensureKnowledgeFreshnessForRetrieval,
  getKnowledgeSyncStatus,
  repairKnowledgeSync,
  getMaintenanceDiagnostics,
  repairMaintenance,
  chunkText,
  hashToken,
  localEmbedding,
  remoteEmbedding,
  getEmbedding,
  embeddingFallback,
  embeddingIdentity,
  extractMetadata,
  cosineSimilarity,
  compatibleVectorScore,
  compactSearchText,
  lexicalRelevanceScore,
  loadVectorStore,
  loadKnowledgeSummaries,
  summarizeSourceText,
  rebuildSummaryHierarchy,
  updateKnowledgeSummariesUnlocked,
  removeSourceFromKnowledgeSummariesUnlocked,
  indexSource,
  buildIndexEntries,
  indexSourcesUnlocked,
  removeSourceFromIndex,
  selectUsefulChunks,
  rebuildIndex,
  searchRelevantChunks,
};

// Augment the original exports object so cyclic requires (whose captured
// reference may be a Proxy over the pre-assignment exports) see every key.
Object.assign(module.exports, __moduleExports);
module.exports = __moduleExports;
