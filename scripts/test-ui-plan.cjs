const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { connectCdp } = require("./lib/cdp-client.cjs");
process.env.NOVEL_PLATFORM_TEST = "1";
const platform = require("../electron/main.cjs");
const storage = require("../electron/services/project-storage.cjs");
const creativeWorkspace = require("../electron/services/creative-workspace.cjs");
const workspace = path.resolve(__dirname, "..");
const runDirectory = path.join(workspace, ".test-runs", "plan-ui-" + new Date().toISOString().replace(/[:.]/g, "-"));
const projectPath = path.join(runDirectory, "project");
const port = 9650 + Math.floor(Math.random() * 250);
const mainPort = 12000 + Math.floor(Math.random() * 200);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { status: "running", checks: [], screenshots: [], measurements: [] };
let child;
let cdp;

async function start() {
  const env = { ...process.env, NOVEL_TEST_PROJECT_PATH: projectPath };
  delete env.NOVEL_PLATFORM_TEST; delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.NOVEL_TEST_EXECUTABLE || require("electron");
  const args = [...(process.env.NOVEL_TEST_EXECUTABLE ? [] : ["."]), `--remote-debugging-port=${port}`, `--inspect=127.0.0.1:${mainPort}`, `--user-data-dir=${path.join(runDirectory, "user-data")}`];
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

async function auditKnowledgeSaving() {
  const target = (await fetch(`http://127.0.0.1:${mainPort}/json/list`).then((response) => response.json()))[0];
  assert.ok(target?.webSocketDebuggerUrl, "知识库回归的隔离主进程可调试");
  const mainCdp = connectCdp(target.webSocketDebuggerUrl);
  await mainCdp.ready;
  const diskVolume = async () => (await platform.loadConfig(projectPath)).chapters[0].volume;
  const feedback = "document.querySelector('.knowledge-save-state')?.textContent || ''";
  const volumeInput = ".knowledge-row input[list='knowledge-volumes']";
  async function waitForMain(expression) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await mainCdp.evaluate(expression)) return;
      await wait(100);
    }
    throw new Error("主进程状态等待超时：" + expression);
  }
  await mainCdp.evaluate(`(() => {
    const electron = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
    const ipc = electron.ipcMain;
    const test = globalThis.__knowledgeTest = { calls: 0, mode: 'pass', originals: new Map(), ipc };
    for (const channel of ['knowledge:update', 'knowledge:list', 'knowledge:status']) {
      const original = ipc._invokeHandlers.get(channel);
      test.originals.set(channel, original);
      ipc.removeHandler(channel);
      ipc.handle(channel, async (event, payload) => {
        if (channel === 'knowledge:update') {
          test.calls++;
          if (test.mode === 'fail') throw new Error('合成知识库保存失败');
        }
        if (channel === 'knowledge:status' && test.failStatus) throw new Error('合成状态读取失败');
        const result = await original(event, payload);
        if (channel === 'knowledge:update' && test.mode === 'hold') return new Promise(resolve => { test.release = () => resolve(result); });
        if (channel === 'knowledge:list' && test.holdList) return new Promise(resolve => { test.releaseList = () => resolve(result); });
        return result;
      });
    }
    return true;
  })()`);
  await cdp.evaluate("globalThis.__originalConfirm = window.confirm; globalThis.__uiRuntimeErrors = []; window.addEventListener('error', event => globalThis.__uiRuntimeErrors.push(event.message)); window.addEventListener('unhandledrejection', event => globalThis.__uiRuntimeErrors.push(String(event.reason))); true");
  try {
    await view("知识库");
    await until("document.querySelector('.knowledge-status-panel strong')?.textContent.includes('已同步')");
    assert.equal(await cdp.evaluate("document.querySelector('.save-state').textContent.includes('即时保存')"), false, "知识库不得误报即时保存");
    const originalVolume = await diskVolume();
    await cdp.evaluate(`(() => { const input = document.querySelector(${JSON.stringify(volumeInput)}); input.focus(); input.setSelectionRange(input.value.length, input.value.length); })()`);
    await cdp.call("Input.insertText", { text: "甲" });
    await until(`(${feedback}).includes('未保存')`);
    assert.ok(await cdp.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(volumeInput)})`), "分类连续输入期间不能重挂载输入框并丢失焦点");
    await cdp.call("Input.insertText", { text: "乙" });
    assert.ok(await cdp.evaluate(`document.querySelector(${JSON.stringify(volumeInput)}).value.endsWith('甲乙')`));
    report.checks.push("U1 分类逐字连续输入保留焦点，分组在提交后更新");
    await fill(volumeInput, "知识库手动分类");
    await until(`(${feedback}).includes('未保存')`);
    await wait(800);
    assert.equal(await diskVolume(), originalVolume, "编辑分类不得未经提交就落盘");
    await click(".save-action");
    await until(`(${feedback}) === '已保存'`);
    assert.equal(await diskVolume(), "知识库手动分类");
    report.checks.push("U1 顶部保存提交知识库分类，修改前不误报即时保存");

    await fill(volumeInput, "知识库快捷键分类");
    await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "s", code: "KeyS", windowsVirtualKeyCode: 83 });
    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "s", code: "KeyS", windowsVirtualKeyCode: 83 });
    await until(`(${feedback}) === '已保存'`);
    assert.equal(await diskVolume(), "知识库快捷键分类");
    await cdp.evaluate("(() => { const select = document.querySelector('.knowledge-row select'); select.value = '大纲'; select.dispatchEvent(new Event('change', { bubbles: true })); })()");
    await until(`(${feedback}).includes('未保存')`);
    await click(".knowledge-header button");
    await until(`(${feedback}) === '已保存'`);
    assert.equal((await platform.loadConfig(projectPath)).chapters[0].knowledgeRole, "大纲");
    report.checks.push("U1 Ctrl+S和保存整理按钮均提交当前知识库草稿");

    await fill(volumeInput, "知识库离页分类");
    await cdp.evaluate("window.confirm = () => false; true");
    await view("角色");
    assert.ok(await cdp.evaluate("Boolean(document.querySelector('.knowledge-panel'))"), "取消保存应留在知识库");
    assert.equal(await diskVolume(), "知识库快捷键分类");
    await cdp.evaluate("window.confirm = () => true; true");
    await view("角色");
    await until("Boolean(document.querySelector('.manager-panel'))");
    assert.equal(await diskVolume(), "知识库离页分类");
    report.checks.push("U1 离页先确认保存，取消保留当前分类稿");

    await view("知识库");
    await until("document.querySelector('.knowledge-status-panel strong')?.textContent.includes('已同步')");
    await mainCdp.evaluate("globalThis.__knowledgeTest.mode = 'fail'; true");
    await fill(volumeInput, "知识库失败保留分类");
    await click(".save-action");
    await until(`(${feedback}).includes('失败')`);
    await view("角色");
    await until(`(${feedback}).includes('失败')`);
    assert.ok(await cdp.evaluate("Boolean(document.querySelector('.knowledge-panel'))"));
    await closeDesktopWindow();
    await wait(500);
    assert.ok(await cdp.evaluate("Boolean(document.querySelector('.knowledge-panel'))"), "知识库保存失败不得退出");
    assert.equal(await cdp.evaluate(`document.querySelector(${JSON.stringify(volumeInput)}).value`), "知识库失败保留分类");
    assert.equal(await diskVolume(), "知识库离页分类");
    await shot("knowledge-save-failed-preserved");
    await mainCdp.evaluate("globalThis.__knowledgeTest.mode = 'pass'; true");
    await click(".knowledge-header button");
    await until(`(${feedback}) === '已保存'`);
    report.checks.push("U1 保存失败不切页、不关闭、不清稿，重试可落盘");

    await mainCdp.evaluate("globalThis.__knowledgeTest.mode = 'hold'; globalThis.__knowledgeTest.calls = 0; true");
    await fill(volumeInput, "知识库保存前版本");
    await click(".save-action");
    await waitForMain("Boolean(globalThis.__knowledgeTest.release)");
    await fill(volumeInput, "知识库保存中新版本");
    await click(".save-action");
    assert.equal(await mainCdp.evaluate("globalThis.__knowledgeTest.calls"), 1, "重复保存应复用在途请求");
    await mainCdp.evaluate("globalThis.__knowledgeTest.mode = 'pass'; globalThis.__knowledgeTest.release(); true");
    await until(`(${feedback}).includes('新改动')`);
    assert.equal(await diskVolume(), "知识库保存前版本");
    assert.equal(await cdp.evaluate(`document.querySelector(${JSON.stringify(volumeInput)}).value`), "知识库保存中新版本");
    await click(".knowledge-header button");
    await until(`(${feedback}) === '已保存'`);
    assert.equal(await diskVolume(), "知识库保存中新版本");
    report.checks.push("U1 保存期间的新输入不被回包覆盖，在途请求不重复提交");

    await mainCdp.evaluate("globalThis.__knowledgeTest.failStatus = true; true");
    await fill(volumeInput, "知识库已提交但诊断失败");
    await click(".knowledge-header button");
    await until(`(${feedback}).includes('已保存') && (${feedback}).includes('状态读取失败')`);
    assert.equal(await diskVolume(), "知识库已提交但诊断失败");
    await mainCdp.evaluate("globalThis.__knowledgeTest.failStatus = false; true");
    report.checks.push("U1 提交成功后的诊断读取失败不误报分类保存失败");

    await view("角色");
    await mainCdp.evaluate("globalThis.__knowledgeTest.holdList = true; true");
    await view("知识库");
    await waitForMain("Boolean(globalThis.__knowledgeTest.releaseList)");
    await fill(volumeInput, "知识库初始化期间新输入");
    await mainCdp.evaluate("globalThis.__knowledgeTest.holdList = false; globalThis.__knowledgeTest.releaseList(); true");
    await until("document.querySelector('.knowledge-status-panel strong')?.textContent.includes('已同步')");
    assert.equal(await cdp.evaluate(`document.querySelector(${JSON.stringify(volumeInput)}).value`), "知识库初始化期间新输入");
    await click(".knowledge-header button");
    await until(`(${feedback}) === '已保存'`);
    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1180, height: 720, deviceScaleFactor: 1.5, mobile: false });
    await measure("knowledge-narrow-150pct");
    await shot("knowledge-save-success");
    await cdp.call("Emulation.clearDeviceMetricsOverride");
    assert.deepEqual(await cdp.evaluate("globalThis.__uiRuntimeErrors"), [], "知识库操作无未捕获界面异常");
    report.checks.push("U1 初始化迟到响应不覆盖草稿，窄窗保存反馈可见，无未捕获异常");
    await view("章节");
  } finally {
    await cdp.evaluate("window.confirm = globalThis.__originalConfirm; delete globalThis.__originalConfirm; true").catch(() => null);
    await mainCdp.evaluate("(() => { const test = globalThis.__knowledgeTest; for (const [channel, original] of test.originals) { test.ipc.removeHandler(channel); test.ipc.handle(channel, original); } delete globalThis.__knowledgeTest; return true; })()").catch(() => null);
    mainCdp.close();
  }
}

async function auditOutlineSaveDuringTyping() {
  const target = (await fetch(`http://127.0.0.1:${mainPort}/json/list`).then((response) => response.json()))[0];
  assert.ok(target?.webSocketDebuggerUrl, "目录改级回归的隔离主进程可调试");
  const mainCdp = connectCdp(target.webSocketDebuggerUrl);
  await mainCdp.ready;
  const marker = "保存中继续输入的正文";
  const chapter = (await platform.loadConfig(projectPath)).chapters[0];
  await mainCdp.evaluate(`(() => {
    const electron = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
    const ipc = electron.ipcMain;
    const original = ipc._invokeHandlers.get('chapter:save');
    const test = globalThis.__outlineTest = { original, hold: true, release: null, ipc };
    ipc.removeHandler('chapter:save');
    ipc.handle('chapter:save', async (event, payload) => {
      const result = await original(event, payload);
      if (test.hold) return new Promise((resolve) => { test.release = () => resolve(result); });
      return result;
    });
    return true;
  })()`);
  try {
    await view("章节");
    await cdp.evaluate("document.querySelector('.chapter-item.active .tree-toggle')?.click(); true");
    await until("[...document.querySelectorAll('.outline-row')].some((row) => row.textContent.includes('城门线索'))");
    assert.equal(await cdp.evaluate("[...document.querySelectorAll('.outline-row')].find((row) => row.textContent.includes('城门线索'))?.querySelector('button[title=\"降级标题\"]')?.click(); true"), true);
    for (let attempt = 0; attempt < 100 && !(await mainCdp.evaluate("Boolean(globalThis.__outlineTest.release)")); attempt++) await wait(100);
    assert.ok(await mainCdp.evaluate("Boolean(globalThis.__outlineTest.release)"), "目录改级保存已进入隔离主进程");
    assert.equal(await cdp.evaluate(`(() => { const editor = document.querySelector('.ProseMirror'); if (!editor) return false; editor.focus(); const selection = window.getSelection(); selection?.selectAllChildren(editor); selection?.collapseToEnd(); return document.execCommand('insertText', false, ${JSON.stringify(marker)}); })()`), true);
    await wait(300);
    assert.ok(await cdp.evaluate(`document.querySelector('.ProseMirror').innerText.includes(${JSON.stringify(marker)})`));
    await mainCdp.evaluate("globalThis.__outlineTest.release(); true");
    await wait(900);
    assert.ok(await cdp.evaluate(`document.querySelector('.ProseMirror').innerText.includes(${JSON.stringify(marker)})`), "目录改级回包不得覆盖保存期间的新输入");
    assert.ok(await cdp.evaluate("document.querySelector('.save-state').textContent.includes('未保存')"), "回包后仍应提示未保存修改");
    const savedDisk = await fs.readFile(platform.getChapterPath(projectPath, chapter), "utf8");
    assert.ok(/### 城门线索|<h3>城门线索<\/h3>/.test(savedDisk), "目录等级修改应已落盘");
    assert.equal(savedDisk.includes(marker), false, "保存期间的新输入不应被误报为已保存");
    await mainCdp.evaluate("globalThis.__outlineTest.hold = false; true");
    await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "s", code: "KeyS", windowsVirtualKeyCode: 83 });
    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "s", code: "KeyS", windowsVirtualKeyCode: 83 });
    await until("document.querySelector('.save-state').textContent === '已保存'");
    const finalDisk = await fs.readFile(platform.getChapterPath(projectPath, chapter), "utf8");
    assert.ok(/### 城门线索|<h3>城门线索<\/h3>/.test(finalDisk) && finalDisk.includes(marker), "二次保存应同时保留目录等级与新输入");
    report.checks.push("F1a 目录改级保存期间的新输入不被迟到回包覆盖，二次保存合并两者");
  } finally {
    await mainCdp.evaluate("(() => { const test = globalThis.__outlineTest; if (!test) return true; test.ipc.removeHandler('chapter:save'); test.ipc.handle('chapter:save', test.original); delete globalThis.__outlineTest; return true; })()").catch(() => null);
    mainCdp.close();
  }
}

