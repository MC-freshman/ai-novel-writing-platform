const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const vectors = require("../electron/services/vector-shards.cjs");

function quantile(values, fraction) { return values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)]; }
function embedding(row, dimensions) { return Array.from({ length: dimensions }, (_, column) => ((row * 17 + column * 13) % 31 - 15) / 16); }
function plainScore(a, b) {
  let dot = 0, left = 0, right = 0;
  for (let index = 0; index < a.length; index++) { dot += a[index] * b[index]; left += a[index] ** 2; right += b[index] ** 2; }
  return dot / Math.sqrt(left * right);
}
async function worker(total, dimensions) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novel-capacity-"));
  let peakSampledRss = process.memoryUsage().rss;
  const sampler = setInterval(() => { peakSampledRss = Math.max(peakSampledRss, process.memoryUsage().rss); }, 20);
  const identity = dimensions === 384 ? { embeddingSource: "local" } : { embeddingSource: "api", embeddingIdentity: "synthetic-api-1024" };
  const query = embedding(1, dimensions);
  const queryEmbedding = { source: identity.embeddingSource, identity: identity.embeddingIdentity, vector: query };
  function make(row, sourceId) { return { id: String(row), sourceId, sourceType: "chapter", title: sourceId, text: "合成小说片段。".repeat(80), chunkIndex: row, embedding: embedding(row, dimensions), ...identity }; }
  function search(index) {
    let best = -2;
    for (const shard of index.shards) for (let row = 0; row < shard.count; row++) best = Math.max(best, vectors.indexVectorScore(queryEmbedding, query, shard, row));
    return best;
  }
  try {
    const generateStart = performance.now();
    for (let start = 0; start < total; start += 1000) {
      const sourceId = `source-${start / 1000}`;
      await vectors.upsertSources(root, new Map([[sourceId, Array.from({ length: Math.min(1000, total - start) }, (_, offset) => make(start + offset, sourceId))]]));
    }
    const generatedMs = performance.now() - generateStart;
    global.gc?.();
    const before = process.memoryUsage();
    const started = performance.now();
    let index = await vectors.loadVectorIndex(root);
    const coldBest = search(index);
    const coldMs = performance.now() - started;
    const durations = [];
    for (let run = 0; run < 15; run++) {
      const start = performance.now();
      index = await vectors.loadVectorIndex(root);
      assert.ok(Math.abs(search(index) - coldBest) < 1e-8);
      durations.push(performance.now() - start);
    }
    for (const shard of index.shards) for (const row of [0, shard.count - 1]) {
      assert.ok(Math.abs(vectors.indexVectorScore(queryEmbedding, query, shard, row) - plainScore(query, embedding(Number(shard.meta[row].id), dimensions))) < 1e-6);
    }
    const filtered = await vectors.loadVectorIndex(root, { sourceIds: ["source-0"] });
    assert.equal(filtered.shards.length, 1);
    assert.equal(filtered.shards[0].sourceId, "source-0");
    await vectors.upsertSources(root, new Map([["source-0", [make(0, "source-0")]]]));
    const changed = await vectors.loadVectorIndex(root, { sourceIds: ["source-0"] });
    assert.equal(changed.shards[0].count, 1);
    await vectors.removeSource(root, "source-0");
    assert.equal((await vectors.loadVectorIndex(root, { sourceIds: ["source-0"] })).shards.length, 0);
    const memory = process.memoryUsage();
    return { total, dimensions, textCharactersPerChunk: 560, generatedMs, coldSearchMs: coldMs, warmP50Ms: quantile(durations, 0.5), warmP95Ms: quantile(durations, 0.95), repeats: durations.length, rssBeforeMB: before.rss / 2 ** 20, peakRssMB: Math.max(peakSampledRss, process.resourceUsage().maxRSS * 1024) / 2 ** 20, arrayBuffersMB: memory.arrayBuffers / 2 ** 20, parity: "pass", filterAndInvalidation: "pass" };
  } finally {
    clearInterval(sampler);
    const relative = path.relative(path.resolve(os.tmpdir()), root);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    await fs.rm(root, { recursive: true, force: true });
  }
}
async function main() {
  if (process.argv[2] === "--worker") { console.log(JSON.stringify(await worker(Number(process.argv[3]), Number(process.argv[4])))); return; }
  const report = { generatedAt: new Date().toISOString(), node: process.version, cpu: os.cpus()[0]?.model, totalMemoryMB: os.totalmem() / 2 ** 20, synthetic: true, coldDefinition: "fresh-process index; OS file cache is not flushed", cases: [] };
  const output = path.resolve(".test-runs/debt-closeout/retrieval-capacity.json");
  await fs.mkdir(path.dirname(output), { recursive: true });
  for (const dimensions of [384, 1024]) for (const total of [30000, 50000, 100000, 200000]) {
    console.log(`开始容量基准 ${total} × ${dimensions}`);
    const result = await new Promise((resolve, reject) => execFile(process.execPath, ["--expose-gc", "--max-old-space-size=4096", __filename, "--worker", String(total), String(dimensions)], { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(JSON.parse(stdout.trim()))));
    report.cases.push(result);
    await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
    console.log(`完成 ${total} × ${dimensions}: cold ${result.coldSearchMs.toFixed(0)}ms, warm P95 ${result.warmP95Ms.toFixed(0)}ms, peak ${result.peakRssMB.toFixed(0)}MB`);
  }
  console.log("PASS: " + output);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
