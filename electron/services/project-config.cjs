// 本文件源自P2主进程拆分；后续维护与行为修复见Git历史。
"use strict";

const { app } = require("electron");
const { existsSync } = require("node:fs");
const { writeFileAtomic, writeProjectFiles, withProjectTransaction } = require("./project-storage.cjs");
const storyState = require("./story-state.cjs");
const projectSnapshots = require("./project-snapshots.cjs");
const creativeWorkspace = require("./creative-workspace.cjs");
const operationJournal = require("./operation-journal.cjs");
const projectMigrations = require("./project-migrations.cjs");
const novelAgent = require("./novel-agent.cjs");
const { DEFAULT_PROJECT_NAME, MAX_CHAT_TOKENS, MAX_RETRIEVAL_TOP_K, MAX_RETRIEVAL_SCAN_K, DEFAULT_RETRIEVAL_SCAN_K } = require("./constants.cjs");
const { state } = require("./runtime-state.cjs");
const __dep0 = require("./project-files.cjs");
const __dep1 = require("./credentials.cjs");
const path = require("node:path");
const fs = require("node:fs/promises");

function nowIso(...args) { return __dep0.nowIso.apply(null, args); }
function clampNumber(...args) { return __dep0.clampNumber(...args); }
function ensureDir(...args) { return __dep0.ensureDir(...args); }
function writeJson(...args) { return __dep0.writeJson(...args); }
function getConfigPath(...args) { return __dep0.getConfigPath(...args); }
function getVectorsPath(...args) { return __dep0.getVectorsPath(...args); }
function getKnowledgeSummariesPath(...args) { return __dep0.getKnowledgeSummariesPath(...args); }
function getAnalysisDir(...args) { return __dep0.getAnalysisDir(...args); }
function getMaterialsDir(...args) { return __dep0.getMaterialsDir(...args); }
function normalizeChapterFileName(...args) { return __dep0.normalizeChapterFileName(...args); }
function getChapterPath(...args) { return __dep0.getChapterPath(...args); }
function contentRevision(...args) { return __dep0.contentRevision(...args); }
function repairSharedChapterFiles(...args) { return __dep0.repairSharedChapterFiles(...args); }
function contentToPlainText(...args) { return __dep0.contentToPlainText(...args); }
function getChapterVersionContentPath(...args) { return __dep0.getChapterVersionContentPath(...args); }
function listChapterVersions(...args) { return __dep0.listChapterVersions(...args); }
function defaultConfig(...args) { return __dep0.defaultConfig(...args); }
function runtimeSecret(...args) { return __dep1.runtimeSecret(...args); }
function calculateTotalWords(...args) { return __dep0.calculateTotalWords(...args); }
async function ensureProjectStructureUnlocked(projectPath, title) {
  await ensureDir(projectPath);
  await ensureDir(path.join(projectPath, "chapters"));
  await ensureDir(path.join(projectPath, "characters"));
  await ensureDir(path.join(projectPath, "worldbuilding"));
  await ensureDir(path.join(projectPath, "vector_db"));
  await ensureDir(path.join(projectPath, "backups"));
  await ensureDir(getAnalysisDir(projectPath));
  await ensureDir(getMaterialsDir(projectPath));
  await storyState.ensureStoryState(projectPath);
  await projectSnapshots.ensureSnapshotStore(projectPath);
  await creativeWorkspace.ensureWorkspace(projectPath);
  await operationJournal.ensureJournal(projectPath);

  const configPath = getConfigPath(projectPath);
  if (!existsSync(configPath)) {
    const config = defaultConfig(title);
    const chapterFile = path.join(projectPath, "chapters", config.chapters[0].fileName);
    await writeProjectFiles(projectPath, [{ path: chapterFile, content: "# 第一章 开篇\n\n从这里开始写下你的故事。\n" }, { path: configPath, content: JSON.stringify(config, null, 2) }]);
    await writeJson(getVectorsPath(projectPath), { version: 1, updatedAt: nowIso(), vectors: [] });
    await writeJson(getKnowledgeSummariesPath(projectPath), { version: 2, updatedAt: "", sources: [], volumes: [], book: null });
  }
  await projectMigrations.migrateProject(projectPath, {
    createSnapshot: (payload) => projectSnapshots.createSnapshot(projectPath, payload),
  });
}


async function saveConfigUnlocked(projectPath, config) {
  config.updatedAt = nowIso();
  await writeJson(getConfigPath(projectPath), config);
}


