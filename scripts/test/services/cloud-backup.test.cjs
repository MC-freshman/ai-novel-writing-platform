"use strict";
// 云备份测试（P80）：本地目录目标端到端（设置/上传/列表/恢复预览/确认导入）。
// WebDAV 目标为真机验证项（需真实服务）；此处覆盖本地目标与校验逻辑。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture, electron } = require("../helpers/service-fixture.cjs");
const cloudBackup = require("../../../electron/services/cloud-backup.cjs");
const { importProjectExchange } = require("../../../electron/services/project-ops.cjs");
const { loadConfig } = require("../../../electron/services/project-ops.cjs");

async function makeProject(root) {
  const project = path.join(root, "project");
  await fs.mkdir(path.join(project, "chapters"), { recursive: true });
  const now = new Date().toISOString();
  const config = {
    version: 1, title: "云备份验证", author: "t", createdAt: now, updatedAt: now,
    api: { provider: "deepseek", apiKey: "SECRET", baseUrl: "", chatModel: "", embeddingProvider: "", embeddingApiKey: "", embeddingBaseUrl: "", embeddingModel: "", temperature: 0.7, maxTokens: 2048, topK: 5, scanK: 50, sendFullText: false },
    ui: { theme: "light", fontSize: 16, lineHeight: 1.8, autosaveMs: 2000, backupOnSave: true, recoveryEnabled: true },
    agent: { autoLocalAnalysis: false, autoDeepAnalysis: false, evidenceRequired: true, snapshotBeforeBulkChanges: true, permissionLevel: "只读分析" },
    stats: { todayDate: "", todayWords: 0, totalWords: 0, lastAutoBackupAt: "" },
    chapters: [{ id: "ch_0", title: "第一章", fileName: "c1.md", order: 0, volume: "卷一", knowledgeRole: "正文", wordCount: 10, contentRevision: "", updatedAt: now }],
  };
  await fs.writeFile(path.join(project, "novel.config.json"), JSON.stringify(config));
  await fs.writeFile(path.join(project, "chapters", "c1.md"), "# 第一章\n\n云备份正文。");
  return project;
}

test("本地目标：设置/上传/列表/恢复预览/确认导入", async (t) => {
  const root = await fixture(t);
  electron.app.getPath = (name) => path.join(root, `userdata-${name}`);
  const project = await makeProject(root);
  const backupDir = path.join(root, "backups");
  const status = await cloudBackup.saveSettings(project, { targetType: "local", localDir: backupDir });
  assert.equal(status.settings.targetType, "local");
  const uploaded = await cloudBackup.upload(project);
  assert.ok(uploaded.fileName.startsWith(cloudBackup.BACKUP_PREFIX));
  assert.ok(uploaded.size > 0);
  const listed = await cloudBackup.list(project);
  assert.equal(listed.backups.length, 1);
  assert.equal(listed.backups[0].name, uploaded.fileName);
  // 恢复预览 + 确认导入（合并为副本）
  const { token, preview } = await cloudBackup.restorePreview(project, { name: uploaded.fileName });
  assert.ok(token);
  assert.equal(preview.canceled, undefined);
  assert.ok(preview.conflicts.chapters.includes("第一章"));
  const imported = await importProjectExchange(project, token, {});
  assert.ok(imported.imported.chapters >= 1);
  const config = await loadConfig(project);
  assert.ok(config.chapters.length >= 2, "导入应创建副本");
});

test("设置校验与无效备份名拒绝", async (t) => {
  const root = await fixture(t);
  electron.app.getPath = (name) => path.join(root, `userdata-${name}`);
  const project = await makeProject(root);
  await assert.rejects(() => cloudBackup.saveSettings(project, { targetType: "local", localDir: "" }), /本地备份目录/);
  await assert.rejects(() => cloudBackup.saveSettings(project, { targetType: "webdav", webdavUrl: "" }), /WebDAV 地址/);
  await cloudBackup.saveSettings(project, { targetType: "local", localDir: path.join(root, "b") });
  await assert.rejects(() => cloudBackup.restorePreview(project, { name: "../evil.zip" }), /无效的备份文件名/);
  const empty = await cloudBackup.list(project);
  assert.equal(empty.backups.length, 0);
});
test("P96 定时备份：间隔校验与默认值", async (t) => {
  const root = await fixture(t);
  electron.app.getPath = (name) => path.join(root, `userdata-${name}`);
  const project = await makeProject(root);
  const initial = await cloudBackup.getSchedule();
  assert.equal(initial.enabled, false);
  assert.equal(initial.intervalHours, 24);
  await assert.rejects(() => cloudBackup.saveSchedule({ enabled: true, intervalHours: 0 }), /1–168/);
  await assert.rejects(() => cloudBackup.saveSchedule({ enabled: true, intervalHours: 999 }), /1–168/);
  const saved = await cloudBackup.saveSchedule({ enabled: true, intervalHours: 12 });
  assert.equal(saved.enabled, true);
  assert.equal(saved.intervalHours, 12);
  const status = await cloudBackup.getStatus(project);
  assert.equal(status.schedule.enabled, true);
  cloudBackup.stopScheduler();
});

test("P96 调度器接线（契约）", () => {
  const fsSync = require("node:fs");
  const main = fsSync.readFileSync(require("node:path").resolve(__dirname, "../../../electron/main.cjs"), "utf8");
  assert.ok(main.includes("startScheduler()"), "主进程启动须初始化定时备份");
  const service = fsSync.readFileSync(require("node:path").resolve(__dirname, "../../../electron/services/cloud-backup.cjs"), "utf8");
  assert.ok(service.includes("unref"), "定时器须 unref 不阻塞退出");
  assert.ok(service.includes("scheduleRunning"), "须防并发重复备份");
});
