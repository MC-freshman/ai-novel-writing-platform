const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { connectCdp } = require("./lib/cdp-client.cjs");
process.env.NOVEL_PLATFORM_TEST = "1";
const platform = require("../electron/main.cjs");
const storage = require("../electron/services/project-storage.cjs");
const workspace = path.resolve(__dirname, "..");
const runDirectory = path.join(workspace, ".test-runs", "plan-ui-" + new Date().toISOString().replace(/[:.]/g, "-"));
const projectPath = path.join(runDirectory, "project");
const port = 9650 + Math.floor(Math.random() * 250);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { status: "running", checks: [], screenshots: [], measurements: [] };
let child;
let cdp;

async function start() {
  const env = { ...process.env, NOVEL_TEST_PROJECT_PATH: projectPath };
  delete env.NOVEL_PLATFORM_TEST; delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.NOVEL_TEST_EXECUTABLE || require("electron");
  const args = [...(process.env.NOVEL_TEST_EXECUTABLE ? [] : ["."]), `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(runDirectory, "user-data")}`];
  child = spawn(executable, args, { cwd: workspace, env, stdio: "ignore", windowsHide: true });
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())).find((item) => item.type === "page"); } catch { /* startup */ }
    if (!target) await wait(100);
  }
  assert.ok(target, "Electron 启动超时");
  cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.ready; await cdp.call("Page.enable");
  await until("Boolean(document.querySelector('.pane-tabs'))");
}

async function until(expression) {
  for (let i = 0; i < 80; i++) { if (await cdp.evaluate(expression)) return; await wait(100); }
  throw new Error("界面状态等待超时：" + expression);
}

async function click(selector) { assert.equal(await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e?.click();return Boolean(e)})()`), true); await wait(180); }
async function view(title) { await click(`.pane-tabs button[title="${title}"]`); }
async function fill(selector, value, textarea = false) {
  await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(${textarea ? "HTMLTextAreaElement" : "HTMLInputElement"}.prototype,'value').set;setter.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await wait(80);
}
async function shot(name) {
  const image = await cdp.call("Page.captureScreenshot", { format: "png" });
  const file = path.join(runDirectory, name + ".png");
  await fs.writeFile(file, Buffer.from(image.data, "base64")); report.screenshots.push(file);
}
async function measure(name) {
  const measurement = await cdp.evaluate(`(()=>{const panel=document.querySelector('.manager-panel')||document.querySelector('.center-pane');const form=document.querySelector('.form-panel');return {name:${JSON.stringify(name)},width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,panelWidth:panel?.clientWidth,panelScrollWidth:panel?.scrollWidth,formWidth:form?.clientWidth,formScrollWidth:form?.scrollWidth,dpi:devicePixelRatio,overflow:[...document.querySelectorAll('body *')].map(e=>({class:e.className,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:e.clientWidth,scroll:e.scrollWidth})).filter(e=>e.right>innerWidth+2).slice(0,16)}})()`);
  report.measurements.push(measurement);
  assert.ok(measurement.pageWidth <= measurement.width + 2, JSON.stringify(measurement));
  if (measurement.formWidth) assert.ok(measurement.formScrollWidth <= measurement.formWidth + 2, JSON.stringify(measurement));
}

async function stop() {
  cdp?.close();
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve)); child.kill(); await exited;
  }
  await wait(350);
}

async function closeDesktopWindow() {
  assert.equal(process.platform, "win32", "桌面关闭用例需要 Windows 窗口消息");
  const command = `Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class WindowCloseTest { public delegate bool Callback(IntPtr h, IntPtr p); [DllImport("user32.dll")] static extern bool EnumWindows(Callback c, IntPtr p); [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n); [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); public static bool Close(uint pid) { bool found=false; EnumWindows((h,p)=> { uint owner; GetWindowThreadProcessId(h,out owner); if(owner==pid) { var name=new StringBuilder(200); GetClassName(h,name,200); if(name.ToString()=="Chrome_WidgetWin_1") { found=PostMessage(h,16,IntPtr.Zero,IntPtr.Zero); return false; } } return true; },IntPtr.Zero); return found; } }'; if (-not [WindowCloseTest]::Close(${child.pid})) { throw 'Test window not found' }`;
  await new Promise((resolve, reject) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true }, (error) => error ? reject(error) : resolve()));
}

