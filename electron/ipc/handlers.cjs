// 本文件由 P2 重构自 electron/main.cjs 机械搬迁（scripts/refactor-split.cjs），逻辑未改动。
"use strict";

const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const { createWriteStream, existsSync } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { writeFileAtomic, writeJsonAtomic, withProjectTransaction, writeProjectFiles } = require("../services/project-storage.cjs");
const storyState = require("../services/story-state.cjs");
const projectSnapshots = require("../services/project-snapshots.cjs");
const creativeWorkspace = require("../services/creative-workspace.cjs");
const novelNetworkImport = require("../services/novel-network-import.cjs");
const { normalizeNetwork } = require("../services/novel-network.cjs");
const operationJournal = require("../services/operation-journal.cjs");
const { assertTrustedSender, validateIpcArguments } = require("../services/ipc-security.cjs");
const releasePrivacy = require("../services/release-privacy.cjs");
const { initLogger, log } = require("../services/logger.cjs");
const { verifyIpcContract } = require("../services/ipc-contract.cjs");
const { channelsRequiringHandler } = require("../../shared/contracts/ipc-channels.cjs");
const { state, sendRendererEvent } = require("../services/runtime-state.cjs");
const __dep0 = require("../services/project-files.cjs");
const __dep1 = require("../services/credentials.cjs");
const __dep2 = require("../services/project-config.cjs");
const __dep3 = require("../services/knowledge-index.cjs");
const __dep4 = require("../services/retrieval-pipeline.cjs");
const __dep5 = require("../services/ai-generate.cjs");
const __dep6 = require("../services/analysis-tools.cjs");
const __dep7 = require("../services/creative-agent.cjs");
const __dep8 = require("../services/project-exchange.cjs");
const __dep9 = require("../services/project-content.cjs");
const __dep10 = require("../services/task-runtime.cjs");
const __dep11 = require("../services/docx-export.cjs");
const __dep12 = require("../services/app-update.cjs");
const __dep13 = require("../services/project-ops.cjs");

function nowIso(...args) { return __dep0.nowIso.apply(null, args); }
function makeId(...args) { return __dep0.makeId(...args); }
function sanitizeFileName(...args) { return __dep0.sanitizeFileName(...args); }
function normalizeCategory(...args) { return __dep0.normalizeCategory(...args); }
function ensureDir(...args) { return __dep0.ensureDir(...args); }
function writeJson(...args) { return __dep0.writeJson(...args); }
function getConfigPath(...args) { return __dep0.getConfigPath(...args); }
function normalizeChapterFileName(...args) { return __dep0.normalizeChapterFileName(...args); }
function getChapterPath(...args) { return __dep0.getChapterPath(...args); }
function getOriginalDocumentPath(...args) { return __dep0.getOriginalDocumentPath(...args); }
function normalizeManagedFileName(...args) { return __dep0.normalizeManagedFileName(...args); }
function uniqueContentFileName(...args) { return __dep0.uniqueContentFileName(...args); }
function uniqueChapterFileName(...args) { return __dep0.uniqueChapterFileName(...args); }
function getCharacterPath(...args) { return __dep0.getCharacterPath(...args); }
function getWorldDocPath(...args) { return __dep0.getWorldDocPath(...args); }
function writeWorldDoc(...args) { return __dep0.writeWorldDoc(...args); }
function listChapterVersions(...args) { return __dep0.listChapterVersions(...args); }
function loadCharacters(...args) { return __dep0.loadCharacters(...args); }
function loadWorldDocs(...args) { return __dep0.loadWorldDocs(...args); }
function loadChapterContent(...args) { return __dep0.loadChapterContent(...args); }
function characterToMarkdown(...args) { return __dep0.characterToMarkdown(...args); }
function saveCredentialSecrets(...args) { return __dep1.saveCredentialSecrets(...args); }
function configFromRenderer(...args) { return __dep2.configFromRenderer(...args); }
function inspectProjectHealth(...args) { return __dep2.inspectProjectHealth(...args); }
function activateProjectSession(...args) { return __dep2.activateProjectSession(...args); }
function withJournalOperation(...args) { return __dep2.withJournalOperation(...args); }
function ensureCurrentProject(...args) { return __dep2.ensureCurrentProject.apply(null, args); }
function loadMaterials(...args) { return __dep3.loadMaterials.apply(null, args); }
function saveMaterial(...args) { return __dep3.saveMaterial(...args); }
function deleteMaterial(...args) { return __dep3.deleteMaterial(...args); }
function listKnowledgeItems(...args) { return __dep3.listKnowledgeItems(...args); }
function getKnowledgeSyncStatus(...args) { return __dep3.getKnowledgeSyncStatus(...args); }
function repairKnowledgeSync(...args) { return __dep3.repairKnowledgeSync(...args); }
function getMaintenanceDiagnostics(...args) { return __dep3.getMaintenanceDiagnostics(...args); }
function repairMaintenance(...args) { return __dep3.repairMaintenance(...args); }
function indexSource(...args) { return __dep3.indexSource(...args); }
function removeSourceFromIndex(...args) { return __dep3.removeSourceFromIndex(...args); }
function rebuildIndex(...args) { return __dep3.rebuildIndex(...args); }
function buildProjectMemorySummary(...args) { return __dep4.buildProjectMemorySummary(...args); }
function buildSystemPrompt(...args) { return __dep4.buildSystemPrompt(...args); }
function contextFromChunks(...args) { return __dep4.contextFromChunks(...args); }
function buildChatRetrievalPackage(...args) { return __dep4.buildChatRetrievalPackage(...args); }
function callChatApi(...args) { return __dep5.callChatApi(...args); }
function generateCharactersFromOutline(...args) { return __dep5.generateCharactersFromOutline(...args); }
function generateWorldDocsFromOutline(...args) { return __dep5.generateWorldDocsFromOutline(...args); }
function buildCreativeAdvice(...args) { return __dep5.buildCreativeAdvice(...args); }
function loadIssueStatuses(...args) { return __dep6.loadIssueStatuses(...args); }
function saveIssueStatuses(...args) { return __dep6.saveIssueStatuses(...args); }
function loadAnalysisState(...args) { return __dep6.loadAnalysisState(...args); }
function saveAnalysisState(...args) { return __dep6.saveAnalysisState(...args); }
function globalSearch(...args) { return __dep6.globalSearch(...args); }
function buildTimelineEvents(...args) { return __dep6.buildTimelineEvents(...args); }
function buildAiTimelineEvents(...args) { return __dep6.buildAiTimelineEvents(...args); }
function buildRelationshipGraph(...args) { return __dep6.buildRelationshipGraph(...args); }
function analyzeConsistency(...args) { return __dep6.analyzeConsistency(...args); }
function prepareWorldCardCandidates(...args) { return __dep6.prepareWorldCardCandidates(...args); }
function saveWorldCardCandidates(...args) { return __dep6.saveWorldCardCandidates(...args); }
function refreshLocalStoryState(...args) { return __dep6.refreshLocalStoryState(...args); }
function getStoryOverviewForProject(...args) { return __dep6.getStoryOverviewForProject(...args); }
function getCreativeWorkspaceView(...args) { return __dep7.getCreativeWorkspaceView(...args); }
function prepareCreativeAgentRun(...args) { return __dep7.prepareCreativeAgentRun(...args); }
function queueCreativeAgentRun(...args) { return __dep7.queueCreativeAgentRun(...args); }
function createSafeRevision(...args) { return __dep7.createSafeRevision(...args); }
function exportProjectExchange(...args) { return __dep8.exportProjectExchange(...args); }
function previewProjectExchange(...args) { return __dep8.previewProjectExchange(...args); }
function calculateTotalWords(...args) { return __dep9.calculateTotalWords(...args); }
function saveChapterContent(...args) { return __dep9.saveChapterContent(...args); }
function compareChapterVersion(...args) { return __dep9.compareChapterVersion(...args); }
function buildCreativeStatistics(...args) { return __dep10.buildCreativeStatistics(...args); }
function getProjectTaskCenter(...args) { return __dep10.getProjectTaskCenter(...args); }
function queueKnowledgeRebuildAfterRestore(...args) { return __dep10.queueKnowledgeRebuildAfterRestore(...args); }
function buildAppearanceStats(...args) { return __dep10.buildAppearanceStats(...args); }
function buildWorldMap(...args) { return __dep10.buildWorldMap(...args); }
function exportChapterToDocx(...args) { return __dep11.exportChapterToDocx(...args); }
function exportBookDocumentsToDirectory(...args) { return __dep11.exportBookDocumentsToDirectory.apply(null, args); }
function checkForAppUpdate(...args) { return __dep12.checkForAppUpdate.apply(null, args); }
function downloadAndOpenAppUpdate(...args) { return __dep12.downloadAndOpenAppUpdate(...args); }
function ensureProjectStructure(...args) { return __dep13.ensureProjectStructure(...args); }
function loadConfig(...args) { return __dep13.loadConfig(...args); }
function saveConfig(...args) { return __dep13.saveConfig(...args); }
function buildAppState(...args) { return __dep13.buildAppState(...args); }
function updateKnowledgeItems(...args) { return __dep13.updateKnowledgeItems(...args); }
function repairProjectHealth(...args) { return __dep13.repairProjectHealth(...args); }
function importDocumentIntoProject(...args) { return __dep13.importDocumentIntoProject(...args); }
function refreshChapterFromOriginalDocument(...args) { return __dep13.refreshChapterFromOriginalDocument(...args); }
function applySafeRevision(...args) { return __dep13.applySafeRevision(...args); }
function applySafeRevisionPart(...args) { return __dep13.applySafeRevisionPart(...args); }
function restoreChapterVersion(...args) { return __dep13.restoreChapterVersion(...args); }
function importProjectExchange(...args) { return __dep13.importProjectExchange(...args); }
function createBackup(...args) { return __dep13.createBackup(...args); }
function indexSources(...args) { return __dep13.indexSources(...args); }

