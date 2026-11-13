"use strict";
// 文风自查测试（P85）：指标口径/阈值标记/段落定位/报告落盘/免责。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture } = require("../helpers/service-fixture.cjs");
const styleCheck = require("../../../electron/services/style-check.cjs");

async function makeProject(root, chapters) {
  const project = path.join(root, "project");
  await fs.mkdir(path.join(project, "chapters"), { recursive: true });
  const now = new Date().toISOString();
  const config = {
    version: 1, title: "文风验证", author: "t", createdAt: now, updatedAt: now,
    api: { provider: "deepseek", apiKey: "", baseUrl: "", chatModel: "", embeddingProvider: "", embeddingApiKey: "", embeddingBaseUrl: "", embeddingModel: "", temperature: 0.7, maxTokens: 2048, topK: 5, scanK: 50, sendFullText: false },
    ui: { theme: "light", fontSize: 16, lineHeight: 1.8, autosaveMs: 2000, backupOnSave: true, recoveryEnabled: true },
    agent: { autoLocalAnalysis: false, autoDeepAnalysis: false, evidenceRequired: true, snapshotBeforeBulkChanges: true, permissionLevel: "只读分析" },
    stats: { todayDate: "", todayWords: 0, totalWords: 0, lastAutoBackupAt: "" },
    chapters: chapters.map((chapter, index) => ({ id: `ch_${index}`, title: chapter.title, fileName: chapter.fileName, order: index, volume: "卷一", knowledgeRole: "正文", wordCount: 10 })),
  };
  await fs.writeFile(path.join(project, "novel.config.json"), JSON.stringify(config));
  for (const chapter of chapters)
    await fs.writeFile(path.join(project, "chapters", chapter.fileName), chapter.content);
  return project;
}

test("analyzeText：句长统计/模板命中/重复率/标记", () => {
  const uniform = "他走了。他来了。他笑了。他哭了。他睡了。他醒了。他跑了。他跳了。";
  const analysis = styleCheck.analyzeText(uniform, styleCheck.DEFAULT_THRESHOLDS);
  assert.equal(analysis.metrics.sentenceCount, 8);
  assert.ok(analysis.metrics.sentenceLenCV < 0.35);
  assert.ok(analysis.flags.some((flag) => flag.key === "sentenceUniform"), "均匀短句须标记");
  const templated = "他嘴角勾起一抹弧度，眼中闪过一丝笑意，深吸一口气，缓缓说道。".repeat(6);
  const templatedAnalysis = styleCheck.analyzeText(templated, styleCheck.DEFAULT_THRESHOLDS);
  assert.ok(templatedAnalysis.metrics.templateHits >= 24);
  assert.ok(templatedAnalysis.flags.some((flag) => flag.key === "template"));
  assert.ok(templatedAnalysis.topParagraphs.length >= 1);
  const varied = "夜雨敲着窗。他忽然想起多年前那个没有星星的晚上，母亲把最后一块饼掰成两半，大的那半递到他手里，自己只舔了舔指尖的碎屑。";
  const variedAnalysis = styleCheck.analyzeText(varied, styleCheck.DEFAULT_THRESHOLDS);
  assert.ok(!variedAnalysis.flags.some((flag) => flag.key === "sentenceUniform"));
  assert.equal(styleCheck.analyzeText("", styleCheck.DEFAULT_THRESHOLDS).metrics.chars, 0);
});

test("analyzeBook：报告落盘/章节过滤/阈值覆盖/免责", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, [
    { title: "第一章", fileName: "c1.md", content: "他嘴角勾起一抹弧度。".repeat(30) },
    { title: "第二章", fileName: "c2.md", content: "干净的章节，没有任何模板短语，句子长短错落有致，读起来自然。" },
  ]);
  const report = await styleCheck.analyzeBook(project, {});
  assert.equal(report.scannedChapters, 2);
  assert.ok(report.flaggedChapters >= 1);
  assert.ok(report.note.includes("不代表任何平台 AI 检测结论"));
  const onDisk = JSON.parse(await fs.readFile(styleCheck.reportPath(project), "utf8"));
  assert.equal(onDisk.scannedChapters, 2);
  const filtered = await styleCheck.analyzeBook(project, { chapterIds: ["ch_1"] });
  assert.equal(filtered.scannedChapters, 1);
  const loaded = await styleCheck.getReport(project);
  assert.equal(loaded.scannedChapters, 1);
  // 放宽阈值后不再标记模板
  const relaxed = await styleCheck.analyzeBook(project, { thresholds: { templatePer1000: 1000 } });
  assert.ok(!relaxed.chapters[0].flags.some((flag) => flag.key === "template"));
});

test("getReport：无报告返回 null", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, []);
  assert.equal(await styleCheck.getReport(project), null);
});