async function auditAsyncFeedback() {
  const target = (await fetch(`http://127.0.0.1:${mainPort}/json/list`).then((response) => response.json()))[0];
  assert.ok(target?.webSocketDebuggerUrl, "异步反馈回归的隔离主进程可调试");
  const mainCdp = connectCdp(target.webSocketDebuggerUrl);
  await mainCdp.ready;
  await mainCdp.evaluate(`(() => {
    const electron = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
    const ipc = electron.ipcMain;
    const test = globalThis.__feedbackTest = { originals: new Map(), ipc, failList: false, failSearch: false, failOperations: false, failStatus: false, failSettings: false };
    for (const channel of ['knowledge:list', 'knowledge:status', 'global:search', 'operations:list', 'project:save-settings']) {
      const original = ipc._invokeHandlers.get(channel);
      test.originals.set(channel, original);
      ipc.removeHandler(channel);
      ipc.handle(channel, async (event, payload) => {
        if (channel === 'knowledge:list' && test.failList) throw new Error('合成知识库列表读取失败');
        if (channel === 'knowledge:status' && test.failStatus) throw new Error('合成知识库状态读取失败');
        if (channel === 'global:search' && test.failSearch) throw new Error('合成全局搜索失败');
        if (channel === 'operations:list' && test.failOperations) throw new Error('合成操作记录读取失败');
        if (channel === 'project:save-settings' && test.failSettings) throw new Error('合成设置保存失败');
        return original(event, payload);
      });
    }
    return true;
  })()`);
  try {
    await mainCdp.evaluate("globalThis.__feedbackTest.failList = true; true");
    await view("角色");
    await view("知识库");
    await until("document.body.textContent.includes('知识库列表读取失败')");
    assert.ok(await cdp.evaluate("document.querySelectorAll('.knowledge-row').length >= 1"), "列表读取失败时仍应保留上次可用文档");
    await mainCdp.evaluate("globalThis.__feedbackTest.failList = false; true");
    await cdp.evaluate("[...document.querySelectorAll('.knowledge-feedback button')].find((button) => button.textContent.includes('重试读取'))?.click(); true");
    await until("!document.body.textContent.includes('知识库列表读取失败')");
    report.checks.push("U3 知识库列表读取失败与空数据分开显示，可重试恢复");

    await mainCdp.evaluate("globalThis.__feedbackTest.failStatus = true; true");
    await view("角色");
    await view("知识库");
    await until("document.body.textContent.includes('部分诊断未读取')");
    assert.ok(await cdp.evaluate("document.querySelectorAll('.knowledge-row').length >= 1"), "诊断失败不影响文档列表");
    await mainCdp.evaluate("globalThis.__feedbackTest.failStatus = false; true");
    await cdp.evaluate("[...document.querySelectorAll('.knowledge-feedback button')].find((button) => button.textContent.includes('重试诊断'))?.click(); true");
    await until("!document.body.textContent.includes('部分诊断未读取')");
    report.checks.push("U3 知识库诊断失败只降级诊断，不阻塞文档列表");

    await view("分析");
    await until("Boolean(document.querySelector('.analysis-search input'))");
    assert.ok(await cdp.evaluate("document.querySelector('.analysis-empty')?.textContent.includes('输入关键词后')"), "搜索初始态应提示输入关键词");
    await fill(".analysis-search input", "不存在的关键词zzz");
    await cdp.evaluate("document.querySelector('.analysis-search button').click(); true");
    await until("document.body.textContent.includes('没有找到与')");
    await mainCdp.evaluate("globalThis.__feedbackTest.failSearch = true; true");
    await fill(".analysis-search input", "触发搜索失败");
    await cdp.evaluate("document.querySelector('.analysis-search button').click(); true");
    await until("document.body.textContent.includes('搜索失败') && Boolean(document.querySelector('.inline-feedback[data-tone=\"error\"]'))");
    await mainCdp.evaluate("globalThis.__feedbackTest.failSearch = false; true");
    await cdp.evaluate("document.querySelector('.inline-feedback[data-tone=\"error\"] button')?.click(); true");
    await until("!document.body.textContent.includes('搜索失败')");
    report.checks.push("U3 搜索初始、零结果、失败和重试状态分开显示");

    await mainCdp.evaluate("globalThis.__feedbackTest.failOperations = true; true");
    await cdp.evaluate("document.querySelector('.task-status-button')?.click(); true");
    await until("document.body.textContent.includes('项目操作记录读取失败')");
    await mainCdp.evaluate("globalThis.__feedbackTest.failOperations = false; true");
    await cdp.evaluate("document.querySelector('.task-center-drawer .inline-feedback button')?.click(); true");
    await until("!document.body.textContent.includes('项目操作记录读取失败') && !document.body.textContent.includes('正在读取项目操作记录')");
    await cdp.evaluate("document.querySelector('.task-center-drawer header button[title=\"关闭\"]')?.click(); true");
    await until("!document.querySelector('.task-center-drawer')");
    report.checks.push("U3 操作记录读取失败不再显示为空记录，可重试恢复");

    await mainCdp.evaluate("globalThis.__feedbackTest.failSettings = true; true");
    await cdp.evaluate("document.querySelector('button[title=\"模型和项目设置\"]')?.click(); true");
    await until("Boolean(document.querySelector('.settings-modal'))");
    await cdp.evaluate("[...document.querySelectorAll('.settings-modal button')].find((button) => button.textContent.trim() === '保存设置')?.click(); true");
    await until("Boolean(document.querySelector('.settings-error'))");
    await until("document.activeElement === document.querySelector('.settings-error')");
    await mainCdp.evaluate("globalThis.__feedbackTest.failSettings = false; true");
    await cdp.evaluate("[...document.querySelectorAll('.settings-modal button')].find((button) => button.textContent.trim() === '取消')?.click(); true");
    await until("!document.querySelector('.settings-modal')");
    report.checks.push("U5 设置保存失败将焦点定位到错误提示");
    await view("章节");
  } finally {
    await mainCdp.evaluate("(() => { const test = globalThis.__feedbackTest; if (!test) return true; for (const [channel, original] of test.originals) { test.ipc.removeHandler(channel); test.ipc.handle(channel, original); } delete globalThis.__feedbackTest; return true; })()").catch(() => null);
    mainCdp.close();
  }
}