function registerIpcHandler(channel, action) {
  state.registeredIpcChannels.add(channel);
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event, state.mainWindow);
    validateIpcArguments(channel, args);
    const started = Date.now();
    try {
      const result = await action(event, ...args);
      const durationMs = Date.now() - started;
      // 成功调用只在慢请求时记录，避免正常路径刷屏；失败一律落盘。
      if (durationMs >= 1000) log("ipc", "info", channel, { durationMs, slow: true });
      return result;
    } catch (error) {
      log("ipc", "error", channel, { durationMs: Date.now() - started, error });
      throw error;
    }
  });
}


function registerIpcHandlers() {
  state.registeredIpcChannels.add("app:confirm-close");
  ipcMain.on("app:confirm-close", (event) => {
    try { assertTrustedSender(event, state.mainWindow); } catch (error) { log("ipc", "warn", "app:confirm-close", { error }); return; }
    if (state.windowCloseRequestTimer) clearTimeout(state.windowCloseRequestTimer);
    state.windowCloseRequestTimer = null;
    state.windowCloseApproved = true;
    if (state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.close();
  });
  state.registeredIpcChannels.add("app:cancel-close");
  ipcMain.on("app:cancel-close", (event) => {
    try { assertTrustedSender(event, state.mainWindow); } catch (error) { log("ipc", "warn", "app:cancel-close", { error }); return; }
    if (state.windowCloseRequestTimer) clearTimeout(state.windowCloseRequestTimer);
    state.windowCloseRequestTimer = null;
  });
  registerIpcHandler("app:get-state", async () => {
    const projectPath = await ensureCurrentProject();
    return buildAppState(projectPath);
  });

  registerIpcHandler("app:check-update", async () => checkForAppUpdate());

  registerIpcHandler("app:download-update", async (_event, payload) => downloadAndOpenAppUpdate(String(payload?.url || ""), String(payload?.assetName || "")));

  registerIpcHandler("app:privacy-scan", async () => releasePrivacy.scanReleaseInputs(path.resolve(__dirname, "..")));

  registerIpcHandler("recovery:get", async () => {
    const projectPath = await ensureCurrentProject();
    return operationJournal.getRecoveryStatus(projectPath);
  });

  registerIpcHandler("recovery:save-draft", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    if (config.ui?.recoveryEnabled === false) return { disabled: true };
    return operationJournal.saveDraft(projectPath, payload || {});
  });

  registerIpcHandler("recovery:clear-draft", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    return operationJournal.clearDraft(projectPath, String(chapterId || ""));
  });

  registerIpcHandler("recovery:save-window", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const current = await operationJournal.loadWindowState(projectPath).catch(() => null);
    const bounds = state.mainWindow && !state.mainWindow.isDestroyed() ? state.mainWindow.getNormalBounds() : current?.bounds;
    return operationJournal.saveWindowState(projectPath, {
      ...(current || {}),
      ...(payload || {}),
      bounds,
      maximized: state.mainWindow && !state.mainWindow.isDestroyed() ? state.mainWindow.isMaximized() : current?.maximized,
    });
  });

  registerIpcHandler("operations:list", async () => {
    const projectPath = await ensureCurrentProject();
    const journal = await operationJournal.loadJournal(projectPath);
    return { operations: journal.operations.slice(0, 200), sessions: journal.sessions.slice(0, 20) };
  });

  registerIpcHandler("project:create", async (_event, payload) => {
    const result = await dialog.showOpenDialog(state.mainWindow, {
      title: "选择新小说项目保存位置",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const title = payload?.title?.trim() || "新小说项目";
    state.currentProjectPath = path.join(result.filePaths[0], sanitizeFileName(title));
    await ensureProjectStructure(state.currentProjectPath, title);
    await activateProjectSession(state.currentProjectPath);
    return buildAppState(state.currentProjectPath);
  });

  registerIpcHandler("project:open", async () => {
    const result = await dialog.showOpenDialog(state.mainWindow, {
      title: "打开小说项目文件夹",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    state.currentProjectPath = result.filePaths[0];
    await ensureProjectStructure(state.currentProjectPath);
    await activateProjectSession(state.currentProjectPath);
    return buildAppState(state.currentProjectPath);
  });

  registerIpcHandler("document:import", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
    const targetVolume = String(payload?.volume || "").trim();
    state.importCancelRequested = false;
    const result = await dialog.showOpenDialog(state.mainWindow, {
      title: targetVolume ? `导入一个或多个文档到「${targetVolume}」` : "导入一个或多个文档为章节",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "支持的文档", extensions: ["docx", "txt", "md"] },
        { name: "Word 文档", extensions: ["docx"] },
        { name: "文本与 Markdown", extensions: ["txt", "md"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const imported = [];
    const failures = [];
    const config = await loadConfig(projectPath);
    if (result.filePaths.length > 1 && config.agent?.snapshotBeforeBulkChanges !== false) {
      sendRendererEvent("import:progress", { active: true, phase: "创建导入前快照", current: 0, total: result.filePaths.length, fileName: "正在保护当前项目", cancellable: false });
      await projectSnapshots.createSnapshot(projectPath, { name: "批量导入前", reason: `导入 ${result.filePaths.length} 个文档前自动保存` });
    }
    sendRendererEvent("import:progress", { active: true, phase: "导入文档", current: 0, total: result.filePaths.length, fileName: "", cancellable: true });
    for (let index = 0; index < result.filePaths.length; index += 1) {
      if (state.importCancelRequested) break;
      const filePath = result.filePaths[index];
      sendRendererEvent("import:progress", {
        active: true,
        phase: "导入文档",
        current: index + 1,
        total: result.filePaths.length,
        fileName: path.basename(filePath),
        cancellable: true,
      });
      try {
        const importedItems = await withJournalOperation(projectPath, {
          type: "document-import",
          title: `导入文档：${path.basename(filePath)}`,
          targetIds: [],
          recoverable: true,
          metadata: { fileName: path.basename(filePath), targetVolume: targetVolume || "导入文档" },
        }, () => importDocumentIntoProject(projectPath, filePath, { volume: targetVolume || "导入文档", config, skipFinalize: true }),
        (items) => ({ importedChapterIds: items.map((item) => item.chapter.id) }));
        imported.push(...importedItems);
      } catch (error) {
        failures.push({ filePath, message: error.message || String(error) });
      }
    }
    if (!imported.length && failures.length) {
      throw new Error(`导入失败：${failures.map((item) => `${path.basename(item.filePath)}：${item.message}`).join("；")}`);
    }
    if (imported.length) {
      await calculateTotalWords(projectPath, config);
      await saveConfig(projectPath, config);
      sendRendererEvent("import:progress", {
        active: true,
        phase: "建立知识库",
        current: imported.length,
        total: imported.length,
        fileName: "正在为成功导入的文档建立索引",
        cancellable: false,
      });
      await indexSources(
        projectPath,
        imported.map((item) => item.source),
      );
      if (config.agent?.autoLocalAnalysis !== false && imported.length) {
        const center = await getProjectTaskCenter(projectPath);
        await center.enqueue({
          type: "story-analysis",
          title: imported.length === 1 ? `整理导入文档：${imported[0].chapter.title}` : `整理 ${imported.length} 份导入文档的创作状态`,
          total: imported.length,
          scope: { chapterIds: imported.map((item) => item.chapter.id) },
          options: { useAI: false, automatic: true, source: "import" },
        });
      }
    }
    sendRendererEvent("import:progress", { active: false, phase: state.importCancelRequested ? "已取消" : "完成", current: imported.length, total: result.filePaths.length, fileName: "" });
    const appState = await buildAppState(projectPath, imported[imported.length - 1]?.chapter.id);
    return {
      ...appState,
      importSummary: {
        total: result.filePaths.length,
        imported: imported.length,
        failed: failures.length,
        failures,
        canceled: state.importCancelRequested,
      },
    };
      });
  });

  registerIpcHandler("document:cancel-import", async () => {
    state.importCancelRequested = true;
    sendRendererEvent("import:progress", { active: true, phase: "正在取消", current: 0, total: 0, fileName: "当前文档处理完后停止", cancellable: false });
    return { ok: true };
  });

  registerIpcHandler("project:save-settings", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
    const config = await loadConfig(projectPath);
    const secrets = await saveCredentialSecrets(projectPath, payload?.api || {}, config);
    const nextConfig = configFromRenderer(config, payload || {});
    nextConfig.api.apiKey = secrets.chatRef;
    nextConfig.api.embeddingApiKey = secrets.embeddingRef;
    Object.defineProperty(nextConfig.api, "__chatSecret", { value: secrets.chat, configurable: true, writable: true, enumerable: false });
    Object.defineProperty(nextConfig.api, "__embeddingSecret", { value: secrets.embedding, configurable: true, writable: true, enumerable: false });
    await saveConfig(projectPath, nextConfig);
    return buildAppState(projectPath, payload?.selectedChapterId);
      });
  });

  registerIpcHandler("project:export-backup", async () => {
    const projectPath = await ensureCurrentProject();
    const result = await dialog.showSaveDialog(state.mainWindow, {
      title: "导出小说项目备份",
      defaultPath: path.join(projectPath, "backups", `backup_${Date.now()}.zip`),
      filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const filePath = await createBackup(projectPath, result.filePath);
    return { filePath };
  });

  registerIpcHandler("project:export-exchange", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return exportProjectExchange(projectPath, payload || {});
  });

  registerIpcHandler("project:preview-exchange", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return previewProjectExchange(projectPath, payload || {});
  });

  registerIpcHandler("project:import-exchange", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withJournalOperation(projectPath, { type: "project-exchange-import", title: "导入项目交换包", recoverable: true },
      () => importProjectExchange(projectPath, payload?.token, payload || {}),
      (result) => ({ imported: result.imported }));
  });

  registerIpcHandler("project:export-book-docx", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const result = await dialog.showOpenDialog(state.mainWindow, {
      title: "选择逐篇 Word 文档的保存位置",
      defaultPath: projectPath,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    return exportBookDocumentsToDirectory(projectPath, result.filePaths[0], payload || {});
  });

  registerIpcHandler("global:search", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return globalSearch(projectPath, payload?.query || "");
  });

  registerIpcHandler("analysis:get-state", async () => {
    const projectPath = await ensureCurrentProject();
    return loadAnalysisState(projectPath);
  });

  registerIpcHandler("analysis:save-state", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return saveAnalysisState(projectPath, payload || {});
  });

  registerIpcHandler("analysis:timeline", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const snapshot = await loadAnalysisState(projectPath);
    if (payload?.refresh === false && snapshot.timeline?.events) return snapshot.timeline;
    let result;
    if (payload?.mode === "ai") {
      try {
        result = await buildAiTimelineEvents(projectPath, payload || {});
      } catch (error) {
        const fallback = await buildTimelineEvents(projectPath, payload || {});
        result = { ...fallback, contextCount: 0, apiError: error.message || String(error) };
      }
    } else {
      result = await buildTimelineEvents(projectPath, payload || {});
    }
    await saveAnalysisState(projectPath, { timeline: result, timelineOptions: result.options || payload || {} });
    return result;
  });

  registerIpcHandler("analysis:relationships", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const snapshot = await loadAnalysisState(projectPath);
    if (payload?.refresh === false && snapshot.relationships?.nodes) return snapshot.relationships;
    const result = await buildRelationshipGraph(projectPath, payload || {});
    await saveAnalysisState(projectPath, { relationships: result, relationshipOptions: result.options || payload || {} });
    return result;
  });

  registerIpcHandler("analysis:consistency", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const snapshot = await loadAnalysisState(projectPath);
    if (payload?.refresh === false && snapshot.consistency?.issues) return snapshot.consistency;
    const result = await analyzeConsistency(projectPath, payload || {});
    await saveAnalysisState(projectPath, { consistency: result, consistencyOptions: result.options || payload || {} });
    return result;
  });

  registerIpcHandler("analysis:update-issue-status", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const issueId = String(payload?.issueId || "");
    const status = String(payload?.status || "待处理");
    if (!issueId) throw new Error("缺少问题 ID。");
    const statuses = await loadIssueStatuses(projectPath);
    statuses[issueId] = { status, updatedAt: nowIso() };
    await saveIssueStatuses(projectPath, statuses);
    const snapshot = await loadAnalysisState(projectPath);
    if (Array.isArray(snapshot.consistency?.issues)) {
      await saveAnalysisState(projectPath, {
        consistency: {
          ...snapshot.consistency,
          issues: snapshot.consistency.issues.map((issue) => (issue.id === issueId ? { ...issue, status, statusUpdatedAt: statuses[issueId].updatedAt } : issue)),
        },
      });
    }
    return { issueId, status, updatedAt: statuses[issueId].updatedAt };
  });

  registerIpcHandler("knowledge:list", async () => {
    const projectPath = await ensureCurrentProject();
    return { items: await listKnowledgeItems(projectPath) };
  });

  registerIpcHandler("knowledge:update", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return updateKnowledgeItems(projectPath, payload?.items || []);
  });

  registerIpcHandler("knowledge:status", async () => {
    const projectPath = await ensureCurrentProject();
    return getKnowledgeSyncStatus(projectPath);
  });

  registerIpcHandler("knowledge:repair", async () => {
    const projectPath = await ensureCurrentProject();
    return repairKnowledgeSync(projectPath);
  });

  registerIpcHandler("maintenance:diagnostics", async () => {
    const projectPath = await ensureCurrentProject();
    return getMaintenanceDiagnostics(projectPath);
  });

  registerIpcHandler("maintenance:repair", async () => {
    const projectPath = await ensureCurrentProject();
    return repairMaintenance(projectPath);
  });

  registerIpcHandler("project:health", async () => {
    const projectPath = await ensureCurrentProject();
    return inspectProjectHealth(projectPath);
  });

  registerIpcHandler("project:repair-health", async () => {
    const projectPath = await ensureCurrentProject();
    return repairProjectHealth(projectPath);
  });

  registerIpcHandler("story:get-overview", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return getStoryOverviewForProject(projectPath, payload || {});
  });

  registerIpcHandler("story:analyze-local", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const requestedIds = new Set((payload?.chapterIds || []).map(String));
    const chapters = config.chapters.filter((chapter) => !requestedIds.size || requestedIds.has(chapter.id));
    for (const chapter of chapters) await refreshLocalStoryState(projectPath, chapter.id);
    return getStoryOverviewForProject(projectPath, payload || {});
  });

  registerIpcHandler("story:update-fact", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return storyState.updateFact(projectPath, String(payload?.factId || ""), payload?.patch || {});
  });

  registerIpcHandler("story:create-fact", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const chapter = config.chapters.find((item) => item.id === payload?.chapterId);
    if (!chapter) throw new Error("请选择要关联的章节或大纲文档。");
    return storyState.createManualFact(projectPath, { ...payload, chapterTitle: chapter.title, volume: chapter.volume || "未分卷" });
  });

  registerIpcHandler("story:delete-fact", async (_event, factId) => {
    const projectPath = await ensureCurrentProject();
    return storyState.deleteFact(projectPath, String(factId || ""));
  });

  registerIpcHandler("story:update-foreshadow", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return storyState.updateForeshadow(projectPath, String(payload?.foreshadowId || ""), payload?.patch || {});
  });

  registerIpcHandler("story:create-foreshadow", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const chapter = config.chapters.find((item) => item.id === payload?.chapterId);
    if (!chapter) throw new Error("请选择伏笔首次埋下的章节或大纲文档。");
    return storyState.createManualForeshadow(projectPath, { ...payload, chapterTitle: chapter.title, volume: chapter.volume || "未分卷" });
  });

  registerIpcHandler("story:delete-foreshadow", async (_event, foreshadowId) => {
    const projectPath = await ensureCurrentProject();
    return storyState.deleteForeshadow(projectPath, String(foreshadowId || ""));
  });

  registerIpcHandler("story:get-board", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    return { board: await storyState.getBoard(projectPath, String(chapterId || "")) };
  });

  registerIpcHandler("story:list-boards", async () => {
    const projectPath = await ensureCurrentProject();
    return { boards: await storyState.listBoards(projectPath) };
  });

  registerIpcHandler("story:generate-board", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const ordered = config.chapters.slice().sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((chapter) => chapter.id === payload?.chapterId);
    const chapter = ordered[index];
    if (!chapter) throw new Error("没有找到要生成筹备板的章节。");
    return { board: await storyState.generateLocalBoard(projectPath, chapter, ordered[index + 1] || null) };
  });

  registerIpcHandler("story:save-board", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return { board: await storyState.saveBoard(projectPath, payload?.board || {}) };
  });

  registerIpcHandler("workspace:get", async () => {
    const projectPath = await ensureCurrentProject();
    return getCreativeWorkspaceView(projectPath);
  });

  registerIpcHandler("novel-network:preview-import", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const folder = payload?.mode === "folder";
    const selected = await dialog.showOpenDialog(state.mainWindow, {
      title: folder ? "选择小说网资料目录" : "选择小说网资料（可多选分册）",
      properties: folder ? ["openDirectory"] : ["openFile", "multiSelections"],
      filters: folder ? undefined : [{ name: "小说统筹资料", extensions: ["md", "markdown", "docx", "json"] }],
    });
    if (selected.canceled || !selected.filePaths.length) return { canceled: true };
    const files = folder ? (await fs.readdir(selected.filePaths[0], { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.(md|markdown|docx|json)$/i.test(entry.name)).map((entry) => path.join(selected.filePaths[0], entry.name)).sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true })) : selected.filePaths;
    const preview = await novelNetworkImport.readImportFiles(files);
    const token = crypto.randomUUID();
    state.pendingNovelNetworkImports.clear();
    state.pendingNovelNetworkImports.set(token, { projectPath, network: preview.network, expiresAt: Date.now() + 10 * 60 * 1000 });
    return { ...preview, token };
  });

  registerIpcHandler("novel-network:import", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const preview = state.pendingNovelNetworkImports.get(String(payload?.token || ""));
    if (!preview || preview.projectPath !== projectPath || preview.expiresAt < Date.now()) throw new Error("小说网导入预览已失效，请重新选择资料。");
    const result = await withProjectTransaction(projectPath, async () => {
      let network = preview.network;
      let duplicates = 0;
      if (payload?.targetId) {
        const workspace = await creativeWorkspace.loadWorkspace(projectPath);
        const current = workspace.novelNetworks.find((item) => item.id === payload.targetId);
        if (!current || current.revision !== payload.expectedRevision) throw new Error("当前小说网版本已变化，请重新读取后追加。");
        const merged = novelNetworkImport.mergeNetworks(current, network);
        network = merged.network;
        duplicates = merged.duplicates;
      } else network = { ...network, title: String(payload?.title || network.title) };
      const item = await creativeWorkspace.upsertItem(projectPath, "novelNetworks", network);
      return { network: item, duplicates, workspace: await getCreativeWorkspaceView(projectPath) };
    });
    state.pendingNovelNetworkImports.delete(String(payload.token));
    return result;
  });

  registerIpcHandler("novel-network:save", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const network = await creativeWorkspace.upsertItem(projectPath, "novelNetworks", payload?.network || {});
    return { network, workspace: await getCreativeWorkspaceView(projectPath) };
  });

  registerIpcHandler("novel-network:delete", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
      const workspace = await creativeWorkspace.loadWorkspace(projectPath);
      const network = workspace.novelNetworks.find((item) => item.id === payload?.id);
      if (!network || network.revision !== payload?.expectedRevision) throw new Error("小说网版本已变化，请重新读取后删除。");
      await creativeWorkspace.deleteItem(projectPath, "novelNetworks", network.id);
      return { workspace: await getCreativeWorkspaceView(projectPath) };
    });
  });

  registerIpcHandler("novel-network:export", async (_event, payload) => {
    await ensureCurrentProject();
    const network = normalizeNetwork(payload?.network);
    const exportName = network.title.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 100) || "未命名";
    const selected = await dialog.showSaveDialog(state.mainWindow, { title: "导出小说网", defaultPath: `小说网_${exportName}.json`, filters: [{ name: "小说网JSON", extensions: ["json"] }] });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    await writeFileAtomic(selected.filePath, JSON.stringify({ schema: "novel-network/v1", network }, null, 2));
    return { filePath: selected.filePath };
  });

  registerIpcHandler("workspace:upsert", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const item = await creativeWorkspace.upsertItem(projectPath, String(payload?.collection || ""), payload?.item || {});
    return { item, workspace: await getCreativeWorkspaceView(projectPath) };
  });

  registerIpcHandler("workspace:delete", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    await creativeWorkspace.deleteItem(projectPath, String(payload?.collection || ""), String(payload?.itemId || ""));
    return { workspace: await getCreativeWorkspaceView(projectPath) };
  });

  registerIpcHandler("workspace:reorder-scenes", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const scenes = await creativeWorkspace.reorderScenes(projectPath, String(payload?.chapterId || ""), payload?.sceneIds || []);
    return { scenes, workspace: await getCreativeWorkspaceView(projectPath) };
  });

  registerIpcHandler("workspace:rebuild-causality", async () => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const overview = await storyState.getStoryOverview(projectPath, { projectChapters: config.chapters, factLimit: 2000, characterLimit: 500, foreshadowLimit: 1000 });
    const chapterOrder = Object.fromEntries(config.chapters.map((chapter) => [chapter.id, chapter.order]));
    const result = await creativeWorkspace.rebuildCausality(projectPath, { facts: overview.facts, foreshadows: overview.foreshadows, chapterOrder });
    return { ...result, workspace: await getCreativeWorkspaceView(projectPath) };
  });

  registerIpcHandler("workspace:generate-arcs", async () => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const overview = await storyState.getStoryOverview(projectPath, { projectChapters: config.chapters, characterLimit: 500 });
    const arcs = await creativeWorkspace.generateArcs(projectPath, overview.characterStates);
    return { arcs, workspace: await getCreativeWorkspaceView(projectPath) };
  });

  registerIpcHandler("workspace:quality", async () => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const overview = await storyState.getStoryOverview(projectPath, { projectChapters: config.chapters, factLimit: 2000, characterLimit: 500, foreshadowLimit: 1000 });
    const workspace = await creativeWorkspace.loadWorkspace(projectPath);
    return { reports: creativeWorkspace.qualityReport(workspace, config.chapters, overview), generatedAt: nowIso() };
  });

  registerIpcHandler("workspace:statistics", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return buildCreativeStatistics(projectPath, String(payload?.label || ""));
  });

  registerIpcHandler("agent:prepare", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return prepareCreativeAgentRun(projectPath, payload || {});
  });

  registerIpcHandler("agent:execute", async (_event, runId) => {
    const projectPath = await ensureCurrentProject();
    return queueCreativeAgentRun(projectPath, String(runId || ""));
  });

  registerIpcHandler("agent:retry-tool", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return queueCreativeAgentRun(projectPath, String(payload?.runId || ""), String(payload?.tool || ""));
  });

  registerIpcHandler("revision:create", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return createSafeRevision(projectPath, payload || {});
  });

  registerIpcHandler("revision:apply", async (_event, revisionId) => {
    const projectPath = await ensureCurrentProject();
    return withJournalOperation(projectPath, { type: "safe-revision-apply", title: "应用安全修订", targetIds: [revisionId], recoverable: true },
      () => applySafeRevision(projectPath, String(revisionId || "")),
      (result) => ({ chapterId: result.revision.chapterId, revisionId: result.revision.id }));
  });

  registerIpcHandler("revision:apply-part", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withJournalOperation(projectPath, { type: "safe-revision-apply-part", title: "局部应用安全修订", targetIds: [String(payload?.revisionId || "")], recoverable: true },
      () => applySafeRevisionPart(projectPath, payload || {}),
      (result) => ({ chapterId: result.revision.chapterId, revisionId: result.revision.id }));
  });

  registerIpcHandler("revision:update-status", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const workspace = await creativeWorkspace.loadWorkspace(projectPath);
    const revision = workspace.revisions.find((item) => item.id === payload?.revisionId);
    if (!revision) throw new Error("没有找到这条修订建议。");
    const status = ["已拒绝", "已失效"].includes(payload?.status) ? payload.status : "已拒绝";
    const item = await creativeWorkspace.upsertItem(projectPath, "revisions", { ...revision, status });
    return { item, workspace: await getCreativeWorkspaceView(projectPath) };
  });

  registerIpcHandler("tasks:list", async () => {
    const projectPath = await ensureCurrentProject();
    return (await getProjectTaskCenter(projectPath)).list();
  });

  registerIpcHandler("tasks:enqueue", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const allowedTypes = new Set(["story-analysis", "creative-board", "consistency-check", "timeline-analysis", "knowledge-rebuild", "snapshot", "creative-statistics"]);
    if (!allowedTypes.has(payload?.type)) throw new Error("不支持的后台任务类型。");
    return { task: await (await getProjectTaskCenter(projectPath)).enqueue(payload || {}) };
  });

  registerIpcHandler("tasks:cancel", async (_event, taskId) => {
    const projectPath = await ensureCurrentProject();
    return (await getProjectTaskCenter(projectPath)).cancel(String(taskId || ""));
  });

  registerIpcHandler("tasks:pause", async (_event, taskId) => {
    const projectPath = await ensureCurrentProject();
    return (await getProjectTaskCenter(projectPath)).pause(String(taskId || ""));
  });

  registerIpcHandler("tasks:resume", async (_event, taskId) => {
    const projectPath = await ensureCurrentProject();
    return (await getProjectTaskCenter(projectPath)).resume(String(taskId || ""));
  });

  registerIpcHandler("tasks:retry", async (_event, taskId) => {
    const projectPath = await ensureCurrentProject();
    return { task: await (await getProjectTaskCenter(projectPath)).retry(String(taskId || "")) };
  });

  registerIpcHandler("tasks:remove", async (_event, taskId) => {
    const projectPath = await ensureCurrentProject();
    return (await getProjectTaskCenter(projectPath)).remove(String(taskId || ""));
  });

  registerIpcHandler("tasks:clear-history", async () => {
    const projectPath = await ensureCurrentProject();
    return (await getProjectTaskCenter(projectPath)).clearHistory();
  });

  registerIpcHandler("snapshots:list", async () => {
    const projectPath = await ensureCurrentProject();
    return projectSnapshots.listSnapshots(projectPath);
  });

  registerIpcHandler("snapshots:create", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return { snapshot: await projectSnapshots.createSnapshot(projectPath, payload || {}) };
  });

  registerIpcHandler("snapshots:compare", async (_event, snapshotId) => {
    const projectPath = await ensureCurrentProject();
    return projectSnapshots.compareSnapshot(projectPath, String(snapshotId || ""));
  });

  registerIpcHandler("snapshots:restore", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const result = await projectSnapshots.restoreSnapshot(projectPath, String(payload?.snapshotId || ""), { paths: payload?.paths || [] });
    const task = await queueKnowledgeRebuildAfterRestore(projectPath, `恢复快照：${result.snapshot.name}`);
    return { ...result, task, state: await buildAppState(projectPath) };
  });

  registerIpcHandler("snapshots:rename", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return { snapshot: await projectSnapshots.renameSnapshot(projectPath, String(payload?.snapshotId || ""), String(payload?.name || "")) };
  });

  registerIpcHandler("snapshots:delete", async (_event, snapshotId) => {
    const projectPath = await ensureCurrentProject();
    const activeSnapshotTask = (await (await getProjectTaskCenter(projectPath)).list()).tasks.some((task) => task.type === "snapshot" && ["等待中", "运行中", "正在停止", "已暂停"].includes(task.status));
    if (activeSnapshotTask) throw new Error("项目快照仍在创建中，请等待任务完成后再删除。");
    return projectSnapshots.deleteSnapshot(projectPath, String(snapshotId || ""));
  });

  registerIpcHandler("snapshots:cleanup", async () => {
    const projectPath = await ensureCurrentProject();
    const activeSnapshotTask = (await (await getProjectTaskCenter(projectPath)).list()).tasks.some((task) => task.type === "snapshot" && ["等待中", "运行中", "正在停止", "已暂停"].includes(task.status));
    if (activeSnapshotTask) throw new Error("项目快照仍在创建中，请等待任务完成后再清理。");
    return projectSnapshots.garbageCollectObjects(projectPath);
  });

  registerIpcHandler("snapshots:create-branch", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return projectSnapshots.createBranch(projectPath, String(payload?.name || "实验分支"), String(payload?.snapshotId || ""));
  });

  registerIpcHandler("snapshots:switch-branch", async (_event, branchId) => {
    const projectPath = await ensureCurrentProject();
    const result = await projectSnapshots.switchBranch(projectPath, String(branchId || ""));
    const task = result.restored ? await queueKnowledgeRebuildAfterRestore(projectPath, `切换分支：${result.activeBranch.name}`) : null;
    return { ...result, task, state: await buildAppState(projectPath) };
  });

  registerIpcHandler("snapshots:delete-branch", async (_event, branchId) => {
    const projectPath = await ensureCurrentProject();
    return projectSnapshots.deleteBranch(projectPath, String(branchId || ""));
  });

  registerIpcHandler("experiments:appearance-stats", async () => {
    const projectPath = await ensureCurrentProject();
    return buildAppearanceStats(projectPath);
  });

  registerIpcHandler("experiments:world-map", async () => {
    const projectPath = await ensureCurrentProject();
    return buildWorldMap(projectPath);
  });

  registerIpcHandler("materials:list", async () => {
    const projectPath = await ensureCurrentProject();
    return { materials: await loadMaterials(projectPath) };
  });

  registerIpcHandler("materials:save", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const item = await saveMaterial(projectPath, payload || {});
    return { material: item, materials: await loadMaterials(projectPath) };
  });

  registerIpcHandler("materials:delete", async (_event, materialId) => {
    const projectPath = await ensureCurrentProject();
    await deleteMaterial(projectPath, String(materialId || ""));
    return { materials: await loadMaterials(projectPath) };
  });

  registerIpcHandler("ai:creative-advice", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const result = await buildCreativeAdvice(projectPath, payload || {});
    await saveAnalysisState(projectPath, {
      creativeAdvice: result,
      creativeOptions: {
        mode: result.mode,
        chapterId: result.chapterId,
        focus: String(payload?.focus || "").trim(),
        contextIds: Array.isArray(payload?.contextIds) ? payload.contextIds.map(String).slice(0, 60) : [],
      },
    });
    return result;
  });

  registerIpcHandler("chapter:create", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
    const config = await loadConfig(projectPath);
    const order = config.chapters.length;
    const title = payload?.title?.trim() || `第${order + 1}章 新章节`;
    const chapterDir = path.join(projectPath, "chapters");
    await ensureDir(chapterDir);
    const fileName = await uniqueChapterFileName(projectPath, config, `chapter_${String(order + 1).padStart(3, "0")}_${title}`, ".md");
    const chapter = {
      id: makeId("chapter"),
      title,
      volume: payload?.volume || "卷一",
      order,
      fileName,
      wordCount: 0,
      knowledgeRole: "正文",
      outline: [{ id: `0_${title}`, level: 1, title, line: 0 }],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    config.chapters.push(chapter);
    await writeProjectFiles(projectPath, [{ path: getChapterPath(projectPath, chapter), content: `# ${title}\n\n` }, { path: getConfigPath(projectPath), content: JSON.stringify(config, null, 2) }]);
    return buildAppState(projectPath, chapter.id);
      });
  });

  registerIpcHandler("chapter:load", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    return loadChapterContent(projectPath, chapterId);
  });

  registerIpcHandler("chapter:save", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withJournalOperation(projectPath, {
      type: "chapter-save", title: "保存章节", targetIds: [payload?.chapterId], recoverable: true,
      metadata: { expectedRevision: String(payload?.expectedRevision || "").slice(0, 128) },
    }, () => saveChapterContent(projectPath, payload),
    (result) => ({ chapterId: result.chapter.id, revision: result.revision, chunks: result.indexResult.chunks }));
  });

  registerIpcHandler("chapter:delete", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
    const config = await loadConfig(projectPath);
    const chapter = config.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在，无法删除。");
    const deepAnalysisKey = `${projectPath}\u0000${chapterId}`;
    if (state.deepAnalysisTimers.has(deepAnalysisKey)) {
      clearTimeout(state.deepAnalysisTimers.get(deepAnalysisKey));
      state.deepAnalysisTimers.delete(deepAnalysisKey);
    }
    if (config.chapters.length <= 1) throw new Error("至少需要保留一个章节。");
    const hasOtherChapterUsingFile = config.chapters.some(
      (item) => item.id !== chapterId && normalizeChapterFileName(item.fileName) === normalizeChapterFileName(chapter.fileName),
    );
    config.chapters = config.chapters.filter((item) => item.id !== chapterId).map((item, index) => ({ ...item, order: index }));
    await calculateTotalWords(projectPath, config);
    await writeProjectFiles(projectPath, [
      ...(!hasOtherChapterUsingFile ? [{ path: getChapterPath(projectPath, chapter), content: null }] : []),
      { path: getConfigPath(projectPath), content: JSON.stringify(config, null, 2) },
    ]);
    await removeSourceFromIndex(projectPath, chapterId).catch(() => null);
    await storyState.removeChapterLedger(projectPath, chapterId).catch(() => null);
    await creativeWorkspace.removeChapterReferences(projectPath, chapterId).catch(() => null);
    return buildAppState(projectPath, config.chapters[0]?.id);
      });
  });

  registerIpcHandler("chapter:export-docx", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const chapter = config.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在，无法导出。");
    const result = await dialog.showSaveDialog(state.mainWindow, {
      title: "导出当前章节为 Word 文档",
      defaultPath: path.join(projectPath, `${sanitizeFileName(chapter.title)}.docx`),
      filters: [{ name: "Word 文档", extensions: ["docx"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const filePath = await exportChapterToDocx(projectPath, chapter, result.filePath);
    return { filePath };
  });

  registerIpcHandler("chapter:open-original", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const chapter = config.chapters.find((item) => item.id === chapterId);
    const originalPath = getOriginalDocumentPath(projectPath, chapter);
    if (!originalPath || !existsSync(originalPath)) {
      return { error: "这个条目没有保留的 Word 原文档。" };
    }
    const error = await shell.openPath(originalPath);
    return error ? { filePath: originalPath, error } : { filePath: originalPath };
  });

  registerIpcHandler("chapter:refresh-original", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return refreshChapterFromOriginalDocument(projectPath, typeof payload === "string" ? payload : String(payload?.chapterId || ""), String(payload?.expectedRevision || ""));
  });

  registerIpcHandler("chapter:list-versions", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    return { versions: await listChapterVersions(projectPath, chapterId) };
  });

  registerIpcHandler("chapter:compare-version", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return compareChapterVersion(projectPath, String(payload?.chapterId || ""), String(payload?.versionId || ""));
  });

  registerIpcHandler("chapter:restore-version", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return restoreChapterVersion(projectPath, String(payload?.chapterId || ""), String(payload?.versionId || ""), String(payload?.expectedRevision || ""));
  });

  registerIpcHandler("chapter:reorder", async (_event, chapterIds) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
    return withJournalOperation(projectPath, { type: "chapter-reorder", title: "调整目录顺序", targetIds: chapterIds, recoverable: true }, async () => {
    const config = await loadConfig(projectPath);
    const idOrder = new Map(chapterIds.map((id, index) => [id, index]));
    config.chapters = config.chapters
      .slice()
      .sort((a, b) => (idOrder.get(a.id) ?? a.order) - (idOrder.get(b.id) ?? b.order))
      .map((item, index) => ({ ...item, order: index }));
    await saveConfig(projectPath, config);
    return { chapters: config.chapters };
    }, (result) => ({ count: result.chapters.length }));
      });
  });

  registerIpcHandler("chapter:move-to-volume", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
    return withJournalOperation(projectPath, { type: "chapter-move", title: "移动目录文档", targetIds: [payload?.chapterId], recoverable: true, metadata: { volume: String(payload?.volume || "") } }, async () => {
    const config = await loadConfig(projectPath);
    const chapterId = String(payload?.chapterId || "");
    const targetVolume = String(payload?.volume || "未分卷").trim() || "未分卷";
    const beforeChapterId = String(payload?.beforeChapterId || "");
    const chapter = config.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("文档不存在，无法移动。");

    const ordered = config.chapters.slice().sort((a, b) => a.order - b.order);
    const moving = { ...chapter, volume: targetVolume, updatedAt: nowIso() };
    const rest = ordered.filter((item) => item.id !== chapterId);
    let insertIndex = -1;
    if (beforeChapterId && beforeChapterId !== chapterId) {
      insertIndex = rest.findIndex((item) => item.id === beforeChapterId);
    }
    if (insertIndex < 0) {
      const lastInVolume = rest.reduce((last, item, index) => ((item.volume || "未分卷") === targetVolume ? index : last), -1);
      insertIndex = lastInVolume >= 0 ? lastInVolume + 1 : rest.length;
    }
    rest.splice(insertIndex, 0, moving);
    config.chapters = rest.map((item, index) => ({ ...item, order: index }));
    await saveConfig(projectPath, config);
    return buildAppState(projectPath, chapterId);
    }, (result) => ({ chapterId: result.selectedChapter?.id || "" }));
      });
  });

  registerIpcHandler("chapter:set-progress", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
    return withJournalOperation(projectPath, { type: "chapter-progress", title: "更新章节进度", recoverable: false, metadata: { count: Array.isArray(payload?.updates) ? payload.updates.length : 0 } }, async () => {
      const config = await loadConfig(projectPath);
      const allowed = ["计划中", "写作中", "已完成", "暂缓"];
      const updates = Array.isArray(payload?.updates) ? payload.updates : [];
      const touched = [];
      for (const update of updates) {
        const chapter = config.chapters.find((item) => item.id === String(update?.chapterId || ""));
        if (!chapter) continue;
        if (update.status === null || update.status === "") {
          delete chapter.progressStatus;
        } else if (allowed.includes(update.status)) {
          chapter.progressStatus = update.status;
        }
        if (typeof update.note === "string") {
          const note = update.note.trim();
          if (note) chapter.progressNote = note;
          else delete chapter.progressNote;
        }
        if (update.hidden === true) chapter.progressHidden = true;
        else if (update.hidden === false) delete chapter.progressHidden;
        chapter.updatedAt = nowIso();
        touched.push(chapter.id);
      }
      if (!touched.length) throw new Error("没有找到要更新的文档。");
      await saveConfig(projectPath, config);
      return buildAppState(projectPath, String(payload?.selectedChapterId || touched[0] || ""));
    });
      });
  });

  registerIpcHandler("character:save", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
    const characters = await loadCharacters(projectPath);
    const previous = payload.id ? characters.find((item) => item.id === payload.id) : null;
    const fileName = await uniqueContentFileName(projectPath, "characters", payload.name || payload.id || "未命名角色", ".json", previous?.fileName || "");
    const card = {
      id: payload.id || makeId("character"),
      name: payload.name || "未命名角色",
      category: normalizeCategory(payload.category),
      appearance: payload.appearance || "",
      personality: payload.personality || "",
      background: payload.background || "",
      relationships: payload.relationships || "",
      notes: payload.notes || "",
      fileName,
      updatedAt: nowIso(),
    };
    const nextPath = getCharacterPath(projectPath, card);
    await writeJson(nextPath, card);
    // A rename only removes the old card after its replacement is durable.
    if (previous?.fileName && path.basename(nextPath) !== normalizeManagedFileName(previous.fileName, ".json")) {
      await fs.rm(getCharacterPath(projectPath, previous), { force: true });
    }
    await indexSource(projectPath, {
      id: card.id,
      type: "character",
      title: card.name,
      content: characterToMarkdown(card),
    });
    return buildAppState(projectPath);
      });
  });

  registerIpcHandler("character:delete", async (_event, characterId) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
    const characters = await loadCharacters(projectPath);
    const card = characters.find((item) => item.id === characterId);
    if (card) await fs.rm(getCharacterPath(projectPath, card), { force: true });
    await removeSourceFromIndex(projectPath, characterId);
    return buildAppState(projectPath);
      });
  });

  registerIpcHandler("world:save", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
    const title = payload.title || "未命名设定";
    const worldDocs = await loadWorldDocs(projectPath);
    const previous = payload.id ? worldDocs.find((item) => item.id === payload.id) : null;
    const fileName = previous?.fileName || (await uniqueContentFileName(projectPath, "worldbuilding", title, ".md"));
    const doc = {
      id: previous?.id || fileName.replace(/\.md$/i, ""),
      title,
      category: normalizeCategory(payload.category),
      fileName,
      content: payload.content || "",
      updatedAt: nowIso(),
    };
    await writeWorldDoc(projectPath, doc);
    await indexSource(projectPath, {
      id: doc.id,
      type: "world",
      title: doc.title,
      content: doc.content,
    });
    return buildAppState(projectPath);
      });
  });

  registerIpcHandler("world:delete", async (_event, docId) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
    const worldDocs = await loadWorldDocs(projectPath);
    const doc = worldDocs.find((item) => item.id === docId);
    if (doc) await fs.rm(getWorldDocPath(projectPath, doc), { force: true });
    await removeSourceFromIndex(projectPath, docId);
    return buildAppState(projectPath);
      });
  });

  registerIpcHandler("ai:generate-characters", async () => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    if (config.agent?.snapshotBeforeBulkChanges !== false) {
      await projectSnapshots.createSnapshot(projectPath, { name: "AI 生成角色卡前", reason: "批量更新角色卡前自动保存" });
    }
    return generateCharactersFromOutline(projectPath);
  });

  registerIpcHandler("ai:generate-world", async () => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    if (config.agent?.snapshotBeforeBulkChanges !== false) {
      await projectSnapshots.createSnapshot(projectPath, { name: "AI 生成世界观前", reason: "批量更新世界观前自动保存" });
    }
    return generateWorldDocsFromOutline(projectPath);
  });

  registerIpcHandler("ai:extract-world-cards", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return prepareWorldCardCandidates(projectPath, payload || {});
  });

  registerIpcHandler("ai:save-world-card-candidates", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    if (config.agent?.snapshotBeforeBulkChanges !== false && (payload?.candidates || []).length > 1) {
      await projectSnapshots.createSnapshot(projectPath, { name: "写入设定候选前", reason: "批量写入世界观候选前自动保存" });
    }
    return saveWorldCardCandidates(projectPath, payload?.candidates || []);
  });

  registerIpcHandler("ai:edit-selection", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const action = String(payload?.action || "润色");
    const text = String(payload?.text || "").trim();
    if (!text) throw new Error("请先选中一段文字。");
    const actionPrompts = {
      改写: "在不改变核心含义的前提下，改写得更自然、更适合小说正文。",
      润色: "润色语言，使节奏、措辞和画面感更好。",
      扩写: "扩写细节，增加动作、感官和情绪，但不要偏离原意。",
      总结: "总结这段文字的剧情作用、关键信息和可改进点。",
    };
    const systemPrompt = `你是小说写作助手。${actionPrompts[action] || actionPrompts.润色}只输出结果，不要解释。`;
    const answer = await callChatApi(config, systemPrompt, `【原文】\n${text}`, []);
    return { answer };
  });

  registerIpcHandler("ai:ask", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const question = String(payload.question || "").trim();
    if (!question) throw new Error("请输入要询问 AI 的内容。");
    const requestId = String(payload?.requestId || makeId("ai_stream"));
    state.activeAiRequests.get(requestId)?.abort();
    const requestController = new AbortController();
    state.activeAiRequests.set(requestId, requestController);
    sendRendererEvent("ai:stream", { requestId, type: "phase", phase: "正在规划检索范围" });
    let retrievalPackage;
    try {
      retrievalPackage = await buildChatRetrievalPackage(projectPath, config, payload || {}, question);
    } catch (error) {
      state.activeAiRequests.delete(requestId);
      throw error;
    }
    const { search, materials, retrieval, inventorySummary } = retrievalPackage;
    sendRendererEvent("ai:stream", { requestId, type: "retrieval", phase: "检索完成，正在生成", retrieval });
    const analysisState = await loadAnalysisState(projectPath);
    const projectMemory = buildProjectMemorySummary(analysisState, payload.projectMemory || "");
    const systemPrompt = buildSystemPrompt({
      ...materials,
      projectMemory,
      userQuestion: question,
      selectedText: payload.selectedText || "",
      retrieval,
      inventorySummary,
    });

    let streamedChars = 0;
    let partialAnswer = "";
    let lastCheckpointAt = 0;
    let lastCheckpointChars = 0;
    const saveStreamCheckpoint = (status = "streaming") =>
      saveAnalysisState(projectPath, {
        aiStreamRecovery: { requestId, question, answer: partialAnswer, status, updatedAt: nowIso() },
      });
    try {
      const answer = await callChatApi(config, systemPrompt, question, payload.history || [], {
        stream: true,
        signal: requestController.signal,
        onToken: (token) => {
          const text = String(token || "");
          streamedChars += text.length;
          partialAnswer += text;
          sendRendererEvent("ai:stream", { requestId, type: "chunk", text: token, streamedChars });
          const now = Date.now();
          if (now - lastCheckpointAt >= 1800 || partialAnswer.length - lastCheckpointChars >= 2400) {
            lastCheckpointAt = now;
            lastCheckpointChars = partialAnswer.length;
            void saveStreamCheckpoint("streaming").catch(() => null);
          }
        },
      });
      partialAnswer = answer;
      await saveStreamCheckpoint(requestController.signal.aborted ? "interrupted" : "completed").catch(() => null);
      sendRendererEvent("ai:stream", { requestId, type: "done", phase: requestController.signal.aborted ? "已停止，内容已保留" : "生成完成", stopped: Boolean(requestController.signal.aborted), streamedChars });
      return {
        answer,
        context: contextFromChunks(search.chunks),
        retrieval,
        contextCount: search.chunks.length,
        candidateCount: search.candidateCount || search.chunks.length,
        scannedCount: search.scannedCount || search.candidateCount || search.chunks.length,
        embeddingSource: search.embeddingSource,
        embeddingWarning: search.embeddingWarning,
        streamedChars,
      };
    } catch (error) {
      if (partialAnswer) await saveStreamCheckpoint("interrupted").catch(() => null);
      sendRendererEvent("ai:stream", { requestId, type: "error", phase: "生成中断，已保留收到的内容", error: error.message || String(error) });
      return {
        answer: `我已经完成本地检索，但暂时没有成功连接到大模型接口。\n\n${error.message}\n\n你可以先查看下方“引用片段”，确认知识库是否已经索引成功。配置接口后再次提问即可获得模型回答。`,
        context: contextFromChunks(search.chunks),
        retrieval,
        contextCount: search.chunks.length,
        candidateCount: search.candidateCount || search.chunks.length,
        scannedCount: search.scannedCount || search.candidateCount || search.chunks.length,
        embeddingSource: search.embeddingSource,
        embeddingWarning: search.embeddingWarning,
        apiError: error.message,
      };
    } finally {
      state.activeAiRequests.delete(requestId);
    }
  });

  registerIpcHandler("ai:cancel", async (_event, requestId) => {
    const id = String(requestId || "");
    const controller = state.activeAiRequests.get(id);
    if (!controller) return { canceled: false };
    controller.abort(new Error("user-canceled"));
    return { canceled: true };
  });

  registerIpcHandler("index:rebuild", async () => {
    const projectPath = await ensureCurrentProject();
    const result = await rebuildIndex(projectPath);
    return { ...result, state: await buildAppState(projectPath) };
  });

  // 启动期契约自检：实际注册通道 vs shared/contracts/ipc-channels.cjs。
  verifyIpcContract({
    registered: state.registeredIpcChannels,
    contractChannels: channelsRequiringHandler(),
    testMode: process.env.NOVEL_PLATFORM_TEST === "1",
  });
}


// Every project read-modify-write operation shares the process and file lock.

const __moduleExports = {
  registerIpcHandler,
  registerIpcHandlers,
};

// Augment the original exports object so cyclic requires (whose captured
// reference may be a Proxy over the pre-assignment exports) see every key.
Object.assign(module.exports, __moduleExports);
module.exports = __moduleExports;
