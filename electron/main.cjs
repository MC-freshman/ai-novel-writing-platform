const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { createWriteStream, existsSync } = require("node:fs");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const crypto = require("node:crypto");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { toUSVString } = require("node:util");
const AdmZip = require("adm-zip");
const mammoth = require("./services/word-import.cjs");
const { parse: parseHtml } = require("node-html-parser");
const { writeFileAtomic, writeJsonAtomic, withProjectTransaction, writeProjectFiles } = require("./services/project-storage.cjs");
const { consumeChatStream } = require("./services/chat-stream.cjs");
const storyState = require("./services/story-state.cjs");
const { PersistentTaskCenter } = require("./services/task-center.cjs");
const projectSnapshots = require("./services/project-snapshots.cjs");
const vectorShards = require("./services/vector-shards.cjs");
const creativeWorkspace = require("./services/creative-workspace.cjs");
const novelNetworkImport = require("./services/novel-network-import.cjs");
const { normalizeNetwork } = require("./services/novel-network.cjs");
const operationJournal = require("./services/operation-journal.cjs");
const projectMigrations = require("./services/project-migrations.cjs");
const retrievalPlanner = require("./services/retrieval-planner.cjs");
const novelAgent = require("./services/novel-agent.cjs");
const knowledgeFreshness = require("./services/knowledge-freshness.cjs");
const creativeStatistics = require("./services/creative-statistics.cjs");
const windowsCredentials = require("./services/windows-credentials.cjs");
const exchangeSecurity = require("./services/project-exchange-security.cjs");
const projectArchives = require("./services/project-archives.cjs");
const { assertTrustedSender, validateIpcArguments } = require("./services/ipc-security.cjs");
const docxFidelity = require("./services/docx-fidelity.cjs");
const releasePrivacy = require("./services/release-privacy.cjs");
const { initLogger, log } = require("./services/logger.cjs");
const { verifyIpcContract } = require("./services/ipc-contract.cjs");
const { channelsRequiringHandler } = require("../shared/contracts/ipc-channels.cjs");
const { state, sendRendererEvent } = require("./services/runtime-state.cjs");
const { getConfigPath, getChapterPath, contentToPlainText, loadCharacters, loadWorldDocs, loadChapterContent, defaultConfig, getKnowledgeRole } = require("./services/project-files.cjs");
const { getDefaultProjectPath, assertExpectedChapterRevision, inspectProjectHealth, activateProjectSession, finishProjectSessions } = require("./services/project-config.cjs");
const { getKnowledgeSyncStatus, repairKnowledgeSync, getMaintenanceDiagnostics, repairMaintenance, chunkText, compatibleVectorScore, loadVectorStore, loadKnowledgeSummaries, indexSource, rebuildIndex, searchRelevantChunks } = require("./services/knowledge-index.cjs");
const { buildProjectSourceCatalog, collectPromptMaterials, buildSystemPrompt, buildInventorySummary, buildChatRetrievalPackage } = require("./services/retrieval-pipeline.cjs");
const { callChatApi, generateCharactersFromOutline, buildCreativeAdvice } = require("./services/ai-generate.cjs");
const { loadAnalysisState, saveAnalysisState, buildTimelineEvents, buildAiTimelineEvents, buildRelationshipGraph, analyzeConsistency, prepareWorldCardCandidates, saveWorldCardCandidates, refreshLocalStoryState, getStoryOverviewForProject, analyzeStoryStateWithAI } = require("./services/analysis-tools.cjs");
const { getCreativeWorkspaceView, prepareCreativeAgentRun, replaceUniqueSelection } = require("./services/creative-agent.cjs");
const { saveChapterContent } = require("./services/project-content.cjs");
const { buildCreativeStatistics, executeBackgroundTask } = require("./services/task-runtime.cjs");
const { exportChapterToDocx, exportBookDocumentsToDirectory, exportBookToDocx } = require("./services/docx-export.cjs");
const { ensureProjectStructure, loadConfig, saveConfig, buildAppState, importDocumentIntoProject, applySafeRevision, applySafeRevisionPart, buildProjectExchangeArchive, createBackup, indexSources, updateKnowledgeSummaries } = require("./services/project-ops.cjs");
const { registerIpcHandlers } = require("./ipc/handlers.cjs");
const {
  AlignmentType,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTextRun,
  Document,
  HeadingLevel,
  ImageRun,
  InsertedTextRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} = require("docx");

process.on("uncaughtException", (error) => {
  log("process", "error", "uncaughtException", { error });
});
process.on("unhandledRejection", (reason) => {
  log("process", "error", "unhandledRejection", { error: reason });
});



