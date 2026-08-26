const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

process.env.NOVEL_PLATFORM_TEST = "1";
process.env.NOVEL_CHAT_TIMEOUT_MS = "0";

const platform = require("../electron/main.cjs");
const vectorShards = require("../electron/services/vector-shards.cjs");

const TOTAL_CHARACTERS = 5_000_000;
const SOURCE_COUNT = 250;

function makeCorpus() {
  const seed = "李明沿着圣城北门的线索继续调查，记录人物位置、物品变化与未回收伏笔。";
  return seed.repeat(Math.ceil(TOTAL_CHARACTERS / seed.length)).slice(0, TOTAL_CHARACTERS);
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novel-long-project-"));
  try {
    await platform.ensureProjectStructure(root, "五百万字性能测试");
    const corpus = makeCorpus();
    const sourceLength = Math.ceil(corpus.length / SOURCE_COUNT);
    const sources = Array.from({ length: SOURCE_COUNT }, (_, index) => ({
      id: `long_source_${index}`,
      type: "chapter",
      title: `第${index + 1}章 性能样本`,
      volume: `第${Math.floor(index / 50) + 1}卷`,
      category: `第${Math.floor(index / 50) + 1}卷`,
      knowledgeRole: "正文",
      content: corpus.slice(index * sourceLength, Math.min(corpus.length, (index + 1) * sourceLength)),
    }));

    const startedAt = Date.now();
    const indexed = await platform.indexSources(root, sources, { replaceSummaries: true, replaceAllIndex: true });
    const indexSeconds = (Date.now() - startedAt) / 1000;
    const stats = await vectorShards.stats(root);
    assert.equal(stats.sources, SOURCE_COUNT, "五百万字索引应保留全部文档分片");
    assert.ok(stats.chunks >= 10_000, `预期至少一万个片段，实际 ${stats.chunks}`);
    assert.equal(indexed.totalChunks, stats.chunks, "索引返回值应与分片清单一致");
    assert.ok(indexSeconds < 180, `本地建立五百万字索引用时过长：${indexSeconds.toFixed(1)} 秒`);

    const manifest = await vectorShards.migrateLegacyIfNeeded(root);
    const untouched = manifest.sources.find((item) => item.sourceId === "long_source_249");
    const untouchedPath = path.join(root, "vector_db", "shards", untouched.fileName);
    const untouchedBefore = await fs.readFile(untouchedPath, "utf8");
    const updateStartedAt = Date.now();
    await platform.indexSource(root, { ...sources[0], content: `${sources[0].content}\n新增伏笔：北门守卫隐瞒了一封信。` });
    const updateMilliseconds = Date.now() - updateStartedAt;
    assert.equal(await fs.readFile(untouchedPath, "utf8"), untouchedBefore, "更新单章时不应重写其他 249 个分片");

    const searchStartedAt = Date.now();
    const search = await platform.searchRelevantChunks(root, "北门的线索和伏笔", 120, {
      candidateSourceIds: sources.slice(0, 24).map((item) => item.id),
      scanLimit: 5000,
      minKeep: 30,
    });
    const searchMilliseconds = Date.now() - searchStartedAt;
    assert.ok(search.chunks.length >= 30 && search.chunks.length <= 120, "检索片段数应在动态下限与发送上限之间");
    assert.ok(search.scannedCount < search.totalIndexedCount, "普通检索应只读取路由后的分片，不应加载整库");
    assert.ok(searchMilliseconds < 10_000, `分片检索用时过长：${searchMilliseconds} 毫秒`);

    console.log(JSON.stringify({
      characters: corpus.length,
      sources: stats.sources,
      chunks: stats.chunks,
      indexSeconds: Number(indexSeconds.toFixed(2)),
      singleSourceUpdateMilliseconds: updateMilliseconds,
      routedSearchMilliseconds: searchMilliseconds,
      routedScannedChunks: search.scannedCount,
      totalIndexedChunks: search.totalIndexedCount,
      rssMegabytes: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
    }, null, 2));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
