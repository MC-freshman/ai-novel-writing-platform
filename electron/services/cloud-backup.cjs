"use strict";
// 云备份（P80）：归档式备份到 WebDAV 或本地网盘同步目录。
// 复用项目交换包格式（已排除密钥/向量库）；单写者原则，不做实时目录同步（审计 A2/T6）。
// 恢复=下载→交换包预览→确认导入（自动安全快照）。密码走 Windows 凭据管理器。
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const crypto = require("node:crypto");
const { readAppPreferences, getAppPreferencesPath } = require("./project-config.cjs");
const { ensureDir, writeFileAtomic } = require("./project-storage.cjs");
const { previewProjectExchange } = require("./project-exchange.cjs");
const { state } = require("./runtime-state.cjs");
const windowsCredentials = require("./windows-credentials.cjs");
const { sanitizeFileName, exportTimestamp } = require("./project-files.cjs");
const { loadConfig, buildProjectExchangeArchive } = require("./project-ops.cjs");

const CREDENTIAL_KIND = "cloud-backup";
const BACKUP_PREFIX = "novel-backup_";

async function readSettings() {
  const preferences = await readAppPreferences();
  const saved = preferences?.cloudBackup && typeof preferences.cloudBackup === "object" ? preferences.cloudBackup : {};
  return {
    targetType: saved.targetType === "webdav" ? "webdav" : "local",
    localDir: String(saved.localDir || ""),
    webdavUrl: String(saved.webdavUrl || ""),
    webdavDir: String(saved.webdavDir || "/novel-backups"),
    username: String(saved.username || ""),
  };
}

async function getStatus(projectPath) {
  const settings = await readSettings();
  let hasPassword;
  try { hasPassword = Boolean(await windowsCredentials.getSecret(projectPath, CREDENTIAL_KIND)); } catch { hasPassword = false; }
  const schedule = await getSchedule();
  return { settings, hasPassword, schedule };
}

async function saveSettings(projectPath, payload) {
  const next = {
    targetType: payload?.targetType === "webdav" ? "webdav" : "local",
    localDir: String(payload?.localDir || "").trim(),
    webdavUrl: String(payload?.webdavUrl || "").trim().replace(/\/$/, ""),
    webdavDir: String(payload?.webdavDir || "/novel-backups").trim() || "/novel-backups",
    username: String(payload?.username || "").trim(),
  };
  if (next.targetType === "local" && !next.localDir) throw new Error("请填写本地备份目录（可指向网盘同步盘目录）。");
  if (next.targetType === "webdav" && !next.webdavUrl) throw new Error("请填写 WebDAV 地址。");
  const preferences = await readAppPreferences();
  const preferencesPath = getAppPreferencesPath();
  await ensureDir(path.dirname(preferencesPath));
  await writeFileAtomic(preferencesPath, JSON.stringify({ ...preferences, cloudBackup: next }, null, 2));
  if (typeof payload?.password === "string" && payload.password) {
    await windowsCredentials.setSecret(projectPath, CREDENTIAL_KIND, payload.password);
  }
  if (payload?.clearPassword === true) {
    await windowsCredentials.deleteSecret(projectPath, CREDENTIAL_KIND).catch(() => {});
  }
  return getStatus(projectPath);
}

async function webdavClient(projectPath, settings) {
  const { createClient } = require("webdav");
  const password = await windowsCredentials.getSecret(projectPath, CREDENTIAL_KIND);
  return createClient(settings.webdavUrl, { username: settings.username, password });
}

function backupFileName(title) {
  return `${BACKUP_PREFIX}${sanitizeFileName(title || "小说项目")}_${exportTimestamp()}.ainovel.zip`;
}

async function upload(projectPath) {
  const settings = await readSettings();
  const config = await loadConfig(projectPath);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "novel-cloud-"));
  const fileName = backupFileName(config.title);
  const tempFile = path.join(tempDir, fileName);
  try {
    await buildProjectExchangeArchive(projectPath, tempFile, {});
    const buffer = await fs.readFile(tempFile);
    if (settings.targetType === "local") {
      await ensureDir(settings.localDir);
      const target = path.join(settings.localDir, fileName);
      await fs.writeFile(target, buffer);
      return { fileName, size: buffer.length, target };
    }
    const client = await webdavClient(projectPath, settings);
    const remoteDir = settings.webdavDir.replace(/\/$/, "");
    await client.createDirectory(remoteDir, { recursive: true }).catch(() => {});
    const remotePath = `${remoteDir}/${fileName}`;
    await client.putFileContents(remotePath, buffer, { overwrite: false });
    return { fileName, size: buffer.length, target: remotePath };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function list(projectPath) {
  const settings = await readSettings();
  if (settings.targetType === "local") {
    if (!settings.localDir) return { backups: [] };
    const entries = await fs.readdir(settings.localDir, { withFileTypes: true }).catch(() => []);
    const backups = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith(BACKUP_PREFIX)) continue;
      const stat = await fs.stat(path.join(settings.localDir, entry.name)).catch(() => null);
      if (stat) backups.push({ name: entry.name, size: stat.size, lastmod: stat.mtime.toISOString() });
    }
    return { backups: backups.sort((a, b) => b.lastmod.localeCompare(a.lastmod)) };
  }
  const client = await webdavClient(projectPath, settings);
  const remoteDir = settings.webdavDir.replace(/\/$/, "");
  const contents = /** @type {any} */ (await client.getDirectoryContents(remoteDir).catch(() => []));
  const items = /** @type {any[]} */ (Array.isArray(contents) ? contents : (contents?.data || []));
  const backups = items
    .filter((item) => item.type === "file" && String(item.basename || item.filename || "").startsWith(BACKUP_PREFIX))
    .map((item) => ({ name: item.basename || path.basename(item.filename), size: item.size || 0, lastmod: item.lastmod || "" }))
    .sort((a, b) => String(b.lastmod).localeCompare(String(a.lastmod)));
  return { backups };
}

