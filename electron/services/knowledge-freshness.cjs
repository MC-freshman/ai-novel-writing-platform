const fs = require("node:fs/promises");
const path = require("node:path");
const { readJson, sha256, writeJsonAtomic } = require("./project-storage.cjs");

const FRESHNESS_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

function getManifestPath(projectPath) {
  return path.join(projectPath, "analysis", "retrieval", "freshness-manifest.json");
}

function emptyManifest() {
  return { version: FRESHNESS_VERSION, updatedAt: "", sources: [] };
}

async function loadManifest(projectPath) {
  const data = await readJson(getManifestPath(projectPath), emptyManifest());
  if (data?.version !== FRESHNESS_VERSION || !Array.isArray(data.sources)) return emptyManifest();
  return data;
}

async function fileSignature(filePath) {
  if (!filePath) return { missing: false, size: -1, mtimeMs: 0, ctimeMs: 0, signature: "virtual" };
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) return { missing: true, size: 0, mtimeMs: 0, ctimeMs: 0, signature: "missing" };
  const size = Number(stat.size || 0);
  const mtimeMs = Math.trunc(Number(stat.mtimeMs || 0));
  const ctimeMs = Math.trunc(Number(stat.ctimeMs || 0));
  return { missing: false, size, mtimeMs, ctimeMs, signature: `${size}|${mtimeMs}|${ctimeMs}` };
}

async function resolveContent(source) {
  if (typeof source.getContent === "function") return String(await source.getContent());
  return String(source.content || "");
}

function syncState({ missing, empty, vectorEntry, summaryEntry, contentHash }) {
  if (missing) return { status: "文件缺失", detail: "目录中有记录，但源文件不存在" };
  if (empty) return { status: "空文档", detail: "没有可建立索引的正文" };
  if (!Number(vectorEntry?.chunkCount || 0)) return { status: "未索引", detail: "知识库中没有这个文档的片段" };
  if (!vectorEntry?.sourceHash || vectorEntry.sourceHash !== contentHash) return { status: "等待更新", detail: "文档内容比知识库新" };
  if (!summaryEntry || summaryEntry.contentHash !== contentHash) return { status: "摘要待更新", detail: "原始片段已同步，分层摘要尚未更新" };
  return { status: "已同步", detail: `${Number(vectorEntry.chunkCount || 0)} 个片段` };
}

async function inspectSources(projectPath, sources, options = {}) {
  const checkedAt = nowIso();
  const previous = await loadManifest(projectPath);
  const previousById = new Map(previous.sources.map((item) => [String(item.sourceId), item]));
  const vectorsById = new Map((options.vectorManifest?.sources || []).map((item) => [String(item.sourceId), item]));
  const summariesById = new Map((options.summaries?.sources || []).map((item) => [String(item.sourceId), item]));
  const normalizeContent = typeof options.normalizeContent === "function" ? options.normalizeContent : (value) => String(value || "");
  const items = [];
  const nextEntries = [];
  let reusedHashes = 0;
  let recalculatedHashes = 0;

  for (const source of Array.isArray(sources) ? sources : []) {
    const sourceId = String(source.sourceId || source.id || "");
    if (!sourceId) continue;
    const signature = await fileSignature(source.filePath);
    const cached = previousById.get(sourceId);
    let contentHash = "";
    let plainLength = Number(cached?.plainLength || 0);
    const mayReuse = !signature.missing && cached?.signature === signature.signature && cached?.contentHash;
    if (mayReuse) {
      contentHash = cached.contentHash;
      reusedHashes += 1;
    } else if (!signature.missing) {
      const plain = normalizeContent(await resolveContent(source));
      contentHash = sha256(String(plain || ""));
      plainLength = String(plain || "").trim().length;
      recalculatedHashes += 1;
    }
    const vectorEntry = vectorsById.get(sourceId);
    const summaryEntry = summariesById.get(sourceId);
    const state = syncState({
      missing: signature.missing,
      empty: !signature.missing && plainLength === 0,
      vectorEntry,
      summaryEntry,
      contentHash,
    });
    const entry = {
      sourceId,
      sourceType: String(source.sourceType || ""),
      title: String(source.title || sourceId),
      group: String(source.group || source.volume || source.category || "未分类"),
      filePath: source.filePath ? path.relative(projectPath, source.filePath).replace(/\\/g, "/") : "",
      size: signature.size,
      mtimeMs: signature.mtimeMs,
      ctimeMs: signature.ctimeMs,
      signature: signature.signature,
      contentHash,
      plainLength,
      checkedAt,
    };
    nextEntries.push(entry);
    items.push({
      ...entry,
      status: state.status,
      detail: state.detail,
      chunkCount: Number(vectorEntry?.chunkCount || 0),
    });
  }

  const currentIds = new Set(nextEntries.map((item) => item.sourceId));
  const orphanSourceIds = (options.vectorManifest?.sources || [])
    .map((item) => String(item.sourceId))
    .filter((sourceId) => !currentIds.has(sourceId));
  const counts = items.reduce((result, item) => {
    if (["已同步", "空文档"].includes(item.status)) result.synced += 1;
    else result.pending += 1;
    if (item.status === "文件缺失") result.errors += 1;
    return result;
  }, { total: items.length, synced: 0, pending: 0, errors: 0, orphans: orphanSourceIds.length });

  const manifest = { version: FRESHNESS_VERSION, updatedAt: checkedAt, sources: nextEntries };
  if (options.persist !== false) await writeJsonAtomic(getManifestPath(projectPath), manifest);
  return {
    checkedAt,
    counts,
    items,
    orphanSourceIds,
    reusedHashes,
    recalculatedHashes,
    manifest,
  };
}

async function cacheHealth(projectPath, currentSourceIds = []) {
  const manifest = await loadManifest(projectPath);
  const current = new Set((currentSourceIds || []).map(String));
  const cached = new Set(manifest.sources.map((item) => String(item.sourceId)));
  return {
    version: manifest.version,
    updatedAt: manifest.updatedAt,
    entries: manifest.sources.length,
    missingEntries: [...current].filter((id) => !cached.has(id)),
    orphanEntries: [...cached].filter((id) => !current.has(id)),
  };
}

module.exports = {
  FRESHNESS_VERSION,
  cacheHealth,
  getManifestPath,
  inspectSources,
  loadManifest,
};
