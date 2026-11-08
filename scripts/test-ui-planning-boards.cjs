const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const AdmZip = require("adm-zip");
const { connectCdp } = require("./lib/cdp-client.cjs");
process.env.NOVEL_PLATFORM_TEST = "1";
const platform = require("../electron/main.cjs");
const workspaceService = require("../electron/services/creative-workspace.cjs");

const root = path.resolve(__dirname, "..");
const runDirectory = path.join(root, ".test-runs", `planning-boards-ui-${Date.now()}`);
const projectPath = path.join(runDirectory, "project");
const port = 10500 + Math.floor(Math.random() * 300);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { status: "running", checks: [], screenshots: [] };
let child, cdp;

async function until(expression, label) {
  for (let i = 0; i < 120; i++) {
    if (await cdp.evaluate(expression)) return;
    await wait(100);
  }
  throw new Error(`界面等待超时：${label || expression}`);
}
async function button(text, scope = "document") {
  const clicked = await cdp.evaluate(`(()=>{const e=[...${scope}.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});e?.click();return Boolean(e)})()`);
  assert.equal(clicked, true, `找不到按钮：${text}`);
  await wait(160);
}
async function fill(label, value, tag = "input") {
  const prototype = tag === "textarea" ? "HTMLTextAreaElement" : tag === "select" ? "HTMLSelectElement" : "HTMLInputElement";
  await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(`${tag}[aria-label="${label}"]`)});if(!e)throw Error('Missing field ${label}');Object.getOwnPropertyDescriptor(${prototype}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${JSON.stringify(tag === "select" ? "change" : "input")},{bubbles:true}));return true})()`);
  await wait(120);
}
async function workspace() {
  return cdp.evaluate("window.novelAPI.getCreativeWorkspace().then(w=>({maps:w.mindMaps||[],grids:w.progressGrids||[]}))");
}
async function shot(name) {
  const result = await cdp.call("Page.captureScreenshot", { format: "png" });
  const file = path.join(runDirectory, `${name}.png`);
  await fs.writeFile(file, Buffer.from(result.data, "base64"));
  report.screenshots.push(file);
}
async function seed() {
  await fs.mkdir(projectPath, { recursive: true });
  await platform.ensureProjectStructure(projectPath, "思维导图与进度网格界面验证");
  const config = await platform.loadConfig(projectPath);
  config.agent.autoLocalAnalysis = false;
  await platform.saveConfig(projectPath, config);
  const charactersDir = path.join(projectPath, "characters");
  await fs.mkdir(charactersDir, { recursive: true });
  await fs.writeFile(path.join(charactersDir, "mcp_hero.json"), JSON.stringify({ id: "mcp_hero", fileName: "mcp_hero.json", name: "测试主角", category: "主角团", relationships: "测试配角：同伴", notes: "追查线索" }));
  await fs.writeFile(path.join(charactersDir, "mcp_friend.json"), JSON.stringify({ id: "mcp_friend", fileName: "mcp_friend.json", name: "测试配角", category: "主角团", relationships: "测试主角：同伴", notes: "协助调查" }));
  const xmindPath = path.join(runDirectory, "导入样例.xmind");
  const zip = new AdmZip();
  zip.addFile("content.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0"><sheet id="s1"><topic id="root"><title>导入的中心主题</title><children><topics type="attached"><topic id="a"><title>导入的子主题</title><notes><plain>来自 XMind 的备注</plain></notes></topic></topics></children></topic></sheet></xmap-content>`, "utf8"));
  zip.writeZip(xmindPath);
  await fs.writeFile(path.join(runDirectory, "bootstrap.cjs"), `const {dialog}=require('electron');dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(xmindPath)}]});require(${JSON.stringify(path.join(root, "electron", "main.cjs"))});`);
}
async function start() {
  const env = { ...process.env, NOVEL_TEST_PROJECT_PATH: projectPath };
  delete env.NOVEL_PLATFORM_TEST;
  delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.NOVEL_TEST_EXECUTABLE || require("electron");
  const args = [...(process.env.NOVEL_TEST_EXECUTABLE ? [] : [path.join(runDirectory, "bootstrap.cjs")]), `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(runDirectory, "user-data")}`];
  child = spawn(executable, args, { cwd: root, env, stdio: "ignore", windowsHide: true });
  let target;
  for (let i = 0; i < 120 && !target; i++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())).find((t) => t.type === "page"); } catch { /* startup */ }
    if (!target) await wait(150);
  }
  assert.ok(target, "Electron启动超时");
  cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.call("Page.enable");
  await until("Boolean(document.querySelector('.pane-tabs'))", "主界面已加载");
  await cdp.evaluate("window.confirm=()=>true");
}
async function stop() {
  cdp?.close(); cdp = null;
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  }
  await wait(200);
}
async function openProgress() {
  await cdp.evaluate("document.querySelector('.pane-tabs button[title=分析]').click()");
  await wait(250);
  await button("进度", "document.querySelector('.analysis-tabs')");
}

