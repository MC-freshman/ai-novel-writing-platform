const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { performance, monitorEventLoopDelay } = require("node:perf_hooks");
process.env.NOVEL_PLATFORM_TEST = "1";
const platform = require("../electron/main.cjs");
const runDirectory = path.join(path.resolve(__dirname, ".."), ".test-runs", "save-performance-" + new Date().toISOString().replace(/[:.]/g, "-"));
const projectPath = path.join(runDirectory, "project");

async function main() {
  await platform.ensureProjectStructure(projectPath, "500万字真实保存基准");
  const config = await platform.loadConfig(projectPath);
  config.agent.autoLocalAnalysis = false;
  const seed = "主角沿着北门线索调查旧事，记录人物位置、物品变化和未回收伏笔。";
  const body = seed.repeat(Math.ceil(20000 / seed.length)).slice(0, 20000);
  config.chapters = Array.from({ length: 250 }, (_, i) => ({ id: "save_sample_" + i, title: "保存样本 " + i, volume: "合成卷", order: i, fileName: "save_" + i + ".md", wordCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  for (const chapter of config.chapters) await fs.writeFile(platform.getChapterPath(projectPath, chapter), `# ${chapter.title}\n\n${body}`);
  await platform.saveConfig(projectPath, config);
  await platform.buildAppState(projectPath);
  const chapter = config.chapters[0];
  let current = await platform.loadChapterContent(projectPath, chapter.id);
  const samples = [];
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  let otherChapterReads = 0;
  const original = fs.readFile;
  fs.readFile = async (file, ...args) => {
    if (String(file).startsWith(path.join(projectPath, "chapters")) && String(file) !== platform.getChapterPath(projectPath, chapter)) otherChapterReads += 1;
    return original(file, ...args);
  };
  loopDelay.enable();
  try {
    for (let i = 0; i < 30; i++) {
      const content = `# ${chapter.title}\n\n${body}\n\n第${i}次保存：这一事实只属于当前章。`;
      const started = performance.now();
      const result = await platform.saveChapterContent(projectPath, { chapterId: chapter.id, content, expectedRevision: current.revision });
      samples.push(performance.now() - started);
      assert.equal(result.committed, true); assert.equal(result.indexWarning, "");
      current = { ...current, content, revision: result.revision };
    }
  } finally { fs.readFile = original; loopDelay.disable(); }
  samples.sort((a, b) => a - b);
  const report = { characters: 5000000, chapters: 250, saves: samples.length, p50Milliseconds: Number(samples[14].toFixed(2)), p95Milliseconds: Number(samples[28].toFixed(2)), otherChapterReads, eventLoopP95Milliseconds: Number((loopDelay.percentile(95) / 1e6).toFixed(2)), eventLoopMaxMilliseconds: Number((loopDelay.max / 1e6).toFixed(2)), samplesMilliseconds: samples.map((value) => Number(value.toFixed(2))) };
  assert.equal(otherChapterReads, 0, "真实保存不能读取其他249章");
  assert.ok(report.p95Milliseconds < 2500, "本地单章保存P95超过2.5秒");
  assert.ok(report.eventLoopMaxMilliseconds < 1000, "主线程连续阻塞超过1秒");
  await fs.writeFile(path.join(runDirectory, "save-performance.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, reportPath: path.join(runDirectory, "save-performance.json") }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
