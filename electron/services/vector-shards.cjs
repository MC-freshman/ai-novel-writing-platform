const fs = require("node:fs/promises");
const path = require("node:path");
const { ensureDir, readJson, sha256, writeJsonAtomic } = require("./project-storage.cjs");

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
  const data = await readJson(getManifestPath(projectPath), null);
  if (!data || data.version !== 3 || !Array.isArray(data.sources)) return null;
  return data;
}

async function writeManifest(projectPath, sources) {
  const normalized = sources.slice().sort((a, b) => String(a.sourceId).localeCompare(String(b.sourceId)));
  const manifest = {
    version: 3,
    updatedAt: nowIso(),
    totalChunks: normalized.reduce((sum, item) => sum + Number(item.chunkCount || 0), 0),
    sources: normalized,
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
  const legacy = await readJson(getLegacyPath(projectPath), { version: 1, vectors: [] });
  return saveAll(projectPath, { vectors: Array.isArray(legacy?.vectors) ? legacy.vectors : [] });
}

async function loadStore(projectPath, options = {}) {
  const manifest = await migrateLegacyIfNeeded(projectPath);
  const requested = new Set((options.sourceIds || []).map(String));
  const sources = requested.size ? manifest.sources.filter((item) => requested.has(String(item.sourceId))) : manifest.sources;
  const vectors = [];
  const concurrency = 12;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, sources.length)) }, async () => {
    while (cursor < sources.length) {
      const index = cursor;
      cursor += 1;
      const source = sources[index];
      const shard = await readJson(path.join(getShardDir(projectPath), source.fileName), { vectors: [] });
      if (Array.isArray(shard?.vectors)) vectors.push(...shard.vectors);
    }
  });
  await Promise.all(workers);
  return { version: 3, updatedAt: manifest.updatedAt, vectors, totalChunks: manifest.totalChunks, manifest };
}

async function upsertSources(projectPath, entriesBySource) {
  const manifest = await migrateLegacyIfNeeded(projectPath);
  const sourceMap = new Map(manifest.sources.map((item) => [String(item.sourceId), item]));
  for (const [sourceId, vectors] of entriesBySource) {
    sourceMap.set(String(sourceId), await writeSourceShard(projectPath, sourceId, vectors));
  }
  return writeManifest(projectPath, [...sourceMap.values()]);
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
    const shard = await readJson(shardPath, { version: 3, sourceId: source.sourceId, vectors: [] });
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
  return { chunks: Number(manifest.totalChunks || 0), sources: manifest.sources.length, updatedAt: manifest.updatedAt || "" };
}

module.exports = {
  loadManifest,
  loadStore,
  migrateLegacyIfNeeded,
  removeSource,
  replaceSources,
  reset,
  saveAll,
  stats,
  updateSourcesMetadata,
  upsertSources,
};
