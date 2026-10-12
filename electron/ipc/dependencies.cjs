"use strict";
const { dialog, ipcMain, shell } = require("electron");
const { existsSync } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  writeFileAtomic,
  withProjectTransaction,
  writeProjectFiles,
} = require("../services/project-storage.cjs");
const storyState = require("../services/story-state.cjs");
const projectSnapshots = require("../services/project-snapshots.cjs");
const creativeWorkspace = require("../services/creative-workspace.cjs");
const novelNetworkImport = require("../services/novel-network-import.cjs");
const { normalizeNetwork } = require("../services/novel-network.cjs");
const operationJournal = require("../services/operation-journal.cjs");
const {
  assertTrustedSender,
  validateIpcArguments,
} = require("../services/ipc-security.cjs");
const releasePrivacy = require("../services/release-privacy.cjs");
const { log } = require("../services/logger.cjs");
const { verifyIpcContract } = require("../services/ipc-contract.cjs");
const {
  channelsRequiringHandler,
} = require("../../shared/contracts/ipc-channels.cjs");
const { state, sendRendererEvent } = require("../services/runtime-state.cjs");
const __dep0 = require("../services/project-files.cjs");
const __dep1 = require("../services/credentials.cjs");
const __dep2 = require("../services/project-config.cjs");
const __dep3 = require("../services/knowledge-index.cjs");
const __dep4 = require("../services/retrieval-pipeline.cjs");
const __dep5 = require("../services/ai-generate.cjs");
const __dep6 = require("../services/analysis-tools.cjs");
const __dep7 = require("../services/creative-agent.cjs");
const __dep8 = require("../services/project-exchange.cjs");
const __dep9 = require("../services/project-content.cjs");
const __dep10 = require("../services/task-runtime.cjs");
const __dep11 = require("../services/docx-export.cjs");
const __dep12 = require("../services/app-update.cjs");
const __dep13 = require("../services/project-ops.cjs");

function nowIso(...args) {
  return __dep0.nowIso.apply(null, args);
}

function makeId(...args) {
  return __dep0.makeId(...args);
}

function sanitizeFileName(...args) {
  return __dep0.sanitizeFileName(...args);
}

function normalizeCategory(...args) {
  return __dep0.normalizeCategory(...args);
}

function ensureDir(...args) {
  return __dep0.ensureDir(...args);
}

function writeJson(...args) {
  return __dep0.writeJson(...args);
}

function getConfigPath(...args) {
  return __dep0.getConfigPath(...args);
}

function normalizeChapterFileName(...args) {
  return __dep0.normalizeChapterFileName(...args);
}

function getChapterPath(...args) {
  return __dep0.getChapterPath(...args);
}

function getOriginalDocumentPath(...args) {
  return __dep0.getOriginalDocumentPath(...args);
}

function normalizeManagedFileName(...args) {
  return __dep0.normalizeManagedFileName(...args);
}

function uniqueContentFileName(...args) {
  return __dep0.uniqueContentFileName(...args);
}

function uniqueChapterFileName(...args) {
  return __dep0.uniqueChapterFileName(...args);
}

function getCharacterPath(...args) {
  return __dep0.getCharacterPath(...args);
}

function getWorldDocPath(...args) {
  return __dep0.getWorldDocPath(...args);
}

function writeWorldDoc(...args) {
  return __dep0.writeWorldDoc(...args);
}

function listChapterVersions(...args) {
  return __dep0.listChapterVersions(...args);
}

function loadCharacters(...args) {
  return __dep0.loadCharacters(...args);
}

function loadWorldDocs(...args) {
  return __dep0.loadWorldDocs(...args);
}

function loadChapterContent(...args) {
  return __dep0.loadChapterContent(...args);
}

function characterToMarkdown(...args) {
  return __dep0.characterToMarkdown(...args);
}

function saveCredentialSecrets(...args) {
  return __dep1.saveCredentialSecrets(...args);
}

function configFromRenderer(...args) {
  return __dep2.configFromRenderer(...args);
}

function inspectProjectHealth(...args) {
  return __dep2.inspectProjectHealth(...args);
}

function activateProjectSession(...args) {
  return __dep2.activateProjectSession(...args);
}

function withJournalOperation(...args) {
  return __dep2.withJournalOperation(...args);
}

function ensureCurrentProject(...args) {
  return __dep2.ensureCurrentProject.apply(null, args);
}

function loadMaterials(...args) {
  return __dep3.loadMaterials.apply(null, args);
}

function saveMaterial(...args) {
  return __dep3.saveMaterial(...args);
}

