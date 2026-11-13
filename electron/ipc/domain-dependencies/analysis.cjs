"use strict";
// Generated per-domain dependency surface. Do not add unrelated services here.
const { analyzeConsistency, buildAiTimelineEvents, buildRelationshipGraph, buildTimelineEvents, globalSearch, loadAnalysisState, loadIssueStatuses, saveAnalysisState, saveIssueStatuses } = require("../../services/analysis-tools.cjs");
const { buildAppearanceStats, buildWorldMap } = require("../../services/task-runtime.cjs");
const { ensureCurrentProject } = require("../../services/project-config.cjs");
const { nowIso } = require("../../services/project-files.cjs");
const { loadConfig } = require("../../services/project-ops.cjs");
const { getWritingOverview } = require("../../services/writing-stats.cjs");
const multiExport = require("../../services/multi-export.cjs");
const sensitiveCheck = require("../../services/sensitive-check.cjs");
const projectSearch = require("../../services/project-search.cjs");
const styleCheck = require("../../services/style-check.cjs");
const nameGen = require("../../services/name-gen.cjs");

module.exports = {
  analyzeConsistency,
  buildAiTimelineEvents,
  buildAppearanceStats,
  buildRelationshipGraph,
  buildTimelineEvents,
  buildWorldMap,
  ensureCurrentProject,
  getWritingOverview,
  globalSearch,
  loadAnalysisState,
  loadConfig,
  loadIssueStatuses,
  multiExport,
  nameGen,
  nowIso,
  projectSearch,
  saveAnalysisState,
  saveIssueStatuses,
  sensitiveCheck,
  styleCheck,
};