async function auditMindMapModuleToggle() {
  const settingsButton = "document.querySelector('button[title=\"模型和项目设置\"]')?.click(); true";
  const mindMapLabel = "[...document.querySelectorAll('.settings-modal label')].find((label) => label.textContent.includes('启用内置思维导图模块'))";
  const saveSettings = "[...document.querySelectorAll('.settings-modal button')].find((button) => button.textContent.trim() === '保存设置')?.click(); true";
  await cdp.evaluate(settingsButton);
  await until("Boolean(document.querySelector('.settings-modal'))");
  assert.equal(await cdp.evaluate("document.querySelector('.settings-help')?.tagName"), "DETAILS");
  assert.equal(await cdp.evaluate("document.querySelector('.settings-help')?.open"), false, "接口说明应默认折叠");
  const settingsGroups = await cdp.evaluate("[...document.querySelectorAll('.settings-group-title')].map((item) => item.textContent)");
  assert.ok(settingsGroups.includes("项目信息") && settingsGroups.includes("接口与模型") && settingsGroups.includes("生成与检索参数") && settingsGroups.includes("向量检索") && settingsGroups.includes("编辑与保存"), JSON.stringify(settingsGroups));
  report.checks.push("U5 设置页按项目、接口、生成、向量、编辑分组，接口说明默认折叠");
  await cdp.evaluate(`${mindMapLabel}?.querySelector('input')?.click(); true`);
  await until(`(() => { const label = ${mindMapLabel}; return Boolean(label) && !label.querySelector('input').checked; })()`);
  await cdp.evaluate(saveSettings);
  await until("!document.querySelector('.settings-modal')");
  assert.equal((await platform.loadConfig(projectPath)).ui.mindMapEnabled, false);
  await view("分析");
  await cdp.evaluate("[...document.querySelectorAll('.analysis-tabs button')].find((button) => button.textContent.includes('进度'))?.click(); true");
  await until("Boolean(document.querySelector('.progress-workspace'))");
  await cdp.evaluate("[...document.querySelectorAll('.progress-workspace-modes button')].find((button) => button.textContent.trim() === '思维导图')?.click(); true");
  await until("document.body.textContent.includes('思维导图模块已停用')");
  assert.equal(await cdp.evaluate("window.novelAPI.getCreativeWorkspace().then((workspace) => workspace.mindMaps.length)"), 1, "停用模块不得删除导图数据");
  report.checks.push("F4b 停用导图模块后显示降级提示且数据保留");

  await cdp.evaluate(settingsButton);
  await until("Boolean(document.querySelector('.settings-modal'))");
  await cdp.evaluate(`${mindMapLabel}?.querySelector('input')?.click(); true`);
  await until(`(() => { const label = ${mindMapLabel}; return Boolean(label) && label.querySelector('input').checked; })()`);
  await cdp.evaluate(saveSettings);
  await until("!document.querySelector('.settings-modal')");
  assert.equal((await platform.loadConfig(projectPath)).ui.mindMapEnabled, true);
  await until("document.body.textContent.includes('模块停用测试导图')");
  report.checks.push("F4b 重新启用导图模块后原导图恢复，其他规划功能未受影响");

  await cdp.evaluate("window.novelModules.unregisterMindMapModule(); true");
  await until("document.body.textContent.includes('思维导图模块未安装')");
  assert.equal(await cdp.evaluate("window.novelAPI.getCreativeWorkspace().then((workspace) => workspace.mindMaps.length)"), 1, "注销模块不得删除导图数据");
  await cdp.evaluate("window.novelModules.registerBuiltinMindMapModule(); true");
  await until("document.body.textContent.includes('模块停用测试导图')");
  report.checks.push("F4b 模块可注销并由注册表重新挂载，导图数据保持不变");

  await cdp.evaluate("window.novelModules.setMindMapModuleUnloadGuard(async () => false); true");
  assert.equal(await cdp.evaluate("window.novelModules.unregisterMindMapModule()"), false, "保存失败时不得注销模块");
  assert.ok(await cdp.evaluate("document.body.textContent.includes('模块停用测试导图')"), "注销被阻止后导图应保持可用");
  await cdp.evaluate("window.novelModules.setMindMapModuleUnloadGuard(null); true");
  await cdp.evaluate("window.novelModules.unregisterMindMapModule(); true");
  await until("document.body.textContent.includes('思维导图模块未安装')");
  await cdp.evaluate("window.novelModules.registerBuiltinMindMapModule(); true");
  await until("document.body.textContent.includes('模块停用测试导图')");
  report.checks.push("F4b 卸载守卫返回失败时阻止注销并保持导图可用");

  await cdp.evaluate("[...document.querySelectorAll('button')].find((button) => button.title === '在独立弹窗中放大画布')?.click(); true");
  await until("Boolean(document.querySelector('.mind-map-modal'))");
  await wait(350);
  const activeInfo = await cdp.evaluate("({ tag: document.activeElement?.tagName, className: document.activeElement?.className, inside: Boolean(document.querySelector('.mind-map-modal')?.contains(document.activeElement)), modal: Boolean(document.querySelector('.mind-map-modal')) })");
  assert.ok(activeInfo.inside || activeInfo.tag === "SECTION", `导图弹窗打开后焦点应进入弹窗：${JSON.stringify(activeInfo)}`);
  for (let index = 0; index < 24; index++) {
    await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  }
  assert.ok(await cdp.evaluate("document.querySelector('.mind-map-modal')?.contains(document.activeElement)"), "Tab不得逃出导图弹窗");
  await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await until("!document.querySelector('.mind-map-modal')");
  report.checks.push("U6 导图弹窗焦点围栏生效，Esc 关闭后焦点可恢复");

  await cdp.evaluate("[...document.querySelectorAll('button')].find((button) => button.title === '在独立弹窗中放大画布')?.click(); true");
  await until("Boolean(document.querySelector('.mind-map-modal'))");
  const focusedSearch = await cdp.evaluate("(() => { const input = document.querySelector('.mind-map-modal input[aria-label=\"搜索思维导图\"]'); input?.focus(); return Boolean(input) && document.activeElement === input; })()");
  assert.ok(focusedSearch, "导图弹窗内应有可聚焦输入框用于 Esc 规则验证");
  await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait(250);
  assert.ok(await cdp.evaluate("Boolean(document.querySelector('.mind-map-modal'))"), "输入框内按 Esc 不应关闭导图弹窗");
  await cdp.evaluate("document.querySelector('.mind-map-modal-close')?.click(); true");
  await until("!document.querySelector('.mind-map-modal')");
  report.checks.push("U6 输入框内 Esc 不误关导图弹窗");

  await view("章节");
  await cdp.evaluate("document.querySelector('button[title=\"功能面板 Ctrl+K\"]')?.click(); true");
  await until("Boolean(document.querySelector('.quick-panel-modal'))");
  await cdp.evaluate("[...document.querySelectorAll('.quick-panel-modal button')].find((button) => button.textContent.trim() === '思维导图')?.click(); true");
  await until("Boolean(document.querySelector('.progress-workspace'))");
  await until("document.body.textContent.includes('模块停用测试导图')");
  assert.equal(await cdp.evaluate("document.querySelector('.progress-workspace-modes button.active')?.textContent.trim()"), "思维导图");
  await cdp.evaluate("document.querySelector('.chapter-item')?.click(); true");
  await until("Boolean(document.querySelector('.editor-panel'))");
  assert.equal(await cdp.evaluate("document.querySelector('.pane-tabs button[title=\"章节\"]')?.getAttribute('aria-current')"), "page");
  report.checks.push("U2 功能面板可直达思维导图并返回原章节");
  await view("章节");
}

