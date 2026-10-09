const fs = require("node:fs/promises");
const path = require("node:path");
const { ensureDir, readJson, sha256, writeJsonAtomic, withProjectWriteQueue } = require("./project-storage.cjs");

function nowIso() {
  return new Date().toISOString();
}

function getVectorDir(projectPath) {
  return path.join(projectPath, "vector_db");
}

function getLegacyPath(projectPath) {
  return path.join(getVectorDir(projectPath), "vectors.json");
}

function getManifestPath(projectPath) {
  return path.join(getVectorDir(projectPath), "manifest.json");
}

function getShardDir(projectPath) {
  return path.join(getVectorDir(projectPath), "shards");
}

function shardFileName(sourceId) {
  return `${sha256(Buffer.from(String(sourceId || ""), "utf8")).slice(0, 32)}.json`;
}

async function loadManifest(projectPath) {
  let raw;
  try { raw = await fs.readFile(getManifestPath(projectPath), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  try {
    const data = JSON.parse(raw);
    if (data.version !== 3 || !Array.isArray(data.sources) || data.sources.some((item) => !item.sourceId || !/^[a-f0-9]{32}\.json$/.test(item.fileName))) throw new Error("清单结构异常");
    return data;
  } catch {
    const backup = path.join(getVectorDir(projectPath), `manifest.corrupt-${Date.now()}.json`);
    await fs.copyFile(getManifestPath(projectPath), backup);
    const recovered = [];
    const damaged = [];
    for (const fileName of await fs.readdir(getShardDir(projectPath)).catch(() => [])) {
      if (!/^[a-f0-9]{32}\.json$/.test(fileName)) continue;
      const shard = await readJson(path.join(getShardDir(projectPath), fileName), null);
      if (!shard?.sourceId || !Array.isArray(shard.vectors) || shard.vectors.some((item) => item.sourceId !== shard.sourceId)) { damaged.push(fileName); continue; }
      recovered.push({ sourceId: shard.sourceId, fileName, chunkCount: shard.vectors.length, ...Object.fromEntries(["sourceHash", "sourceType", "title", "volume", "category", "knowledgeRole"].map((key) => [key, shard.vectors[0]?.[key] || ""])) });
    }
    const recovery = { status: damaged.length ? "degraded" : "recovered", message: `索引清单损坏，已从 ${recovered.length} 个分片恢复${damaged.length ? `，${damaged.length} 个坏分片需要重建` : ""}。坏清单已保留。`, backupPath: backup, damaged, recoveredAt: nowIso() };
    const manifest = await writeManifest(projectPath, recovered, recovery);
    return manifest;
  }
}

async function writeManifest(projectPath, sources, recovery = null) {
  const normalized = sources.slice().sort((a, b) => String(a.sourceId).localeCompare(String(b.sourceId)));
  const manifest = {
    version: 3,
    updatedAt: nowIso(),
    totalChunks: normalized.reduce((sum, item) => sum + Number(item.chunkCount || 0), 0),
    sources: normalized,
    ...(recovery ? { recovery } : {}),
  };
  await writeJsonAtomic(getManifestPath(projectPath), manifest);
  await writeJsonAtomic(getLegacyPath(projectPath), {
    version: 3,
    sharded: true,
    updatedAt: manifest.updatedAt,
    totalChunks: manifest.totalChunks,
    vectors: [],
  });
  return manifest;
}

async function writeSourceShard(projectPath, sourceId, vectors) {
  await ensureDir(getShardDir(projectPath));
  const fileName = shardFileName(sourceId);
  await writeJsonAtomic(path.join(getShardDir(projectPath), fileName), {
    version: 3,
    sourceId,
    updatedAt: nowIso(),
    vectors,
  });
  const first = vectors[0] || {};
  return {
    sourceId,
    fileName,
    chunkCount: vectors.length,
    sourceHash: String(first.sourceHash || ""),
    sourceType: String(first.sourceType || ""),
    title: String(first.title || ""),
    volume: String(first.volume || ""),
    category: String(first.category || ""),
    knowledgeRole: String(first.knowledgeRole || ""),
    updatedAt: nowIso(),
  };
}

async function saveAll(projectPath, store) {
  await ensureDir(getShardDir(projectPath));
  const groups = new Map();
  for (const vector of Array.isArray(store?.vectors) ? store.vectors : []) {
    if (!groups.has(vector.sourceId)) groups.set(vector.sourceId, []);
    groups.get(vector.sourceId).push(vector);
  }
  const sources = [];
  for (const [sourceId, vectors] of groups) sources.push(await writeSourceShard(projectPath, sourceId, vectors));
  return writeManifest(projectPath, sources);
}

async function migrateLegacyIfNeeded(projectPath) {
  const existing = await loadManifest(projectPath);
  if (existing) return existing;
  const files = await fs.readdir(getShardDir(projectPath)).catch(() => []);
  if (files.some((file) => /^[a-f0-9]{32}\.json$/.test(file))) {
    await writeJsonAtomic(getManifestPath(projectPath), { recoveryRequired: true });
    return loadManifest(projectPath);
  }
  const legacy = await readJson(getLegacyPath(projectPath), { version: 1, vectors: [] });
  if (legacy?.sharded && Number(legacy.totalChunks || 0) > 0) throw new Error("索引清单和分片均缺失，需要重建知识库；已保留旧索引状态。");
  return saveAll(projectPath, { vectors: Array.isArray(legacy?.vectors) ? legacy.vectors : [] });
}

async function loadStore(projectPath, options = {}) {
  const manifest = await migrateLegacyIfNeeded(projectPath);
  const requested = new Set((options.sourceIds || []).map(String));
  const sources = requested.size ? manifest.sources.filter((item) => requested.has(String(item.sourceId))) : manifest.sources;
  const vectors = [];
  const damaged = [];
  const concurrency = 12;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, sources.length)) }, async () => {
    while (cursor < sources.length) {
      const index = cursor;
      cursor += 1;
      const source = sources[index];
      const shardPath = path.join(getShardDir(projectPath), source.fileName);
      const shard = await readJson(shardPath, null);
      if (shard?.sourceId === source.sourceId && Array.isArray(shard.vectors) && shard.vectors.every((item) => item.sourceId === source.sourceId)) vectors.push(...shard.vectors);
      else {
        damaged.push(source.fileName);
        await fs.copyFile(shardPath, `${shardPath}.corrupt-${Date.now()}`).catch((error) => { if (error.code !== "ENOENT") throw error; });
      }
    }
  });
  await Promise.all(workers);
  if (damaged.length) {
    manifest.recovery = { status: "degraded", message: `${damaged.length} 个索引分片损坏或缺失，当前检索结果不完整；请重建知识库。`, damaged: [...new Set([...(manifest.recovery?.damaged || []), ...damaged])], recoveredAt: nowIso() };
    await writeJsonAtomic(getManifestPath(projectPath), manifest);
  }
  return { version: 3, updatedAt: manifest.updatedAt, vectors, totalChunks: manifest.totalChunks, manifest };
}

