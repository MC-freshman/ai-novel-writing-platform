// P4 benchmark: old loadStore (plain number[] scan) vs new loadVectorIndex
// (resident Float32Array + cached norms). Real numbers only — no estimates.
// Usage: node scripts/bench-vector-cache.cjs [sources] [chunksPerSource] [dims] [repeats]
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vectorShards = require("../electron/services/vector-shards.cjs");

const SOURCES = Number(process.argv[2] || 300);
const CHUNKS_PER_SOURCE = Number(process.argv[3] || 20);
const DIM = Number(process.argv[4] || 384); // VECTOR_DIMENSIONS = 384 (local embedding)
const REPEATS = Number(process.argv[5] || 20);
const TOTAL = SOURCES * CHUNKS_PER_SOURCE;

function makeVector(sourceId, chunkIndex) {
  const embedding = Array.from({ length: DIM }, (_, i) => Math.sin((chunkIndex + 1) * (i + 1) * 0.37 + sourceId.length * 0.11));
  return {
    id: `${sourceId}_${chunkIndex}`,
    sourceId,
    sourceType: "chapter",
    title: `第${chunkIndex}章`,
    volume: "第一卷",
    category: "正文",
    knowledgeRole: "正文",
    chunkIndex,
    text: `片段${sourceId}-${chunkIndex}。`.repeat(60),
    embedding,
    embeddingSource: "local",
    sourceHash: `hash-${sourceId}`,
    updatedAt: new Date().toISOString(),
  };
}

function plainCosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "novel-vector-bench-"));
  try {
    process.stdout.write(`生成合成索引：${SOURCES} 来源 × ${CHUNKS_PER_SOURCE} 片段 × ${DIM} 维 = ${TOTAL} 向量 ...\n`);
    const vectors = [];
    for (let s = 0; s < SOURCES; s += 1) {
      for (let c = 0; c < CHUNKS_PER_SOURCE; c += 1) vectors.push(makeVector(`src-${String(s).padStart(4, "0")}`, c));
    }
    await vectorShards.saveAll(project, { vectors });

    const heapBefore = process.memoryUsage().heapUsed;
    const query0 = Array.from({ length: DIM }, (_, i) => Math.cos(i * 0.91));
    const queryEmbedding0 = { source: "local", vector: query0 };

    // ---- 端到端单次检索（装载 + 扫描）：旧路径每次检索都重读分片 JSON ----
    const oldSearchRuns = [];
    let store = null;
    for (let r = 0; r < REPEATS; r += 1) {
      const t0 = performance.now();
      store = await vectorShards.loadStore(project);
      let best = -2;
      for (const item of store.vectors) best = Math.max(best, plainCosine(query0, item.embedding));
      oldSearchRuns.push(performance.now() - t0);
    }
    const loadStoreOnlyRuns = [];
    for (let r = 0; r < 5; r += 1) {
      const t0 = performance.now();
      await vectorShards.loadStore(project);
      loadStoreOnlyRuns.push(performance.now() - t0);
    }

    // ---- 新路径：首次装载（含转换），后续零 IO ----
    const tLoadIndex0 = performance.now();
    const index = await vectorShards.loadVectorIndex(project);
    const loadIndexColdMs = performance.now() - tLoadIndex0;

    const newSearchRuns = [];
    for (let r = 0; r < REPEATS; r += 1) {
      const t0 = performance.now();
      const warm = await vectorShards.loadVectorIndex(project); // 缓存命中，零 IO
      let best = -2;
      for (const shard of warm.shards) {
        for (let row = 0; row < shard.count; row += 1) {
          best = Math.max(best, vectorShards.indexVectorScore(queryEmbedding0, query0, shard, row));
        }
      }
      newSearchRuns.push(performance.now() - t0);
    }

    const heapAfter = process.memoryUsage().heapUsed;

    // 评分一致性抽查：同一查询两路径的 top1 分值必须一致
    let oldBest = -2;
    for (const item of store.vectors) oldBest = Math.max(oldBest, plainCosine(query0, item.embedding));
    let newBest = -2;
    for (const shard of index.shards) {
      for (let row = 0; row < shard.count; row += 1) newBest = Math.max(newBest, vectorShards.indexVectorScore(queryEmbedding0, query0, shard, row));
    }

    const oldMedian = median(oldSearchRuns);
    const newMedian = median(newSearchRuns);
    const report = {
      scale: { sources: SOURCES, chunksPerSource: CHUNKS_PER_SOURCE, dimensions: DIM, totalVectors: TOTAL },
      endToEndSearchMedianMs: {
        oldLoadEveryTime: Number(oldMedian.toFixed(1)),
        newResidentIndex: Number(newMedian.toFixed(1)),
      },
      speedupPerSearch: Number((oldMedian / newMedian).toFixed(1)),
      breakdown: {
        oldLoadStoreOnlyMedianMs: Number(median(loadStoreOnlyRuns).toFixed(1)),
        newFirstLoadColdMs: Number(loadIndexColdMs.toFixed(1)),
        note: "旧路径每次检索重读全部分片 JSON；新路径仅首次装载付费，之后同清单键零 IO",
      },
      topScoreParity: { old: Number(oldBest.toFixed(6)), new: Number(newBest.toFixed(6)), delta: Math.abs(oldBest - newBest) },
      heapUsedDeltaMB: Number(((heapAfter - heapBefore) / 1024 / 1024).toFixed(1)),
      repeats: REPEATS,
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await fs.rm(project, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
