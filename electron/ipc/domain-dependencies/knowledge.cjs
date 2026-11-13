"use strict";
// Generated per-domain dependency surface. Do not add unrelated services here.
const { buildAppState, updateKnowledgeItems } = require("../../services/project-ops.cjs");
const { deleteMaterial, getKnowledgeSyncStatus, getMaintenanceDiagnostics, listKnowledgeItems, loadMaterials, rebuildIndex, repairKnowledgeSync, repairMaintenance, saveMaterial, testEmbedding } = require("../../services/knowledge-index.cjs");
const { ensureCurrentProject } = require("../../services/project-config.cjs");
const { loadConfig } = require("../../services/project-ops.cjs");
const imageGen = require("../../services/image-gen.cjs");
const { getMaterialsDir } = require("../../services/project-files.cjs");
const fs = require("node:fs/promises");
const path = require("node:path");

module.exports = {
  buildAppState,
  deleteMaterial,
  ensureCurrentProject,
  fs,
  getKnowledgeSyncStatus,
  getMaintenanceDiagnostics,
  getMaterialsDir,
  imageGen,
  listKnowledgeItems,
  loadConfig,
  loadMaterials,
  path,
  rebuildIndex,
  repairKnowledgeSync,
  repairMaintenance,
  saveMaterial,
  testEmbedding,
  updateKnowledgeItems,
};
