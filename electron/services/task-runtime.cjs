// Public compatibility entry. Implementation is organized by domain below.
"use strict";
const statistics = require("./tasks/statistics.cjs");
const execution = require("./tasks/execution.cjs");
const center = require("./tasks/center.cjs");

const api = {
  buildCreativeStatistics: statistics.buildCreativeStatistics,
  executeBackgroundTask: execution.executeBackgroundTask,
  getProjectTaskCenter: center.getProjectTaskCenter,
  queueKnowledgeRebuildAfterRestore: center.queueKnowledgeRebuildAfterRestore,
  scheduleIdleDeepAnalysis: center.scheduleIdleDeepAnalysis,
  buildAppearanceStats: statistics.buildAppearanceStats,
  buildWorldMap: statistics.buildWorldMap,
};
// Preserve captured exports during the existing CommonJS service load cycle.
Object.assign(module.exports, api);
module.exports = api;