async function upsertSources(projectPath, entriesBySource) {
  const manifest = await migrateLegacyIfNeeded(projectPath);
  const sourceMap = new Map(manifest.sources.map((item) => [String(item.sourceId), item]));
  for (const [sourceId, vectors] of entriesBySource) {
    sourceMap.set(String(sourceId), await writeSourceShard(projectPath, sourceId, vectors));
  }
  const repairedFiles = new Set([...entriesBySource.keys()].map(shardFileName));
  const damaged = (manifest.recovery?.damaged || []).filter((file) => !repairedFiles.has(file));
  const recovery = damaged.length ? { ...manifest.recovery, damaged } : null;
  return writeManifest(projectPath, [...sourceMap.values()], recovery);
}

async function replaceSources(projectPath, entriesBySource) {
  const previous = await migrateLegacyIfNeeded(projectPath);
  const sources = [];
  for (const [sourceId, vectors] of entriesBySource) sources.push(await writeSourceShard(projectPath, sourceId, vectors));
  const next = await writeManifest(projectPath, sources);
  const retainedFiles = new Set(sources.map((item) => item.fileName));
  await Promise.all(previous.sources
    .filter((item) => item.fileName && !retainedFiles.has(item.fileName))
    .map((item) => fs.rm(path.join(getShardDir(projectPath), item.fileName), { force: true }).catch(() => null)));
  return next;
}

