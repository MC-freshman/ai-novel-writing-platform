"use strict";
// 敏感词自查测试（P77）：AC 引擎/词库管理/忽略名单/扫描报告/导入校验。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture, electron } = require("../helpers/service-fixture.cjs");
const sensitive = require("../../../electron/services/sensitive-check.cjs");

async function makeProject(root, chapters) {
  const project = path.join(root, "project");
  await fs.mkdir(path.join(project, "chapters"), { recursive: true });
  const now = new Date().toISOString();
  const config = {
    version: 1, title: "自查验证", author: "t", createdAt: now, updatedAt: now,
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

test("AC 自动机：重叠/嵌套/failure 链命中", () => {
  const automaton = sensitive.buildAutomaton(["他", "他们", "他们俩", "abcab", "ab"]);
  const hits = sensitive.scanText(automaton, "他们俩abcab");
  const words = hits.map((hit) => `${hit.word}@${hit.start}`);
  assert.ok(words.includes("他@0"));
  assert.ok(words.includes("他们@0"));
  assert.ok(words.includes("他们俩@0"));
  assert.ok(words.includes("ab@3"));
  assert.ok(words.includes("abcab@3"));
  assert.ok(words.includes("ab@6"), "failure 链应命中第二个 ab");
  assert.deepEqual(sensitive.scanText(automaton, "无关文本"), []);
  const empty = sensitive.buildAutomaton([]);
  assert.deepEqual(sensitive.scanText(empty, "任意"), []);
});

test("默认词库为停用的自研示例；词库开关与删除保护", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, []);
  let state = await sensitive.getState(project);
  const demo = state.dictionaries.find((item) => item.id === "builtin-demo");
  assert.ok(demo, "须含内置示例词表");
  assert.equal(demo.enabled, false, "示例词表默认停用");
  assert.equal(demo.builtin, true);
  state = await sensitive.toggleDictionary(project, "builtin-demo", true);
  assert.equal(state.dictionaries.find((item) => item.id === "builtin-demo").enabled, true);
  await assert.rejects(() => sensitive.deleteDictionary(project, "builtin-demo"), /不可删除/);
  await assert.rejects(() => sensitive.toggleDictionary(project, "missing", true), /不存在/);
});

test("忽略名单增删与上限口径", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, []);
  let state = await sensitive.updateIgnore(project, "示例违禁词甲");
  assert.ok(state.ignoreList.includes("示例违禁词甲"));
  state = await sensitive.updateIgnore(project, "示例违禁词甲");
  assert.equal(state.ignoreList.filter((word) => word === "示例违禁词甲").length, 1, "重复添加去重");
  state = await sensitive.updateIgnore(project, "示例违禁词甲", true);
  assert.ok(!state.ignoreList.includes("示例违禁词甲"));
  await assert.rejects(() => sensitive.updateIgnore(project, "  "), /不能为空/);
});

test("全书扫描：命中/忽略过滤/报告落盘/空词库", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, [
    { title: "第一章", fileName: "c1.md", content: "这里出现示例违禁词甲，还有示例违禁词乙。" },
    { title: "第二章", fileName: "c2.md", content: "干净的一章。" },
  ]);
  // 未启用任何词库 → 0 命中
  let report = await sensitive.scan(project, {});
  assert.equal(report.totalHits, 0);
  assert.equal(report.scannedChapters, 2);
  // 启用示例词库 → 命中
  await sensitive.toggleDictionary(project, "builtin-demo", true);
  report = await sensitive.scan(project, {});
  assert.equal(report.totalHits, 2);
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].chapterId, "ch_0");
  assert.ok(report.results[0].hits[0].context.includes("示例违禁词甲"));
  assert.ok(report.note.includes("不代表任何平台审核结论"));
  const onDisk = JSON.parse(await fs.readFile(sensitive.reportPath(project), "utf8"));
  assert.equal(onDisk.totalHits, 2);
  // 忽略后重扫
  await sensitive.updateIgnore(project, "示例违禁词甲");
  report = await sensitive.scan(project, {});
  assert.equal(report.totalHits, 1);
  // 指定章节
  report = await sensitive.scan(project, { chapterIds: ["ch_1"] });
  assert.equal(report.scannedChapters, 1);
  assert.equal(report.totalHits, 0);
});

test("词库导入：TXT 每行一词/JSON/非法文件/取消", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, []);
  const txtPath = path.join(root, "words.txt");
  await fs.writeFile(txtPath, "词一\n词二\n词一\n\n");
  electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [txtPath] });
  const imported = await sensitive.importDictionary(project);
  assert.equal(imported.canceled, false);
  assert.equal(imported.dictionary.wordCount, 2, "去重去空行");
  const state = await sensitive.getState(project);
  const added = state.dictionaries.find((item) => item.id === imported.dictionary.id);
  assert.equal(added.enabled, true);
  // JSON 词库
  const jsonPath = path.join(root, "words.json");
  await fs.writeFile(jsonPath, JSON.stringify({ name: "JSON词库", words: ["甲", "乙"] }));
  electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [jsonPath] });
  const importedJson = await sensitive.importDictionary(project);
  assert.equal(importedJson.dictionary.name, "JSON词库");
  // 非法 JSON
  const badPath = path.join(root, "bad.json");
  await fs.writeFile(badPath, "{broken");
  electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [badPath] });
  await assert.rejects(() => sensitive.importDictionary(project), /无法解析/);
  // 取消
  electron.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  const canceled = await sensitive.importDictionary(project);
  assert.equal(canceled.canceled, true);
  // 删除导入的词库
  const afterDelete = await sensitive.deleteDictionary(project, imported.dictionary.id);
  assert.ok(!afterDelete.dictionaries.some((item) => item.id === imported.dictionary.id));
});