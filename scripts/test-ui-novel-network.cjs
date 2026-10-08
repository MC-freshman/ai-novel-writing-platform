const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { connectCdp } = require("./lib/cdp-client.cjs");
process.env.NOVEL_PLATFORM_TEST = "1";
const platform = require("../electron/main.cjs");
const workspaceService = require("../electron/services/creative-workspace.cjs");
const { readImportFiles } = require("../electron/services/novel-network-import.cjs");
const storage = require("../electron/services/project-storage.cjs");
const root = path.resolve(__dirname, "..");
const runDirectory = path.join(root, ".test-runs", `network-ui-${Date.now()}`);
const projectPath = path.join(runDirectory, "project");
const chooserPath = path.join(runDirectory, "chooser.json");
const exportPath = path.join(runDirectory, "exported-network.json");
const port = 10100 + Math.floor(Math.random() * 300);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { status: "running", checks: [], measurements: [], screenshots: [], nativeDialogs: "File picker selection stubbed; real IPC and file parser used" };
let child, cdp, importedFiles, chapterId;

async function until(expression) {
  for (let i = 0; i < 100; i++) { if (await cdp.evaluate(expression)) return; await wait(100); }
  const feedback = await cdp.evaluate("document.querySelector('.novel-network-heading [role=status]')?.textContent || ''");
  throw new Error(`界面等待超时：${expression}；当前反馈：${feedback}`);
}
async function button(text, scope = "document") {
  assert.equal(await cdp.evaluate(`(()=>{const e=[...${scope}.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});e?.click();return Boolean(e)})()`), true, text);
  await wait(150);
}
async function fill(label, value, tag = "input") {
  const prototype = tag === "textarea" ? "HTMLTextAreaElement" : tag === "select" ? "HTMLSelectElement" : "HTMLInputElement";
  await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(`${tag}[aria-label="${label}"]`)});if(!e)throw Error('Missing field');Object.getOwnPropertyDescriptor(${prototype}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${JSON.stringify(tag === "select" ? "change" : "input")},{bubbles:true}));return true})()`);
  await wait(80);
}
async function save() { await button("保存小说网"); await until("document.querySelector('.novel-network-heading [role=status]')?.textContent.includes('小说网已保存')"); }
async function openNetwork() {
  await cdp.evaluate("document.querySelector('.pane-tabs button[title=分析]').click()"); await wait(200);
  await button("进度", "document.querySelector('.analysis-tabs')");
  await button("小说统筹网"); await until("Boolean(document.querySelector('.novel-network-panel'))");
}
async function selectTable(kind) {
  const id = await cdp.evaluate(`window.novelAPI.getCreativeWorkspace().then(w=>w.novelNetworks[0].tables.find(t=>t.kind===${JSON.stringify(kind)}).id)`);
  await fill("选择统筹表", id, "select");
}
async function shot(name) {
  const result = await cdp.call("Page.captureScreenshot", { format: "png" });
  const file = path.join(runDirectory, `${name}.png`); await fs.writeFile(file, Buffer.from(result.data, "base64")); report.screenshots.push(file);
}
async function measure(name) {
  const value = await cdp.evaluate(`(()=>{const p=document.querySelector('.progress-workspace');return {name:${JSON.stringify(name)},width:innerWidth,pageWidth:document.documentElement.scrollWidth,panelWidth:p.clientWidth,panelScrollWidth:p.scrollWidth}})()`);
  report.measurements.push(value); assert.ok(value.pageWidth <= value.width + 2 && value.panelScrollWidth <= value.panelWidth + 2, JSON.stringify(value));
}
async function start() {
  const env = { ...process.env, NOVEL_TEST_PROJECT_PATH: projectPath };
  delete env.NOVEL_PLATFORM_TEST; delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.NOVEL_TEST_EXECUTABLE;
  const executable = packaged || require("electron");
  const args = [...(packaged ? [] : [path.join(runDirectory, "bootstrap.cjs")]), `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(runDirectory, "user-data")}`];
  child = spawn(executable, args, { cwd: root, env, stdio: "ignore", windowsHide: true });
  let target;
  for (let i = 0; i < 120 && !target; i++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())).find(t => t.type === "page"); } catch { /* startup */ }
    if (!target) await wait(150);
  }
  assert.ok(target, "Electron启动超时"); cdp = connectCdp(target.webSocketDebuggerUrl); await cdp.ready; await cdp.call("Page.enable");
  await until("Boolean(document.querySelector('.pane-tabs'))"); await cdp.evaluate("window.confirm=()=>true");
}
async function stop() {
  cdp?.close(); cdp = null;
  if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once("exit", resolve)); child.kill(); await exited; }
  await wait(250);
}
async function closeDesktopWindow() {
  const command = `Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class NetworkCloseTest { public delegate bool Callback(IntPtr h, IntPtr p); [DllImport("user32.dll")] static extern bool EnumWindows(Callback c, IntPtr p); [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n); [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); public static bool Close(uint pid) { bool found=false; EnumWindows((h,p)=> { uint owner; GetWindowThreadProcessId(h,out owner); if(owner==pid) { var name=new StringBuilder(200); GetClassName(h,name,200); if(name.ToString()=="Chrome_WidgetWin_1") { found=PostMessage(h,16,IntPtr.Zero,IntPtr.Zero); return false; } } return true; },IntPtr.Zero); return found; } }'; if (-not [NetworkCloseTest]::Close(${child.pid})) { throw 'Test window not found' }`;
  await new Promise((resolve, reject) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true }, error => error ? reject(error) : resolve()));
}
async function seed() {
  await fs.mkdir(runDirectory, { recursive: true }); await platform.ensureProjectStructure(projectPath, "小说统筹网界面验证");
  const config = await platform.loadConfig(projectPath); config.agent.autoLocalAnalysis = false; chapterId = config.chapters[0].id;
  config.chapters[0].progressStatus = "已完成"; config.chapters[0].progressNote = "原进度备注"; await platform.saveConfig(projectPath, config);
  const sampleFolder = path.join(runDirectory, "source-documents"); await fs.mkdir(sampleFolder);
  const sample = path.join(sampleFolder, "统筹示例.md");
  await fs.writeFile(sample, "# 统筹示例\n## POV线程\n| 线 | 名称 | 活跃章区 |\n|---|---|---|\n| T1 | 调查线 | 1-8 |\n## 世界钟\n| 块 | 东区 | 西区 |\n|---|---|---|\n| 第一块 | 公告(1) | 出发(2) |\n## 信息台账\n| 真相 | 埋设章 | 揭露章 |\n|---|---|---|\n| R1 线索来源 | 1 | 8 |\n## 已写章节对齐\n| 已写章 | 素材落位（新排期章号） |\n|---|---|\n| 开篇 | 1 |\n## 第一块\n01｜T1｜修理路灯｜埋R1\n02｜T1｜核对公告｜验R1\n");
  importedFiles = process.env.NOVEL_NETWORK_IMPORT_FILES ? JSON.parse(await fs.readFile(process.env.NOVEL_NETWORK_IMPORT_FILES, "utf8")) : [sample];
  await fs.writeFile(chooserPath, JSON.stringify({ files: importedFiles, folder: path.dirname(importedFiles[0]), exportPath }));
  await fs.writeFile(path.join(runDirectory, "bootstrap.cjs"), `const fs=require('node:fs');const {dialog,ipcMain}=require('electron');const register=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,handler)=>register(channel,channel==='analysis:get'?async(...args)=>{await new Promise(resolve=>setTimeout(resolve,650));return handler(...args)}:handler);const config=()=>JSON.parse(fs.readFileSync(${JSON.stringify(chooserPath)},'utf8'));dialog.showOpenDialog=async(_window,options)=>({canceled:false,filePaths:options.properties.includes('openDirectory')?[config().folder]:config().files});dialog.showSaveDialog=async()=>({canceled:false,filePath:config().exportPath});require(${JSON.stringify(path.join(root, "electron", "main.cjs"))});`);
  if (process.env.NOVEL_TEST_EXECUTABLE) {
    report.nativeDialogs = "Native dialog tests skipped in packaged execution; real IPC save/read tested";
    const preview = await readImportFiles(importedFiles); await workspaceService.upsertItem(projectPath, "novelNetworks", preview.network);
  }
}
async function main() {
  await seed();
  try {
    await start(); await openNetwork(); await wait(750); assert.ok(await cdp.evaluate("Boolean(document.querySelector('.novel-network-panel'))"));
    report.checks.push("迟到的分析页状态不会覆盖已选择的小说网入口");
    if (!process.env.NOVEL_TEST_EXECUTABLE) {
      await button("导入文件"); await until("Boolean(document.querySelector('.novel-network-import-preview'))");
      assert.equal((await workspaceService.loadWorkspace(projectPath)).novelNetworks.length, 0);
      await button("确认导入小说网"); await until("document.querySelector('select[aria-label=选择小说网]').options.length===2");
      report.checks.push("真实文件解析与IPC导入；确认前项目没有小说网写入");
      await button("导入目录"); await until("Boolean(document.querySelector('.novel-network-import-preview'))"); await button("取消导入");
      assert.equal((await workspaceService.loadWorkspace(projectPath)).novelNetworks.length, 1); report.checks.push("真实目录枚举和预览取消不会新增小说网");
    }
    await selectTable("chapters"); await fill("记录 事件", "界面修改事件", "textarea"); await fill("关联已写正文", chapterId, "select"); await save();
    const saved = (await workspaceService.loadWorkspace(projectPath)).novelNetworks[0];
    assert.equal(saved.tables.find(t => t.kind === "chapters").rows[0].chapterId, chapterId);
    assert.equal(saved.tables.find(t => t.kind === "chapters").rows[0].cells[2], "界面修改事件");
    assert.ok(await cdp.evaluate("/标记 [TR]\\d+|计划第/.test(document.querySelector('.novel-network-related').textContent)"));
    report.checks.push("编辑记录、绑定已写正文、共同标记关联查看、正式保存");
    await button("展开小说网"); await button("表格总览"); await shot("network-expanded"); await measure("expanded");
    await button("收起小说网"); await measure("narrow"); await shot("network-narrow");
    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1.5, mobile: false }); await wait(250); await measure("dpi-150"); await shot("network-dpi-150");
    await cdp.call("Emulation.clearDeviceMetricsOverride"); report.checks.push("展开、窄面板和150%缩放没有容器外横向溢出");
    await fill("小说网名称", "换页保护草稿"); await button("全局搜索", "document.querySelector('.analysis-tabs')"); await button("进度", "document.querySelector('.analysis-tabs')"); await button("小说统筹网");
    await until("document.querySelector('input[aria-label=小说网名称]')?.value==='换页保护草稿'");
    await stop(); await start(); await openNetwork(); await until("document.querySelector('input[aria-label=小说网名称]')?.value==='换页保护草稿'");
    await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "s", code: "KeyS", windowsVirtualKeyCode: 83 });
    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "s", code: "KeyS", windowsVirtualKeyCode: 83 });
    await until("document.querySelector('.novel-network-heading [role=status]')?.textContent.includes('小说网已保存')");
    assert.equal((await workspaceService.loadWorkspace(projectPath)).novelNetworks[0].title, "换页保护草稿"); report.checks.push("换分析页与异常退出恢复草稿，Ctrl+S保存小说网");

    const workspaceDir = path.join(projectPath, "analysis", "creative-workspace");
    await fill("小说网名称", "保存失败保留输入"); await wait(850);
    await fs.rename(workspaceDir, `${workspaceDir}-held`); await fs.writeFile(workspaceDir, "合成写入故障");
    try {
      await button("保存小说网"); await until("/保存失败|草稿保护失败/.test(document.querySelector('.novel-network-heading [role=status]')?.textContent||'')");
      if (process.platform === "win32") { await closeDesktopWindow(); await wait(800); report.checks.push("小说网保存失败时，真实桌面关闭操作保持窗口和草稿"); }
      assert.equal(await cdp.evaluate("document.querySelector('input[aria-label=小说网名称]').value"), "保存失败保留输入");
    }
    finally { await fs.rm(workspaceDir); await fs.rename(`${workspaceDir}-held`, workspaceDir); }
    await save(); report.checks.push("文件写入失败保留输入；修复后重试保存");

    await fill("小说网名称", "保存开始版本"); await wait(850);
    let release, entered;
    const enteredPromise = new Promise(resolve => { entered = resolve; }); const releasePromise = new Promise(resolve => { release = resolve; });
    const lock = storage.withProjectTransaction(projectPath, async () => { entered(); await releasePromise; }); await enteredPromise;
    try { await button("保存小说网"); await until("document.querySelector('.novel-network-heading [role=status]')?.textContent.includes('保存中')"); await fill("小说网名称", "保存过程中新增版本"); }
    finally { release(); await lock; }
    await until("document.querySelector('.novel-network-heading [role=status]')?.textContent.includes('此前版本已保存')");
    await save(); assert.equal((await workspaceService.loadWorkspace(projectPath)).novelNetworks[0].title, "保存过程中新增版本"); report.checks.push("保存过程中继续输入，第二次保存正确使用新版本号");

    await selectTable("clock"); await cdp.evaluate("document.querySelector('.novel-network-columns').open=true"); await fill("新列名称", "新地区"); await button("添加列");
    await fill("记录 新地区", "补充事件", "textarea"); await save();
    assert.ok((await workspaceService.loadWorkspace(projectPath)).novelNetworks[0].tables.find(t => t.kind === "clock").columns.includes("新地区")); report.checks.push("世界钟新增地区列并编辑保存");
    if (!process.env.NOVEL_TEST_EXECUTABLE) {
      await button("导出JSON"); await until("document.querySelector('.statusbar')?.textContent.includes('已导出')");
      const exported = JSON.parse(await fs.readFile(exportPath, "utf8")); assert.equal(exported.network.title, "保存过程中新增版本");
      await fs.writeFile(chooserPath, JSON.stringify({ files: [exportPath], exportPath }));
      await button("导入文件"); await until("Boolean(document.querySelector('.novel-network-import-preview'))"); await fill("小说网导入方式", "append", "select");
      const count = (await workspaceService.loadWorkspace(projectPath)).novelNetworks[0].tables.reduce((n,t) => n + t.rows.length, 0);
      await button("确认导入小说网"); await until("!document.querySelector('.novel-network-import-preview')");
      assert.equal((await workspaceService.loadWorkspace(projectPath)).novelNetworks[0].tables.reduce((n,t) => n+t.rows.length, 0), count); report.checks.push("真实IPC JSON导出与追加去重往返");
      await assert.rejects(cdp.evaluate("window.novelAPI.importNovelNetwork({token:'expired-token'})"), /失效/); report.checks.push("失效导入预览被拒绝");
    }
    await button("新建小说网"); await fill("小说网名称", "手动新网"); await fill("新统筹表类型", "custom", "select"); await button("添加统筹表"); await button("添加记录");
    await fill("记录 名称", "手动记录", "textarea"); await fill("记录 说明", "手动内容", "textarea"); await save();
    assert.ok((await workspaceService.loadWorkspace(projectPath)).novelNetworks.some(n => n.title === "手动新网" && n.tables.some(t => t.kind === "custom" && t.rows[0]?.cells[0] === "手动记录")));
    await button("删除记录"); await save(); assert.equal(await cdp.evaluate("document.querySelectorAll('.novel-network-records > button').length"), 0);
    await button("删除表"); await save(); await button("删除小说网");
    await until("document.querySelector('select[aria-label=选择小说网]').options.length===2"); report.checks.push("手动创建新网、自定义表和记录，以及删除记录、表和网");
    await button("章节进度"); await until("Boolean(document.querySelector('.progress-cell'))");
    assert.ok(await cdp.evaluate("document.querySelector('.progress-board').textContent.includes('原进度备注')"));
    await button("隐藏已完成"); assert.equal(await cdp.evaluate("document.querySelectorAll('.progress-cell').length"), 0); await button("隐藏已完成");
    await cdp.evaluate("document.querySelector('.progress-cell-hide').click()"); await until("!document.querySelector('.progress-cell')");
    await button("已移出 1 章"); await button("恢复显示"); await until("Boolean(document.querySelector('.progress-cell'))");
    assert.equal((await platform.loadConfig(projectPath)).chapters[0].progressStatus, "已完成"); report.checks.push("原进度备注、状态、隐藏已完成、移出和恢复章节保持可用");
    report.status = "pass";
  } finally { await stop(); await fs.writeFile(path.join(runDirectory, "report.json"), JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify({ status: report.status, checks: report.checks, reportPath: path.join(runDirectory, "report.json") }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
