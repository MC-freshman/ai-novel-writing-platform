const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { connectCdp } = require("./lib/cdp-client.cjs");
process.env.NOVEL_PLATFORM_TEST = "1";
const platform = require("../electron/main.cjs");
const creativeWorkspace = require("../electron/services/creative-workspace.cjs");

const root = path.resolve(__dirname, "..");
const runDirectory = path.join(root, ".test-runs", `no-mindmap-${Date.now()}`);
const projectPath = path.join(runDirectory, "project");
const port = 10600 + Math.floor(Math.random() * 300);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { status: "running", checks: [] };
let child;
let cdp;

function build(env = {}) {
  execFileSync(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", "dist"], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "ignore",
  });
}

async function until(expression) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await cdp.evaluate(expression)) return;
    await wait(100);
  }
  throw new Error("界面等待超时：" + expression);
}

async function stop() {
  cdp?.close();
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  }
  await wait(300);
}

async function main() {
  await fs.mkdir(runDirectory, { recursive: true });
  await platform.ensureProjectStructure(projectPath, "无模块启动验证");
  await creativeWorkspace.upsertItem(projectPath, "mindMaps", {
    id: "no_module_map",
    title: "无模块启动保留导图",
    rootId: "root",
    nodes: [{ id: "root", parentId: "", text: "中心主题", note: "", color: "", collapsed: false, order: 0, side: "right" }],
    relations: [],
    positions: {},
  });
  try {
    build({ VITE_DISABLE_MINDMAP_MODULE: "1" });
    const childEnv = { ...process.env, NOVEL_TEST_PROJECT_PATH: projectPath };
    delete childEnv.NOVEL_PLATFORM_TEST;
    delete childEnv.ELECTRON_RUN_AS_NODE;
    child = spawn(require("electron"), [".", `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(runDirectory, "user-data")}`], {
      cwd: root,
      env: childEnv,
      stdio: "ignore",
      windowsHide: true,
    });
    let target;
    for (let attempt = 0; attempt < 120 && !target; attempt++) {
      try { target = (await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())).find((item) => item.type === "page"); } catch { /* startup */ }
      if (!target) await wait(100);
    }
    assert.ok(target, "Electron启动超时");
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.call("Page.enable");
    await until("Boolean(document.querySelector('.pane-tabs'))");
    await cdp.evaluate("[...document.querySelectorAll('.pane-tabs button')].find((button) => button.textContent.trim() === '分析')?.click(); true");
    await until("Boolean(document.querySelector('.analysis-tabs'))");
    await cdp.evaluate("[...document.querySelectorAll('.analysis-tabs button')].find((button) => button.textContent.trim() === '规划与进度')?.click(); true");
    await until("Boolean(document.querySelector('.progress-workspace'))");
    await cdp.evaluate("[...document.querySelectorAll('.progress-workspace-modes button')].find((button) => button.textContent.trim() === '思维导图')?.click(); true");
    await until("document.body.textContent.includes('思维导图模块未安装')");
    assert.equal(await cdp.evaluate("window.novelAPI.getCreativeWorkspace().then((workspace) => workspace.mindMaps.length)"), 1, "未注册模块时导图数据仍应保留");
    await cdp.evaluate("[...document.querySelectorAll('.progress-workspace-modes button')].find((button) => button.textContent.trim() === '进度网格')?.click(); true");
    await until("Boolean(document.querySelector('.progress-grid-panel'))");
    report.checks.push("未注册内置导图模块的构建可启动，导图降级提示与数据保留，进度网格可用");
    report.status = "pass";
    report.reportPath = path.join(runDirectory, "no-mindmap-report.json");
    await fs.writeFile(report.reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.status = "fail";
    report.error = error.message;
    await fs.writeFile(path.join(runDirectory, "no-mindmap-report.json"), JSON.stringify(report, null, 2));
    throw error;
  } finally {
    await stop();
    build();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
