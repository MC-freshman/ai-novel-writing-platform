const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const vectorShards = require("../../../electron/services/vector-shards.cjs");

async function makeTempProject(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novel-vector-test-"));
  t.after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  return dir;
}

function fakeVector(sourceId, chunkIndex) {
  return {
    sourceId,
    chunkIndex,
    sourceHash: `hash-${sourceId}`,
    sourceType: "chapter",
    title: `第${chunkIndex}章`,
    volume: "第一卷",
    category: "正文",
    knowledgeRole: "body",
    text: `片段${sourceId}-${chunkIndex}`,
    vector: Array.from({ length: 8 }, (_, i) => (chunkIndex + i) / 16),
    updatedAt: new Date().toISOString(),
  };
}

test("saveAll 与 loadStore 往返一致", async (t) => {
  const project = await makeTempProject(t);
  const vectors = [
    fakeVector("src-a", 0),
    fakeVector("src-a", 1),
    fakeVector("src-b", 0),
  ];
  const manifest = await vectorShards.saveAll(project, { vectors });
  assert.equal(manifest.totalChunks, 3);
  assert.equal(manifest.sources.length, 2);

  const store = await vectorShards.loadStore(project);
  assert.equal(store.vectors.length, 3);
  assert.equal(store.totalChunks, 3);
  assert.ok(store.vectors.every((item) => item.sourceId === "src-a" || item.sourceId === "src-b"));

  const filtered = await vectorShards.loadStore(project, { sourceIds: ["src-b"] });
  assert.equal(filtered.vectors.length, 1);
  assert.equal(filtered.vectors[0].sourceId, "src-b");
});

test("manifest 损坏后 loadManifest 从分片自动恢复", async (t) => {
  const project = await makeTempProject(t);
  await vectorShards.saveAll(project, { vectors: [fakeVector("src-a", 0), fakeVector("src-b", 0)] });
  const manifestPath = path.join(project, "vector_db", "manifest.json");
  await fs.writeFile(manifestPath, "{corrupted", "utf8");

  const manifest = await vectorShards.loadManifest(project);
  assert.ok(manifest.sources.length === 2, "应从分片恢复出 2 个来源");
  assert.match(manifest.recovery?.status || "", /recovered|degraded/);

  const store = await vectorShards.loadStore(project);
  assert.equal(store.vectors.length, 2, "恢复后向量数据不丢失");
});

test("removeSource 之后 loadStore 不再包含该来源", async (t) => {
  const project = await makeTempProject(t);
  await vectorShards.saveAll(project, { vectors: [fakeVector("src-a", 0), fakeVector("src-b", 0)] });
  await vectorShards.removeSource(project, "src-a");
  const store = await vectorShards.loadStore(project);
  assert.equal(store.vectors.length, 1);
  assert.equal(store.vectors[0].sourceId, "src-b");
  const stats = await vectorShards.stats(project);
  assert.equal(stats.chunks, 1);
  assert.equal(stats.sources, 1);
});

test("upsertSources 增量更新不破坏既有来源", async (t) => {
  const project = await makeTempProject(t);
  await vectorShards.saveAll(project, { vectors: [fakeVector("src-a", 0)] });
  await vectorShards.upsertSources(project, new Map([["src-c", [fakeVector("src-c", 0), fakeVector("src-c", 1)]]]));
  const store = await vectorShards.loadStore(project);
  assert.equal(store.vectors.length, 3);
  const stats = await vectorShards.stats(project);
  assert.equal(stats.sources, 2);
});
