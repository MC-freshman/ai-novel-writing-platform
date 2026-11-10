const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { connectCdp } = require("./lib/cdp-client.cjs");

process.env.NOVEL_PLATFORM_TEST = "1";
const platform = require("../electron/main.cjs");

const root = path.resolve(__dirname, "..");
const runDirectory = path.join(root, ".test-runs", `controls-ui-${Date.now()}`);
const projectPath = path.join(runDirectory, "project");
const secondProjectPath = path.join(runDirectory, "second-project");
const newProjectRoot = path.join(runDirectory, "new-projects");
const exportDirectory = path.join(runDirectory, "book-export");
const importFile = path.join(runDirectory, "import-control.md");
const chapterDocx = path.join(runDirectory, "current-chapter.docx");
const backupZip = path.join(runDirectory, "project-backup.zip");
const configPath = path.join(runDirectory, "dialog-config.json");
const bootstrapPath = path.join(runDirectory, "bootstrap.cjs");
const port = 10800 + Math.floor(Math.random() * 200);
const mainPort = 12600 + Math.floor(Math.random() * 200);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { status: "running", checks: [], screenshots: [] };
let child;
let cdp;
let mainCdp;

async function until(expression, label, attempts = 120) {
  for (let i = 0; i < attempts; i++) {
    if (await cdp.evaluate(expression)) return;
    await wait(100);
  }
  throw new Error(`界面等待超时：${label || expression}`);
}

async function clickSelector(selector) {
  const clicked = await cdp.evaluate(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e?.click();return Boolean(e)})()`,
  );
  assert.equal(clicked, true, `找不到元素：${selector}`);
  await wait(160);
}

async function button(text, scope = "document") {
  const clicked = await cdp.evaluate(
    `(()=>{const e=[...${scope}.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});e?.click();return Boolean(e)})()`,
  );
  assert.equal(clicked, true, `找不到按钮：${text}`);
  await wait(160);
}

async function fill(selector, value, tag = "input") {
  const prototype =
    tag === "textarea" ? "HTMLTextAreaElement" : "HTMLInputElement";
  await cdp.evaluate(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing field');Object.getOwnPropertyDescriptor(${prototype}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
  );
  await wait(100);
}

async function waitForFile(filePath, attempts = 120) {
  for (let i = 0; i < attempts; i++) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat && stat.size > 0) return stat;
    await wait(150);
  }
  throw new Error(`文件未生成：${filePath}`);
}

async function listFilesRecursive(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFilesRecursive(target)));
    else files.push(target);
  }
  return files;
}

async function connectMainInspector() {
  let target;
  for (let i = 0; i < 120 && !target; i++) {
    try {
      target = (
        await fetch(`http://127.0.0.1:${mainPort}/json/list`).then((r) =>
          r.json(),
        )
      )[0];
    } catch {
      /* startup */
    }
    if (!target) await wait(100);
  }
  assert.ok(target?.webSocketDebuggerUrl, "主进程调试端口可用");
  const client = connectCdp(target.webSocketDebuggerUrl);
  await client.ready;
  return client;
}

async function clickMenu(topLabel, itemLabel) {
  const result = await mainCdp.evaluate(
    `(() => {
      const electron = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
      const menu = electron.Menu.getApplicationMenu();
      const top = menu.items.find((item) => item.label === ${JSON.stringify(topLabel)});
      const item = top && top.submenu && top.submenu.items.find((entry) => entry.label === ${JSON.stringify(itemLabel)});
      if (!item) return 'missing';
      item.click();
      return 'clicked';
    })()`,
  );
  assert.equal(result, "clicked", `菜单项不存在：${topLabel}/${itemLabel}`);
  await wait(200);
}

async function statusIncludes(text) {
  return cdp.evaluate(
    `document.querySelector('.statusbar')?.textContent.includes(${JSON.stringify(text)}) || false`,
  );
}