async function createWindow() {
  state.windowCloseApproved = false;
  if (state.windowCloseRequestTimer) clearTimeout(state.windowCloseRequestTimer);
  state.windowCloseRequestTimer = null;
  const savedWindowState = state.currentProjectPath ? await operationJournal.loadWindowState(state.currentProjectPath).catch(() => null) : null;
  const savedBounds = savedWindowState?.bounds || {};
  state.mainWindow = new BrowserWindow({
    width: Math.max(1180, Number(savedBounds.width) || 1440),
    height: Math.max(720, Number(savedBounds.height) || 900),
    ...(Number.isFinite(savedBounds.x) && Number.isFinite(savedBounds.y) ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: 1180,
    minHeight: 720,
    title: "AI小说创作平台",
    backgroundColor: "#f7f1e8",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  state.mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log("renderer", "error", "render-process-gone", { details });
  });
  state.mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    log("renderer", "error", "preload-error", { extra: { preloadPath, error } });
  });

  state.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  state.mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url === state.mainWindow.webContents.getURL()) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });

  if (savedWindowState?.maximized) state.mainWindow.maximize();
  state.mainWindow.on("close", () => {
    if (!state.currentProjectPath || state.mainWindow.isDestroyed()) return;
    const bounds = state.mainWindow.getNormalBounds();
    const maximized = state.mainWindow.isMaximized();
    void operationJournal.loadWindowState(state.currentProjectPath)
      .then((current) => operationJournal.saveWindowState(state.currentProjectPath, { ...(current || {}), bounds, maximized }))
      .catch(() => null);
  });

  state.mainWindow.on("close", (event) => {
    if (state.windowCloseApproved || state.mainWindow.isDestroyed() || state.mainWindow.webContents.isDestroyed()) return;
    event.preventDefault();
    if (state.windowCloseRequestTimer) return;
    state.mainWindow.webContents.send("app:before-close");
    state.windowCloseRequestTimer = setTimeout(() => {
      state.windowCloseRequestTimer = null;
      // Saving can take longer than the IPC handshake. Only the renderer may approve closing.
    }, 30000);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await state.mainWindow.loadURL(devUrl);
  } else {
    await state.mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function sendMenuAction(action) {
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send("menu:action", action);
  }
}

function setChineseApplicationMenu() {
  const template = [
    {
      label: "文件",
      submenu: [
        { label: "新建项目", accelerator: "CmdOrCtrl+N", click: () => sendMenuAction("newProject") },
        { label: "打开项目", accelerator: "CmdOrCtrl+O", click: () => sendMenuAction("openProject") },
        { label: "导入文档", accelerator: "CmdOrCtrl+I", click: () => sendMenuAction("importDocument") },
        { label: "导出当前章节为Word", accelerator: "CmdOrCtrl+E", click: () => sendMenuAction("exportChapterDocx") },
        { label: "按目录树逐篇导出Word", click: () => sendMenuAction("exportBookDocx") },
        { type: "separator" },
        { label: "导出备份", click: () => sendMenuAction("exportBackup") },
        { type: "separator" },
        { label: "退出", role: "quit" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { label: "保存当前章节", accelerator: "CmdOrCtrl+S", click: () => sendMenuAction("saveChapter") },
        { type: "separator" },
        { label: "撤销", role: "undo" },
        { label: "重做", role: "redo" },
        { type: "separator" },
        { label: "剪切", role: "cut" },
        { label: "复制", role: "copy" },
        { label: "粘贴", role: "paste" },
        { label: "全选", role: "selectAll" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { label: "切换主题", click: () => sendMenuAction("toggleTheme") },
        { label: "专注模式", accelerator: "F11", click: () => sendMenuAction("toggleFocus") },
        { label: "重建知识库", click: () => sendMenuAction("rebuildIndex") },
        { type: "separator" },
        { label: "重新加载", role: "reload" },
      ],
    },
    {
      label: "设置",
      submenu: [{ label: "模型与项目设置", click: () => sendMenuAction("showSettings") }],
    },
    {
      label: "窗口",
      submenu: [
        { label: "最小化", role: "minimize" },
        { label: "关闭窗口", role: "close" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}


if (process.env.NOVEL_PLATFORM_TEST === "1") {
  module.exports = {
    analyzeConsistency,
    buildAiTimelineEvents,
    buildAppState,
    buildChatRetrievalPackage,
    buildCreativeAdvice,
    buildProjectExchangeArchive,
    buildInventorySummary,
    buildProjectSourceCatalog,
    buildRelationshipGraph,
    buildSystemPrompt,
    buildTimelineEvents,
    callChatApi,
    chunkText,
    compatibleVectorScore,
    collectPromptMaterials,
    contentToPlainText,
    createBackup,
    defaultConfig,
    ensureProjectStructure,
    getCreativeWorkspaceView,
    assertExpectedChapterRevision,
    exportBookToDocx,
    exportBookDocumentsToDirectory,
    exportChapterToDocx,
    generateCharactersFromOutline,
    getChapterPath,
    getConfigPath,
    getKnowledgeRole,
    getKnowledgeSyncStatus,
    getMaintenanceDiagnostics,
    inspectProjectHealth,
    applySafeRevision,
    applySafeRevisionPart,
    buildCreativeStatistics,
    replaceUniqueSelection,
    importDocumentIntoProject,
    indexSource,
    indexSources,
    loadAnalysisState,
    loadCharacters,
    loadConfig,
    loadKnowledgeSummaries,
    loadChapterContent,
    loadVectorStore,
    loadWorldDocs,
    prepareWorldCardCandidates,
    prepareCreativeAgentRun,
    analyzeStoryStateWithAI,
    executeBackgroundTask,
    getStoryOverviewForProject,
    refreshLocalStoryState,
    repairKnowledgeSync,
    repairMaintenance,
    rebuildIndex,
    saveConfig,
    saveChapterContent,
    saveAnalysisState,
    saveWorldCardCandidates,
    searchRelevantChunks,
    updateKnowledgeSummaries,
    projectSnapshots,
    storyState,
  };
} else {
  app.whenReady().then(async () => {
    app.setName("AI小说创作平台");
    initLogger(path.join(app.getPath("userData"), "logs"), { minLevel: "info", retentionDays: 14 });
    log("app", "info", "startup", { version: app.getVersion(), electron: process.versions.electron, node: process.versions.node, platform: process.platform });
    setChineseApplicationMenu();
    registerIpcHandlers();
    state.currentProjectPath = await getDefaultProjectPath();
    await ensureProjectStructure(state.currentProjectPath);
    await activateProjectSession(state.currentProjectPath);
    await createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (state.gracefulShutdownStarted || !state.projectSessions.size) return;
    event.preventDefault();
    state.gracefulShutdownStarted = true;
    void finishProjectSessions().finally(() => app.quit());
  });
}
