"use strict";
// 外部 MCP 接入服务测试（P81）：目录解析/设置持久化/配置生成/只读自检。
// 全部使用合成 fixture，不依赖任何外部真实 MCP 安装。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture, electron } = require("../helpers/service-fixture.cjs");
const externalMcp = require("../../../electron/services/external-mcp.cjs");
const { state } = require("../../../electron/services/runtime-state.cjs");

const MANIFEST = {
  schema: "ai-software/v1",
  id: "fixture-mcp",
  version: "9.9.9",
  displayName: "Fixture MCP",
  kind: "mcp-stdio",
  transport: { protocol: "mcp-stdio", command: "node", args: ["src/server.mjs"] },
};

// 迷你 MCP 服务：只实现自检用到的只读方法。
const MINI_SERVER = `import readline from 'node:readline';
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
const tools = ['novel_project_info','novel_capabilities','novel_mindmap_list'].map((name) => ({ name, description: name, inputSchema: { type: 'object' } }));
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let req; try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  if (method === 'initialize') send({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture-mcp', version: '9.9.9' } } });
  else if (method === 'tools/list') send({ jsonrpc: '2.0', id, result: { tools } });
  else if (method === 'tools/call') {
    const name = params?.name;
    const result = name === 'novel_project_info' ? { schema: 'novel-project-info/v3', fields: { title: 'fixture' } }
      : name === 'novel_capabilities' ? { available: true, counts: { readonly: 3, writable: 0 }, errors: [] }
      : name === 'novel_mindmap_list' ? { schema: 'novel-mindmap-list/v3.1', count: 0, maps: [] }
      : null;
    if (!result) send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'TOOL_UNKNOWN' } });
    else send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false } });
  } else send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'METHOD_NOT_FOUND' } });
});
`;

async function makeServerTree(root, { pointer = true } = {}) {
  const versionDir = pointer ? path.join(root, "versions", "9.9.9") : root;
  await fs.mkdir(path.join(versionDir, "src"), { recursive: true });
  await fs.writeFile(path.join(versionDir, "manifest.json"), JSON.stringify(MANIFEST, null, 2));
  await fs.writeFile(path.join(versionDir, "src", "server.mjs"), MINI_SERVER);
  if (pointer) {
    await fs.writeFile(path.join(root, "current.json"), JSON.stringify({ schema: "ai-software-pointer/v1", id: "fixture-mcp", version: "9.9.9", available: ["9.9.9"] }, null, 2));
  }
  return versionDir;
}

async function makeProject(root) {
  const project = path.join(root, "project");
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, "novel.config.json"), JSON.stringify({ version: 1, title: "fixture", chapters: [] }));
  return project;
}

function useAppPaths(root) {
  electron.app.getPath = (name) => path.join(root, `userdata-${name}`);
  electron.app.isPackaged = false;
  electron.app.getAppPath = () => root;
}

test("resolveMcpServer 解析指针根与版本目录", async (t) => {
  const root = await fixture(t);
  const pointerRoot = path.join(root, "library");
  await makeServerTree(pointerRoot);
  const fromPointer = externalMcp.resolveMcpServer(pointerRoot);
  assert.equal(fromPointer.ok, true);
  assert.equal(fromPointer.version, "9.9.9");
  assert.equal(fromPointer.id, "fixture-mcp");
  assert.ok(fromPointer.entryPath.endsWith(path.join("versions", "9.9.9", "src", "server.mjs")));
  const direct = externalMcp.resolveMcpServer(fromPointer.serverDir);
  assert.equal(direct.ok, true);
  assert.equal(direct.serverDir, fromPointer.serverDir);
});

test("resolveMcpServer 拒绝非法目录与越界入口", async (t) => {
  const root = await fixture(t);
  assert.equal(externalMcp.resolveMcpServer("").ok, false);
  assert.equal(externalMcp.resolveMcpServer(path.join(root, "missing")).ok, false);
  const empty = path.join(root, "empty");
  await fs.mkdir(empty);
  assert.equal(externalMcp.resolveMcpServer(empty).ok, false);
  const badKind = path.join(root, "bad-kind");
  await fs.mkdir(badKind);
  await fs.writeFile(path.join(badKind, "manifest.json"), JSON.stringify({ ...MANIFEST, kind: "other" }));
  assert.equal(externalMcp.resolveMcpServer(badKind).ok, false);
  const escape = path.join(root, "escape");
  await fs.mkdir(escape);
  await fs.writeFile(path.join(escape, "manifest.json"), JSON.stringify({ ...MANIFEST, transport: { ...MANIFEST.transport, args: ["../../evil.mjs"] } }));
  assert.equal(externalMcp.resolveMcpServer(escape).ok, false);
  const badPointer = path.join(root, "bad-pointer");
  await makeServerTree(badPointer);
  await fs.writeFile(path.join(badPointer, "current.json"), JSON.stringify({ version: "9.9.9", available: ["1.0.0"] }));
  assert.equal(externalMcp.resolveMcpServer(badPointer).ok, false);
});