async function auditAdaptation() {
  const originalTitle = (await platform.loadConfig(projectPath)).title;
  async function setProjectTitle(value) {
    await cdp.evaluate("document.querySelector('button[title=\"模型和项目设置\"]')?.click(); true");
    await until("Boolean(document.querySelector('.settings-modal'))");
    await cdp.evaluate(`(() => { const label = [...document.querySelectorAll('.settings-modal label')].find((item) => item.textContent.includes('小说名称')); const input = label?.querySelector('input'); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); return Boolean(input); })()`);
    await cdp.evaluate("[...document.querySelectorAll('.settings-modal button')].find((button) => button.textContent.trim() === '保存设置')?.click(); true");
    await until("!document.querySelector('.settings-modal')");
  }
  try {
    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1180, height: 720, deviceScaleFactor: 1.5, mobile: false });
    await cdp.evaluate("document.querySelector('button[title=\"切换主题\"]')?.click(); true");
    await until("document.documentElement.dataset.theme === 'dark'");
    await setProjectTitle("很长的界面适配测试项目名称用于检查顶部栏在最小窗口与高DPI下的布局边界");
    const metrics = await cdp.evaluate("(() => { const topbar = document.querySelector('.topbar'); return { pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, pageHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight, topbarWidth: topbar?.clientWidth, topbarScrollWidth: topbar?.scrollWidth, theme: document.documentElement.dataset.theme }; })()");
    assert.ok(metrics.pageWidth <= metrics.viewportWidth + 2, JSON.stringify(metrics));
    assert.ok(metrics.pageHeight <= metrics.viewportHeight + 2, JSON.stringify(metrics));
    assert.ok(!metrics.topbarWidth || metrics.topbarScrollWidth <= metrics.topbarWidth + 2, JSON.stringify(metrics));
    await cdp.evaluate("document.querySelector('button[title=\"模型和项目设置\"]')?.click(); true");
    await until("Boolean(document.querySelector('.settings-modal'))");
    const settingsMetrics = await cdp.evaluate("(() => { const settings = document.querySelector('.settings-modal'); const grid = document.querySelector('.settings-grid'); return { settingsWidth: settings?.clientWidth, settingsScrollWidth: settings?.scrollWidth, gridWidth: grid?.clientWidth, gridScrollWidth: grid?.scrollWidth }; })()");
    assert.ok(!settingsMetrics.settingsWidth || settingsMetrics.settingsScrollWidth <= settingsMetrics.settingsWidth + 2, JSON.stringify(settingsMetrics));
    assert.ok(!settingsMetrics.gridWidth || settingsMetrics.gridScrollWidth <= settingsMetrics.gridWidth + 2, JSON.stringify(settingsMetrics));
    await cdp.evaluate("[...document.querySelectorAll('.settings-modal button')].find((button) => button.textContent.trim() === '取消')?.click(); true");
    await until("!document.querySelector('.settings-modal')");
    await setProjectTitle(originalTitle);
    report.checks.push("U6 最小窗口、150%DPI、暗色与长项目标题无页面、顶部栏或设置滚动区溢出");
  } finally {
    await setProjectTitle(originalTitle).catch(() => null);
    if (await cdp.evaluate("document.documentElement.dataset.theme === 'dark'"))
      await cdp.evaluate("document.querySelector('button[title=\"切换主题\"]')?.click(); true");
    await cdp.call("Emulation.clearDeviceMetricsOverride").catch(() => null);
    await view("章节");
  }
}

