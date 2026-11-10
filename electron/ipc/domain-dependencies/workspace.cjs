"use strict";
// Generated per-domain dependency surface. Do not add unrelated services here.
const { buildCreativeStatistics } = require("../../services/task-runtime.cjs");
const creativeWorkspace = require("../../services/creative-workspace.cjs");
const crypto = require("node:crypto");
const { dialog } = require("electron");
const { ensureCurrentProject } = require("../../services/project-config.cjs");
const fs = require("node:fs/promises");
const { getCreativeWorkspaceView } = require("../../services/creative-agent.cjs");
const { loadConfig } = require("../../services/project-ops.cjs");
const { normalizeNetwork } = require("../../services/novel-network.cjs");
const novelNetworkImport = require("../../services/novel-network-import.cjs");
const { nowIso } = require("../../services/project-files.cjs");
const path = require("node:path");
const { state } = require("../../services/runtime-state.cjs");
const storyState = require("../../services/story-state.cjs");
const { withProjectTransaction, writeFileAtomic } = require("../../services/project-storage.cjs");

module.exports = {
  buildCreativeStatistics,
  creativeWorkspace,
  crypto,
  dialog,
  ensureCurrentProject,
  fs,
  getCreativeWorkspaceView,
  loadConfig,
  normalizeNetwork,
  novelNetworkImport,
  nowIso,
  path,
  state,
  storyState,
  withProjectTransaction,
  writeFileAtomic,
};
