"use strict";
// Generated per-domain dependency surface. Do not add unrelated services here.
const IPC_DIRECTORY = __dirname;
const { buildAppState, loadConfig } = require("../../services/project-ops.cjs");
const { checkForAppUpdate, downloadAndOpenAppUpdate } = require("../../services/app-update.cjs");
const { ensureCurrentProject } = require("../../services/project-config.cjs");
const operationJournal = require("../../services/operation-journal.cjs");
const path = require("node:path");
const releasePrivacy = require("../../services/release-privacy.cjs");
const { state } = require("../../services/runtime-state.cjs");

module.exports = {
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
};
