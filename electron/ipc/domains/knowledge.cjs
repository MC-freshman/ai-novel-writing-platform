"use strict";
const { registerIpcHandler } = require("../register.cjs");
const {
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
} = require("../dependencies.cjs");

function registerDomain() {
  registerIpcHandler("knowledge:list", async () => {
    const projectPath = await ensureCurrentProject();
    return { items: await listKnowledgeItems(projectPath) };
  });

  registerIpcHandler("knowledge:update", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return updateKnowledgeItems(projectPath, payload?.items || []);
  });

  registerIpcHandler("knowledge:status", async () => {
    const projectPath = await ensureCurrentProject();
    return getKnowledgeSyncStatus(projectPath);
  });

  registerIpcHandler("knowledge:repair", async () => {
    const projectPath = await ensureCurrentProject();
    return repairKnowledgeSync(projectPath);
  });

  registerIpcHandler("maintenance:diagnostics", async () => {
    const projectPath = await ensureCurrentProject();
    return getMaintenanceDiagnostics(projectPath);
  });

  registerIpcHandler("maintenance:repair", async () => {
    const projectPath = await ensureCurrentProject();
    return repairMaintenance(projectPath);
  });

  registerIpcHandler("materials:list", async () => {
    const projectPath = await ensureCurrentProject();
    return { materials: await loadMaterials(projectPath) };
  });

  registerIpcHandler("materials:save", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const item = await saveMaterial(projectPath, payload || {});
    return { material: item, materials: await loadMaterials(projectPath) };
  });

  registerIpcHandler("materials:delete", async (_event, materialId) => {
    const projectPath = await ensureCurrentProject();
    await deleteMaterial(projectPath, String(materialId || ""));
    return { materials: await loadMaterials(projectPath) };
  });

  registerIpcHandler("index:rebuild", async () => {
    const projectPath = await ensureCurrentProject();
    const result = await rebuildIndex(projectPath);
    return { ...result, state: await buildAppState(projectPath) };
  });
}
module.exports = { registerDomain };
