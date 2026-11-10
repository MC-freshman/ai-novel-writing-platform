"use strict";
// Generated per-domain dependency surface. Do not add unrelated services here.
const { applySafeRevision, applySafeRevisionPart } = require("../../services/project-ops.cjs");
const { createSafeRevision, getCreativeWorkspaceView, prepareCreativeAgentRun, queueCreativeAgentRun } = require("../../services/creative-agent.cjs");
const creativeWorkspace = require("../../services/creative-workspace.cjs");
const { ensureCurrentProject, withJournalOperation } = require("../../services/project-config.cjs");
const { getProjectTaskCenter } = require("../../services/task-runtime.cjs");

module.exports = {
  applySafeRevision,
  applySafeRevisionPart,
  createSafeRevision,
  creativeWorkspace,
  ensureCurrentProject,
  getCreativeWorkspaceView,
  getProjectTaskCenter,
  prepareCreativeAgentRun,
  queueCreativeAgentRun,
  withJournalOperation,
};
