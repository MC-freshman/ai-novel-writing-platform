const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { connectCdp } = require("./lib/cdp-client.cjs");

process.env.NOVEL_PLATFORM_TEST = "1";
const platform = require("../electron/main.cjs");
const creativeWorkspace = require("../electron/services/creative-workspace.cjs");
const workspace = path.resolve(__dirname, "..");
const runDirectory = path.join(workspace, ".test-runs", "serene-ui-" + new Date().toISOString().replace(/[:.]/g, "-"));
const projectPath = path.join(runDirectory, "project");
const port = 9900 + Math.floor(Math.random() * 100);
const report = { status: "running", checks: [], screenshots: [], measurements: [], contrast: [] };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child;
let cdp;
let chapter;

async function until(expression) {
  for (let index = 0; index < 100; index++) {
    if (await cdp.evaluate(expression)) return;
    await wait(100);
  }
  throw new Error("等待界面状态超时：" + expression);
}

async function click(selector) {
  assert.ok(await cdp.evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); node?.click(); return Boolean(node); })()`), selector);
  await wait(150);
}

async function key(key, code, modifiers = 0) {
  await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
  await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  await wait(150);
}

async function capture(name) {
  const result = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const file = path.join(runDirectory, name + ".png");
  await fs.writeFile(file, Buffer.from(result.data, "base64"));
  report.screenshots.push(file);
}

async function layout(name) {
  const result = await cdp.evaluate(`(() => {
    const rect = (selector) => { const node = document.querySelector(selector); const r = node?.getBoundingClientRect(); return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width } : null; };
    return { name: ${JSON.stringify(name)}, viewport: { width: innerWidth, height: innerHeight }, pageWidth: document.documentElement.scrollWidth,
      topbar: rect('.topbar'), focusButton: rect('.focus-toggle'), center: rect('.center-pane'), input: rect('.chat-input'),
      overflow: [...document.querySelectorAll('.topbar button, .pane-tabs button, .chat-input, .editor-header, .progress-strip-head')].filter(n => {
        const r = n.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 2 || r.left < -2 || n.scrollWidth > n.clientWidth + 2);
      }).map(n => ({ class: n.className, title: n.title, text: n.textContent.trim(), width: n.clientWidth, scroll: n.scrollWidth })) };
  })()`);
  report.measurements.push(result);
  assert.ok(result.pageWidth <= result.viewport.width + 2, JSON.stringify(result));
  assert.deepEqual(result.overflow, [], JSON.stringify(result));
  if (result.input) assert.ok(result.input.bottom <= result.viewport.height - 28 && result.input.top >= 0, "输入框必须可见");
}

async function contrast(theme) {
  const pairs = await cdp.evaluate(`(() => {
    const style = getComputedStyle(document.documentElement);
    return [['--text','--paper'], ['--muted','--panel'], ['--accent-strong','--panel-strong']].map(([text,bg]) => ({ text: style.getPropertyValue(text).trim(), bg: style.getPropertyValue(bg).trim() }));
  })()`);
  const luminance = (hex) => {
    const values = hex.replace('#', '').match(/.{2}/g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
  };
  for (const pair of pairs) {
    const a = luminance(pair.text), b = luminance(pair.bg);
    const ratio = (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
    report.contrast.push({ theme, ...pair, ratio: Number(ratio.toFixed(2)) });
    assert.ok(ratio >= 4.5, `文字对比不足 ${theme}: ${ratio}`);
  }
}

async function main() {
  await fs.mkdir(runDirectory, { recursive: true });
  await platform.ensureProjectStructure(projectPath, "林间写作");
  const config = await platform.loadConfig(projectPath);
  chapter = config.chapters[0];
  chapter.title = "第一章 雨停之后";
  chapter.volume = "卷一 · 山林来信";
  chapter.contentFormat = "html";
  chapter.knowledgeRole = "正文";
  chapter.outline = [{ id: "serene-start", level: 1, title: chapter.title, line: 0 }];
  const content = `<h1>第一章 雨停之后</h1><p>雨在黄昏前停了。山坡上的草木还带着潮意，窗外偶尔传来一声鸟鸣，像有人把一句话轻轻放进寂静里。</p><p>林溪推开窗，风沿着木框缓缓吹进来。桌上摊着一封没有署名的信，纸页泛着浅浅的米色，折痕已经被她抚平。</p><p>她没有急着拆开。远处的山影一点点暗下去，而那个许久未曾想起的名字，就在这时回到了心里。</p><h2>一封来自远方的信</h2><p>信封上只有一行字：等春天回来，请沿着溪流往上走。</p><p>她记得那条路。小时候，每当林间起雾，他们总会在那里遇见一座小小的木桥。桥下的水从不喧哗，只是安静地流向山外。</p>`;
  await fs.writeFile(platform.getChapterPath(projectPath, chapter), content, "utf8");
  for (let index = 1; index <= 36; index++) {
    const extra = { ...chapter, id: `progress-layout-${index}`, fileName: `progress-layout-${index}.html`, order: index,
      title: `第${index + 1}章 山林来信与尚未说完的故事`, volume: index <= 7 ? "大纲" : index <= 25 ? "卷二 · 沿着溪流寻找山谷里被遗忘的故事与一封迟来的信" : "草稿",
      progressStatus: index <= 7 ? "已完成" : "计划中", wordCount: 0, outline: [] };
    config.chapters.push(extra);
    await fs.writeFile(platform.getChapterPath(projectPath, extra), "<p></p>", "utf8");
  }
  config.title = "林间写作";
  await platform.saveConfig(projectPath, config);
  await creativeWorkspace.upsertItem(projectPath, "scenes", { id: "focus-progress-scene", chapterId: chapter.id, chapterTitle: chapter.title, title: "沿着溪流找到旧木桥，确认那封信的来处", status: "写作中", order: 0 });
  const env = { ...process.env, NOVEL_TEST_PROJECT_PATH: projectPath };
  delete env.NOVEL_PLATFORM_TEST;
  delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.NOVEL_TEST_EXECUTABLE || require("electron");
  child = spawn(executable, [...(process.env.NOVEL_TEST_EXECUTABLE ? [] : ["."]), `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(runDirectory, "user-data")}`], { cwd: workspace, env, stdio: "ignore", windowsHide: true });
  let target;
  for (let index = 0; index < 100 && !target; index++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())).find(t => t.type === "page"); } catch { /* Starting Electron. */ }
    if (!target) await wait(150);
  }
  assert.ok(target, "Electron 启动超时");
  cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.call("Page.enable");
  await until("Boolean(document.querySelector('.ProseMirror'))");
  await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(200);
  await layout("日间 1440×900");
  await contrast("light");
  await capture("writing-day");
  await click(".empty-chat-example");
  assert.equal(await cdp.evaluate("document.querySelector('.chat-input textarea').value"), "帮我梳理当前章节里尚未解决的伏笔");
  assert.equal(await cdp.evaluate("document.activeElement.id"), "novel-ai-question");
  report.checks.push("空态示例填入输入框并聚焦，不自动发送");

  await key("F", "KeyF", 10);
  await until("Boolean(document.querySelector('.app-shell.focus'))");
  assert.equal(await cdp.evaluate("Boolean(document.querySelector('.right-pane'))"), false);
  await capture("writing-focus-day");
  await until("document.activeElement.classList.contains('ProseMirror')");
  await layout("日间专注");
  await key("Escape", "Escape");
  await until("Boolean(document.querySelector('.right-pane'))");
  report.checks.push("Ctrl+Shift+F 进入专注并聚焦正文，Esc 恢复两侧面板");

  await click('button[title="切换主题"]');
  await until("document.documentElement.dataset.theme === 'dark'");
  await contrast("dark");
  await capture("writing-night");
  await click(".focus-toggle");
  await until("Boolean(document.querySelector('.app-shell.focus'))");
  await capture("writing-focus-night");
  await until("document.querySelector('.progress-strip')?.getBoundingClientRect().height > 0");
  await click(".progress-strip-toggle");
  await until("document.querySelector('.progress-task-title')?.textContent.includes('旧木桥')");
  await layout("专注模式展开章节任务");
  await capture("writing-focus-progress");
  assert.equal(await cdp.evaluate("getComputedStyle(document.querySelector('.progress-strip-actions')).display !== 'none'"), true);
  await click(".progress-task-check");
  await until("Boolean(document.querySelector('.progress-task.done'))");
  await click(".progress-strip-toggle");
  assert.equal(await cdp.evaluate("document.querySelector('.progress-strip').getBoundingClientRect().height > 0"), true);
  report.checks.push("专注模式保留章节进度与任务说明，任务可勾选，展开/收起可用");
  await key("s", "KeyS", 2);
  await until("document.querySelector('.save-state').textContent.trim() === '已保存'");
  await click(".ai-chat-shortcut");
  await until("Boolean(document.querySelector('.right-pane'))");
  report.checks.push("日夜主题均有可读文字；专注中 Ctrl+S 保存；AI 对话入口恢复侧栏");

  await click('button[title="切换主题"]');
  await until("document.documentElement.dataset.theme === 'light'");
  await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1180, height: 720, deviceScaleFactor: 1, mobile: false });
  await wait(200);
  await cdp.evaluate("document.querySelector('.empty-chat-example')?.focus()");
  await layout("紧凑 1180×720");
  await capture("writing-compact");
  const widths = await cdp.evaluate("({ left: document.querySelector('.left-pane').getBoundingClientRect().width, right: document.querySelector('.right-pane').getBoundingClientRect().width })");
  await click(".progress-strip-toggle");
  assert.equal(await cdp.evaluate("document.querySelector('.progress-strip-toggle').getAttribute('aria-expanded')"), "true");
  await layout("紧凑窗口展开进度");
  await click(".progress-strip-toggle");
  await click(".focus-toggle");
  await key("Escape", "Escape");
  assert.deepEqual(await cdp.evaluate("({ left: document.querySelector('.left-pane').getBoundingClientRect().width, right: document.querySelector('.right-pane').getBoundingClientRect().width })"), widths);
  report.checks.push("1180×720 无工具裁切、输入框可见、进度可展开，专注退出后保留侧栏宽度");

  await cdp.evaluate("(() => { const e = document.querySelector('.ProseMirror'); e.focus(); window.getSelection().selectAllChildren(e); window.getSelection().collapseToEnd(); document.execCommand('insertText', false, '写作保存验证'); })()");
  await key("s", "KeyS", 2);
  await until("document.querySelector('.save-state').textContent.trim() === '已保存'");
  const updated = await platform.loadConfig(projectPath);
  assert.ok((await fs.readFile(platform.getChapterPath(projectPath, updated.chapters[0]), "utf8")).includes("写作保存验证"));
  report.checks.push("实际输入正文后 Ctrl+S 成功落盘");
  await click('button[title="模型和项目设置"]');
  await until("Boolean(document.querySelector('.settings-modal'))");
  await key("Escape", "Escape");
  await until("!document.querySelector('.settings-modal')");
  report.checks.push("设置可打开，Esc 正常关闭弹窗");
  await click('.pane-tabs button[title="分析"]');
  await cdp.evaluate("[...document.querySelectorAll('.analysis-tabs button')].find(b => b.textContent.trim() === '进度').click()");
  await until("document.querySelectorAll('.progress-cell').length >= 30");
  await click('button[title="切换主题"]');
  await until("document.documentElement.dataset.theme === 'dark'");
  for (const width of [1440, 1180]) {
    await cdp.call("Emulation.setDeviceMetricsOverride", { width, height: 720, deviceScaleFactor: 1, mobile: false });
    await wait(200);
    const measurement = await cdp.evaluate(`(() => {
      const rect = s => { const r = document.querySelector(s).getBoundingClientRect(); return { top:r.top, bottom:r.bottom, left:r.left, right:r.right, height:r.height }; };
      const board = document.querySelector('.progress-board');
      return { width:innerWidth, tabs:rect('.analysis-tabs'), modes:rect('.progress-workspace-modes'), toolbar:rect('.progress-toolbar-actions'), help:rect('.progress-toolbar-help'), firstVolume:rect('.progress-volume-head'),
        boardHeight:board.clientHeight, boardScrollHeight:board.scrollHeight, overflow:board.scrollWidth > board.clientWidth + 2,
        controlsOverflow:[...document.querySelectorAll('.progress-toolbar-actions button, .progress-volume-controls')].some(n => n.getBoundingClientRect().right > board.getBoundingClientRect().right + 2) };
    })()`);
    report.measurements.push(measurement);
    assert.ok(measurement.tabs.height >= 44 && measurement.tabs.bottom <= measurement.modes.top, "长章节列表不能挤压导航");
    assert.ok(measurement.modes.bottom < measurement.toolbar.top && measurement.toolbar.bottom <= measurement.help.top && measurement.help.bottom < measurement.firstVolume.top, "导航、工具、说明、分卷应有独立间距");
    assert.ok(measurement.boardScrollHeight > measurement.boardHeight && !measurement.overflow && !measurement.controlsOverflow, "长列表应在进度区域内滚动");
    await capture(`progress-layout-${width}`);
  }
  await cdp.evaluate("[...document.querySelectorAll('.progress-toolbar-actions button')].find(b => b.textContent.trim() === '批量标记').click()");
  await until("Boolean(document.querySelector('.progress-toolbar-hint'))");
  await cdp.evaluate("document.querySelector('.progress-volume-info > button').click()");
  await until("[...document.querySelectorAll('.progress-toolbar-actions button')].find(b => b.textContent.trim() === '设为暂缓')?.disabled === false");
  await cdp.evaluate("[...document.querySelectorAll('.progress-toolbar-actions button')].find(b => b.textContent.trim() === '设为暂缓').click()");
  await until("[...document.querySelectorAll('.progress-volume-sum')].some(n => n.textContent.includes('暂缓 1'))");
  await capture("progress-layout-batch");
  await cdp.evaluate("document.querySelector('.progress-volume-action').click()");
  await until("Boolean(document.querySelector('.progress-toolbar-actions button[title=\"恢复显示本卷\"]'))");
  await click('.progress-toolbar-actions button[title="恢复显示本卷"]');
  await until("document.querySelectorAll('.progress-volume').length === 4");
  report.checks.push("37 个长中文章节：导航不挤压，工具/说明/分卷分开排版；批量标记、隐藏及恢复本卷可用");
  report.status = "pass";
}

main().catch(error => { report.status = "fail"; report.error = error.message; process.exitCode = 1; }).finally(async () => {
  await fs.mkdir(runDirectory, { recursive: true });
  await fs.writeFile(path.join(runDirectory, "serene-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, runDirectory }, null, 2));
  if (cdp) await cdp.call("Browser.close").catch(() => null);
  cdp?.close();
  child?.kill();
});
