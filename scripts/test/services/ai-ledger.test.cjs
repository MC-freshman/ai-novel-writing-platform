"use strict";
// AI 台账与证据包测试（P78）：采纳记录/占比估算/证据包结构与隐私排除/版本原文上限。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { fixture, electron } = require("../helpers/service-fixture.cjs");
const ledger = require("../../../electron/services/ai-ledger.cjs");
const { getChapterVersionDir } = require("../../../electron/services/project-files.cjs");

async function makeProject(root, chapters) {
  const project = path.join(root, "project");
  await fs.mkdir(path.join(project, "chapters"), { recursive: true });
  const now = new Date().toISOString();
  const config = {
    version: 1, title: "台账验证", author: "作者甲", createdAt: now, updatedAt: now,
    api: { provider: "deepseek", apiKey: "SECRET-KEY-MUST-NOT-LEAK", baseUrl: "https://api.example.com", chatModel: "m", embeddingProvider: "", embeddingApiKey: "SECRET-EMB", embeddingBaseUrl: "", embeddingModel: "", temperature: 0.7, maxTokens: 2048, topK: 5, scanK: 50, sendFullText: false },
    ui: { theme: "light", fontSize: 16, lineHeight: 1.8, autosaveMs: 2000, backupOnSave: true, recoveryEnabled: true },
    agent: { autoLocalAnalysis: false, autoDeepAnalysis: false, evidenceRequired: true, snapshotBeforeBulkChanges: true, permissionLevel: "只读分析" },
    stats: { todayDate: "", todayWords: 0, totalWords: 100, lastAutoBackupAt: "" },
    chapters: chapters.map((chapter, index) => ({ id: `ch_${index}`, title: chapter.title, fileName: chapter.fileName, order: index, volume: "卷一", knowledgeRole: "正文", wordCount: chapter.wordCount || 100, contentRevision: "rev", updatedAt: now })),
  };
  await fs.writeFile(path.join(project, "novel.config.json"), JSON.stringify(config));
  for (const chapter of chapters)
    await fs.writeFile(path.join(project, "chapters", chapter.fileName), chapter.content || "正文内容。");
  return project;
}

test("采纳记录与概览：聚合/估算/无记录=null", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, [
    { title: "第一章", fileName: "c1.md", wordCount: 1000 },
    { title: "第二章", fileName: "c2.md", wordCount: 500 },
  ]);
  await ledger.recordAdoption(project, { chapterId: "ch_0", chapterTitle: "第一章", revisionId: "r1", mode: "full", adoptedWords: 100, at: "2026-11-10T08:00:00Z" });
  await ledger.recordAdoption(project, { chapterId: "ch_0", chapterTitle: "第一章", revisionId: "r2", mode: "part", adoptedWords: 50, at: "2026-11-10T09:00:00Z" });
  const overview = await ledger.getOverview(project);
  assert.equal(overview.totalAdoptions, 2);
  assert.equal(overview.totalAdoptedWords, 150);
  assert.equal(overview.recordedChapters, 1);
  const first = overview.chapters.find((chapter) => chapter.chapterId === "ch_0");
  assert.equal(first.adoptedWords, 150);
  assert.equal(first.estimatedRatio, 0.15);
  const second = overview.chapters.find((chapter) => chapter.chapterId === "ch_1");
  assert.equal(second.estimatedRatio, null, "无记录章节占比为 null 而非 0");
  assert.ok(overview.note.includes("不构成法律或平台审核保证"));
});

