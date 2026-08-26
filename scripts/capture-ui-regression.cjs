const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

process.env.NOVEL_PLATFORM_TEST = "1";
const electronPath = require("electron");
const platform = require("../electron/main.cjs");
const creativeWorkspace = require("../electron/services/creative-workspace.cjs");
const projectSnapshots = require("../electron/services/project-snapshots.cjs");
const workspace = path.resolve(__dirname, "..");
const packagedExecutable = String(process.env.NOVEL_TEST_EXECUTABLE || "").trim();
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDirectory = path.join(workspace, ".test-runs", `ui_visual_${runId}`);
const projectPath = path.join(runDirectory, "project");
const userDataPath = path.join(runDirectory, "user-data");
const port = 9300 + Math.floor(Math.random() * 300);
const undoIsolationMarker = "撤销历史隔离标记";
const undoIsolationSecondContent = "<h1>第二章 独立内容</h1><p>本章内容只属于第二章，不得被其他章节的撤销历史替换。</p>";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTarget() {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // Electron is still starting.
    }
    await wait(250);
  }
  throw new Error("等待 Electron 调试页面超时。");
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result || {});
  };
  const ready = new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("无法连接 Electron 调试页面。"));
  });
  return {
    ready,
    call(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => socket.close(),
  };
}

async function capture(cdp, name) {
  const result = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const filePath = path.join(runDirectory, name);
  await fs.writeFile(filePath, Buffer.from(result.data, "base64"));
  return filePath;
}

