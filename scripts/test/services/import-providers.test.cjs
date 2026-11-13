"use strict";
// 外部项目导入测试（P91）：Obsidian 递归/分卷映射/wiki 警告/.nwx 解包/nwd 元数据剥离。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { fixture } = require("../helpers/service-fixture.cjs");
const importProviders = require("../../../electron/services/import-providers.cjs");
const { loadConfig } = require("../../../electron/services/project-ops.cjs");

async function makeProject(root) {
  const project = path.join(root, "project");
  await fs.mkdir(path.join(project, "chapters"), { recursive: true });
  const now = new Date().toISOString();
  const config = {
    version: 1, title: "导入验证", author: "t", createdAt: now, updatedAt: now,
    api: { provider: "deepseek", apiKey: "", baseUrl: "", chatModel: "", embeddingProvider: "", embeddingApiKey: "", embeddingBaseUrl: "", embeddingModel: "", temperature: 0.7, maxTokens: 2048, topK: 5, scanK: 50, sendFullText: false },
    ui: { theme: "light", fontSize: 16, lineHeight: 1.8, autosaveMs: 2000, backupOnSave: true, recoveryEnabled: true },
    agent: { autoLocalAnalysis: false, autoDeepAnalysis: false, evidenceRequired: true, snapshotBeforeBulkChanges: true, permissionLevel: "只读分析" },
    stats: { todayDate: "", todayWords: 0, totalWords: 0, lastAutoBackupAt: "" },
    chapters: [],
  };
  await fs.writeFile(path.join(project, "novel.config.json"), JSON.stringify(config));
  return project;
}

test("scanVault：递归/分卷映射/wiki 警告/隐藏目录跳过", async (t) => {
  const root = await fixture(t);
  const vault = path.join(root, "vault");
  await fs.mkdir(path.join(vault, "卷一", "子目录"), { recursive: true });
  await fs.mkdir(path.join(vault, ".obsidian"), { recursive: true });
  await fs.writeFile(path.join(vault, "根文档.md"), "# 根文档\n\n正文 [[另一篇]]。");
  await fs.writeFile(path.join(vault, "卷一", "第一章.md"), "# 第一章\n\n内容。");
  await fs.writeFile(path.join(vault, "卷一", "子目录", "第二章.md"), "第二章正文");
  await fs.writeFile(path.join(vault, ".obsidian", "配置.md"), "隐藏");
  await fs.writeFile(path.join(vault, "图片.png"), "binary");
  const scan = await importProviders.scanVault(vault);
  assert.equal(scan.files.length, 3);
  const rootDoc = scan.files.find((file) => file.relPath === "根文档.md");
  assert.equal(rootDoc.title, "根文档");
  assert.equal(rootDoc.volume, "导入文档");
  const nested = scan.files.find((file) => file.relPath.includes("子目录"));
  assert.equal(nested.volume, "卷一 / 子目录");
  assert.ok(scan.warnings.some((warning) => warning.includes("wiki 链接")));
});

test("stripNwdMeta 剥离 %%~ 元数据", () => {
  const nwd = "%%~name: 第一章\n%%~path: 1\n\n# 第一章\n\n正文。";
  const stripped = importProviders.stripNwdMeta(nwd);
  assert.ok(!stripped.includes("%%~"));
  assert.ok(stripped.includes("# 第一章"));
});

test("runVaultImport：章节创建与分卷", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root);
  const vault = path.join(root, "vault");
  await fs.mkdir(path.join(vault, "卷一"), { recursive: true });
  await fs.writeFile(path.join(vault, "卷一", "第一章.md"), "# 第一章\n\n这是导入的正文内容。");
  await fs.writeFile(path.join(vault, "第二章.md"), "# 第二章\n\n更多正文。");
  const result = await importProviders.runVaultImport(project, { directory: vault });
  assert.equal(result.imported, 2);
  const config = await loadConfig(project);
  assert.equal(config.chapters.length, 2);
  assert.ok(config.chapters.some((chapter) => chapter.volume === "卷一"));
});

test("nwx 预览与导入（zip 内 nwd/md）", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root);
  const nwxPath = path.join(root, "book.nwx");
  const zip = new AdmZip();
  zip.addFile("project/第一章.nwd", Buffer.from("%%~name: 第一章\n\n# 第一章\n\nnwd 正文。"));
  zip.addFile("project/第二章.md", Buffer.from("# 第二章\n\nmd 正文。"));
  zip.addFile("project/nwProject.nwx", Buffer.from("<project/>"));
  zip.writeZip(nwxPath);
  // 直接调用内部解包路径（绕过对话框）：用 runNwxImport
  const result = await importProviders.runNwxImport(project, { filePath: nwxPath });
  assert.equal(result.imported, 2);
  const config = await loadConfig(project);
  assert.equal(config.chapters.length, 2);
  await assert.rejects(() => importProviders.runNwxImport(project, { filePath: path.join(root, "bad.txt") }), /仅支持 .nwx/);
});

test("空库与缺参拒绝", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root);
  const empty = path.join(root, "empty");
  await fs.mkdir(empty);
  await assert.rejects(() => importProviders.runVaultImport(project, { directory: empty }), /没有可导入/);
  await assert.rejects(() => importProviders.runVaultImport(project, {}), /缺少导入目录/);
  await assert.rejects(() => importProviders.runNwxImport(project, {}), /缺少 .nwx/);
});
test("P100 rtfToText：unicode/十六进制/换行/跳过组", () => {
  const rtf = String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}{\colortbl;\red0\green0\blue0;}\f0\fs24 你好\par 世界\line 第三行\tab 缩进\u20013 ?}`;
  const text = importProviders.rtfToText(rtf);
  assert.ok(text.includes("你好"));
  assert.ok(text.includes("世界"));
  assert.ok(text.includes("第三行"));
  assert.ok(text.includes("中"), "unicode \\u20013 须转为「中」");
  assert.ok(!text.includes("Arial"), "字体表须跳过");
  const pict = String.raw`{\rtf1{\pict\pngblip 89504e47}正文}`;
  assert.ok(!importProviders.rtfToText(pict).includes("89504e47"), "图片组须跳过");
  assert.ok(importProviders.rtfToText(pict).includes("正文"));
  assert.equal(importProviders.rtfToText(""), "");
});

test("P100 .scriv 导入端到端", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root);
  const scrivPath = path.join(root, "book.scriv");
  const zip = new AdmZip();
  zip.addFile("book.scriv/Files/Data/111/content.rtf", Buffer.from(String.raw`{\rtf1\ansi 第一章正文\par 第二段。}`));
  zip.addFile("book.scriv/Files/Data/222/content.rtf", Buffer.from(String.raw`{\rtf1\ansi 第二章正文}`));
  zip.addFile("book.scriv/Files/search.indexes", Buffer.from("index"));
  zip.writeZip(scrivPath);
  const result = await importProviders.runScrivImport(project, { filePath: scrivPath });
  assert.equal(result.imported, 2);
  const config = await loadConfig(project);
  assert.equal(config.chapters.length, 2);
  await assert.rejects(() => importProviders.runScrivImport(project, { filePath: path.join(root, "bad.txt") }), /仅支持 .scriv/);
});
