// 本文件由 P2 重构自 electron/main.cjs 机械搬迁（scripts/refactor-split.cjs），逻辑未改动。
"use strict";


// 主进程共享运行时状态（原 main.cjs 顶层变量），单例对象被各域模块共享。
const state = {
  mainWindow: null,
  currentProjectPath: "",
  importCancelRequested: false,
  windowCloseApproved: false,
  windowCloseRequestTimer: null,
  gracefulShutdownStarted: false,
  activeAiRequests: new Map(),
  projectTaskCenters: new Map(),
  deepAnalysisTimers: new Map(),
  chapterRevisionCache: new Map(),
  pendingExchangeImports: new Map(),
  pendingNovelNetworkImports: new Map(),
  projectSessions: new Map(),
  credentialSecretsCache: new Map(),
  registeredIpcChannels: new Set(),
};

function sendRendererEvent(channel, payload) {
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send(channel, payload);
  }
}




const __moduleExports = {
  state,
  sendRendererEvent,
};

// Augment the original exports object so cyclic requires (whose captured
// reference may be a Proxy over the pre-assignment exports) see every key.
Object.assign(module.exports, __moduleExports);
module.exports = __moduleExports;
