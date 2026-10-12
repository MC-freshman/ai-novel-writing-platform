"use strict";
const { registerIpcHandler } = require("../register.cjs");
const {
  activateProjectSession,
  buildAppState,
  calculateTotalWords,
  configFromRenderer,
  createBackup,
  dialog,
  ensureCurrentProject,
  ensureProjectStructure,
  exportBookDocumentsToDirectory,
  exportProjectExchange,
  getProjectTaskCenter,
  importDocumentIntoProject,
  importProjectExchange,
  indexSources,
  inspectProjectHealth,
  loadConfig,
  path,
  previewProjectExchange,
  projectSnapshots,
  repairProjectHealth,
  sanitizeFileName,
  saveConfig,
  saveCredentialSecrets,
  sendRendererEvent,
  state,
  withJournalOperation,
  withProjectTransaction,
} = require("../dependencies.cjs");

function registerDomain() {
  registerIpcHandler("project:create", async (_event, payload) => {
    const result = await dialog.showOpenDialog(state.mainWindow, {
      title: "选择新小说项目保存位置",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const title = payload?.title?.trim() || "新小说项目";
    state.currentProjectPath = path.join(
      result.filePaths[0],
      sanitizeFileName(title),
    );
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
        title: targetVolume
          ? `导入一个或多个文档到「${targetVolume}」`
          : "导入一个或多个文档为章节",
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
      if (
        result.filePaths.length > 1 &&
        config.agent?.snapshotBeforeBulkChanges !== false
      ) {
        sendRendererEvent("import:progress", {
          active: true,
          phase: "创建导入前快照",
          current: 0,
          total: result.filePaths.length,
          fileName: "正在保护当前项目",
          cancellable: false,
        });
        await projectSnapshots.createSnapshot(projectPath, {
          name: "批量导入前",
          reason: `导入 ${result.filePaths.length} 个文档前自动保存`,
        });
      }
      sendRendererEvent("import:progress", {
        active: true,
        phase: "导入文档",
        current: 0,
        total: result.filePaths.length,
        fileName: "",
        cancellable: true,
      });
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
          const importedItems = await withJournalOperation(
            projectPath,
            {
              type: "document-import",
              title: `导入文档：${path.basename(filePath)}`,
              targetIds: [],
              recoverable: true,
              metadata: {
                fileName: path.basename(filePath),
                targetVolume: targetVolume || "导入文档",
              },
            },
            () =>
              importDocumentIntoProject(projectPath, filePath, {
                volume: targetVolume || "导入文档",
                config,
                skipFinalize: true,
              }),
            (items) => ({
              importedChapterIds: items.map((item) => item.chapter.id),
            }),
          );
          imported.push(...importedItems);
        } catch (error) {
          failures.push({ filePath, message: error.message || String(error) });
        }
      }
      if (!imported.length && failures.length) {
        throw new Error(
          `导入失败：${failures.map((item) => `${path.basename(item.filePath)}：${item.message}`).join("；")}`,
        );
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
            title:
              imported.length === 1
                ? `整理导入文档：${imported[0].chapter.title}`
                : `整理 ${imported.length} 份导入文档的创作状态`,
            total: imported.length,
            scope: { chapterIds: imported.map((item) => item.chapter.id) },
            options: { useAI: false, automatic: true, source: "import" },
          });
        }
      }
      sendRendererEvent("import:progress", {
        active: false,
        phase: state.importCancelRequested ? "已取消" : "完成",
        current: imported.length,
        total: result.filePaths.length,
        fileName: "",
      });
      const appState = await buildAppState(
        projectPath,
        imported[imported.length - 1]?.chapter.id,
      );
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
    sendRendererEvent("import:progress", {
      active: true,
      phase: "正在取消",
      current: 0,
      total: 0,
      fileName: "当前文档处理完后停止",
      cancellable: false,
    });
    return { ok: true };
  });

  registerIpcHandler("project:save-settings", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
      const config = await loadConfig(projectPath);
      const secrets = await saveCredentialSecrets(
        projectPath,
        payload?.api || {},
        config,
      );
      const nextConfig = configFromRenderer(config, payload || {});
      nextConfig.api.apiKey = secrets.chatRef;
      nextConfig.api.embeddingApiKey = secrets.embeddingRef;
      Object.defineProperty(nextConfig.api, "__chatSecret", {
        value: secrets.chat,
        configurable: true,
        writable: true,
        enumerable: false,
      });
      Object.defineProperty(nextConfig.api, "__embeddingSecret", {
        value: secrets.embedding,
        configurable: true,
        writable: true,
        enumerable: false,
      });
      await saveConfig(projectPath, nextConfig);
      return buildAppState(projectPath, payload?.selectedChapterId);
    });
  });

  registerIpcHandler("project:export-backup", async () => {
    const projectPath = await ensureCurrentProject();
    const result = await dialog.showSaveDialog(state.mainWindow, {
      title: "导出小说项目备份",
      defaultPath: path.join(
        projectPath,
        "backups",
        `backup_${Date.now()}.zip`,
      ),
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
    return withJournalOperation(
      projectPath,
      {
        type: "project-exchange-import",
        title: "导入项目交换包",
        recoverable: true,
      },
      () => importProjectExchange(projectPath, payload?.token, payload || {}),
      (result) => ({ imported: result.imported }),
    );
  });

  registerIpcHandler("project:export-book-docx", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const result = await dialog.showOpenDialog(state.mainWindow, {
      title: "选择逐篇 Word 文档的保存位置",
      defaultPath: projectPath,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    return exportBookDocumentsToDirectory(
      projectPath,
      result.filePaths[0],
      payload || {},
    );
  });

  registerIpcHandler("project:health", async () => {
    const projectPath = await ensureCurrentProject();
    return inspectProjectHealth(projectPath);
  });

  registerIpcHandler("project:repair-health", async () => {
    const projectPath = await ensureCurrentProject();
    return repairProjectHealth(projectPath);
  });
}
module.exports = { registerDomain };
