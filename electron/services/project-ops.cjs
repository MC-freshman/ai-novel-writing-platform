// 本文件源自P2主进程拆分；后续维护与行为修复见Git历史。
"use strict";

const { withProjectTransaction } = require("./project-storage.cjs");
const projectArchives = require("./project-archives.cjs");
const __dep0 = require("./project-files.cjs");
const __dep1 = require("./project-config.cjs");
const __dep2 = require("./knowledge-index.cjs");
const __dep3 = require("./creative-agent.cjs");
const __dep4 = require("./project-exchange.cjs");
const __dep5 = require("./project-content.cjs");

function loadConfigUnlocked(...args) { return __dep0.loadConfigUnlocked(...args); }
function ensureProjectStructureUnlocked(...args) { return __dep1.ensureProjectStructureUnlocked(...args); }
function saveConfigUnlocked(...args) { return __dep1.saveConfigUnlocked(...args); }
function repairProjectHealthUnlocked(...args) { return __dep1.repairProjectHealthUnlocked(...args); }
function updateKnowledgeItemsUnlocked(...args) { return __dep2.updateKnowledgeItemsUnlocked(...args); }
function updateKnowledgeSummariesUnlocked(...args) { return __dep2.updateKnowledgeSummariesUnlocked(...args); }
function removeSourceFromKnowledgeSummariesUnlocked(...args) { return __dep2.removeSourceFromKnowledgeSummariesUnlocked(...args); }
function indexSourcesUnlocked(...args) { return __dep2.indexSourcesUnlocked(...args); }
function applySafeRevisionUnlocked(...args) { return __dep3.applySafeRevisionUnlocked(...args); }
function applySafeRevisionPartUnlocked(...args) { return __dep3.applySafeRevisionPartUnlocked(...args); }
function buildProjectExchangeArchiveUnlocked(...args) { return __dep4.buildProjectExchangeArchiveUnlocked(...args); }
function importProjectExchangeUnlocked(...args) { return __dep4.importProjectExchangeUnlocked(...args); }
function importDocumentIntoProjectUnlocked(...args) { return __dep5.importDocumentIntoProjectUnlocked(...args); }
function refreshChapterFromOriginalDocumentUnlocked(...args) { return __dep5.refreshChapterFromOriginalDocumentUnlocked(...args); }
function buildAppStateUnlocked(...args) { return __dep5.buildAppStateUnlocked(...args); }
function restoreChapterVersionUnlocked(...args) { return __dep5.restoreChapterVersionUnlocked(...args); }

async function createBackupUnlocked(projectPath, targetFile = "") {
  return projectArchives.createBackupArchive(projectPath, targetFile);
}


function ensureProjectStructure(projectPath, ...args) {
  return withProjectTransaction(projectPath, () => ensureProjectStructureUnlocked(projectPath, ...args));
}

function loadConfig(projectPath, ...args) {
  return withProjectTransaction(projectPath, () => loadConfigUnlocked(projectPath, ...args));
}

function saveConfig(projectPath, ...args) {
  return withProjectTransaction(projectPath, () => saveConfigUnlocked(projectPath, ...args));
}

function buildAppState(projectPath, ...args) {
  return withProjectTransaction(projectPath, () => buildAppStateUnlocked(projectPath, ...args));
}

function updateKnowledgeItems(projectPath, ...args) {
  return withProjectTransaction(projectPath, () => updateKnowledgeItemsUnlocked(projectPath, ...args));
}

function repairProjectHealth(projectPath, ...args) {
  return withProjectTransaction(projectPath, async () => {
    const result = await repairProjectHealthUnlocked(projectPath, ...args);
    return { ...result, state: await __dep5.buildAppStateUnlocked(projectPath) };
  });
}

function importDocumentIntoProject(projectPath, ...args) {
  return withProjectTransaction(projectPath, () => importDocumentIntoProjectUnlocked(projectPath, ...args));
}

function refreshChapterFromOriginalDocument(projectPath, ...args) {
  return withProjectTransaction(projectPath, () => refreshChapterFromOriginalDocumentUnlocked(projectPath, ...args));
}

function applySafeRevision(projectPath, ...args) {
  return withProjectTransaction(projectPath, () => applySafeRevisionUnlocked(projectPath, ...args));
}

function applySafeRevisionPart(projectPath, ...args) {
  return withProjectTransaction(projectPath, () => applySafeRevisionPartUnlocked(projectPath, ...args));
}

function restoreChapterVersion(projectPath, ...args) {
  return withProjectTransaction(projectPath, () => restoreChapterVersionUnlocked(projectPath, ...args));
}

function importProjectExchange(projectPath, ...args) {
  return withProjectTransaction(projectPath, () => importProjectExchangeUnlocked(projectPath, ...args));
}

function buildProjectExchangeArchive(projectPath, ...args) {
  return withProjectTransaction(projectPath, () => buildProjectExchangeArchiveUnlocked(projectPath, ...args));
}

function createBackup(projectPath, ...args) {
  return withProjectTransaction(projectPath, () => createBackupUnlocked(projectPath, ...args));
}

function indexSources(projectPath, ...args) {
  return withProjectTransaction(projectPath, () => indexSourcesUnlocked(projectPath, ...args));
}

function updateKnowledgeSummaries(projectPath, ...args) {
  return withProjectTransaction(projectPath, () => updateKnowledgeSummariesUnlocked(projectPath, ...args));
}

function removeSourceFromKnowledgeSummaries(projectPath, ...args) {
  return withProjectTransaction(projectPath, () => removeSourceFromKnowledgeSummariesUnlocked(projectPath, ...args));
}


const __moduleExports = {
  createBackupUnlocked,
  ensureProjectStructure,
  loadConfig,
  saveConfig,
  buildAppState,
  updateKnowledgeItems,
  repairProjectHealth,
  importDocumentIntoProject,
  refreshChapterFromOriginalDocument,
  applySafeRevision,
  applySafeRevisionPart,
  restoreChapterVersion,
  importProjectExchange,
  buildProjectExchangeArchive,
  createBackup,
  indexSources,
  updateKnowledgeSummaries,
  removeSourceFromKnowledgeSummaries,
};

// Augment the original exports object so cyclic requires (whose captured
// reference may be a Proxy over the pre-assignment exports) see every key.
Object.assign(module.exports, __moduleExports);
module.exports = __moduleExports;
