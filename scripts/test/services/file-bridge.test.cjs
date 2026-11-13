"use strict";
// 文件桥测试（P74）：导出/外部修改侦测/XMind 往返/JSON 保真/章节冲突即停。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture } = require("../helpers/service-fixture.cjs");
const fileBridge = require("../../../electron/services/file-bridge.cjs");
const { upsertItem, loadWorkspace } = require("../../../electron/services/creative-workspace.cjs");
const { getChapterPath } = require("../../../electron/services/project-files.cjs");

async function makeProject(root) {
  const project = path.join(root, "project");
  await fs.mkdir(path.join(project, "chapters"), { recursive: true });
  const now = new Date().toISOString();
  const config = {
    version: 1, title: "文件桥验证", author: "t", createdAt: now, updatedAt: now,
    api: { provider: "deepseek", apiKey: "", baseUrl: "", chatModel: "", embeddingProvider: "", embeddingApiKey: "", embeddingBaseUrl: "", embeddingModel: "", temperature: 0.7, maxTokens: 2048, topK: 5, scanK: 50, sendFullText: false },
    ui: { theme: "light", fontSize: 16, lineHeight: 1.8, autosaveMs: 2000, backupOnSave: true, recoveryEnabled: true },
    agent: { autoLocalAnalysis: false, autoDeepAnalysis: false, evidenceRequired: true, snapshotBeforeBulkChanges: true, permissionLevel: "只读分析" },
    stats: { todayDate: "", todayWords: 0, totalWords: 0, lastAutoBackupAt: "" },
    chapters: [{ id: "ch_0", title: "第一章", fileName: "c1.md", order: 0, volume: "卷一", knowledgeRole: "正文", wordCount: 10, contentRevision: "", updatedAt: now }],
  };
  await fs.writeFile(path.join(project, "novel.config.json"), JSON.stringify(config));
  await fs.writeFile(path.join(project, "chapters", "c1.md"), "# 第一章\n\n原始正文。");
  await upsertItem(project, "mindMaps", {
    id: "map_0", title: "测试导图", rootId: "root",
    nodes: [
      { id: "root", parentId: "", text: "中心", note: "中心备注", color: "", collapsed: false, order: 0, side: "right" },
      { id: "n1", parentId: "root", text: "分支甲", note: "", color: "", collapsed: false, order: 0, side: "left" },
      { id: "n2", parentId: "n1", text: "子主题", note: "", color: "", collapsed: false, order: 0, side: "left" },
    ],
    relations: [], positions: {},
  });
  return project;
}

test("导图导出：xmind 往返 + json 保真 + 变更侦测", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root);
  const exported = await fileBridge.exportForBridge(project, { kind: "mindmap", id: "map_0" });
  assert.equal(exported.files.length, 2);
  // 未修改时无变化
  const before = await fileBridge.checkChanges(project);
  assert.equal(before.changed.length, 0);
  // 外部修改 json（模拟外部编辑）
  const jsonFile = exported.files.find((file) => file.endsWith(".json"));
  const map = JSON.parse(await fs.readFile(jsonFile, "utf8"));
  map.nodes[1].text = "分支甲改";
  await fs.writeFile(jsonFile, JSON.stringify(map));
  const after = await fileBridge.checkChanges(project);
  assert.ok(after.changed.some((item) => item.kind === "mindmap-json"));
  // 预览 + 确认回导（json 保真）
  const preview = await fileBridge.reimportPreview(project, { bridgeFile: jsonFile });
  assert.equal(preview.kind, "mindmap-json");
  assert.equal(preview.nodeCount, 3);
  const result = await fileBridge.reimportConfirm(project, { bridgeFile: jsonFile });
  assert.equal(result.id, "map_0");
  const workspace = await loadWorkspace(project);
  assert.equal(workspace.mindMaps.find((item) => item.id === "map_0").nodes[1].text, "分支甲改");
  // 回导后哈希刷新，不再提示变化
  const settled = await fileBridge.checkChanges(project);
  assert.ok(!settled.changed.some((item) => item.filePath === jsonFile));
});

test("xmind 导出可被平台导入器解析（往返）", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root);
  const exported = await fileBridge.exportForBridge(project, { kind: "mindmap", id: "map_0" });
  const xmindFile = exported.files.find((file) => file.endsWith(".xmind"));
  const preview = await fileBridge.reimportPreview(project, { bridgeFile: xmindFile });
  assert.equal(preview.kind, "mindmap");
  assert.equal(preview.sheets[0].nodeCount, 3);
  assert.ok(preview.lossy.includes("关系线"));
  const result = await fileBridge.reimportConfirm(project, { bridgeFile: xmindFile, sheetIndex: 0 });
  assert.equal(result.nodeCount, 3);
});

test("章节桥：回导成功与冲突即停", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root);
  const exported = await fileBridge.exportForBridge(project, { kind: "chapter", id: "ch_0" });
  const chapterFile = exported.primary;
  await fs.writeFile(chapterFile, "# 第一章\n\n外部修改后的正文。");
  const preview = await fileBridge.reimportPreview(project, { bridgeFile: chapterFile });
  assert.equal(preview.conflict, false);
  const result = await fileBridge.reimportConfirm(project, { bridgeFile: chapterFile });
  assert.equal(result.kind, "chapter");
  const content = await fs.readFile(getChapterPath(project, { fileName: "c1.md" }), "utf8");
  assert.ok(content.includes("外部修改后的正文"));
  // 再次外部修改，但平台内也改了 → 冲突
  await fs.writeFile(chapterFile, "# 第一章\n\n又一次外部修改。");
  await fs.writeFile(getChapterPath(project, { fileName: "c1.md" }), "# 第一章\n\n平台内修改。");
  const conflictPreview = await fileBridge.reimportPreview(project, { bridgeFile: chapterFile });
  assert.equal(conflictPreview.conflict, true);
  await assert.rejects(() => fileBridge.reimportConfirm(project, { bridgeFile: chapterFile }), /已停止回导/);
});

test("路径越界与非法类型拒绝", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root);
  await assert.rejects(() => fileBridge.exportForBridge(project, { kind: "bad", id: "x" }), /不支持的桥接类型/);
  await assert.rejects(() => fileBridge.openExternal(project, { filePath: path.join(root, "outside.txt") }), /bridge 目录/);
  await assert.rejects(() => fileBridge.reimportPreview(project, { bridgeFile: path.join(root, "outside.xmind") }), /非法的桥接文件路径/);
});