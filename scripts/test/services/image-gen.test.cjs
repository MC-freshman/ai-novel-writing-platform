"use strict";
// 图像生成测试（P88）：mock 图像接口→落盘+素材登记；配置校验；无密钥拒绝。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture, electron } = require("../helpers/service-fixture.cjs");
const { listenSafe } = require("../../lib/safe-port.cjs");
const imageGen = require("../../../electron/services/image-gen.cjs");
const { loadMaterials } = require("../../../electron/services/knowledge-index.cjs");

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function makeProject(root) {
  const project = path.join(root, "project");
  await fs.mkdir(path.join(project, "materials"), { recursive: true });
  const now = new Date().toISOString();
  const config = {
    version: 1, title: "图像验证", author: "t", createdAt: now, updatedAt: now,
    api: { provider: "deepseek", apiKey: "", baseUrl: "", chatModel: "", embeddingProvider: "", embeddingApiKey: "", embeddingBaseUrl: "", embeddingModel: "", temperature: 0.7, maxTokens: 2048, topK: 5, scanK: 50, sendFullText: false },
    ui: { theme: "light", fontSize: 16, lineHeight: 1.8, autosaveMs: 2000, backupOnSave: true, recoveryEnabled: true },
    agent: { autoLocalAnalysis: false, autoDeepAnalysis: false, evidenceRequired: true, snapshotBeforeBulkChanges: true, permissionLevel: "只读分析" },
    stats: { todayDate: "", todayWords: 0, totalWords: 0, lastAutoBackupAt: "" },
    chapters: [],
  };
  await fs.writeFile(path.join(project, "novel.config.json"), JSON.stringify(config));
  return project;
}

test("generate：mock 接口→图片落盘+素材登记", async (t) => {
  const root = await fixture(t);
  electron.app.getPath = (name) => path.join(root, `userdata-${name}`);
  const project = await makeProject(root);
  const server = http.createServer((req, res) => {
    assert.ok(req.url.endsWith("/images/generations"));
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const parsed = JSON.parse(body);
      assert.equal(parsed.response_format, "b64_json");
      assert.ok(req.headers.authorization.startsWith("Bearer "));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ b64_json: PNG_1PX }] }));
    });
  });
  const port = await listenSafe(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await imageGen.saveConfig(project, { baseUrl: `http://127.0.0.1:${port}/v1`, model: "test-image", apiKey: "sk-test" });
  const result = await imageGen.generate(project, { prompt: "雨夜路灯下的少年", n: 1 });
  assert.equal(result.files.length, 1);
  assert.ok(result.files[0].dataUrl.startsWith("data:image/png;base64,"));
  const stat = await fs.stat(result.files[0].path);
  assert.ok(stat.size > 0);
  const materials = await loadMaterials(project);
  assert.ok(materials.some((item) => item.id === result.files[0].materialId));
});

test("配置校验与无密钥/空提示拒绝", async (t) => {
  const root = await fixture(t);
  electron.app.getPath = (name) => path.join(root, `userdata-${name}`);
  const project = await makeProject(root);
  await assert.rejects(() => imageGen.generate(project, { prompt: "x" }), /接口地址与模型/);
  await imageGen.saveConfig(project, { baseUrl: "http://127.0.0.1:9/v1", model: "m" });
  await assert.rejects(() => imageGen.generate(project, { prompt: "x" }), /密钥/);
  await imageGen.saveConfig(project, { baseUrl: "http://127.0.0.1:9/v1", model: "m", apiKey: "k" });
  await assert.rejects(() => imageGen.generate(project, { prompt: "  " }), /图像描述/);
  const config = await imageGen.getConfig(project);
  assert.equal(config.hasKey, true);
  assert.equal(config.settings.size, "1024x1024");
});
test("P95 url 响应兼容（方舟等返回 url 的服务商）", async (t) => {
  const root = await fixture(t);
  electron.app.getPath = (name) => path.join(root, `userdata-${name}`);
  const project = await makeProject(root);
  // 图片文件服务
  const imageServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(Buffer.from(PNG_1PX, "base64"));
  });
  const imagePort = await listenSafe(imageServer);
  t.after(() => new Promise((resolve) => imageServer.close(resolve)));
  // 图像接口返回 url
  const apiServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${imagePort}/img.png` }] }));
  });
  const apiPort = await listenSafe(apiServer);
  t.after(() => new Promise((resolve) => apiServer.close(resolve)));
  await imageGen.saveConfig(project, { baseUrl: `http://127.0.0.1:${apiPort}/v1`, model: "seedream", apiKey: "sk-test" });
  const result = await imageGen.generate(project, { prompt: "测试", n: 1 });
  assert.equal(result.files.length, 1);
  const stat = await fs.stat(result.files[0].path);
  assert.ok(stat.size > 0);
});

test("P95 头像路径限制（契约）", () => {
  const fsSync = require("node:fs");
  const domain = fsSync.readFileSync(require("node:path").resolve(__dirname, "../../../electron/ipc/domains/knowledge.cjs"), "utf8");
  assert.ok(domain.includes("materials:read-image"));
  assert.ok(domain.includes("非法的图片路径"));
  assert.ok(domain.includes("materialsDir + path.sep"));
});
