"use strict";
// Generated per-domain dependency surface. Do not add unrelated services here.
const { buildChatRetrievalPackage, buildProjectMemorySummary, buildSystemPrompt, contextFromChunks } = require("../../services/retrieval-pipeline.cjs");
const { callChatApi } = require("../../services/ai-generate.cjs");
const { ensureCurrentProject } = require("../../services/project-config.cjs");
const { loadAnalysisState, saveAnalysisState } = require("../../services/analysis-tools.cjs");
const { loadConfig } = require("../../services/project-ops.cjs");
const { makeId, nowIso, loadCharacters } = require("../../services/project-files.cjs");
const { sendRendererEvent, state } = require("../../services/runtime-state.cjs");
const promptTemplates = require("../../services/prompt-templates.cjs");
const { buildPersonaPrompt } = require("../../services/persona.cjs");

module.exports = {
  buildChatRetrievalPackage,
  buildPersonaPrompt,
  buildProjectMemorySummary,
  buildSystemPrompt,
  callChatApi,
  contextFromChunks,
  ensureCurrentProject,
  loadAnalysisState,
  loadCharacters,
  loadConfig,
  makeId,
  nowIso,
  promptTemplates,
  saveAnalysisState,
  sendRendererEvent,
  state,
};