async function seedVisualProject() {
  await platform.ensureProjectStructure(projectPath, "界面回归测试项目");
  const config = await platform.loadConfig(projectPath);
  const chapter = config.chapters[0];
  const content = "<h1>第一章 开篇</h1><p>李明在圣城发现徽章秘密，王雪决定与他共同追查。</p><h2>城门线索</h2><p>两人约定次日从北门出发。</p>";
  chapter.title = "第一章 开篇";
  chapter.volume = "卷一";
  chapter.knowledgeRole = "正文";
  chapter.contentFormat = "html";
  chapter.wordCount = content.length;
  chapter.outline = [{ id: "h1", level: 1, title: "第一章 开篇", line: 0 }, { id: "h2", level: 2, title: "城门线索", line: 1 }];
  const secondChapter = {
    ...chapter,
    id: "visual_chapter_2",
    title: "第二章 独立内容",
    fileName: "visual_chapter_2.html",
    order: 1,
    wordCount: undoIsolationSecondContent.length,
    outline: [{ id: "h1-second", level: 1, title: "第二章 独立内容", line: 0 }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  chapter.order = 0;
  config.chapters = [chapter, secondChapter];
  config.title = "界面回归测试项目";
  await fs.writeFile(platform.getChapterPath(projectPath, chapter), content, "utf8");
  await fs.writeFile(platform.getChapterPath(projectPath, secondChapter), undoIsolationSecondContent, "utf8");
  await platform.saveConfig(projectPath, config);
  await fs.writeFile(path.join(projectPath, "characters", "visual_li.json"), JSON.stringify({ id: "visual_li", fileName: "visual_li.json", name: "李明", category: "主角团", relationships: "王雪：同伴", notes: "追查徽章秘密" }), "utf8");
  await fs.writeFile(path.join(projectPath, "characters", "visual_wang.json"), JSON.stringify({ id: "visual_wang", fileName: "visual_wang.json", name: "王雪", category: "主角团", relationships: "李明：同伴", notes: "协助调查" }), "utf8");
  await creativeWorkspace.upsertItem(projectPath, "annotations", { chapterId: chapter.id, chapterTitle: chapter.title, quote: "圣城", comment: "确认圣城与大纲中的地理称呼一致。", type: "待核对", status: "待处理", origin: "manual" });
  await creativeWorkspace.upsertItem(projectPath, "revisions", { chapterId: chapter.id, chapterTitle: chapter.title, action: "润色", instruction: "增强线索感", original: "徽章秘密", replacement: "失落徽章背后的秘密", status: "待确认" });
  await creativeWorkspace.upsertItem(projectPath, "causalNodes", { id: "visual_cause", type: "事件", title: "发现徽章", detail: "李明在圣城发现线索", chapterId: chapter.id, chapterTitle: chapter.title, volume: chapter.volume, origin: "manual", locked: true, order: 0, x: 180, y: 170 });
  await creativeWorkspace.upsertItem(projectPath, "causalNodes", { id: "visual_result", type: "结果", title: "决定追查", detail: "李明与王雪次日出发", chapterId: chapter.id, chapterTitle: chapter.title, volume: chapter.volume, origin: "manual", locked: true, order: 1, x: 450, y: 250 });
  await creativeWorkspace.upsertItem(projectPath, "causalEdges", { id: "visual_edge", source: "visual_cause", target: "visual_result", relation: "促使", detail: "线索推动行动", color: "#3f7f78", direction: "forward", origin: "manual" });
  await projectSnapshots.createSnapshot(projectPath, { name: "界面回归起点", reason: "检查选择恢复列表" });
  await fs.writeFile(platform.getChapterPath(projectPath, chapter), `${content}<p>快照后新增的段落。</p>`, "utf8");
}

async function auditUndoIsolation(cdp) {
  const edited = await cdp.call("Runtime.evaluate", {
    expression: `(() => {
      const editor = document.querySelector('.ProseMirror');
      if (!editor) return false;
      editor.focus();
      const selection = window.getSelection();
      selection?.selectAllChildren(editor);
      selection?.collapseToEnd();
      return document.execCommand('insertText', false, '${undoIsolationMarker}');
    })()`,
    returnByValue: true,
  });
  if (!edited.result?.value) throw new Error("无法在第一章写入撤销隔离测试标记。");
  await wait(250);
  const switched = await cdp.call("Runtime.evaluate", {
    expression: `(() => {
      const item = [...document.querySelectorAll('.chapter-item')].find((node) => node.textContent.includes('第二章 独立内容'));
      item?.click();
      return Boolean(item);
    })()`,
    returnByValue: true,
  });
  if (!switched.result?.value) throw new Error("无法切换到第二章执行撤销隔离测试。");
  await wait(2800);
  for (let index = 0; index < 8; index += 1) {
    await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90 });
    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90 });
  }
  await wait(2400);
  const audit = await cdp.call("Runtime.evaluate", {
    expression: `(() => ({
      title: document.querySelector('.title-input')?.value || '',
      text: document.querySelector('.ProseMirror')?.innerText || '',
      activeTreeItem: document.querySelector('.chapter-item.active')?.innerText || '',
    }))()`,
    returnByValue: true,
  });
  const value = audit.result?.value || {};
  if (!String(value.title).includes("第二章 独立内容") || !String(value.activeTreeItem).includes("第二章 独立内容")) {
    throw new Error("连续撤销后编辑器章节身份发生变化。");
  }
  if (String(value.text).includes(undoIsolationMarker) || String(value.text).includes("第一章 开篇")) {
    throw new Error("富文档撤销历史跨越了章节边界。");
  }
  const latestConfig = await platform.loadConfig(projectPath);
  const first = latestConfig.chapters.find((item) => item.title === "第一章 开篇");
  const second = latestConfig.chapters.find((item) => item.title === "第二章 独立内容");
  const [firstDiskContent, secondDiskContent] = await Promise.all([
    fs.readFile(platform.getChapterPath(projectPath, first), "utf8"),
    fs.readFile(platform.getChapterPath(projectPath, second), "utf8"),
  ]);
  if (!firstDiskContent.includes(undoIsolationMarker)) throw new Error("切章前的第一章修改没有正确保存。");
  if (secondDiskContent !== undoIsolationSecondContent) throw new Error("连续撤销错误覆盖了第二章文件。");
  await cdp.call("Runtime.evaluate", {
    expression: `(() => { const item = [...document.querySelectorAll('.chapter-item')].find((node) => node.textContent.includes('第一章 开篇')); item?.click(); return Boolean(item); })()`,
    returnByValue: true,
  });
  await wait(1200);
}

