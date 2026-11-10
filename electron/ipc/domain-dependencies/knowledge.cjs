"use strict";
// Generated per-domain dependency surface. Do not add unrelated services here.
const { buildAppState, updateKnowledgeItems } = require("../../services/project-ops.cjs");
const { deleteMaterial, getKnowledgeSyncStatus, getMaintenanceDiagnostics, listKnowledgeItems, loadMaterials, rebuildIndex, repairKnowledgeSync, repairMaintenance, saveMaterial } = require("../../services/knowledge-index.cjs");
const { ensureCurrentProject } = require("../../services/project-config.cjs");

module.exports = {
  buildAppState,
  deleteMaterial,
  ensureCurrentProject,
  getKnowledgeSyncStatus,
  getMaintenanceDiagnostics,
  listKnowledgeItems,
  loadMaterials,
  rebuildIndex,
  repairKnowledgeSync,
  repairMaintenance,
  saveMaterial,
  updateKnowledgeItems,
};