async function waitStatus(text, attempts = 120) {
  for (let i = 0; i < attempts; i++) {
    if (await statusIncludes(text)) return;
    await wait(150);
  }
  throw new Error(`状态栏未出现：${text}`);
}

async function screenshot(name) {
  const result = await cdp.call("Page.captureScreenshot", { format: "png" });
  const file = path.join(runDirectory, `${name}.png`);
  await fs.writeFile(file, Buffer.from(result.data, "base64"));
  report.screenshots.push(file);
}

async function seed() {
  await fs.mkdir(runDirectory, { recursive: true });
  await fs.mkdir(exportDirectory, { recursive: true });
  await fs.mkdir(newProjectRoot, { recursive: true });
  await platform.ensureProjectStructure(projectPath, "控件审计项目");
  const config = await platform.loadConfig(projectPath);
  config.agent.autoLocalAnalysis = false;
  const first = config.chapters[0];
  first.title = "第一章 控件";
  first.volume = "第一卷";
  first.order = 0;
  const second = {
    ...first,
    id: "control-second",
    title: "第二章 控件",
    fileName: "control-second.md",
    order: 1,
    progressNote: "",
  };
  first.outline = [
    { id: "first-h1", level: 1, title: "第一章 控件", line: 1 },
    { id: "first-h2", level: 2, title: "场景一", line: 3 },
  ];
  second.outline = [
    { id: "second-h1", level: 1, title: "第二章 控件", line: 1 },
    { id: "second-h2", level: 2, title: "小节二", line: 3 },
  ];
  config.chapters = [first, second];
  await platform.saveConfig(projectPath, config);
  await fs.writeFile(
    platform.getChapterPath(projectPath, first),
    "# 第一章 控件\n\n## 场景一\n\n原始正文。\n",
    "utf8",
  );
  await fs.writeFile(
    platform.getChapterPath(projectPath, second),
    "# 第二章 控件\n\n## 小节二\n\n原始正文二。\n",
    "utf8",
  );
  await platform.ensureProjectStructure(secondProjectPath, "被打开的项目");
  await platform.projectSnapshots.createSnapshot(projectPath, {
    name: "控件快照",
    reason: "界面控件回归",
  });
  await fs.writeFile(
    importFile,
    "# 导入控件章\n\n导入正文，用于验证菜单导入入口。\n",
    "utf8",
  );
  const dialogConfig = {
    mainPath: path.join(root, "electron", "main.cjs"),
    openProjectPath: secondProjectPath,
    newProjectRoot,
    importFile,
    exportDirectory,
    chapterDocx,
    backupZip,
  };
  await fs.writeFile(configPath, JSON.stringify(dialogConfig), "utf8");
  await fs.writeFile(
    bootstrapPath,
    `const fs = require('node:fs');
const { dialog } = require('electron');
const config = JSON.parse(fs.readFileSync(process.env.NOVEL_CONTROLS_CONFIG, 'utf8'));
dialog.showOpenDialog = async (_window, options = {}) => {
  const title = String(options.title || '');
  if (title.includes('打开小说项目')) return { canceled: false, filePaths: [config.openProjectPath] };
  if (title.includes('新小说项目保存位置')) return { canceled: false, filePaths: [config.newProjectRoot] };
  if (title.includes('导入')) return { canceled: false, filePaths: [config.importFile] };
  if (title.includes('逐篇')) return { canceled: false, filePaths: [config.exportDirectory] };
  return { canceled: true, filePaths: [] };
};
dialog.showSaveDialog = async (_window, options = {}) => {
  const title = String(options.title || '');
  if (title.includes('当前章节')) return { canceled: false, filePath: config.chapterDocx };
  if (title.includes('备份')) return { canceled: false, filePath: config.backupZip };
  return { canceled: true, filePath: '' };
};
require(config.mainPath);
`,
    "utf8",
  );
}

