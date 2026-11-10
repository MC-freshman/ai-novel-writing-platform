"use strict";
// Generated per-domain dependency surface. Do not add unrelated services here.
const { buildAppState, createBackup, importDocumentIntoProject, importProjectExchange, indexSources, loadConfig, repairProjectHealth, saveConfig } = require("../../services/project-ops.cjs");
const { switchCurrentProject, configFromRenderer, ensureCurrentProject, inspectProjectHealth, withJournalOperation } = require("../../services/project-config.cjs");
const { calculateTotalWords } = require("../../services/project-content.cjs");
const { dialog } = require("electron");
const { exportBookDocumentsToDirectory } = require("../../services/docx-export.cjs");
const { exportProjectExchange, previewProjectExchange } = require("../../services/project-exchange.cjs");
const { getProjectTaskCenter } = require("../../services/task-runtime.cjs");
const path = require("node:path");
const projectSnapshots = require("../../services/project-snapshots.cjs");
const { sanitizeFileName } = require("../../services/project-files.cjs");
const { saveCredentialSecrets } = require("../../services/credentials.cjs");
const { sendRendererEvent, state } = require("../../services/runtime-state.cjs");
const { withProjectTransaction } = require("../../services/project-storage.cjs");

module.exports = {
  buildAppState,
  switchCurrentProject,
  calculateTotalWords,
  configFromRenderer,
  createBackup,
  dialog,
  ensureCurrentProject,
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
};