function configForRenderer(config) {
  return {
    ...config,
    api: {
      ...config.api,
      apiKey: "",
      embeddingApiKey: "",
      apiKeyConfigured: Boolean(runtimeSecret(config.api, "chat")),
      embeddingApiKeyConfigured: Boolean(runtimeSecret(config.api, "embedding")),
      clearApiKey: false,
      clearEmbeddingApiKey: false,
      credentialStorage: process.platform === "win32" && process.env.NOVEL_PLATFORM_TEST !== "1" ? "windows" : config.api.apiKey ? "legacy" : "none",
      credentialError: String(config.api.__credentialError || ""),
    },
  };
}


function mergeModuleFlags(existingModules, patchModules) {
  if (!existingModules && !patchModules) return undefined;
  const merged = { ...existingModules };
  for (const [slot, value] of Object.entries(patchModules || {})) {
    if (!/^[a-z][a-z0-9-]*$/.test(slot)) continue;
    if (value && typeof value === "object" && typeof value.enabled === "boolean") merged[slot] = { enabled: value.enabled };
  }
  return merged;
}


function configFromRenderer(existingConfig, patch) {
  const api = patch.api || {};
  const ui = patch.ui || {};
  const agent = patch.agent || {};
  const nextTemperature = clampNumber(api.temperature ?? existingConfig.api.temperature, 0, 2, 0.7);
  const nextMaxTokens = Math.floor(clampNumber(api.maxTokens ?? existingConfig.api.maxTokens, 1, MAX_CHAT_TOKENS, 8000));
  const nextTopK = Math.floor(clampNumber(api.topK ?? existingConfig.api.topK, 1, MAX_RETRIEVAL_TOP_K, 120));
  const nextScanK = Math.floor(clampNumber(api.scanK ?? existingConfig.api.scanK, nextTopK, MAX_RETRIEVAL_SCAN_K, DEFAULT_RETRIEVAL_SCAN_K));
  const modules = mergeModuleFlags(existingConfig.modules, patch.modules);
  return {
    ...existingConfig,
    title: patch.title ?? existingConfig.title,
    author: patch.author ?? existingConfig.author,
    api: {
      ...existingConfig.api,
      ...api,
      temperature: nextTemperature,
      maxTokens: nextMaxTokens,
      topK: nextTopK,
      scanK: nextScanK,
      apiKey: existingConfig.api.apiKey,
      embeddingApiKey: existingConfig.api.embeddingApiKey,
    },
    ui: {
      ...existingConfig.ui,
      ...ui,
    },
    agent: {
      ...existingConfig.agent,
      ...agent,
      permissionLevel: novelAgent.normalizePermission(agent.permissionLevel ?? existingConfig.agent.permissionLevel),
    },
    ...(modules ? { modules } : {}),
  };
}


async function getDefaultProjectPath() {
  if (process.env.NOVEL_TEST_PROJECT_PATH) return path.resolve(process.env.NOVEL_TEST_PROJECT_PATH);
  const docs = app.getPath("documents");
  return path.join(docs, "AI小说创作平台", DEFAULT_PROJECT_NAME);
}


function getAppPreferencesPath() {
  return path.join(app.getPath("userData"), "app-preferences.json");
}


