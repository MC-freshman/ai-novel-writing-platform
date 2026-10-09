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

// ---------------------------------------------------------------------------
// P4: 常驻 Float32Array 索引（loadVectorIndex / indexVectorScore）
// ---------------------------------------------------------------------------
function productionVector(sourceId, chunkIndex, dim, embeddingSource) {
  return {
    id: `${sourceId}_${chunkIndex}`,
    projectTitle: "测试项目",
    sourceId,
    sourceType: "chapter",
    title: `第${chunkIndex}章`,
    volume: "第一卷",
    category: "正文",
    knowledgeRole: "正文",
    chunkIndex,
    text: `片段${sourceId}-${chunkIndex}`,
    embedding: Array.from({ length: dim }, (_, i) => Math.sin((chunkIndex + 1) * (i + 1) * 0.37)),
    embeddingSource,
    embeddingIdentity: embeddingSource === "api" ? "bge-m3:1024" : undefined,
    sourceHash: `hash-${sourceId}`,
    updatedAt: new Date().toISOString(),
  };
}

function plainCosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

test("loadVectorIndex 评分与兼容路径逐位对齐（local + api）", async (t) => {
  const project = await makeTempProject(t);
  const dim = 64;
  const vectors = [
    productionVector("src-a", 0, dim, "local"),
    productionVector("src-a", 1, dim, "api"),
    productionVector("src-b", 0, dim, "local"),
    productionVector("src-b", 1, dim, "api"),
  ];
  await vectorShards.saveAll(project, { vectors });
  const index = await vectorShards.loadVectorIndex(project);
  assert.equal(index.itemCount, 4);
  assert.equal(index.storeView.vectors.length, 4);
  assert.ok(index.storeView.vectors.every((item) => !("embedding" in item)), "storeView 不得携带 embedding");

  const localQuery = Array.from({ length: dim }, (_, i) => Math.cos(i * 0.91));
  const apiQuery = { source: "api", vector: Array.from({ length: dim }, (_, i) => Math.sin(i * 0.53)), identity: "bge-m3:1024" };
  const otherIdentity = { source: "api", vector: apiQuery.vector, identity: "other-model" };

  for (const shard of index.shards) {
    for (let row = 0; row < shard.count; row += 1) {
      const meta = shard.meta[row];
      const itemEmbedding = vectors.find((v) => v.id === meta.id).embedding;
      // compatibleVectorScore 语义：
      //   item 为 local → 永远与 localQueryVector 比（不管 queryEmbedding）；
      //   item 为 api → 仅当 queryEmbedding.source === "api" 且维度/identity 匹配时与 queryEmbedding.vector 比。
      const expectedLocal = meta.embeddingSource === "local" ? plainCosine(localQuery, itemEmbedding) : 0;
      const expectedApi = meta.embeddingSource === "api" ? plainCosine(apiQuery.vector, itemEmbedding) : expectedLocal;
      const gotLocal = vectorShards.indexVectorScore({ source: "local", vector: localQuery }, localQuery, shard, row);
      const gotApi = vectorShards.indexVectorScore(apiQuery, localQuery, shard, row);
      const gotOtherIdentity = vectorShards.indexVectorScore(otherIdentity, localQuery, shard, row);
      assert.ok(Math.abs(gotLocal - expectedLocal) < 1e-6, `local 评分对齐失败: ${gotLocal} vs ${expectedLocal}`);
      assert.ok(Math.abs(gotApi - expectedApi) < 1e-6, `api 评分对齐失败: ${gotApi} vs ${expectedApi}`);
      if (meta.embeddingSource === "api" && meta.embeddingIdentity && meta.embeddingIdentity !== otherIdentity.identity) {
        assert.equal(gotOtherIdentity, 0, "identity 不匹配必须返回 0");
      }
    }
  }
  // 维度不匹配 → 0
  const shortQuery = Array.from({ length: dim - 1 }, (_, i) => i * 0.1);
  assert.equal(vectorShards.indexVectorScore({ source: "local", vector: shortQuery }, shortQuery, index.shards[0], 0), 0);
});

test("loadVectorIndex 尊重 sourceIds 过滤且缓存随清单失效", async (t) => {
  const project = await makeTempProject(t);
  await vectorShards.saveAll(project, { vectors: [productionVector("src-a", 0, 32, "local"), productionVector("src-b", 0, 32, "local")] });
  const filtered = await vectorShards.loadVectorIndex(project, { sourceIds: ["src-b"] });
  assert.equal(filtered.itemCount, 1);
  assert.equal(filtered.shards[0].sourceId, "src-b");

  const before = await vectorShards.loadVectorIndex(project);
  assert.equal(before.itemCount, 2);
  // 写操作刷新清单 updatedAt → 缓存键失效 → 重建后可见新数据
  await vectorShards.upsertSources(project, new Map([["src-c", [productionVector("src-c", 0, 32, "local"), productionVector("src-c", 1, 32, "local")]]]));
  const after = await vectorShards.loadVectorIndex(project);
  assert.equal(after.itemCount, 4, "写操作后索引必须重建并包含新来源");
});

test("loadVectorIndex 对坏分片降级且不再重复备份", async (t) => {
  const project = await makeTempProject(t);
  await vectorShards.saveAll(project, { vectors: [productionVector("src-a", 0, 32, "local"), productionVector("src-b", 0, 32, "local")] });
  const shardDir = path.join(project, "vector_db", "shards");
  const files = (await fs.readdir(shardDir)).filter((name) => /^[a-f0-9]{32}\.json$/.test(name));
  await fs.writeFile(path.join(shardDir, files[0]), "{corrupted", "utf8");

  const first = await vectorShards.loadVectorIndex(project);
  assert.equal(first.itemCount, 1, "坏分片被跳过");
  assert.equal(first.manifest.recovery?.status, "degraded");
  const backupsAfterFirst = (await fs.readdir(shardDir)).filter((name) => name.includes(".corrupt-"));
  assert.ok(backupsAfterFirst.length >= 1, "坏分片应被备份");

  const second = await vectorShards.loadVectorIndex(project);
  assert.equal(second.itemCount, 1);
  const backupsAfterSecond = (await fs.readdir(shardDir)).filter((name) => name.includes(".corrupt-"));
  assert.equal(backupsAfterSecond.length, backupsAfterFirst.length, "缓存命中时不得重复备份坏分片");
});
