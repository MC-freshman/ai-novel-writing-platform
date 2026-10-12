"use strict";
const storyState = require("../story-state.cjs");
const { PersistentTaskCenter } = require("../task-center.cjs");
const projectSnapshots = require("../project-snapshots.cjs");
const vectorShards = require("../vector-shards.cjs");
const creativeWorkspace = require("../creative-workspace.cjs");
const creativeStatistics = require("../creative-statistics.cjs");
const { state, sendRendererEvent } = require("../runtime-state.cjs");
const __dep0 = require("../project-files.cjs");
const fs = require("node:fs/promises");

function nowIso(...args) {
  return __dep0.nowIso.apply(null, args);
}

function normalizeCategory(...args) {
  return __dep0.normalizeCategory(...args);
}

function writeJson(...args) {
  return __dep0.writeJson(...args);
}

function getKnowledgeSummariesPath(...args) {
  return __dep0.getKnowledgeSummariesPath(...args);
}

function getChapterPath(...args) {
  return __dep0.getChapterPath(...args);
}

function contentToPlainText(...args) {
  return __dep0.contentToPlainText(...args);
}

function loadProjectSources(...args) {
  return __dep0.loadProjectSources(...args);
}

function stableHash(...args) {
  return __dep0.stableHash(...args);
}

function loadCharacters(...args) {
  return __dep0.loadCharacters(...args);
}

function loadWorldDocs(...args) {
  return __dep0.loadWorldDocs(...args);
}

function rebuildIndex(...args) {
  return require("../knowledge-index.cjs").rebuildIndex(...args);
}

function buildCreativeAdvice(...args) {
  return require("../ai-generate.cjs").buildCreativeAdvice(...args);
}

function saveAnalysisState(...args) {
  return require("../analysis-tools.cjs").saveAnalysisState(...args);
}

function buildTimelineEvents(...args) {
  return require("../analysis-tools.cjs").buildTimelineEvents(...args);
}

function buildAiTimelineEvents(...args) {
  return require("../analysis-tools.cjs").buildAiTimelineEvents(...args);
}

function analyzeConsistency(...args) {
  return require("../analysis-tools.cjs").analyzeConsistency(...args);
}

function refreshLocalStoryState(...args) {
  return require("../analysis-tools.cjs").refreshLocalStoryState(...args);
}

function analyzeStoryStateWithAI(...args) {
  return require("../analysis-tools.cjs").analyzeStoryStateWithAI(...args);
}

function getCreativeWorkspaceView(...args) {
  return require("../creative-agent.cjs").getCreativeWorkspaceView(...args);
}

function executeCreativeAgentRun(...args) {
  return require("../creative-agent.cjs").executeCreativeAgentRun(...args);
}

function loadConfig(...args) {
  return require("../project-ops.cjs").loadConfig(...args);
}

module.exports = {
  storyState,
  PersistentTaskCenter,
  projectSnapshots,
  vectorShards,
  creativeWorkspace,
  creativeStatistics,
  state,
  sendRendererEvent,
  fs,
  nowIso,
  normalizeCategory,
  writeJson,
  getKnowledgeSummariesPath,
  getChapterPath,
  contentToPlainText,
  loadProjectSources,
  stableHash,
  loadCharacters,
  loadWorldDocs,
  rebuildIndex,
  buildCreativeAdvice,
  saveAnalysisState,
  buildTimelineEvents,
  buildAiTimelineEvents,
  analyzeConsistency,
  refreshLocalStoryState,
  analyzeStoryStateWithAI,
  getCreativeWorkspaceView,
  executeCreativeAgentRun,
  loadConfig,
};