test("saveSettings 持久化并校验输入", async (t) => {
  const root = await fixture(t);
  useAppPaths(root);
  const library = path.join(root, "library");
  await makeServerTree(library);
  const status = await externalMcp.saveSettings({ mcpDirectory: library, runtimeKind: "node", xmindImportRoot: "" });
  assert.equal(status.settings.mcpDirectory, library);
  assert.equal(status.settings.runtimeKind, "node");
  assert.equal(status.server.ok, true);
  const preferences = JSON.parse(await fs.readFile(path.join(root, "userdata-userData", "app-preferences.json"), "utf8"));
  assert.equal(preferences.mcp.mcpDirectory, library);
  await assert.rejects(() => externalMcp.saveSettings({ mcpDirectory: library, runtimeKind: "python" }), /运行时/);
  await assert.rejects(() => externalMcp.saveSettings({ mcpDirectory: path.join(root, "missing") }), /不存在/);
  const kept = await externalMcp.getIntegrationStatus();
  assert.equal(kept.settings.runtimeKind, "node");
});

test("buildClientConfig 生成正确的根目录与运行时环境", async (t) => {
  const root = await fixture(t);
  useAppPaths(root);
  const library = path.join(root, "library");
  await makeServerTree(library);
  const project = await makeProject(root);
  state.currentProjectPath = project;
  await externalMcp.saveSettings({ mcpDirectory: library, runtimeKind: "node", xmindImportRoot: "" });
  const nodeConfig = await externalMcp.buildClientConfig({});
  assert.equal(nodeConfig.env.NOVEL_PROJECT_ROOT, project);
  assert.equal(nodeConfig.env.NOVEL_APP_ROOT, root);
  assert.equal(nodeConfig.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(nodeConfig.command, "node");
  assert.ok(nodeConfig.configJson.includes("ai-novel-platform"));
  const electronConfig = await externalMcp.buildClientConfig({ runtimeKind: "electron" });
  assert.equal(electronConfig.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(electronConfig.command, process.execPath);
  // 打包态：NODE_PATH 指向 electron 占位模块
  electron.app.isPackaged = true;
  const originalResources = process.resourcesPath;
  process.resourcesPath = path.join(root, "resources");
  try {
    const packaged = await externalMcp.buildClientConfig({ runtimeKind: "electron" });
    assert.equal(packaged.env.NOVEL_APP_ROOT, path.join(root, "resources", "app.asar.unpacked"));
    assert.ok(packaged.env.NODE_PATH.endsWith("node_modules"));
    const stub = await fs.readFile(path.join(packaged.env.NODE_PATH, "electron", "index.js"), "utf8");
    assert.ok(stub.includes("module.exports"));
  } finally {
    process.resourcesPath = originalResources;
    electron.app.isPackaged = false;
    state.currentProjectPath = "";
  }
  await assert.rejects(() => externalMcp.buildClientConfig({ projectPath: "" }), /项目/);
});

test("selfTest 对合成 MCP 服务完成只读自检", async (t) => {
  const root = await fixture(t);
  useAppPaths(root);
  const library = path.join(root, "library");
  await makeServerTree(library);
  const project = await makeProject(root);
  state.currentProjectPath = project;
  await externalMcp.saveSettings({ mcpDirectory: library, runtimeKind: "auto", xmindImportRoot: "" });
  const report = await externalMcp.selfTest({});
  assert.equal(report.ok, true, JSON.stringify(report.steps));
  assert.equal(report.steps.length, 7);
  assert.ok(report.steps.every((step) => step.ok));
  // 无项目时自检失败且给出明确步骤
  state.currentProjectPath = "";
  const noProject = await externalMcp.selfTest({});
  assert.equal(noProject.ok, false);
  assert.ok(noProject.steps.some((step) => step.name === "当前项目" && !step.ok));
});

test("detectNodeRuntime 与 runtimeForKind", () => {
  const detected = externalMcp.detectNodeRuntime();
  assert.ok(["node", "electron"].includes(detected.kind));
  assert.equal(externalMcp.runtimeForKind("electron").kind, "electron");
  assert.equal(externalMcp.runtimeForKind("node").kind, "node");
  assert.equal(externalMcp.runtimeForKind("auto").kind, detected.kind);
});