async function main() {
  await seed();
  try {
    await start();
    await openProgress();
    assert.ok(!(await cdp.evaluate("[...document.querySelectorAll('.analysis-tabs button')].some(b=>b.textContent.includes('关系网'))")), "分析页仍保留已合并的关系网标签");
    report.checks.push("分析页关系网标签已移除，能力并入思维导图");
    assert.equal(await cdp.evaluate("typeof window.novelAPI.importXMind"), "function", "当前程序缺少 XMind 导入接口");
    report.checks.push("程序暴露 XMind 导入接口（含打包版）");
    const modes = await cdp.evaluate("[...document.querySelectorAll('.progress-workspace-modes button')].map(e=>e.textContent.trim())");
    assert.ok(modes.includes("思维导图") && modes.includes("进度网格"), `模式按钮缺少新入口：${JSON.stringify(modes)}`);
    report.checks.push("规划与进度页出现思维导图与进度网格入口");

    await button("思维导图");
    await until("Boolean(document.querySelector('.mind-map-panel'))", "思维导图画布");
    await button("新建思维导图");
    await until("window.novelAPI.getCreativeWorkspace().then(w=>(w.mindMaps||[]).length===1)", "第一张导图已落盘");
    await until("document.querySelectorAll('.mind-map-node').length===1", "中心主题已渲染");
    await button("添加子主题");
    await until("document.querySelectorAll('.mind-map-node').length===2", "子主题已渲染");
    await fill("选中主题文字", "接不上的伏笔");
    await fill("主题备注", "第二幕回收", "textarea");
    await until("window.novelAPI.getCreativeWorkspace().then(w=>JSON.stringify(w.mindMaps[0].nodes).includes('接不上的伏笔'))", "主题文字自动保存");
    const firstMap = await workspace();
    assert.equal(firstMap.maps.length, 1);
    assert.equal(firstMap.maps[0].nodes.length, 2);
    assert.ok(firstMap.maps[0].nodes.some((node) => node.note === "第二幕回收"), "备注未落盘");
    await shot("mind-map");
    report.checks.push("思维导图新建、子主题、改名、备注均自动保存");

    await button("进度网格");
    await until("Boolean(document.querySelector('.progress-grid-panel'))", "进度网格面板");
    await button("新建网格");
    await until("window.novelAPI.getCreativeWorkspace().then(w=>(w.progressGrids||[]).length===1)", "第一张网格已落盘");
    await button("添加行");
    await until("document.querySelectorAll('.progress-grid-table tbody tr').length===4", "新增行已渲染");
    await fill("进度状态", "已完成", "select");
    await until("window.novelAPI.getCreativeWorkspace().then(w=>(w.progressGrids||[])[0].rows.some(r=>r.status==='已完成'))", "状态自动保存");
    assert.ok(await cdp.evaluate("document.querySelector('.progress-grid-percent')?.textContent.includes('25%')"), "完成率统计未更新");
    await shot("progress-grid");
    report.checks.push("进度网格新建、加行、状态与完成率统计自动保存");

    await button("思维导图");
    await until("Boolean(document.querySelector('.mind-map-panel'))", "切回思维导图");
    assert.ok(await cdp.evaluate("document.querySelector('.mind-map-list')?.textContent.includes('未命名思维导图')"), "列表未显示之前创建的导图");
    assert.ok(await cdp.evaluate("document.querySelectorAll('.mind-map-node').length===2"), "切回后导图内容丢失");
    report.checks.push("切回规划页可查看之前创建的思维导图与内容");

    await button("弹窗编辑");
    await until("Boolean(document.querySelector('.mind-map-modal'))", "思维导图弹窗");
    const modalAudit = await cdp.evaluate("(()=>{const modal=document.querySelector('.mind-map-modal');const canvas=modal?.querySelector('.mind-map-canvas');return {height:canvas?.clientHeight||0,width:modal?.clientWidth||0,scrollWidth:modal?.scrollWidth||0}})()");
    assert.ok(modalAudit.height >= 380, `弹窗画布没有放大：${JSON.stringify(modalAudit)}`);
    assert.ok(modalAudit.scrollWidth <= modalAudit.width + 2, "弹窗出现横向溢出");
    assert.ok(await cdp.evaluate("Boolean(document.querySelector('.mind-map-modal .mind-map-panel.fullscreen'))"), "弹窗未启用全屏布局");
    await shot("mind-map-modal");
    await button("关闭弹窗");
    await until("!document.querySelector('.mind-map-modal')", "弹窗已关闭");
    report.checks.push("思维导图弹窗全屏编辑可打开、画布放大且可关闭");

    if (!process.env.NOVEL_TEST_EXECUTABLE) {
      await button("导入 XMind");
      await until("Boolean(document.querySelector('.mind-map-import-preview'))", "XMind 导入预览");
      assert.ok(await cdp.evaluate("document.querySelector('.mind-map-import-preview')?.textContent.includes('导入样例.xmind')"), "预览未显示文件名");
      await button("确认导入 XMind");
      await until("window.novelAPI.getCreativeWorkspace().then(w=>(w.mindMaps||[]).length===2)", "XMind 导图已落盘");
      const imported = await cdp.evaluate("window.novelAPI.getCreativeWorkspace().then(w=>w.mindMaps.find(m=>m.nodes.some(n=>n.text==='导入的子主题')))");
      assert.ok(imported, "导入的导图缺少子主题");
      assert.equal(imported.nodes.find((node) => node.text === "导入的子主题").note, "来自 XMind 的备注");
      assert.equal(imported.nodes[0].text, "导入的中心主题");
      assert.ok(await cdp.evaluate("document.querySelector('.mind-map-list')?.textContent.includes('导入样例')"), "列表未显示导入的导图");
      report.checks.push("XMind 8 文件经真实 IPC 导入为中心主题、子主题与备注");

      await button("从角色关系生成");
      await until("window.novelAPI.getCreativeWorkspace().then(w=>(w.mindMaps||[]).some(m=>m.title.includes('角色关系网')))", "角色关系导图已落盘");
      const relationMap = await cdp.evaluate("window.novelAPI.getCreativeWorkspace().then(w=>w.mindMaps.find(m=>m.title.includes('角色关系网')))");
      assert.ok(relationMap.nodes.length >= 3, "角色关系导图缺少角色分支");
      assert.equal(relationMap.nodes[0].text, "角色关系网");
      assert.ok(relationMap.nodes.some((node) => node.text.includes("→") || node.text.includes("←")), "未生成关系连线节点");
      report.checks.push("原关系网能力已合并为可编辑思维导图");
    }

    const saved = await workspaceService.loadWorkspace(projectPath);
    assert.equal(saved.mindMaps.length, process.env.NOVEL_TEST_EXECUTABLE ? 1 : 3);
    assert.equal(saved.progressGrids.length, 1);
    assert.equal(saved.progressGrids[0].rows.length, 4);
    report.checks.push("退出前项目文件中的导图与网格数据完整");
    report.status = "passed";
  } finally {
    await stop();
  }
}

main().then(async () => {
  await fs.writeFile(path.join(runDirectory, "report.json"), JSON.stringify(report, null, 2));
  console.log(`PASS: 思维导图与进度网格真实桌面验证通过\n${report.checks.map((item) => `- ${item}`).join("\n")}\n报告：${path.join(runDirectory, "report.json")}`);
}).catch(async (error) => {
  report.status = "failed";
  report.error = error instanceof Error ? error.stack : String(error);
  await fs.mkdir(runDirectory, { recursive: true });
  await fs.writeFile(path.join(runDirectory, "report.json"), JSON.stringify(report, null, 2));
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`报告：${path.join(runDirectory, "report.json")}`);
  process.exitCode = 1;
});