async function start() {
  const env = {
    ...process.env,
    NOVEL_TEST_PROJECT_PATH: projectPath,
    NOVEL_CONTROLS_CONFIG: configPath,
  };
  delete env.NOVEL_PLATFORM_TEST;
  delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.NOVEL_TEST_EXECUTABLE || require("electron");
  const args = [
    ...(process.env.NOVEL_TEST_EXECUTABLE ? [] : [bootstrapPath]),
    `--remote-debugging-port=${port}`,
    `--inspect=127.0.0.1:${mainPort}`,
    `--user-data-dir=${path.join(runDirectory, "user-data")}`,
  ];
  child = spawn(executable, args, {
    cwd: root,
    env,
    stdio: "ignore",
    windowsHide: true,
  });
  let target;
  for (let i = 0; i < 150 && !target; i++) {
    try {
      target = (
        await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
      ).find((item) => item.type === "page");
    } catch {
      /* startup */
    }
    if (!target) await wait(150);
  }
  assert.ok(target, "Electron 启动超时");
  cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.call("Page.enable");
  await until("Boolean(document.querySelector('.pane-tabs'))", "主界面已加载");
  await cdp.evaluate("window.confirm=()=>true");
  mainCdp = await connectMainInspector();
}

async function stop() {
  mainCdp?.close();
  cdp?.close();
  mainCdp = null;
  cdp = null;
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  }
  await wait(250);
}

async function getState() {
  return cdp.evaluate("window.novelAPI.getAppState()");
}

async function testMenuBasics() {
  const beforeTheme = await cdp.evaluate(
    "document.documentElement.dataset.theme || ''",
  );
  await clickMenu("视图", "切换主题");
  await until(
    `document.documentElement.dataset.theme && document.documentElement.dataset.theme !== ${JSON.stringify(beforeTheme)}`,
    "菜单切换主题",
  );
  await clickMenu("视图", "切换主题");
  await until(
    `document.documentElement.dataset.theme === ${JSON.stringify(beforeTheme)}`,
    "主题恢复",
  );
  report.checks.push("菜单：切换主题双向生效");

  await clickMenu("视图", "专注模式");
  await until("document.querySelector('.app-shell')?.classList.contains('focus')", "菜单专注模式");
  await clickMenu("视图", "专注模式");
  await until("!document.querySelector('.app-shell')?.classList.contains('focus')", "退出专注模式");
  report.checks.push("菜单：专注模式进入和退出生效");

  await clickMenu("设置", "模型与项目设置");
  await until("Boolean(document.querySelector('.settings-modal'))", "菜单打开设置");
  await cdp.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await cdp.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await until("!document.querySelector('.settings-modal')", "设置关闭");
  report.checks.push("菜单：模型与项目设置可打开并用 Esc 关闭");
}

async function testMenuSaveAndExports() {
  const state = await getState();
  const chapter = state.chapters.find((item) => item.id === state.selectedChapter?.id) || state.chapters[0];
  const marker = "菜单保存控件正文。";
  await cdp.evaluate(
    "(()=>{const editor=document.querySelector('.ProseMirror');editor.focus();const selection=window.getSelection();const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);selection.removeAllRanges();selection.addRange(range);return true})()",
  );
  await cdp.call("Input.insertText", { text: marker });
  await wait(200);
  await clickMenu("编辑", "保存当前章节");
  await waitStatus("已保存", 150);
  const disk = await fs.readFile(platform.getChapterPath(projectPath, chapter), "utf8");
  assert.match(disk, new RegExp(marker));
  report.checks.push("菜单：保存当前章节落到真实文件");

  await clickMenu("文件", "导出当前章节为Word");
  await waitForFile(chapterDocx);
  report.checks.push("菜单：导出当前章节为 Word 生成真实文件");

  await clickMenu("文件", "按目录树逐篇导出Word");
  await waitStatus("已逐篇导出", 160);
  let exported = [];
  for (let i = 0; i < 160; i++) {
    exported = (await listFilesRecursive(exportDirectory)).filter((file) => file.endsWith(".docx"));
    if (exported.length >= 2) break;
    await wait(150);
  }
  assert.ok(exported.length >= 2, "逐篇 Word 导出至少生成两章");
  report.checks.push(`菜单：按目录树逐篇导出生成 ${exported.length} 个 Word 文件`);

  await clickMenu("文件", "导出备份");
  await waitForFile(backupZip);
  report.checks.push("菜单：导出备份生成真实 ZIP");

  await clickMenu("视图", "重建知识库");
  await waitStatus("知识库已重建", 180);
  report.checks.push("菜单：重建知识库返回完成状态");
}

