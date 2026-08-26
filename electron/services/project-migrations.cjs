const fs = require("node:fs/promises");
const path = require("node:path");
const { ensureDir, readJson, writeJsonAtomic } = require("./project-storage.cjs");

const CURRENT_PROJECT_SCHEMA = 4;

function nowIso() {
  return new Date().toISOString();
}

function migrationStatePath(projectPath) {
  return path.join(projectPath, "analysis", "system", "migrations.json");
}

async function loadMigrationState(projectPath) {
  return readJson(migrationStatePath(projectPath), { version: 1, schemaVersion: 0, history: [], updatedAt: "" });
}

function migrateConfig(config, targetVersion) {
  const next = structuredClone(config || {});
  if (targetVersion >= 1) {
    next.chapters = Array.isArray(next.chapters) ? next.chapters.map((chapter, index) => ({
      ...chapter,
      order: Number.isFinite(Number(chapter.order)) ? Number(chapter.order) : index,
      knowledgeRole: ["大纲", "正文", "补充材料"].includes(chapter.knowledgeRole) ? chapter.knowledgeRole : "正文",
      outline: Array.isArray(chapter.outline) ? chapter.outline : [],
    })) : [];
  }
  if (targetVersion >= 2) {
    next.agent = {
      autoLocalAnalysis: next.agent?.autoLocalAnalysis !== false,
      autoDeepAnalysis: next.agent?.autoDeepAnalysis === true,
      evidenceRequired: next.agent?.evidenceRequired !== false,
      snapshotBeforeBulkChanges: next.agent?.snapshotBeforeBulkChanges !== false,
      ...(next.agent || {}),
    };
  }
  if (targetVersion >= 3) {
    next.ui = { ...(next.ui || {}), recoveryEnabled: next.ui?.recoveryEnabled !== false };
  }
  if (targetVersion >= 4) {
    next.projectSchemaVersion = CURRENT_PROJECT_SCHEMA;
    next.agent = {
      ...(next.agent || {}),
      permissionLevel: ["只读分析", "可创建规划", "可生成修订候选"].includes(next.agent?.permissionLevel)
        ? next.agent.permissionLevel
        : "只读分析",
    };
  }
  return next;
}

async function migrateProject(projectPath, options = {}) {
  const state = await loadMigrationState(projectPath);
  const configPath = path.join(projectPath, "novel.config.json");
  const originalBuffer = await fs.readFile(configPath).catch(() => null);
  if (!originalBuffer) return { migrated: false, from: CURRENT_PROJECT_SCHEMA, to: CURRENT_PROJECT_SCHEMA, state };
  const config = JSON.parse(originalBuffer.toString("utf8"));
  const from = Math.max(Number(state.schemaVersion || 0), Number(config.projectSchemaVersion || 0));
  if (from >= CURRENT_PROJECT_SCHEMA) {
    if (Number(state.schemaVersion || 0) < CURRENT_PROJECT_SCHEMA) {
      const synchronizedState = {
        ...state,
        schemaVersion: CURRENT_PROJECT_SCHEMA,
        updatedAt: nowIso(),
      };
      await ensureDir(path.dirname(migrationStatePath(projectPath)));
      await writeJsonAtomic(migrationStatePath(projectPath), synchronizedState);
      return { migrated: false, from, to: CURRENT_PROJECT_SCHEMA, state: synchronizedState };
    }
    return { migrated: false, from, to: CURRENT_PROJECT_SCHEMA, state };
  }

  const migrationId = `migration_${from}_to_${CURRENT_PROJECT_SCHEMA}_${Date.now()}`;
  const backupDir = path.join(projectPath, "analysis", "system", "migration-backups");
  await ensureDir(backupDir);
  const backupPath = path.join(backupDir, `${migrationId}.json`);
  await fs.writeFile(backupPath, originalBuffer);
  let snapshot = null;
  try {
    snapshot = await options.createSnapshot?.({ name: `项目结构升级 ${from} -> ${CURRENT_PROJECT_SCHEMA}`, reason: "升级前自动快照" });
    const migratedConfig = migrateConfig(config, CURRENT_PROJECT_SCHEMA);
    await writeJsonAtomic(configPath, migratedConfig);
    const completed = {
      id: migrationId, from, to: CURRENT_PROJECT_SCHEMA, status: "已完成", snapshotId: snapshot?.id || snapshot?.snapshot?.id || "",
      backupPath: path.relative(projectPath, backupPath).replaceAll("\\", "/"), startedAt: nowIso(), completedAt: nowIso(), error: "",
    };
    const nextState = { version: 1, schemaVersion: CURRENT_PROJECT_SCHEMA, history: [completed, ...(state.history || [])].slice(0, 50), updatedAt: nowIso() };
    await writeJsonAtomic(migrationStatePath(projectPath), nextState);
    return { migrated: true, from, to: CURRENT_PROJECT_SCHEMA, snapshot, state: nextState };
  } catch (error) {
    await fs.writeFile(configPath, originalBuffer);
    const failed = {
      id: migrationId, from, to: CURRENT_PROJECT_SCHEMA, status: "已回滚", snapshotId: snapshot?.id || snapshot?.snapshot?.id || "",
      backupPath: path.relative(projectPath, backupPath).replaceAll("\\", "/"), startedAt: nowIso(), completedAt: nowIso(), error: error?.message || String(error),
    };
    const nextState = { version: 1, schemaVersion: from, history: [failed, ...(state.history || [])].slice(0, 50), updatedAt: nowIso() };
    await writeJsonAtomic(migrationStatePath(projectPath), nextState);
    throw Object.assign(new Error(`项目结构升级失败，已自动恢复升级前配置：${failed.error}`), { cause: error, migration: failed });
  }
}

module.exports = {
  CURRENT_PROJECT_SCHEMA,
  loadMigrationState,
  migrateConfig,
  migrateProject,
};