function deleteMaterial(...args) {
  return __dep3.deleteMaterial(...args);
}

function listKnowledgeItems(...args) {
  return __dep3.listKnowledgeItems(...args);
}

function getKnowledgeSyncStatus(...args) {
  return __dep3.getKnowledgeSyncStatus(...args);
}

function repairKnowledgeSync(...args) {
  return __dep3.repairKnowledgeSync(...args);
}

function getMaintenanceDiagnostics(...args) {
  return __dep3.getMaintenanceDiagnostics(...args);
}

function repairMaintenance(...args) {
  return __dep3.repairMaintenance(...args);
}

function indexSource(...args) {
  return __dep3.indexSource(...args);
}

function removeSourceFromIndex(...args) {
  return __dep3.removeSourceFromIndex(...args);
}

function rebuildIndex(...args) {
  return __dep3.rebuildIndex(...args);
}

function buildProjectMemorySummary(...args) {
  return __dep4.buildProjectMemorySummary(...args);
}

function buildSystemPrompt(...args) {
  return __dep4.buildSystemPrompt(...args);
}

function contextFromChunks(...args) {
  return __dep4.contextFromChunks(...args);
}

function buildChatRetrievalPackage(...args) {
  return __dep4.buildChatRetrievalPackage(...args);
}

function callChatApi(...args) {
  return __dep5.callChatApi(...args);
}

function generateCharactersFromOutline(...args) {
  return __dep5.generateCharactersFromOutline(...args);
}

function generateWorldDocsFromOutline(...args) {
  return __dep5.generateWorldDocsFromOutline(...args);
}

function buildCreativeAdvice(...args) {
  return __dep5.buildCreativeAdvice(...args);
}

function loadIssueStatuses(...args) {
  return __dep6.loadIssueStatuses(...args);
}

function saveIssueStatuses(...args) {
  return __dep6.saveIssueStatuses(...args);
}

function loadAnalysisState(...args) {
  return __dep6.loadAnalysisState(...args);
}

function saveAnalysisState(...args) {
  return __dep6.saveAnalysisState(...args);
}

function globalSearch(...args) {
  return __dep6.globalSearch(...args);
}

function buildTimelineEvents(...args) {
  return __dep6.buildTimelineEvents(...args);
}

function buildAiTimelineEvents(...args) {
  return __dep6.buildAiTimelineEvents(...args);
}

function buildRelationshipGraph(...args) {
  return __dep6.buildRelationshipGraph(...args);
}

function analyzeConsistency(...args) {
  return __dep6.analyzeConsistency(...args);
}

function prepareWorldCardCandidates(...args) {
  return __dep6.prepareWorldCardCandidates(...args);
}

function saveWorldCardCandidates(...args) {
  return __dep6.saveWorldCardCandidates(...args);
}

function refreshLocalStoryState(...args) {
  return __dep6.refreshLocalStoryState(...args);
}

function getStoryOverviewForProject(...args) {
  return __dep6.getStoryOverviewForProject(...args);
}

function getCreativeWorkspaceView(...args) {
  return __dep7.getCreativeWorkspaceView(...args);
}

function prepareCreativeAgentRun(...args) {
  return __dep7.prepareCreativeAgentRun(...args);
}

function queueCreativeAgentRun(...args) {
  return __dep7.queueCreativeAgentRun(...args);
}

function createSafeRevision(...args) {
  return __dep7.createSafeRevision(...args);
}

function exportProjectExchange(...args) {
  return __dep8.exportProjectExchange(...args);
}

function previewProjectExchange(...args) {
  return __dep8.previewProjectExchange(...args);
}

function calculateTotalWords(...args) {
  return __dep9.calculateTotalWords(...args);
}

function saveChapterContent(...args) {
  return __dep9.saveChapterContent(...args);
}

function compareChapterVersion(...args) {
  return __dep9.compareChapterVersion(...args);
}

function buildCreativeStatistics(...args) {
  return __dep10.buildCreativeStatistics(...args);
}

function getProjectTaskCenter(...args) {
  return __dep10.getProjectTaskCenter(...args);
}

function queueKnowledgeRebuildAfterRestore(...args) {
  return __dep10.queueKnowledgeRebuildAfterRestore(...args);
}

function buildAppearanceStats(...args) {
  return __dep10.buildAppearanceStats(...args);
}

function buildWorldMap(...args) {
  return __dep10.buildWorldMap(...args);
}

function exportChapterToDocx(...args) {
  return __dep11.exportChapterToDocx(...args);
}