async function testMenuImportAndOpen() {
  const before = await getState();
  await clickMenu("文件", "导入文档");
  let imported = before;
  for (let i = 0; i < 180; i++) {
    imported = await getState();
    if (imported.chapters.length > before.chapters.length) break;
    await wait(150);
  }
  assert.ok(imported.chapters.length > before.chapters.length, "导入菜单新增章节");
  assert.ok(imported.chapters.some((item) => item.title.includes("import-control")), "导入文档标题写入项目");
  report.checks.push("菜单：导入文档新增章节并写入项目");

  await clickMenu("文件", "打开项目");
  let opened = null;
  for (let i = 0; i < 180; i++) {
    opened = await getState();
    if (path.resolve(opened.projectPath) === path.resolve(secondProjectPath)) break;
    await wait(150);
  }
  assert.equal(path.resolve(opened.projectPath), path.resolve(secondProjectPath));
  report.checks.push("菜单：打开项目切换到选定项目");
}

async function testMenuNewProjectPrompt() {
  await clickMenu("文件", "新建项目");
  await until("Boolean(document.querySelector('.prompt-dialog'))", "新建项目输入弹窗");
  assert.equal(
    await cdp.evaluate("document.querySelector('.prompt-dialog input')?.getAttribute('aria-label')"),
    "新小说项目名称",
  );
  await fill(".prompt-dialog input", "控件新建项目");
  await button("创建", "document.querySelector('.prompt-dialog')");
  let created = null;
  for (let i = 0; i < 180; i++) {
    created = await getState();
    if (
      path.resolve(created.projectPath).startsWith(path.resolve(newProjectRoot)) &&
      created.projectPath.includes("控件新建项目")
    )
      break;
    await wait(150);
  }
  assert.ok(path.resolve(created.projectPath).startsWith(path.resolve(newProjectRoot)));
  assert.ok(created.projectPath.includes("控件新建项目"));
  assert.equal(created.config.title, "控件新建项目");
  report.checks.push("菜单：新建项目通过应用内输入弹窗创建成功");
  await screenshot("menu-new-project");
}

