"use strict";
// Generated per-domain dependency surface. Do not add unrelated services here.
const { buildAppState } = require("../../services/project-ops.cjs");
const { characterToMarkdown, getCharacterPath, getWorldDocPath, loadCharacters, loadWorldDocs, makeId, normalizeCategory, normalizeManagedFileName, nowIso, uniqueContentFileName, writeJson, writeWorldDoc } = require("../../services/project-files.cjs");
const { ensureCurrentProject } = require("../../services/project-config.cjs");
const fs = require("node:fs/promises");
const { indexSource, removeSourceFromIndex } = require("../../services/knowledge-index.cjs");
const path = require("node:path");
const { withProjectTransaction } = require("../../services/project-storage.cjs");

module.exports = {
  buildAppState,
  characterToMarkdown,
  ensureCurrentProject,
  fs,
  getCharacterPath,
  getWorldDocPath,
  indexSource,
  loadCharacters,
  loadWorldDocs,
  makeId,
  normalizeCategory,
  normalizeManagedFileName,
  nowIso,
  path,
  removeSourceFromIndex,
  uniqueContentFileName,
  withProjectTransaction,
  writeJson,
  writeWorldDoc,
};
