"use strict";
const { registerIpcHandler } = require("../register.cjs");
const {
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
} = require("../domain-dependencies/knowledge.cjs");

function registerDomain() {
  registerIpcHandler("materials:read-image", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const relative = String(payload?.path || "");
    const materialsDir = path.resolve(getMaterialsDir(projectPath));
    const resolved = path.resolve(materialsDir, relative);
    if (!resolved.startsWith(materialsDir + path.sep)) throw new Error("非法的图片路径。");
    const buffer = await fs.readFile(resolved);
    const ext = path.extname(resolved).slice(1).toLowerCase() || "png";
    return { dataUrl: `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${buffer.toString("base64")}` };
  });

  registerIpcHandler("image:get-config", async () => {
    const projectPath = await ensureCurrentProject();
    return imageGen.getConfig(projectPath);
  });

  registerIpcHandler("image:save-config", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return imageGen.saveConfig(projectPath, payload || {});
  });

  registerIpcHandler("image:generate", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return imageGen.generate(projectPath, payload || {});
  });
  registerIpcHandler("embedding:test", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    // 用草稿中的地址/模型覆盖已存配置测试（密钥仍走凭据管理器）。
    const api = {
      ...config.api,
      ...(payload?.embeddingBaseUrl !== undefined ? { embeddingBaseUrl: String(payload.embeddingBaseUrl || "") } : {}),
      ...(payload?.embeddingModel !== undefined ? { embeddingModel: String(payload.embeddingModel || "") } : {}),
    };
    return testEmbedding(api);
  });

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
