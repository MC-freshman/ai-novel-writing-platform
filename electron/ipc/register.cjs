"use strict";
const {
  assertTrustedSender,
  ipcMain,
  log,
  state,
  validateIpcArguments,
} = require("./dependencies.cjs");

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
      if (durationMs >= 1000)
        log("ipc", "info", channel, { durationMs, slow: true });
      return result;
    } catch (error) {
      log("ipc", "error", channel, { durationMs: Date.now() - started, error });
      throw error;
    }
  });
}

module.exports = { registerIpcHandler };