/** 下载备份并生成交换包预览（token）；确认导入走既有 project:import-exchange（自动安全快照）。 */
async function restorePreview(projectPath, payload) {
  const name = String(payload?.name || "");
  if (!name.startsWith(BACKUP_PREFIX)) throw new Error("无效的备份文件名。");
  const settings = await readSettings();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "novel-restore-"));
  const tempFile = path.join(tempDir, name);
  if (settings.targetType === "local") {
    const source = path.join(settings.localDir, name);
    await fs.copyFile(source, tempFile);
  } else {
    const client = await webdavClient(projectPath, settings);
    const remotePath = `${settings.webdavDir.replace(/\/$/, "")}/${name}`;
    const raw = /** @type {any} */ (await client.getFileContents(remotePath));
    const buffer = Buffer.isBuffer(raw) ? raw : (raw && raw.data ? Buffer.from(raw.data) : Buffer.from(raw));
    await fs.writeFile(tempFile, buffer);
  }
  const token = crypto.randomBytes(16).toString("hex");
  state.pendingExchangeImports.set(token, { filePath: tempFile, projectPath, createdAt: Date.now() });
  const preview = await previewProjectExchange(projectPath, { token });
  return { token, preview, tempFile };
}

module.exports = { CREDENTIAL_KIND, BACKUP_PREFIX, readSettings, getStatus, saveSettings, upload, list, restorePreview, getSchedule, saveSchedule, startScheduler, stopScheduler };

// ---- 定时备份（P96）----
let scheduleTimer = null;
let scheduleRunning = false;

async function getSchedule() {
  const preferences = await readAppPreferences();
  const saved = preferences?.cloudBackupSchedule && typeof preferences.cloudBackupSchedule === "object" ? preferences.cloudBackupSchedule : {};
  return {
    enabled: saved.enabled === true,
    intervalHours: Math.min(168, Math.max(1, Number(saved.intervalHours) || 24)),
    lastRunAt: String(saved.lastRunAt || ""),
    lastError: String(saved.lastError || ""),
    lastFile: String(saved.lastFile || ""),
  };
}

async function writeScheduleState(patch) {
  const preferences = await readAppPreferences();
  const current = preferences?.cloudBackupSchedule || {};
  const preferencesPath = getAppPreferencesPath();
  await ensureDir(path.dirname(preferencesPath));
  await writeFileAtomic(preferencesPath, JSON.stringify({ ...preferences, cloudBackupSchedule: { ...current, ...patch } }, null, 2));
}

async function saveSchedule(payload) {
  const intervalHours = Number(payload?.intervalHours);
  if (!Number.isFinite(intervalHours) || intervalHours < 1 || intervalHours > 168) throw new Error("备份间隔须在 1–168 小时之间。");
  await writeScheduleState({ enabled: payload?.enabled === true, intervalHours: Math.floor(intervalHours) });
  restartScheduler();
  return getSchedule();
}

async function runScheduledBackup() {
  if (scheduleRunning) return;
  const projectPath = state.currentProjectPath;
  if (!projectPath) return;
  scheduleRunning = true;
  const at = new Date().toISOString();
  try {
    const result = await upload(projectPath);
    await writeScheduleState({ lastRunAt: at, lastError: "", lastFile: result.fileName });
  } catch (error) {
    await writeScheduleState({ lastRunAt: at, lastError: String(error?.message || error).slice(0, 200) }).catch(() => {});
  } finally {
    scheduleRunning = false;
  }
}

function stopScheduler() {
  if (scheduleTimer) clearInterval(scheduleTimer);
  scheduleTimer = null;
}

function restartScheduler() {
  stopScheduler();
  void getSchedule().then((schedule) => {
    if (!schedule.enabled) return;
    scheduleTimer = setInterval(() => void runScheduledBackup(), schedule.intervalHours * 3600 * 1000);
    if (typeof scheduleTimer.unref === "function") scheduleTimer.unref();
  }).catch(() => {});
}

function startScheduler() {
  restartScheduler();
}