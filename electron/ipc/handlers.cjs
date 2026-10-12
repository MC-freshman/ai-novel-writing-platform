// IPC coordinator: one guarded registration path and domain-specific handlers.
"use strict";
const {
  assertTrustedSender,
  channelsRequiringHandler,
  ipcMain,
  log,
  state,
  verifyIpcContract,
} = require("./dependencies.cjs");
const { registerIpcHandler } = require("./register.cjs");

function registerIpcHandlers() {
  state.registeredIpcChannels.add("app:confirm-close");

  ipcMain.on("app:confirm-close", (event) => {
    try {
      assertTrustedSender(event, state.mainWindow);
    } catch (error) {
      log("ipc", "warn", "app:confirm-close", { error });
      return;
    }
    if (state.windowCloseRequestTimer)
      clearTimeout(state.windowCloseRequestTimer);
    state.windowCloseRequestTimer = null;
    state.windowCloseApproved = true;
    if (state.mainWindow && !state.mainWindow.isDestroyed())
      state.mainWindow.close();
  });

  state.registeredIpcChannels.add("app:cancel-close");

  ipcMain.on("app:cancel-close", (event) => {
    try {
      assertTrustedSender(event, state.mainWindow);
    } catch (error) {
      log("ipc", "warn", "app:cancel-close", { error });
      return;
    }
    if (state.windowCloseRequestTimer)
      clearTimeout(state.windowCloseRequestTimer);
    state.windowCloseRequestTimer = null;
  });

  require("./domains/application.cjs").registerDomain();

  require("./domains/projects.cjs").registerDomain();

  require("./domains/analysis.cjs").registerDomain();

  require("./domains/knowledge.cjs").registerDomain();

  require("./domains/story.cjs").registerDomain();

  require("./domains/workspace.cjs").registerDomain();

  require("./domains/tasks-agent.cjs").registerDomain();

  require("./domains/snapshots.cjs").registerDomain();

  require("./domains/ai-tools.cjs").registerDomain();

  require("./domains/chapters.cjs").registerDomain();

  require("./domains/entities.cjs").registerDomain();

  require("./domains/chat.cjs").registerDomain();

  // 启动期契约自检：实际注册通道 vs shared/contracts/ipc-channels.cjs。
  verifyIpcContract({
    registered: state.registeredIpcChannels,
    contractChannels: channelsRequiringHandler(),
    testMode: process.env.NOVEL_PLATFORM_TEST === "1",
  });
}

module.exports = { registerIpcHandler, registerIpcHandlers };
