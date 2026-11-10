"use strict";
// Generated per-domain dependency surface. Do not add unrelated services here.
const { buildAppState, loadConfig, refreshChapterFromOriginalDocument, restoreChapterVersion, saveConfig } = require("../../services/project-ops.cjs");
const { calculateTotalWords, compareChapterVersion, saveChapterContent } = require("../../services/project-content.cjs");
const creativeWorkspace = require("../../services/creative-workspace.cjs");
const { dialog, shell } = require("electron");
const { ensureCurrentProject, withJournalOperation } = require("../../services/project-config.cjs");
const { ensureDir, getChapterPath, getConfigPath, getOriginalDocumentPath, listChapterVersions, loadChapterContent, makeId, normalizeChapterFileName, nowIso, sanitizeFileName, uniqueChapterFileName } = require("../../services/project-files.cjs");
const { existsSync } = require("node:fs");
const { exportChapterToDocx } = require("../../services/docx-export.cjs");
const path = require("node:path");
const { removeSourceFromIndex } = require("../../services/knowledge-index.cjs");
const { state } = require("../../services/runtime-state.cjs");
const storyState = require("../../services/story-state.cjs");
const { withProjectTransaction, writeProjectFiles } = require("../../services/project-storage.cjs");

module.exports = {
  buildAppState,
  calculateTotalWords,
  compareChapterVersion,
  creativeWorkspace,
  dialog,
  ensureCurrentProject,
  ensureDir,
  existsSync,
  exportChapterToDocx,
  getChapterPath,
  getConfigPath,
  getOriginalDocumentPath,
  listChapterVersions,
  loadChapterContent,
  loadConfig,
  makeId,
  normalizeChapterFileName,
  nowIso,
  path,
  refreshChapterFromOriginalDocument,
  removeSourceFromIndex,
  restoreChapterVersion,
  sanitizeFileName,
  saveChapterContent,
  saveConfig,
  shell,
  state,
  storyState,
  uniqueChapterFileName,
  withJournalOperation,
  withProjectTransaction,
  writeProjectFiles,
};