test("台账条目上限裁剪最旧", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, [{ title: "第一章", fileName: "c1.md" }]);
  const entries = [];
  for (let i = 0; i < ledger.MAX_ENTRIES; i++)
    entries.push({ id: `led_${i}`, chapterId: "ch_0", chapterTitle: "第一章", revisionId: `r${i}`, mode: "full", adoptedWords: 1, at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z` });
  await fs.mkdir(path.join(project, "analysis"), { recursive: true });
  await fs.writeFile(ledger.ledgerPath(project), JSON.stringify({ version: 1, entries, updatedAt: "" }));
  await ledger.recordAdoption(project, { chapterId: "ch_0", chapterTitle: "第一章", revisionId: "new", mode: "full", adoptedWords: 5, at: "2026-11-10T08:00:00Z" });
  const data = await ledger.loadLedger(project);
  assert.equal(data.entries.length, ledger.MAX_ENTRIES);
  assert.equal(data.entries[0].id, "led_1", "最旧条目被裁剪");
  assert.equal(data.entries[data.entries.length - 1].revisionId, "new");
});

test("证据包：结构/哈希/隐私排除/版本原文与上限", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, [{ title: "第一章", fileName: "c1.md", content: "当前正文。" }]);
  // 构造一个历史版本
  const versionDir = getChapterVersionDir(project, "ch_0");
  await fs.mkdir(versionDir, { recursive: true });
  await fs.writeFile(path.join(versionDir, "version_x.json"), JSON.stringify({ id: "version_x", chapterId: "ch_0", fileName: "version_x.md", createdAt: "2026-11-09T08:00:00Z", contentRevision: "oldrev", reason: "保存前版本" }));
  await fs.writeFile(path.join(versionDir, "version_x.md"), "旧版正文。");
  await ledger.recordAdoption(project, { chapterId: "ch_0", chapterTitle: "第一章", revisionId: "r1", mode: "full", adoptedWords: 10, at: "2026-11-10T08:00:00Z" });

  const exportPath = path.join(root, "evidence.zip");
  electron.dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportPath });
  const result = await ledger.exportEvidence(project, { includeVersionContent: true });
  assert.equal(result.canceled, false);
  assert.equal(result.counts.chapters, 1);
  assert.equal(result.counts.adoptions, 1);
  assert.equal(result.counts.versionFiles, 1);
  const zip = new AdmZip(exportPath);
  const names = zip.getEntries().map((entry) => entry.entryName);
  assert.ok(names.includes("evidence.json"));
  assert.ok(names.includes("evidence.md"));
  assert.ok(names.includes("SHA256SUMS.txt"));
  assert.ok(names.includes("versions/ch_0/version_x.md"));
  const evidenceText = zip.readAsText("evidence.json");
  assert.ok(!evidenceText.includes("SECRET-KEY-MUST-NOT-LEAK"), "聊天密钥不得入包");
  assert.ok(!evidenceText.includes("SECRET-EMB"), "向量密钥不得入包");
  assert.ok(!evidenceText.includes("api.example.com"), "接口地址不得入包");
  const evidence = JSON.parse(evidenceText);
  assert.equal(evidence.schema, "novel-creation-evidence/v1");
  assert.equal(evidence.chapters[0].versions.length, 1);
  assert.ok(evidence.chapters[0].versions[0].contentHash.length === 64);
  assert.ok(evidence.chapters[0].currentHash.length === 64);
  assert.equal(evidence.timeline.adoptions.length, 1);
  assert.ok(evidence.limitations.length >= 2);
  const sums = zip.readAsText("SHA256SUMS.txt");
  assert.ok(sums.includes("evidence.json"));
  // 不含版本原文
  const plainPath = path.join(root, "evidence-plain.zip");
  electron.dialog.showSaveDialog = async () => ({ canceled: false, filePath: plainPath });
  const plain = await ledger.exportEvidence(project, {});
  assert.equal(plain.counts.versionFiles, 0);
  const plainZip = new AdmZip(plainPath);
  assert.ok(!plainZip.getEntries().some((entry) => entry.entryName.startsWith("versions/")));
  // 取消
  electron.dialog.showSaveDialog = async () => ({ canceled: true, filePath: "" });
  const canceled = await ledger.exportEvidence(project, {});
  assert.equal(canceled.canceled, true);
});