async function testProgressPromptsAndTree() {
  await cdp.evaluate("document.querySelector('.pane-tabs button[title=分析]').click()");
  await wait(250);
  await button("规划与进度", "document.querySelector('.analysis-tabs')");
  await until("Boolean(document.querySelector('.progress-volume'))", "进度板加载");

  const before = await getState();
  await clickSelector('.progress-volume-action[title^="在「"]');
  await until("Boolean(document.querySelector('.prompt-dialog'))", "新建章节输入弹窗");
  await fill(".prompt-dialog input", "控件提示框新章");
  await button("创建", "document.querySelector('.prompt-dialog')");
  await until("!document.querySelector('.prompt-dialog')", "新建章节提示框关闭");
  let after = before;
  for (let i = 0; i < 120; i++) {
    after = await getState();
    if (after.chapters.some((item) => item.title === "控件提示框新章")) break;
    await wait(120);
  }
  assert.ok(after.chapters.some((item) => item.title === "控件提示框新章"));
  report.checks.push("进度板：卷头新建章节通过应用内弹窗完成");

  await cdp.evaluate(
    "document.querySelector('.progress-cell')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))",
  );
  await until("Boolean(document.querySelector('.prompt-dialog textarea'))", "进度备注输入弹窗");
  await fill(".prompt-dialog textarea", "控件进度备注", "textarea");
  await button("保存", "document.querySelector('.prompt-dialog')");
  await until("!document.querySelector('.prompt-dialog')", "进度备注提示框关闭");
  await waitStatus("进度备注已保存");
  report.checks.push("进度板：双击备注通过应用内弹窗保存");

  await cdp.evaluate("document.querySelector('.pane-tabs button[title=章节]').click()");
  await until("Boolean(document.querySelector('.chapter-node'))", "目录树加载");
  await cdp.evaluate(
    "(()=>{const item=[...document.querySelectorAll('.chapter-item')].find(e=>e.textContent.includes('第一章 控件'));item?.click();return Boolean(item)})()",
  );
  await wait(350);
  for (const title of ["第一章 控件", "第二章 控件"]) {
    await cdp.evaluate(
      `(()=>{const node=[...document.querySelectorAll('.chapter-node')].find(e=>e.textContent.includes(${JSON.stringify(title)}));node?.querySelector('.tree-toggle')?.click();return Boolean(node)})()`,
    );
    await wait(250);
  }
  const selected = await getState();
  const selectedId = selected.selectedChapter?.id;
  const tree = await cdp.evaluate(
    `(() => [...document.querySelectorAll('.chapter-node')].map((node) => ({
      title: node.querySelector('.chapter-item')?.textContent?.trim() || '',
      active: Boolean(node.querySelector('.chapter-item.active')),
      arrows: node.querySelectorAll('.outline-actions button').length,
    })))()`,
  );
  const activeNode = tree.find((node) => node.active);
  const secondNode = tree.find((node) => node.title.includes("第二章 控件"));
  assert.ok(selectedId);
  assert.ok(activeNode && activeNode.arrows > 0, JSON.stringify(tree));
  assert.ok(secondNode && secondNode.arrows === 0, `未选中章节不应显示升降级按钮：${JSON.stringify(tree)}`);
  report.checks.push("目录树：仅选中章节显示标题升降级按钮");
}

async function testStoryCenterPromptIsolation() {
  await clickSelector('.chat-header-actions button[title="打开创作状态"]');
  await until("Boolean(document.querySelector('.story-center-modal'))", "创作状态打开");
  await cdp.evaluate(
    "[...document.querySelectorAll('.story-center-tabs button')].find((button) => button.textContent.includes('快照与分支'))?.click()",
  );
  await until("Boolean(document.querySelector('.snapshot-row'))", "快照列表加载");
  await button("改名", "document.querySelector('.snapshot-row')");
  await until("Boolean(document.querySelector('.prompt-dialog'))", "快照改名输入弹窗");
  await cdp.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await cdp.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await until("!document.querySelector('.prompt-dialog')", "输入弹窗关闭");
  assert.ok(
    await cdp.evaluate("Boolean(document.querySelector('.story-center-modal'))"),
    "Esc 关闭输入弹窗时不应同时关闭创作状态",
  );
  await clickSelector('.story-center-header button[title="关闭"]');
  await until("!document.querySelector('.story-center-modal')", "创作状态关闭");
  report.checks.push("应用内输入弹窗覆盖创作状态时，Esc 只关闭输入框");
}

async function main() {
  await seed();
  try {
    await start();
    await testMenuBasics();
    await testMenuSaveAndExports();
    await testProgressPromptsAndTree();
    await testStoryCenterPromptIsolation();
    await testMenuImportAndOpen();
    await testMenuNewProjectPrompt();
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.error = error instanceof Error ? error.stack : String(error);
    try {
      await screenshot("failure");
    } catch {
      /* ignore */
    }
    throw error;
  } finally {
    await stop();
    await fs.writeFile(
      path.join(runDirectory, "controls-ui-report.json"),
      JSON.stringify(report, null, 2),
      "utf8",
    );
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