async function updateSourcesMetadata(projectPath, metadataBySource) {
  const manifest = await migrateLegacyIfNeeded(projectPath);
  const patches = metadataBySource instanceof Map ? metadataBySource : new Map(Object.entries(metadataBySource || {}));
  if (!patches.size) return manifest;
  const nextSources = [];
  for (const source of manifest.sources) {
    const patch = patches.get(String(source.sourceId));
    if (!patch) {
      nextSources.push(source);
      continue;
    }
    const shardPath = path.join(getShardDir(projectPath), source.fileName);
    const shard = await readJson(shardPath, null);
    if (!shard || shard.sourceId !== source.sourceId || !Array.isArray(shard.vectors)) throw new Error("索引分片损坏或缺失，已停止元数据更新；请重建知识库。");
    const vectors = (Array.isArray(shard.vectors) ? shard.vectors : []).map((entry) => ({ ...entry, ...patch, updatedAt: nowIso() }));
    nextSources.push(await writeSourceShard(projectPath, source.sourceId, vectors));
  }
  return writeManifest(projectPath, nextSources);
}

async function removeSource(projectPath, sourceId) {
  const manifest = await migrateLegacyIfNeeded(projectPath);
  const target = manifest.sources.find((item) => String(item.sourceId) === String(sourceId));
  const sources = manifest.sources.filter((item) => String(item.sourceId) !== String(sourceId));
  const next = await writeManifest(projectPath, sources);
  if (target?.fileName) await fs.rm(path.join(getShardDir(projectPath), target.fileName), { force: true }).catch(() => null);
  return next;
}

async function reset(projectPath) {
  await ensureDir(getShardDir(projectPath));
  return writeManifest(projectPath, []);
}

async function stats(projectPath) {
  const manifest = await migrateLegacyIfNeeded(projectPath);
  return { chunks: Number(manifest.totalChunks || 0), sources: manifest.sources.length, updatedAt: manifest.updatedAt || "", recovery: manifest.recovery || null };
}

// Internal calls stay within the claimed operation; public calls share one manifest queue.
const serialize = (operation) => (projectPath, ...args) =>
  withProjectWriteQueue(projectPath, "vector-shards", () => operation(projectPath, ...args));

// ---------------------------------------------------------------------------
// P4: resident vector index (Float32Array) — disk format unchanged (v3 shards).
// 读路径专用：把分片里的 number[] 向量转成常驻 Float32Array + 预计算范数，
// 元数据对象与向量分离存放（meta 不含 embedding）。缓存键取自清单
// （任何写操作都会刷新 updatedAt → 键变化 → 重建），保证与磁盘一致。
// ---------------------------------------------------------------------------
const indexCache = new Map(); // projectPath -> { key, manifest, shards: Map<fileName, shardIndex>, lastAccess }
const INDEX_CACHE_MAX_PROJECTS = 4;

function indexKeyFromManifest(manifest) {
  return `${manifest.updatedAt || ""}:${manifest.totalChunks || 0}:${manifest.sources.length}`;
}

async function loadShardIndex(projectPath, source) {
  const shardPath = path.join(getShardDir(projectPath), source.fileName);
  const shard = await readJson(shardPath, null);
  const vectors = shard?.sourceId === source.sourceId && Array.isArray(shard.vectors) ? shard.vectors : null;
  if (!vectors || vectors.some((item) => item.sourceId !== source.sourceId || !Array.isArray(item.embedding))) return null;
  const count = vectors.length;
  const dim = count ? vectors[0].embedding.length : 0;
  if (vectors.some((item) => item.embedding.length !== dim)) return null;
  const flat = new Float32Array(count * dim);
  const norms = new Float32Array(count);
  const meta = new Array(count);
  for (let i = 0; i < count; i += 1) {
    flat.set(vectors[i].embedding, i * dim);
    let sum = 0;
    for (let j = 0; j < dim; j += 1) {
      const value = flat[i * dim + j];
      sum += value * value;
    }
    norms[i] = Math.sqrt(sum);
    const entry = { ...vectors[i] };
    delete entry.embedding;
    meta[i] = entry;
  }
  return { sourceId: source.sourceId, fileName: source.fileName, count, dim, flat, norms, meta };
}