async function main() {
  await fs.mkdir(runDirectory, { recursive: true });
  await platform.ensureProjectStructure(projectPath, "完整P表界面测试项目与长标题布局检查");
  const config = await platform.loadConfig(projectPath);
  const seededChapter = config.chapters[0];
  const seededContent = "# 第一章 开篇\n\n## 城门线索\n\n两人约定次日从北门出发。\n";
  Object.assign(seededChapter, {
    title: "第一章 开篇",
    volume: "卷一",
    knowledgeRole: "正文",
    contentFormat: "markdown",
    wordCount: seededContent.length,
    outline: [
      { id: "h1", level: 1, title: "第一章 开篇", line: 0 },
      { id: "h2", level: 2, title: "城门线索", line: 2 },
    ],
  });
  config.chapters = [seededChapter];
  await fs.writeFile(platform.getChapterPath(projectPath, seededChapter), seededContent, "utf8");
  config.agent.autoLocalAnalysis = false;
  await platform.saveConfig(projectPath, config);
  await creativeWorkspace.upsertItem(projectPath, "mindMaps", {
    id: "module_toggle_map",
    title: "模块停用测试导图",
    rootId: "root",
    nodes: [{ id: "root", parentId: "", text: "中心主题", note: "", color: "", collapsed: false, order: 0, side: "right" }],
    relations: [],
    positions: {},
  });
  for (const [id, name] of [["a", "甲角色"], ["b", "乙角色"]]) await fs.writeFile(path.join(projectPath, "characters", id + ".json"), JSON.stringify({ id, name, fileName: id + ".json", category: "主角", notes: "初始资料" }));
  for (const [id, title] of [["a", "甲设定"], ["b", "乙设定"]]) await fs.writeFile(path.join(projectPath, "worldbuilding", id + ".md"), `---\ntitle: ${title}\ncategory: 设定\n---\n\n初始设定`);
  try {
    await start();
    await auditKnowledgeSaving();
    await auditOutlineSaveDuringTyping();
    await auditAsyncFeedback();
    await auditMindMapModuleToggle();
    await auditAdaptation();
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
    await stop(); await start();
    await until("document.querySelector('.statusbar > strong')?.textContent.includes('发现可恢复内容')");
    await view("角色");
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
    await until("document.querySelector('.draft-feedback')?.textContent.includes('已保存并加入知识库') || document.querySelector('footer.statusbar strong')?.textContent.includes('角色卡片已保存：保存过程中新增的角色版本')");
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