async function readAppPreferences() {
  try {
    const parsed = JSON.parse(await fs.readFile(getAppPreferencesPath(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}


async function rememberLastProjectPath(projectPath) {
  if (process.env.NOVEL_TEST_PROJECT_PATH || process.env.NOVEL_PLATFORM_TEST === "1") return;
  try {
    const preferences = await readAppPreferences();
    const preferencesPath = getAppPreferencesPath();
    await ensureDir(path.dirname(preferencesPath));
    await writeFileAtomic(preferencesPath, JSON.stringify({ ...preferences, lastProjectPath: path.resolve(projectPath) }, null, 2));
  } catch {
    // 记住上次项目只影响启动便利性，写入失败不阻断项目打开。
  }
}


async function resolveStartupProjectPath() {
  if (process.env.NOVEL_TEST_PROJECT_PATH) return path.resolve(process.env.NOVEL_TEST_PROJECT_PATH);
  const { lastProjectPath } = await readAppPreferences();
  if (typeof lastProjectPath === "string" && lastProjectPath.trim()) {
    const resolved = path.resolve(lastProjectPath.trim());
    if (existsSync(getConfigPath(resolved))) return resolved;
  }
  return getDefaultProjectPath();
}


function assertExpectedChapterRevision(expectedRevision, currentContent) {
  if (!expectedRevision) return;
  const actualRevision = contentRevision(currentContent);
  if (expectedRevision !== actualRevision) {
    throw new Error("检测到该章节在本次编辑期间已被其他操作修改。为避免覆盖内容，保存已停止；请重新打开章节后对比历史版本。");
  }
}


async function inspectProjectHealth(projectPath) {
  const config = await __dep0.loadConfigUnlocked(projectPath);
  const issues = [];
  const idGroups = new Map();
  const fileGroups = new Map();
  const contentGroups = new Map();
  for (const chapter of config.chapters) {
    if (!idGroups.has(chapter.id)) idGroups.set(chapter.id, []);
    idGroups.get(chapter.id).push(chapter);
    const fileName = normalizeChapterFileName(chapter.fileName);
    if (!fileGroups.has(fileName)) fileGroups.set(fileName, []);
    fileGroups.get(fileName).push(chapter);
    const filePath = getChapterPath(projectPath, chapter);
    if (!fileName || !existsSync(filePath)) {
      issues.push({ code: "missing-file", severity: "高", title: chapter.title, detail: "章节正文文件缺失", chapterId: chapter.id, repairable: true });
      continue;
    }
    const content = await fs.readFile(filePath, "utf8").catch(() => "");
    if (contentToPlainText(content).trim().length >= 100) {
      const hash = contentRevision(content);
      if (!contentGroups.has(hash)) contentGroups.set(hash, []);
      contentGroups.get(hash).push(chapter);
    }
  }
  for (const [id, chapters] of idGroups) {
    if (chapters.length > 1) issues.push({ code: "duplicate-id", severity: "高", title: id, detail: `${chapters.length} 个目录项使用同一章节编号`, repairable: false });
  }
  for (const [fileName, chapters] of fileGroups) {
    if (fileName && chapters.length > 1) issues.push({ code: "shared-file", severity: "高", title: fileName, detail: `${chapters.map((item) => item.title).join("、")}共用一个文件`, repairable: true });
  }
  for (const chapters of contentGroups.values()) {
    if (chapters.length > 1) {
      issues.push({ code: "duplicate-content", severity: "中", title: chapters.map((item) => item.title).join("、"), detail: "多个章节当前内容完全相同，请确认是否误覆盖", repairable: false });
    }
  }
  const sortedOrders = config.chapters.map((item) => Number(item.order)).sort((a, b) => a - b);
  if (sortedOrders.some((order, index) => order !== index)) {
    issues.push({ code: "invalid-order", severity: "中", title: "目录顺序异常", detail: "章节顺序存在重复或断号，可自动重新编号", repairable: true });
  }
  const migrationState = await projectMigrations.loadMigrationState(projectPath);
  if (Number(migrationState.schemaVersion || 0) < projectMigrations.CURRENT_PROJECT_SCHEMA) {
    issues.push({ code: "migration-pending", severity: "高", title: "项目结构尚未升级", detail: `当前 ${migrationState.schemaVersion || 0}，需要 ${projectMigrations.CURRENT_PROJECT_SCHEMA}`, repairable: true });
  }
  const recovery = await operationJournal.getRecoveryStatus(projectPath);
  if (recovery.interruptedOperations.length) {
    issues.push({ code: "interrupted-operations", severity: "中", title: "存在中断操作", detail: `${recovery.interruptedOperations.length} 项操作在异常退出前未完成，请检查恢复中心`, repairable: false });
  }
  const chapterIds = new Set(config.chapters.map((item) => item.id));
  const workspace = await creativeWorkspace.loadWorkspace(projectPath);
  const orphanWorkspaceItems = [
    ...workspace.scenes,
    ...workspace.arcs,
    ...workspace.annotations,
    ...workspace.revisions,
    ...workspace.agentRuns,
  ].filter((item) => item.chapterId && !chapterIds.has(item.chapterId));
  if (orphanWorkspaceItems.length) {
    issues.push({ code: "orphan-workspace", severity: "中", title: "创作工作台存在失效引用", detail: `${orphanWorkspaceItems.length} 条记录指向已删除章节`, repairable: true });
  }
  return {
    checkedAt: nowIso(),
    healthy: issues.every((item) => item.severity !== "高"),
    chapterCount: config.chapters.length,
    recovery: { drafts: recovery.drafts.length, interruptedOperations: recovery.interruptedOperations.length },
    schemaVersion: migrationState.schemaVersion || 0,
    issues,
  };
}


async function repairProjectHealthUnlocked(projectPath) {
  const config = await __dep0.loadConfigUnlocked(projectPath);
  await repairSharedChapterFiles(projectPath, config);
  for (const chapter of config.chapters) {
    if (existsSync(getChapterPath(projectPath, chapter))) continue;
    const versions = await listChapterVersions(projectPath, chapter.id);
    const latest = versions[0];
    if (!latest) continue;
    const content = await fs.readFile(getChapterVersionContentPath(projectPath, chapter.id, latest), "utf8").catch(() => "");
    if (content) await writeFileAtomic(getChapterPath(projectPath, chapter), content, "utf8");
  }
  config.chapters = config.chapters.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0)).map((item, index) => ({ ...item, order: index }));
  const chapterIds = new Set(config.chapters.map((item) => item.id));
  const workspace = await creativeWorkspace.loadWorkspace(projectPath);
  const orphanChapterIds = new Set([
    ...workspace.scenes,
    ...workspace.arcs,
    ...workspace.annotations,
    ...workspace.revisions,
    ...workspace.agentRuns,
  ].map((item) => item.chapterId).filter((id) => id && !chapterIds.has(id)));
  for (const chapterId of orphanChapterIds) await creativeWorkspace.removeChapterReferences(projectPath, chapterId);
  await projectMigrations.migrateProject(projectPath, { createSnapshot: (payload) => projectSnapshots.createSnapshot(projectPath, payload) });
  await calculateTotalWords(projectPath, config);
  await saveConfigUnlocked(projectPath, config);
  return { health: await inspectProjectHealth(projectPath) };
}


let projectSwitchQueue = Promise.resolve();


function runProjectSwitch(action) {
  const operation = projectSwitchQueue.catch(() => null).then(action);
  projectSwitchQueue = operation.then(() => undefined, () => undefined);
  return operation;
}


async function activateProjectSession(projectPath) {
  const key = path.resolve(projectPath);
  if (state.projectSessions.has(key)) return state.projectSessions.get(key);
  // Start the new session first so a failed switch leaves the old project usable.
  const result = await operationJournal.startSession(projectPath, app.getVersion?.() || "");
  for (const [otherPath, session] of state.projectSessions) {
    if (otherPath === key) continue;
    await operationJournal.endSession(otherPath, session.id).catch(() => null);
    state.projectSessions.delete(otherPath);
  }
  state.projectSessions.set(key, result.session);
  return result.session;
}


async function switchCurrentProject(projectPath, title) {
  const target = path.resolve(projectPath);
  return runProjectSwitch(async () => {
    await ensureProjectStructureUnlocked(target, title);
    await activateProjectSession(target);
    state.currentProjectPath = target;
    await rememberLastProjectPath(target);
    return target;
  });
}


async function finishProjectSessions() {
  const entries = [...state.projectSessions.entries()];
  state.projectSessions.clear();
  await Promise.all(entries.map(([projectPath, session]) => operationJournal.endSession(projectPath, session.id).catch(() => null)));
}


async function withJournalOperation(projectPath, payload, action, summarize = (_result) => null) {
  const operation = await operationJournal.beginOperation(projectPath, payload);
  try {
    const result = await action(operation);
    try {
      await operationJournal.completeOperation(projectPath, operation.id, summarize(result));
    } catch (error) {
      if (!result?.committed) throw error;
      return { ...result, journalWarning: `正文已保存，操作日志更新失败：${error?.message || error}。` };
    }
    return result;
  } catch (error) {
    await operationJournal.failOperation(projectPath, operation.id, error).catch(() => null);
    throw error;
  }
}


async function ensureCurrentProject() {
  const projectPath = state.currentProjectPath || (state.currentProjectPath = await getDefaultProjectPath());
  const key = path.resolve(projectPath);
  await withProjectTransaction(projectPath, () => ensureProjectStructureUnlocked(projectPath));
  // A project switch may have started during the await; never activate a stale project.
  if (path.resolve(state.currentProjectPath) === key) await activateProjectSession(projectPath);
  return projectPath;
}


const __moduleExports = {
  ensureProjectStructureUnlocked,
  saveConfigUnlocked,
  configForRenderer,
  configFromRenderer,
  getDefaultProjectPath,
  getAppPreferencesPath,
  readAppPreferences,
  rememberLastProjectPath,
  resolveStartupProjectPath,
  assertExpectedChapterRevision,
  inspectProjectHealth,
  repairProjectHealthUnlocked,
  activateProjectSession,
  switchCurrentProject,
  finishProjectSessions,
  withJournalOperation,
  ensureCurrentProject,
};

// Augment the original exports object so cyclic requires (whose captured
// reference may be a Proxy over the pre-assignment exports) see every key.
Object.assign(module.exports, __moduleExports);
module.exports = __moduleExports;