async function loadVectorIndex(projectPath, options = {}) {
  const manifest = await migrateLegacyIfNeeded(projectPath);
  const key = indexKeyFromManifest(manifest);
  let entry = indexCache.get(projectPath);
  if (!entry || entry.key !== key) {
    entry = { key, manifest, shards: new Map(), lastAccess: Date.now() };
    indexCache.set(projectPath, entry);
    while (indexCache.size > INDEX_CACHE_MAX_PROJECTS) {
      const oldest = [...indexCache.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess)[0];
      if (!oldest || oldest[0] === projectPath) break;
      indexCache.delete(oldest[0]);
    }
  }
  entry.lastAccess = Date.now();
  entry.manifest = manifest;
  const requested = (options.sourceIds || []).map(String);
  const wanted = requested.length ? manifest.sources.filter((item) => requested.includes(String(item.sourceId))) : manifest.sources;
  const shards = [];
  const damaged = [];
  for (const source of wanted) {
    let shard = entry.shards.get(source.fileName);
    if (!shard) {
      shard = await loadShardIndex(projectPath, source);
      if (shard) {
        entry.shards.set(source.fileName, shard);
      } else {
        // 与 loadStore 的坏分片处理保持一致：备份坏文件并记录 degraded。
        const shardPath = path.join(getShardDir(projectPath), source.fileName);
        await fs.copyFile(shardPath, `${shardPath}.corrupt-${Date.now()}`).catch((error) => { if (error.code !== "ENOENT") throw error; });
        damaged.push(source.fileName);
        shard = { sourceId: source.sourceId, fileName: source.fileName, count: 0, dim: 0, flat: new Float32Array(0), norms: new Float32Array(0), meta: [] };
        // 缓存哨兵空分片：同一清单键下不再重复读盘/备份；修复写入会刷新
        // updatedAt → 键变化 → 全量重建。
        entry.shards.set(source.fileName, shard);
      }
    }
    shards.push(shard);
  }
  if (damaged.length) {
    const merged = [...new Set([...(manifest.recovery?.damaged || []), ...damaged])];
    manifest.recovery = { status: "degraded", message: `${merged.length} 个索引分片损坏或缺失，当前检索结果不完整；请重建知识库。`, damaged: merged, recoveredAt: nowIso() };
    await writeJsonAtomic(getManifestPath(projectPath), manifest);
    // 恢复信息已并入清单；缓存键以 updatedAt 为准，下一次自然重建。
  }
  const itemCount = shards.reduce((sum, shard) => sum + shard.count, 0);
  return {
    key,
    updatedAt: manifest.updatedAt,
    totalChunks: Number(manifest.totalChunks || 0),
    shards,
    itemCount,
    manifest,
    // _store 兼容视图：元数据齐全、无 embedding，供 forceInclude/coverage 使用
    storeView: { version: 3, updatedAt: manifest.updatedAt, vectors: shards.flatMap((shard) => shard.meta), totalChunks: Number(manifest.totalChunks || 0), manifest },
  };
}

// 与 knowledge-index.cjs 的 cosineSimilarity/compatibleVectorScore 语义逐位对齐
//（零范数返回 0；长度不等返回 0；identity 不匹配返回 0），仅换成缓存的
// Float32Array 行 + 预计算范数，省去每查询重复开方与对象属性访问。
function typedCosineAligned(queryVector, flat, offset, cachedNormB) {
  const length = queryVector.length;
  let dot = 0;
  let normA = 0;
  for (let j = 0; j < length; j += 1) {
    const value = queryVector[j];
    dot += value * flat[offset + j];
    normA += value * value;
  }
  if (!normA || !cachedNormB) return 0;
  return dot / (Math.sqrt(normA) * cachedNormB);
}

function indexVectorScore(queryEmbedding, localQueryVector, shard, row) {
  const meta = shard.meta[row];
  const itemSource = meta.embeddingSource === "api" ? "api" : "local";
  const dim = shard.dim;
  if (itemSource === "local") {
    return dim === localQueryVector.length ? typedCosineAligned(localQueryVector, shard.flat, row * dim, shard.norms[row]) : 0;
  }
  if (queryEmbedding.source !== "api" || dim !== queryEmbedding.vector.length) return 0;
  if (meta.embeddingIdentity && meta.embeddingIdentity !== queryEmbedding.identity) return 0;
  return typedCosineAligned(queryEmbedding.vector, shard.flat, row * dim, shard.norms[row]);
}

module.exports = Object.fromEntries(Object.entries({
  indexVectorScore, loadManifest, loadStore, loadVectorIndex, migrateLegacyIfNeeded, removeSource, replaceSources,
  reset, saveAll, stats, updateSourcesMetadata, upsertSources,
}).map(([name, operation]) => [name, name === "indexVectorScore" ? operation : serialize(operation)]));