async function main() {
  await fs.mkdir(runDirectory, { recursive: true });
  await seedVisualProject();
  const executable = packagedExecutable || electronPath;
  const executableArgs = packagedExecutable
    ? [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataPath}`]
    : [".", `--remote-debugging-port=${port}`, `--user-data-dir=${userDataPath}`];
  const childEnv = { ...process.env, NOVEL_TEST_PROJECT_PATH: projectPath };
  delete childEnv.NOVEL_PLATFORM_TEST;
  const child = spawn(executable, executableArgs, {
    cwd: workspace,
    stdio: "ignore",
    env: childEnv,
  });
  try {
    const target = await waitForTarget();
    const cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.call("Page.enable");
    await wait(1500);
    await auditUndoIsolation(cdp);
    const mainScreenshot = await capture(cdp, "ui-main.png");
    const openedInlineReview = await cdp.call("Runtime.evaluate", {
      expression: `(() => { const mark = document.querySelector('.inline-review'); mark?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return Boolean(mark); })()`,
      returnByValue: true,
    });
    if (!openedInlineReview.result?.value) throw new Error("正文旁批注或修订标记没有正常显示。");
    await wait(250);
    const inlineReviewAudit = await cdp.call("Runtime.evaluate", {
      expression: `(() => { const marks = [...document.querySelectorAll('.inline-review')]; const popover = document.querySelector('.inline-review-popover'); return { missing: !popover, count: marks.length, width: popover?.clientWidth || 0, scrollWidth: popover?.scrollWidth || 0 }; })()`,
      returnByValue: true,
    });
    if (inlineReviewAudit.result?.value?.missing) throw new Error("正文旁批注或修订标记没有正常显示。");
    if (inlineReviewAudit.result?.value?.scrollWidth > inlineReviewAudit.result?.value?.width + 2) throw new Error("正文旁批注弹层出现横向溢出。");
    const inlineReviewScreenshot = await capture(cdp, "ui-inline-review.png");
    const openedAdvisor = await cdp.call("Runtime.evaluate", {
      expression: `(() => { const button = [...document.querySelectorAll('.assistant-tabs button')].find((item) => item.textContent.trim() === '创作参谋'); if (!button) return false; button.click(); return true; })()`,
      returnByValue: true,
    });
    if (!openedAdvisor.result?.value) throw new Error("没有找到右侧创作参谋入口。");
    await wait(700);
    const advisorScreenshot = await capture(cdp, "ui-creative-agent.png");
    const advisorAudit = await cdp.call("Runtime.evaluate", {
      expression: `(() => {
        const panel = document.querySelector('.ai-advisor-panel');
        if (!panel) return { missing: true };
        return {
          missing: false,
          width: panel.clientWidth,
          scrollWidth: panel.scrollWidth,
          hasPermission: panel.innerText.includes('Agent 权限与选区'),
          hasPrepare: panel.innerText.includes('准备参谋计划'),
        };
      })()`,
      returnByValue: true,
    });
    if (advisorAudit.result?.value?.missing) throw new Error("创作 Agent 面板没有正常显示。");
    if (!advisorAudit.result?.value?.hasPermission || !advisorAudit.result?.value?.hasPrepare) throw new Error("创作 Agent 权限或准备入口缺失。");
    if (advisorAudit.result?.value?.scrollWidth > advisorAudit.result?.value?.width + 2) throw new Error("创作 Agent 面板出现横向溢出。");
    await cdp.call("Runtime.evaluate", {
      expression: `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim().startsWith('知识库')); if (!button) return false; button.click(); return true; })()`,
      returnByValue: true,
    });
    await wait(1200);
    const knowledgeScreenshot = await capture(cdp, "ui-knowledge.png");
    const audit = await cdp.call("Runtime.evaluate", {
      expression: `(() => {
        const panel = document.querySelector('.knowledge-panel');
        const targets = panel ? [panel, panel.querySelector('.knowledge-toolbar'), panel.querySelector('.knowledge-list'), ...panel.querySelectorAll('.knowledge-row')].filter(Boolean) : [];
        return {
          text: document.body.innerText.slice(0, 1000),
          width: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
          height: document.documentElement.scrollHeight,
          viewportHeight: window.innerHeight,
          knowledgeOverflow: targets.filter((item) => item.scrollWidth > item.clientWidth + 2).map((item) => ({
            className: item.className,
            scrollWidth: item.scrollWidth,
            clientWidth: item.clientWidth,
          })),
        };
      })()`,
      returnByValue: true,
    });
    if (audit.result?.value?.width > audit.result?.value?.viewport + 2) throw new Error("界面出现横向溢出。");
    if (audit.result?.value?.knowledgeOverflow?.length) throw new Error(`知识库内部出现横向溢出：${JSON.stringify(audit.result.value.knowledgeOverflow)}`);

    const openedStoryCenter = await cdp.call("Runtime.evaluate", {
      expression: `(() => { const button = document.querySelector('button[title="打开创作状态"]'); if (!button) return false; button.click(); return true; })()`,
      returnByValue: true,
    });
    if (!openedStoryCenter.result?.value) throw new Error("没有找到创作状态入口。");
    await wait(700);
    const storyScreenshot = await capture(cdp, "ui-story-center.png");
    const storyAudit = await cdp.call("Runtime.evaluate", {
      expression: `(() => {
        const modal = document.querySelector('.story-center-modal');
        if (!modal) return { missing: true };
        return {
          missing: false,
          width: modal.clientWidth,
          scrollWidth: modal.scrollWidth,
          height: modal.clientHeight,
          scrollHeight: modal.scrollHeight,
          tabCount: modal.querySelectorAll('.story-center-tabs button').length,
          toolbarButtons: [...modal.querySelectorAll('.story-center-toolbar button')].map((item) => item.textContent.trim()),
        };
      })()`,
      returnByValue: true,
    });
    if (storyAudit.result?.value?.missing) throw new Error("创作状态弹窗没有打开。");
    if (storyAudit.result?.value?.scrollWidth > storyAudit.result?.value?.width + 2) throw new Error("创作状态弹窗出现横向溢出。");

    const openedWorkspace = await cdp.call("Runtime.evaluate", {
      expression: `(() => { const button = [...document.querySelectorAll('.story-center-tabs button')].find((item) => item.textContent.trim().startsWith('创作工作台')); if (!button) return false; button.click(); return true; })()`,
      returnByValue: true,
    });
    if (!openedWorkspace.result?.value) throw new Error("没有找到创作工作台入口。");
    await wait(700);
    const workspaceScreenshot = await capture(cdp, "ui-creative-workspace.png");
    const workspaceAudit = await cdp.call("Runtime.evaluate", {
      expression: `(() => {
        const workspace = document.querySelector('.creative-workspace-view');
        const content = workspace?.querySelector('.creative-workspace-content');
        if (!workspace || !content) return { missing: true };
        return {
          missing: false,
          width: workspace.clientWidth,
          scrollWidth: workspace.scrollWidth,
          contentWidth: content.clientWidth,
          contentScrollWidth: content.scrollWidth,
          tabCount: workspace.querySelectorAll('.creative-workspace-tabs button').length,
          buttonCount: workspace.querySelectorAll('button').length,
        };
      })()`,
      returnByValue: true,
    });
    if (workspaceAudit.result?.value?.missing) throw new Error("创作工作台没有正常显示。");
    if (workspaceAudit.result?.value?.tabCount !== 7) throw new Error("创作工作台标签数量异常。");
    if (workspaceAudit.result?.value?.scrollWidth > workspaceAudit.result?.value?.width + 2) throw new Error("创作工作台出现横向溢出。");
    if (workspaceAudit.result?.value?.contentScrollWidth > workspaceAudit.result?.value?.contentWidth + 2) throw new Error("创作工作台内容出现横向溢出。");

    const openedNetwork = await cdp.call("Runtime.evaluate", {
      expression: `(() => { const button = [...document.querySelectorAll('.creative-workspace-tabs button')].find((item) => item.textContent.trim() === '脉络'); if (!button) return false; button.click(); return true; })()`,
      returnByValue: true,
    });
    if (!openedNetwork.result?.value) throw new Error("没有找到统一剧情网络入口。");
    await wait(500);
    const networkScreenshot = await capture(cdp, "ui-story-network.png");
    const networkAudit = await cdp.call("Runtime.evaluate", {
      expression: `(() => { const panel = document.querySelector('.story-network-panel'); const canvas = panel?.querySelector('.story-network-canvas'); return { missing: !panel || !canvas, width: panel?.clientWidth || 0, scrollWidth: panel?.scrollWidth || 0, modes: panel?.querySelectorAll('.story-network-modes button').length || 0, nodes: panel?.querySelectorAll('.story-network-node').length || 0, edges: panel?.querySelectorAll('g.editable').length || 0 }; })()`,
      returnByValue: true,
    });
    if (networkAudit.result?.value?.missing || networkAudit.result?.value?.modes !== 4 || networkAudit.result?.value?.nodes < 2 || networkAudit.result?.value?.edges < 1) throw new Error(`统一剧情网络数据或入口异常：${JSON.stringify(networkAudit.result?.value)}`);
    if (networkAudit.result?.value?.scrollWidth > networkAudit.result?.value?.width + 2) throw new Error("统一剧情网络出现横向溢出。");

    const openedSnapshots = await cdp.call("Runtime.evaluate", {
      expression: `(() => { const button = [...document.querySelectorAll('.story-center-tabs button')].find((item) => item.textContent.trim().startsWith('快照与分支')); if (!button) return false; button.click(); return true; })()`,
      returnByValue: true,
    });
    if (!openedSnapshots.result?.value) throw new Error("没有找到快照与分支入口。");
    await wait(650);
    const clickedCompare = await cdp.call("Runtime.evaluate", {
      expression: `(() => { const button = [...document.querySelectorAll('.snapshot-actions button')].find((item) => item.textContent.trim() === '比较'); if (!button) return false; button.click(); return true; })()`,
      returnByValue: true,
    });
    if (!clickedCompare.result?.value) throw new Error("快照比较按钮没有正常显示。");
    await wait(500);
    const snapshotScreenshot = await capture(cdp, "ui-snapshot-restore.png");
    const snapshotAudit = await cdp.call("Runtime.evaluate", {
      expression: `(() => { const panel = document.querySelector('.snapshot-comparison'); return { missing: !panel, width: panel?.clientWidth || 0, scrollWidth: panel?.scrollWidth || 0, selectable: panel?.querySelectorAll('input[type=checkbox]:not(:disabled)').length || 0 }; })()`,
      returnByValue: true,
    });
    if (snapshotAudit.result?.value?.missing || snapshotAudit.result?.value?.selectable < 1) throw new Error("快照逐项恢复清单没有正常显示。");
    if (snapshotAudit.result?.value?.scrollWidth > snapshotAudit.result?.value?.width + 2) throw new Error("快照逐项恢复清单出现横向溢出。");

    await cdp.call("Runtime.evaluate", { expression: `document.querySelector('.story-center-header button[title="关闭"]')?.click()`, returnByValue: true });
    await wait(300);
    const openedAnalysis = await cdp.call("Runtime.evaluate", {
      expression: `(() => { const button = [...document.querySelectorAll('.pane-tabs button')].find((item) => item.textContent.trim() === '分析'); if (!button) return false; button.click(); return true; })()`,
      returnByValue: true,
    });
    if (!openedAnalysis.result?.value) throw new Error("没有找到分析入口。");
    await wait(450);
    await cdp.call("Runtime.evaluate", { expression: `(() => { const button = [...document.querySelectorAll('.analysis-tabs button')].find((item) => item.textContent.includes('关系网')); button?.click(); return Boolean(button); })()`, returnByValue: true });
    await wait(250);
    await cdp.call("Runtime.evaluate", { expression: `(() => { const button = [...document.querySelectorAll('.analysis-actions button')].find((item) => item.textContent.includes('刷新关系网')); button?.click(); return Boolean(button); })()`, returnByValue: true });
    await wait(800);
    const openedEdgeEditor = await cdp.call("Runtime.evaluate", { expression: `(() => { const label = document.querySelector('.relationship-edge-label'); label?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return Boolean(label); })()`, returnByValue: true });
    if (!openedEdgeEditor.result?.value) throw new Error("关系网没有生成可编辑连线。");
    await wait(300);
    const relationScreenshot = await capture(cdp, "ui-relationship-edge-editor.png");
    const relationAudit = await cdp.call("Runtime.evaluate", { expression: `(() => { const shell = document.querySelector('.relationship-graph-shell'); const editor = document.querySelector('.graph-edge-editor'); return { missing: !shell || !editor, shellWidth: shell?.clientWidth || 0, shellScrollWidth: shell?.scrollWidth || 0, editorWidth: editor?.clientWidth || 0, editorScrollWidth: editor?.scrollWidth || 0 }; })()`, returnByValue: true });
    if (relationAudit.result?.value?.missing) throw new Error("关系边编辑器没有打开。");
    if (relationAudit.result?.value?.shellScrollWidth > relationAudit.result?.value?.shellWidth + 2 || relationAudit.result?.value?.editorScrollWidth > relationAudit.result?.value?.editorWidth + 2) throw new Error("关系网或关系边编辑器出现横向溢出。");

    await cdp.call("Runtime.evaluate", { expression: `document.querySelector('button[title="模型和项目设置"]')?.click()`, returnByValue: true });
    await wait(350);
    await cdp.call("Runtime.evaluate", { expression: `(() => { const details = document.querySelector('.settings-security-panel'); if (details && !details.open) details.open = true; return Boolean(details); })()`, returnByValue: true });
    await wait(200);
    const settingsScreenshot = await capture(cdp, "ui-security-settings.png");
    const settingsAudit = await cdp.call("Runtime.evaluate", { expression: `(() => { const modal = document.querySelector('.settings-modal'); const panel = document.querySelector('.settings-security-panel'); return { missing: !modal || !panel, width: modal?.clientWidth || 0, scrollWidth: modal?.scrollWidth || 0, hasUpdate: panel?.innerText.includes('检查更新') || false, hasScan: panel?.innerText.includes('隐私扫描') || false }; })()`, returnByValue: true });
    if (settingsAudit.result?.value?.missing || !settingsAudit.result?.value?.hasUpdate || !settingsAudit.result?.value?.hasScan) throw new Error("安全设置入口不完整。");
    if (settingsAudit.result?.value?.scrollWidth > settingsAudit.result?.value?.width + 2) throw new Error("设置弹窗出现横向溢出。");
    await cdp.call("Runtime.evaluate", { expression: `document.querySelector('.settings-modal > header button')?.click()`, returnByValue: true });
    await wait(250);
    await cdp.call("Runtime.evaluate", { expression: `document.querySelector('button[title="打开创作状态"]')?.click()`, returnByValue: true });
    await wait(450);

    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1180, height: 720, deviceScaleFactor: 1, mobile: false });
    await wait(350);
    const narrowStoryScreenshot = await capture(cdp, "ui-story-center-narrow.png");
    const narrowAudit = await cdp.call("Runtime.evaluate", {
      expression: `(() => {
        const modal = document.querySelector('.story-center-modal');
        return {
          pageWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          modalWidth: modal?.clientWidth || 0,
          modalScrollWidth: modal?.scrollWidth || 0,
          bodyWidth: modal?.querySelector('.story-center-body')?.clientWidth || 0,
          bodyScrollWidth: modal?.querySelector('.story-center-body')?.scrollWidth || 0,
        };
      })()`,
      returnByValue: true,
    });
    if (narrowAudit.result?.value?.pageWidth > narrowAudit.result?.value?.viewportWidth + 2) throw new Error(`窄窗口页面出现横向溢出：${JSON.stringify(narrowAudit.result?.value)}`);
    if (narrowAudit.result?.value?.modalScrollWidth > narrowAudit.result?.value?.modalWidth + 2) throw new Error("窄窗口创作状态弹窗出现横向溢出。");
    if (narrowAudit.result?.value?.bodyScrollWidth > narrowAudit.result?.value?.bodyWidth + 2) throw new Error("窄窗口弹窗内容出现横向溢出。");
    await cdp.call("Emulation.clearDeviceMetricsOverride");
    await cdp.call("Browser.close").catch(() => null);
    await wait(500);
    cdp.close();
    console.log(JSON.stringify({ mainScreenshot, inlineReviewScreenshot, advisorScreenshot, knowledgeScreenshot, storyScreenshot, workspaceScreenshot, networkScreenshot, snapshotScreenshot, relationScreenshot, settingsScreenshot, narrowStoryScreenshot, audit: audit.result?.value, inlineReviewAudit: inlineReviewAudit.result?.value, advisorAudit: advisorAudit.result?.value, storyAudit: storyAudit.result?.value, workspaceAudit: workspaceAudit.result?.value, networkAudit: networkAudit.result?.value, snapshotAudit: snapshotAudit.result?.value, relationAudit: relationAudit.result?.value, settingsAudit: settingsAudit.result?.value, narrowAudit: narrowAudit.result?.value }, null, 2));
  } finally {
    child.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
