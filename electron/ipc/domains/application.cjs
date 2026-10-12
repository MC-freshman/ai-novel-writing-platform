"use strict";
const { registerIpcHandler } = require("../register.cjs");
const {
  IPC_DIRECTORY,
  buildAppState,
  checkForAppUpdate,
  downloadAndOpenAppUpdate,
  ensureCurrentProject,
  loadConfig,
  operationJournal,
  path,
  releasePrivacy,
  state,
} = require("../dependencies.cjs");

function registerDomain() {
  registerIpcHandler("app:get-state", async () => {
    const projectPath = await ensureCurrentProject();
    return buildAppState(projectPath);
  });

  registerIpcHandler("app:check-update", async () => checkForAppUpdate());

  registerIpcHandler("app:download-update", async (_event, payload) =>
    downloadAndOpenAppUpdate(
      String(payload?.url || ""),
      String(payload?.assetName || ""),
    ),
  );

  registerIpcHandler("app:privacy-scan", async () =>
    releasePrivacy.scanReleaseInputs(path.resolve(IPC_DIRECTORY, "..")),
  );

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
    const current = await operationJournal
      .loadWindowState(projectPath)
      .catch(() => null);
    const bounds =
      state.mainWindow && !state.mainWindow.isDestroyed()
        ? state.mainWindow.getNormalBounds()
        : current?.bounds;
    return operationJournal.saveWindowState(projectPath, {
      ...(current || {}),
      ...(payload || {}),
      bounds,
      maximized:
        state.mainWindow && !state.mainWindow.isDestroyed()
          ? state.mainWindow.isMaximized()
          : current?.maximized,
    });
  });

  registerIpcHandler("operations:list", async () => {
    const projectPath = await ensureCurrentProject();
    const journal = await operationJournal.loadJournal(projectPath);
    return {
      operations: journal.operations.slice(0, 200),
      sessions: journal.sessions.slice(0, 20),
    };
  });
}
module.exports = { registerDomain };
