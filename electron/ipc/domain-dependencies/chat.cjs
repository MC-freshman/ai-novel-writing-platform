"use strict";
// Generated per-domain dependency surface. Do not add unrelated services here.
const { buildChatRetrievalPackage, buildProjectMemorySummary, buildSystemPrompt, contextFromChunks } = require("../../services/retrieval-pipeline.cjs");
const { callChatApi } = require("../../services/ai-generate.cjs");
const { ensureCurrentProject } = require("../../services/project-config.cjs");
const { loadAnalysisState, saveAnalysisState } = require("../../services/analysis-tools.cjs");
const { loadConfig } = require("../../services/project-ops.cjs");
const { makeId, nowIso } = require("../../services/project-files.cjs");
const { sendRendererEvent, state } = require("../../services/runtime-state.cjs");

module.exports = {
  buildChatRetrievalPackage,
  buildProjectMemorySummary,
  buildSystemPrompt,
  callChatApi,
  contextFromChunks,
  ensureCurrentProject,
  loadAnalysisState,
  loadConfig,
  makeId,
  nowIso,
  saveAnalysisState,
  sendRendererEvent,
  state,
};
