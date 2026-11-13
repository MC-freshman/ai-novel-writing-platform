"use strict";
// 外部 MCP 接入（P81）：把用户自研/外部 MCP 服务目录接入平台。
// 平台只做「发现 + 校验 + 运行时选择 + 客户端配置生成 + 只读连接自检」，
// 不复制、不修改外部服务字节；服务根目录由环境变量注入（NOVEL_PROJECT_ROOT / NOVEL_APP_ROOT）。
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const readline = require("node:readline");
const { app, dialog } = require("electron");
const { state } = require("./runtime-state.cjs");
const { getAppPreferencesPath, readAppPreferences } = require("./project-config.cjs");
const { ensureDir, writeFileAtomic } = require("./project-storage.cjs");

const RUNTIME_KINDS = ["auto", "node", "electron"];
const SELF_TEST_STEP_TIMEOUT_MS = 20000;

function fail(message) {
  return { ok: false, error: message };
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/** 解析 MCP 服务目录：支持版本指针根（current.json + versions/）或版本目录（manifest.json）。 */
function resolveMcpServer(directory) {
  const raw = String(directory || "").trim();
  if (!raw) return fail("尚未选择 MCP 服务目录。");
  const resolved = path.resolve(raw);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return fail(`目录不存在：${resolved}`);
  let serverDir = resolved;
  let pointerVersion = "";
  const pointerPath = path.join(resolved, "current.json");
  if (fs.existsSync(pointerPath)) {
    let pointer;
    try { pointer = readJsonFile(pointerPath); } catch { return fail("current.json 无法解析，请确认选择的是 MCP 软件库根目录或版本目录。"); }
    pointerVersion = String(pointer?.version || "");
    if (!pointerVersion) return fail("current.json 缺少 version 字段。");
    if (Array.isArray(pointer?.available) && pointer.available.length && !pointer.available.map(String).includes(pointerVersion))
      return fail(`current.json 指向的版本 ${pointerVersion} 不在 available 列表中。`);
    serverDir = path.join(resolved, "versions", pointerVersion);
  }
  const manifestPath = path.join(serverDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return fail(`缺少 manifest.json：${serverDir}`);
  let manifest;
  try { manifest = readJsonFile(manifestPath); } catch { return fail("manifest.json 无法解析。"); }
  const kind = manifest?.kind || manifest?.transport?.protocol;
  if (kind !== "mcp-stdio") return fail(`不是 mcp-stdio 类型的软件目录（kind=${kind || "未知"}）。`);
  const entryRel = String(manifest?.transport?.args?.[0] || "src/server.mjs");
  const entryPath = path.resolve(serverDir, entryRel);
  if (entryPath !== serverDir && !entryPath.startsWith(serverDir + path.sep)) return fail("入口文件路径越界。");
  if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) return fail(`入口文件不存在：${entryPath}`);
  return {
    ok: true,
    directory: resolved,
    serverDir,
    entryPath,
    id: String(manifest?.id || ""),
    version: String(manifest?.version || pointerVersion || ""),
    displayName: String(manifest?.displayName || manifest?.id || "MCP 服务"),
  };
}

/** 探测系统 Node；不可用时回退应用自带运行时（ELECTRON_RUN_AS_NODE）。 */
function detectNodeRuntime() {
  try {
    const result = spawnSync("node", ["--version"], { timeout: 5000, windowsHide: true, encoding: "utf8" });
    if (result.status === 0 && String(result.stdout || "").trim().startsWith("v"))
      return { kind: "node", command: "node", version: String(result.stdout).trim() };
  } catch { /* 回退应用运行时 */ }
  return { kind: "electron", command: process.execPath, version: process.versions.node };
}

function runtimeForKind(kind) {
  if (kind === "node") return { kind: "node", command: "node", version: "" };
  if (kind === "electron") return { kind: "electron", command: process.execPath, version: process.versions.node };
  return detectNodeRuntime();
}

function appRootForMcp() {
  return app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked") : app.getAppPath();
}

/** 打包态下为外部 Node 进程提供 electron 占位模块（服务对 electron 均为惰性调用）。 */
async function ensureElectronStub() {
  const nodeModulesDir = path.join(app.getPath("userData"), "mcp-runtime", "node_modules");
  const stubDir = path.join(nodeModulesDir, "electron");
  await ensureDir(stubDir);
  const packagePath = path.join(stubDir, "package.json");
  const indexPath = path.join(stubDir, "index.js");
  if (!fs.existsSync(packagePath))
    await writeFileAtomic(packagePath, JSON.stringify({ name: "electron", version: "0.0.0-platform-stub", main: "index.js" }, null, 2));
  if (!fs.existsSync(indexPath))
    await writeFileAtomic(indexPath, "// 平台生成的占位模块：外部 MCP 进程以纯 Node 运行，服务对 electron 的调用均为惰性。\nmodule.exports = {};\n");
  return nodeModulesDir;
}

async function readSettings() {
  const preferences = await readAppPreferences();
  const saved = preferences?.mcp && typeof preferences.mcp === "object" ? preferences.mcp : {};
  return {
    mcpDirectory: String(saved.mcpDirectory || ""),
    runtimeKind: RUNTIME_KINDS.includes(saved.runtimeKind) ? saved.runtimeKind : "auto",
    xmindImportRoot: String(saved.xmindImportRoot || ""),
  };
}

async function getIntegrationStatus() {
  const settings = await readSettings();
  return {
    packaged: !!app.isPackaged,
    appRoot: appRootForMcp(),
    projectPath: state.currentProjectPath || "",
    runtime: detectNodeRuntime(),
    settings,
    server: settings.mcpDirectory ? resolveMcpServer(settings.mcpDirectory) : null,
  };
}

async function saveSettings(payload) {
  const next = {
    mcpDirectory: String(payload?.mcpDirectory || "").trim(),
    runtimeKind: String(payload?.runtimeKind || "auto"),
    xmindImportRoot: String(payload?.xmindImportRoot || "").trim(),
  };
  if (!RUNTIME_KINDS.includes(next.runtimeKind)) throw new Error("运行时必须是 auto、node 或 electron。");
  if (next.mcpDirectory) {
    const resolved = resolveMcpServer(next.mcpDirectory);
    if (!resolved.ok) throw new Error(resolved.error);
    next.mcpDirectory = resolved.directory;
  }
  if (next.xmindImportRoot && (!fs.existsSync(next.xmindImportRoot) || !fs.statSync(next.xmindImportRoot).isDirectory()))
    throw new Error(`XMind 导入限制目录不存在：${next.xmindImportRoot}`);
  const preferences = await readAppPreferences();
  const preferencesPath = getAppPreferencesPath();
  await ensureDir(path.dirname(preferencesPath));
  await writeFileAtomic(preferencesPath, JSON.stringify({ ...preferences, mcp: next }, null, 2));
  return getIntegrationStatus();
}

async function buildClientConfig(payload) {
  const settings = await readSettings();
  const directory = String(payload?.directory || settings.mcpDirectory || "");
  const server = resolveMcpServer(directory);
  if (!server.ok) throw new Error(server.error);
  const projectPath = String(payload?.projectPath || state.currentProjectPath || "");
  if (!projectPath) throw new Error("当前没有打开的项目，无法生成 NOVEL_PROJECT_ROOT。");
  const runtime = runtimeForKind(payload?.runtimeKind || settings.runtimeKind);
  /** @type {Record<string, string>} */
  const env = { NOVEL_PROJECT_ROOT: projectPath, NOVEL_APP_ROOT: appRootForMcp() };
  if (settings.xmindImportRoot) env.NOVEL_XMIND_IMPORT_ROOT = settings.xmindImportRoot;
  if (runtime.kind === "electron") env.ELECTRON_RUN_AS_NODE = "1";
  if (app.isPackaged) env.NODE_PATH = await ensureElectronStub();
  const config = { mcpServers: { "ai-novel-platform": { command: runtime.command, args: [server.entryPath], env } } };
  return {
    config,
    configJson: JSON.stringify(config, null, 2),
    command: runtime.command,
    args: [server.entryPath],
    env,
    serverDir: server.serverDir,
    notes: [
      "外部客户端将能读取当前项目内容；写入工具需要 novel_plan + confirmToken 两步确认。",
      "桌面端与外部客户端同时打开时，请把项目目录视为单写者：外部写入后在规划页点「刷新规划数据」。",
    ],
  };
}

async function pickServerDirectory() {
  const selected = await dialog.showOpenDialog(state.mainWindow, {
    title: "选择 MCP 服务目录（软件库根目录或版本目录）",
    properties: ["openDirectory"],
  });
  if (selected.canceled || !selected.filePaths.length) return { canceled: true };
  const directory = selected.filePaths[0];
  return { canceled: false, directory, server: resolveMcpServer(directory) };
}

/** 只读连接自检：initialize → tools/list → 项目信息 → 注入能力 → 导图列表。绝不触发写工具。 */
async function selfTest(payload) {
  const report = { ok: false, steps: [], stderrTail: "" };
  const step = (name, ok, detail) => { report.steps.push({ name, ok: !!ok, detail: detail === undefined ? undefined : String(detail).slice(0, 400) }); return ok; };
  let child = null;
  let stderr = "";
  try {
    const settings = await readSettings();
    const server = resolveMcpServer(payload?.directory || settings.mcpDirectory);
    if (!step("服务目录", server.ok, server.ok ? `${server.displayName} ${server.version}` : server.error)) return report;
    const projectPath = String(payload?.projectPath || state.currentProjectPath || "");
    if (!step("当前项目", !!projectPath, projectPath || "没有打开的项目")) return report;
    const runtime = runtimeForKind(settings.runtimeKind);
    /** @type {Record<string, string>} */
    const env = { ...process.env, NOVEL_PROJECT_ROOT: projectPath, NOVEL_APP_ROOT: appRootForMcp() };
    if (settings.xmindImportRoot) env.NOVEL_XMIND_IMPORT_ROOT = settings.xmindImportRoot;
    if (runtime.kind === "electron") env.ELECTRON_RUN_AS_NODE = "1";
    if (app.isPackaged) env.NODE_PATH = await ensureElectronStub();
    child = spawn(runtime.command, [server.entryPath], { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    let nextId = 1;
    const pending = new Map();
    let spawnError = null;
    child.on("error", (error) => {
      spawnError = error;
      for (const [, entry] of pending) entry.reject(new Error(`无法启动运行时 ${runtime.command}：${error.message}`));
      pending.clear();
    });
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (message.id != null && pending.has(message.id)) { pending.get(message.id).resolve(message); pending.delete(message.id); }
      } catch { /* 非 JSON 行忽略 */ }
    });
    const rpc = (method, params) => new Promise((resolve, reject) => {
      if (spawnError) { reject(new Error(`无法启动运行时 ${runtime.command}：${spawnError.message}`)); return; }
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时`)); }, SELF_TEST_STEP_TIMEOUT_MS);
      pending.set(id, { resolve: (message) => { clearTimeout(timer); resolve(message); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
    const tool = async (name, args = {}) => {
      const message = await rpc("tools/call", { name, arguments: args });
      if (message.error) throw new Error(message.error.message || "RPC 错误");
      return message.result?.structuredContent ?? JSON.parse(message.result.content[0].text);
    };
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ai-novel-platform", version: app.getVersion ? app.getVersion() : "0.0.0" } });
    if (!step("initialize", !!init.result?.serverInfo, JSON.stringify(init.result?.serverInfo || init.error || {}))) return report;
    const list = await rpc("tools/list", {});
    if (!step("tools/list", Array.isArray(list.result?.tools), `${list.result?.tools?.length ?? 0} 个工具`)) return report;
    const info = await tool("novel_project_info");
    if (!step("novel_project_info", !!info?.fields, JSON.stringify(info?.fields || {}).slice(0, 200))) return report;
    const caps = await tool("novel_capabilities");
    const preloadErrors = Array.isArray(caps?.errors) ? caps.errors : [];
    step("注入预加载", caps?.available === true, `只读 ${caps?.counts?.readonly ?? 0} / 可写 ${caps?.counts?.writable ?? 0}；错误 ${preloadErrors.length} 条${preloadErrors.length ? "：" + JSON.stringify(preloadErrors.slice(0, 3)) : ""}`);
    const maps = await tool("novel_mindmap_list");
    step("novel_mindmap_list", typeof maps?.count === "number", `${maps?.count ?? "?"} 张导图`);
    report.ok = report.steps.every((item) => item.ok);
    return report;
  } catch (error) {
    step("自检异常", false, error instanceof Error ? error.message : String(error));
    return report;
  } finally {
    report.stderrTail = stderr.slice(-1200);
    if (child && !child.killed) child.kill();
  }
}

module.exports = {
  RUNTIME_KINDS,
  resolveMcpServer,
  detectNodeRuntime,
  runtimeForKind,
  appRootForMcp,
  ensureElectronStub,
  readSettings,
  getIntegrationStatus,
  saveSettings,
  buildClientConfig,
  pickServerDirectory,
  selfTest,
};