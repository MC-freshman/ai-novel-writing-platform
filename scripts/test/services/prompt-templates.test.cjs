"use strict";
// 指令模板库服务测试（P82）：CRUD/上限/导入去重/导出校验。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture, electron } = require("../helpers/service-fixture.cjs");
const templates = require("../../../electron/services/prompt-templates.cjs");

test("模板 CRUD 与校验", async (t) => {
  const root = await fixture(t);
  let data = await templates.listTemplates(root);
  assert.equal(data.templates.length, 0);
  data = await templates.saveTemplate(root, { title: "节奏分析", body: "分析《{{书名}}》{{章节标题}}的节奏" });
  assert.equal(data.templates.length, 1);
  const id = data.templates[0].id;
  data = await templates.saveTemplate(root, { id, title: "节奏分析 v2", body: "新正文" });
  assert.equal(data.templates.length, 1);
  assert.equal(data.templates[0].title, "节奏分析 v2");
  await assert.rejects(() => templates.saveTemplate(root, { title: "", body: "x" }), /不能为空/);
  await assert.rejects(() => templates.saveTemplate(root, { title: "x", body: "y".repeat(8001) }), /最长/);
  data = await templates.deleteTemplate(root, id);
  assert.equal(data.templates.length, 0);
  await assert.rejects(() => templates.deleteTemplate(root, id), /不存在/);
});

test("模板数量上限拒绝不截断", async (t) => {
  const root = await fixture(t);
  for (let i = 0; i < templates.MAX_TEMPLATES; i++)
    await templates.saveTemplate(root, { title: `模板${i}`, body: `正文${i}` });
  await assert.rejects(() => templates.saveTemplate(root, { title: "超限", body: "x" }), /上限/);
  const data = await templates.listTemplates(root);
  assert.equal(data.templates.length, templates.MAX_TEMPLATES);
});

test("导入去重与导出往返（模拟对话框）", async (t) => {
  const root = await fixture(t);
  await templates.saveTemplate(root, { title: "甲", body: "A" });
  // 导出：模拟保存对话框
  const exportPath = path.join(root, "export.json");
  electron.dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportPath });
  const exported = await templates.exportTemplates(root);
  assert.equal(exported.canceled, false);
  assert.equal(exported.count, 1);
  // 导入同一文件：完全重复被跳过
  electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [exportPath] });
  const imported = await templates.importTemplates(root);
  assert.equal(imported.added, 0);
  assert.equal(imported.skipped, 1);
  // 修改后导入：新增
  const parsed = JSON.parse(await fs.readFile(exportPath, "utf8"));
  parsed.templates.push({ title: "乙", body: "B" });
  await fs.writeFile(exportPath, JSON.stringify(parsed));
  const imported2 = await templates.importTemplates(root);
  assert.equal(imported2.added, 1);
  assert.equal(imported2.total, 2);
  // 非法文件
  const badPath = path.join(root, "bad.json");
  await fs.writeFile(badPath, "{broken");
  electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [badPath] });
  await assert.rejects(() => templates.importTemplates(root), /无法解析/);
  // 取消
  electron.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  const canceled = await templates.importTemplates(root);
  assert.equal(canceled.canceled, true);
});

test("损坏存储清洗", async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, "analysis"), { recursive: true });
  await fs.writeFile(templates.templatesPath(root), JSON.stringify({ templates: [{ title: "ok", body: "b" }, null, { title: "", body: "x" }, "bad"] }));
  const data = await templates.listTemplates(root);
  assert.equal(data.templates.length, 1);
  assert.equal(data.templates[0].title, "ok");
});