function exportBookDocumentsToDirectory(...args) {
  return __dep11.exportBookDocumentsToDirectory.apply(null, args);
}

function checkForAppUpdate(...args) {
  return __dep12.checkForAppUpdate.apply(null, args);
}

function downloadAndOpenAppUpdate(...args) {
  return __dep12.downloadAndOpenAppUpdate(...args);
}

function ensureProjectStructure(...args) {
  return __dep13.ensureProjectStructure(...args);
}

function loadConfig(...args) {
  return __dep13.loadConfig(...args);
}

function saveConfig(...args) {
  return __dep13.saveConfig(...args);
}

function buildAppState(...args) {
  return __dep13.buildAppState(...args);
}

function updateKnowledgeItems(...args) {
  return __dep13.updateKnowledgeItems(...args);
}

function repairProjectHealth(...args) {
  return __dep13.repairProjectHealth(...args);
}

function importDocumentIntoProject(...args) {
  return __dep13.importDocumentIntoProject(...args);
}

function refreshChapterFromOriginalDocument(...args) {
  return __dep13.refreshChapterFromOriginalDocument(...args);
}

function applySafeRevision(...args) {
  return __dep13.applySafeRevision(...args);
}

function applySafeRevisionPart(...args) {
  return __dep13.applySafeRevisionPart(...args);
}

function restoreChapterVersion(...args) {
  return __dep13.restoreChapterVersion(...args);
}

function importProjectExchange(...args) {
  return __dep13.importProjectExchange(...args);
}

function createBackup(...args) {
  return __dep13.createBackup(...args);
}

function indexSources(...args) {
  return __dep13.indexSources(...args);
}
const IPC_DIRECTORY = __dirname;
module.exports = {
  dialog,
  ipcMain,
  shell,
  existsSync,
  fs,
  path,
  crypto,
  writeFileAtomic,
  withProjectTransaction,
  writeProjectFiles,
  storyState,
  projectSnapshots,
  creativeWorkspace,
  novelNetworkImport,
  normalizeNetwork,
  operationJournal,
  assertTrustedSender,
  validateIpcArguments,
  releasePrivacy,
  log,
  verifyIpcContract,
  channelsRequiringHandler,
  state,
  sendRendererEvent,
  nowIso,
  makeId,
  sanitizeFileName,
  normalizeCategory,
  ensureDir,
  writeJson,
  getConfigPath,
  normalizeChapterFileName,
  getChapterPath,
  getOriginalDocumentPath,
  normalizeManagedFileName,
  uniqueContentFileName,
  uniqueChapterFileName,
  getCharacterPath,
  getWorldDocPath,
  writeWorldDoc,
  listChapterVersions,
  loadCharacters,
  loadWorldDocs,
  loadChapterContent,
  characterToMarkdown,
  saveCredentialSecrets,
  configFromRenderer,
  inspectProjectHealth,
  activateProjectSession,
  withJournalOperation,
  ensureCurrentProject,
  loadMaterials,
  saveMaterial,
  deleteMaterial,
  listKnowledgeItems,
  getKnowledgeSyncStatus,
  repairKnowledgeSync,
  getMaintenanceDiagnostics,
  repairMaintenance,
  indexSource,
  removeSourceFromIndex,
  rebuildIndex,
  buildProjectMemorySummary,
  buildSystemPrompt,
  contextFromChunks,
  buildChatRetrievalPackage,
  callChatApi,
  generateCharactersFromOutline,
  generateWorldDocsFromOutline,
  buildCreativeAdvice,
  loadIssueStatuses,
  saveIssueStatuses,
  loadAnalysisState,
  saveAnalysisState,
  globalSearch,
  buildTimelineEvents,
  buildAiTimelineEvents,
  buildRelationshipGraph,
  analyzeConsistency,
  prepareWorldCardCandidates,
  saveWorldCardCandidates,
  refreshLocalStoryState,
  getStoryOverviewForProject,
  getCreativeWorkspaceView,
  prepareCreativeAgentRun,
  queueCreativeAgentRun,
  createSafeRevision,
  exportProjectExchange,
  previewProjectExchange,
  calculateTotalWords,
  saveChapterContent,
  compareChapterVersion,
  buildCreativeStatistics,
  getProjectTaskCenter,
  queueKnowledgeRebuildAfterRestore,
  buildAppearanceStats,
  buildWorldMap,
  exportChapterToDocx,
  exportBookDocumentsToDirectory,
  checkForAppUpdate,
  downloadAndOpenAppUpdate,
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
  createBackup,
  indexSources,
  IPC_DIRECTORY,
};