async function main() {
  await fs.mkdir(runDirectory, { recursive: true });
  await platform.ensureProjectStructure(projectPath, "完整P表界面测试项目与长标题布局检查");
  const config = await platform.loadConfig(projectPath); config.agent.autoLocalAnalysis = false; await platform.saveConfig(projectPath, config);
  for (const [id, name] of [["a", "甲角色"], ["b", "乙角色"]]) await fs.writeFile(path.join(projectPath, "characters", id + ".json"), JSON.stringify({ id, name, fileName: id + ".json", category: "主角", notes: "初始资料" }));
  for (const [id, title] of [["a", "甲设定"], ["b", "乙设定"]]) await fs.writeFile(path.join(projectPath, "worldbuilding", id + ".md"), `---\ntitle: ${title}\ncategory: 设定\n---\n\n初始设定`);
  try {
    await start();
    await cdp.evaluate("document.querySelector('.rich-toolbar-more summary').focus()");
    await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await until("document.querySelector('.rich-toolbar-more').open");
    await shot("keyboard-toolbar");
    await click(".rich-toolbar-more summary");
    report.checks.push("P15 键盘打开分组排版工具");
    await view("角色");
    await fill(".form-panel input", "甲角色未保存修改");
    await cdp.evaluate("[...document.querySelectorAll('.manager-item')].find(e=>e.textContent.includes('乙角色')).click()"); await wait(250);
    await cdp.evaluate("[...document.querySelectorAll('.manager-item')].find(e=>e.textContent.includes('甲角色')).click()"); await wait(250);
    assert.equal(await cdp.evaluate("document.querySelector('.form-panel input').value"), "甲角色未保存修改");
    report.checks.push("P04 切卡保留草稿");
    await view("世界"); await fill(".world-editor textarea", "设定未保存修改", true);
    await view("分析"); await view("世界");
    await until("document.querySelector('.world-editor textarea')?.value === '设定未保存修改'");
    report.checks.push("P04 换页恢复世界观草稿");
    await shot("world-draft"); await measure("world-normal");
    await stop(); await start(); await view("角色");
    await until("document.querySelector('.form-panel input')?.value === '甲角色未保存修改'");
    report.checks.push("P04 异常退出后恢复角色草稿");
    await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "s", code: "KeyS", windowsVirtualKeyCode: 83 });
    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "s", code: "KeyS", windowsVirtualKeyCode: 83 });
    await until("document.querySelector('.draft-feedback')?.textContent.includes('已保存并加入知识库')");
    assert.ok((await platform.loadCharacters(projectPath)).some((item) => item.name === "甲角色未保存修改"));
    report.checks.push("P04 Ctrl+S 保存当前角色页");
    await fill(".form-panel input", "失败时保留的角色稿"); await wait(850);
    const charactersDir = path.join(projectPath, "characters");
    const savedDir = path.join(projectPath, "characters-held");
    await fs.rename(charactersDir, savedDir); await fs.writeFile(charactersDir, "合成故障阻止写入");
    try {
      await closeDesktopWindow(); await wait(800);
      assert.equal(await cdp.evaluate("Boolean(document.querySelector('.manager-panel'))"), true);
      assert.equal(await cdp.evaluate("document.querySelector('.form-panel input').value"), "失败时保留的角色稿");
      report.checks.push("P04 保存失败不关闭窗口或清除草稿");
      await shot("failed-save-preserved");
    } finally { await fs.rm(charactersDir); await fs.rename(savedDir, charactersDir); }
    await fill(".form-panel input", "开始保存的角色版本"); await wait(850);
    let allowSave;
    let saveLockEntered;
    const lockEntered = new Promise((resolve) => { saveLockEntered = resolve; });
    const saveRelease = new Promise((resolve) => { allowSave = resolve; });
    const saveLock = storage.withProjectTransaction(projectPath, async () => { saveLockEntered(); await saveRelease; });
    await lockEntered;
    try {
      await cdp.evaluate("[...document.querySelectorAll('.form-actions button')].find(e=>e.textContent.includes('保存')).click()");
      await until("document.querySelector('.draft-feedback')?.textContent.includes('保存中')");
      await fill(".form-panel input", "保存过程中新增的角色版本");
    } finally { allowSave(); await saveLock; }
    await until("document.querySelector('.draft-feedback')?.textContent.includes('Ctrl+S') && !document.querySelector('.draft-feedback')?.textContent.includes('保存中')");
    assert.equal(await cdp.evaluate("document.querySelector('.form-panel input').value"), "保存过程中新增的角色版本");
    assert.ok((await platform.loadCharacters(projectPath)).some((item) => item.name === "开始保存的角色版本"));
    await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "s", code: "KeyS", windowsVirtualKeyCode: 83 });
    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "s", code: "KeyS", windowsVirtualKeyCode: 83 });
    await until("document.querySelector('.draft-feedback')?.textContent.includes('已保存并加入知识库')");
    assert.ok((await platform.loadCharacters(projectPath)).some((item) => item.name === "保存过程中新增的角色版本"));
    report.checks.push("P04 保存期间的新输入保留为待保存稿并可继续提交");
    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1180, height: 720, deviceScaleFactor: 1.5, mobile: false });
    await wait(300); await measure("character-narrow-150pct"); await shot("character-narrow-dpi");
    await view("世界"); await measure("world-narrow-150pct"); await shot("world-narrow-dpi");
    report.checks.push("P15 窄窗与150% DPI表单边界");
    await fill(".world-editor textarea", "慢保存必须完成后才关闭", true);
    let entered;
    let resume;
    const acquired = new Promise((resolve) => { entered = resolve; });
    const release = new Promise((resolve) => { resume = resolve; });
    const holding = storage.withProjectTransaction(projectPath, async () => { entered(); await release; });
    await acquired;
    try {
      await closeDesktopWindow(); await wait(5600);
      assert.equal(await cdp.evaluate("Boolean(document.querySelector('.world-editor'))"), true);
      await shot("slow-close-waits");
      report.checks.push("P04 保存等待超过5秒仍不强制关闭");
    } finally { resume(); await holding; }
    for (let i = 0; i < 100 && child.exitCode === null; i++) await wait(100);
    assert.notEqual(child.exitCode, null, "保存成功后窗口应按关闭请求退出");
    assert.ok((await platform.loadWorldDocs(projectPath)).some((item) => item.content.includes("慢保存必须完成后才关闭")));
    report.checks.push("P04 关闭前保存成功并落盘");
    report.status = "pass";
    await fs.writeFile(path.join(runDirectory, "plan-ui-report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, reportPath: path.join(runDirectory, "plan-ui-report.json") }, null, 2));
  } catch (error) {
    try { await shot("failure-layout"); } catch { /* transport may have closed */ }
    report.status = "fail"; report.error = error.message;
    await fs.writeFile(path.join(runDirectory, "plan-ui-report.json"), JSON.stringify(report, null, 2)); throw error;
  } finally { await stop(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
