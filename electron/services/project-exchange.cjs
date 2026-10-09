// 本文件由 P2 重构自 electron/main.cjs 机械搬迁（scripts/refactor-split.cjs），逻辑未改动。
"use strict";

const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const { createWriteStream, existsSync } = require("node:fs");
const crypto = require("node:crypto");
const AdmZip = require("adm-zip");
const { writeFileAtomic, writeJsonAtomic, withProjectTransaction, writeProjectFiles } = require("./project-storage.cjs");
const projectSnapshots = require("./project-snapshots.cjs");
const creativeWorkspace = require("./creative-workspace.cjs");
const exchangeSecurity = require("./project-exchange-security.cjs");
const projectArchives = require("./project-archives.cjs");
const { state, sendRendererEvent } = require("./runtime-state.cjs");
const __dep0 = require("./project-files.cjs");
const __dep1 = require("./knowledge-index.cjs");
const __dep2 = require("./project-content.cjs");
const __dep3 = require("./project-ops.cjs");
const path = require("node:path");
const fs = require("node:fs/promises");

function nowIso(...args) { return __dep0.nowIso.apply(null, args); }
function makeId(...args) { return __dep0.makeId(...args); }
function sanitizeFileName(...args) { return __dep0.sanitizeFileName(...args); }
function exportTimestamp(...args) { return __dep0.exportTimestamp(...args); }
function countWords(...args) { return __dep0.countWords(...args); }
function writeJson(...args) { return __dep0.writeJson(...args); }
function normalizeChapterFileName(...args) { return __dep0.normalizeChapterFileName(...args); }
function getChapterPath(...args) { return __dep0.getChapterPath(...args); }
function uniqueChapterFileName(...args) { return __dep0.uniqueChapterFileName(...args); }
function getCharacterPath(...args) { return __dep0.getCharacterPath(...args); }
function parseWorldDocFile(...args) { return __dep0.parseWorldDocFile(...args); }
function buildWorldDocFile(...args) { return __dep0.buildWorldDocFile(...args); }
function writeWorldDoc(...args) { return __dep0.writeWorldDoc(...args); }
function loadCharacters(...args) { return __dep0.loadCharacters(...args); }
function loadWorldDocs(...args) { return __dep0.loadWorldDocs(...args); }
function extractOutline(...args) { return __dep0.extractOutline(...args); }
function loadMaterials(...args) { return __dep1.loadMaterials(...args); }
function saveMaterial(...args) { return __dep1.saveMaterial(...args); }
function rebuildIndex(...args) { return __dep1.rebuildIndex(...args); }
function calculateTotalWords(...args) { return __dep2.calculateTotalWords(...args); }
function loadConfig(...args) { return __dep3.loadConfig(...args); }
function saveConfig(...args) { return __dep3.saveConfig(...args); }
function buildAppState(...args) { return __dep3.buildAppState(...args); }
function buildProjectExchangeArchive(...args) { return __dep3.buildProjectExchangeArchive(...args); }

async function uniqueFileNameInDirectory(directory, requestedBase, extension) {
  const base = sanitizeFileName(requestedBase || "导入资料") || "导入资料";
  let fileName = `${base}${extension}`;
  let counter = 2;
  while (existsSync(path.join(directory, fileName))) fileName = `${base}_${counter++}${extension}`;
  return fileName;
}


function importedCopyTitle(title, existingTitles) {
  const base = String(title || "导入资料").trim() || "导入资料";
  if (!existingTitles.has(base)) {
    existingTitles.add(base);
    return base;
  }
  let counter = 1;
  let candidate = `${base}（导入）`;
  while (existingTitles.has(candidate)) candidate = `${base}（导入 ${++counter}）`;
  existingTitles.add(candidate);
  return candidate;
}


async function buildProjectExchangeArchiveUnlocked(projectPath, targetFile, options = {}) {
  const config = await loadConfig(projectPath);
  const includeWorkspace = options.includeWorkspace !== false;
  const characters = await loadCharacters(projectPath);
  const worldDocs = await loadWorldDocs(projectPath);
  const materials = await loadMaterials(projectPath);
  const exportConfig = {
    version: config.version,
    title: config.title,
    author: config.author,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    chapters: config.chapters.map(({ importedFrom, originalDocxFile, ...chapter }) => ({ ...chapter, importedFrom: undefined, originalDocxFile: undefined })),
  };
  const resourceWarnings = [];
  const manifest = {
    format: "ai-novel-project-exchange",
    version: 1,
    createdAt: nowIso(),
    appVersion: options.appVersion || app.getVersion(),
    project: { title: config.title, author: config.author },
    counts: { chapters: config.chapters.length, characters: characters.length, worldDocs: worldDocs.length, materials: materials.length },
    workspaceIncluded: includeWorkspace,
    resourceWarnings,
    security: { apiSettingsIncluded: false, vectorIndexIncluded: false, backupsIncluded: false, passwordProtected: Boolean(options.password) },
  };
  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));
  zip.addFile("project/novel.config.json", Buffer.from(JSON.stringify(exportConfig, null, 2), "utf8"));
  for (const chapter of config.chapters) {
    const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8");
    const buffer = Buffer.from(await projectArchives.portableValue(content, projectPath, zip, resourceWarnings, chapter.title));
    zip.addFile(`project/chapters/${normalizeChapterFileName(chapter.fileName)}`, buffer);
  }
  for (const card of characters) zip.addFile(`project/characters/${path.basename(card.fileName || `${card.id}.json`)}`, Buffer.from(JSON.stringify(await projectArchives.portableValue({ ...card, fileName: undefined }, projectPath, zip, resourceWarnings, card.name), null, 2), "utf8"));
  for (const doc of worldDocs) zip.addFile(`project/worldbuilding/${path.basename(doc.fileName || `${doc.id}.md`)}`, Buffer.from(await projectArchives.portableValue(buildWorldDocFile(doc), projectPath, zip, resourceWarnings, doc.title), "utf8"));
  for (const item of materials) zip.addFile(`project/materials/${item.id}.json`, Buffer.from(JSON.stringify(await projectArchives.portableValue(item, projectPath, zip, resourceWarnings, item.title), null, 2), "utf8"));
  if (includeWorkspace) {
    const workspace = await creativeWorkspace.loadWorkspace(projectPath);
    zip.addFile("project/analysis/creative-workspace/state.json", Buffer.from(JSON.stringify(await projectArchives.portableValue(workspace, projectPath, zip, resourceWarnings), null, 2), "utf8"));
  }
  manifest.counts.assets = zip.getEntries().filter((entry) => entry.entryName.startsWith("project/assets/")).length;
  zip.updateFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
  const archive = zip.toBuffer();
  const output = options.password ? await exchangeSecurity.encryptBuffer(archive, options.password) : archive;
  await writeFileAtomic(targetFile, output);
  return { filePath: targetFile, manifest, encrypted: Boolean(options.password) };
}


async function exportProjectExchange(projectPath, options = {}) {
  const config = await loadConfig(projectPath);
  const result = await dialog.showSaveDialog(state.mainWindow, {
    title: "导出项目交换包",
    defaultPath: path.join(projectPath, `${sanitizeFileName(config.title || "小说项目")}_交换包_${exportTimestamp()}${options.password ? ".ainovelx" : ".ainovel.zip"}`),
    filters: options.password ? [{ name: "加密 AI 小说项目交换包", extensions: ["ainovelx"] }] : [{ name: "AI 小说项目交换包", extensions: ["zip"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  return buildProjectExchangeArchive(projectPath, result.filePath, options);
}


function readExchangeJson(zip, entryName, fallback = null) {
  const entry = zip.getEntry(entryName);
  if (!entry) return fallback;
  try {
    return JSON.parse(zip.readAsText(entry));
  } catch {
    return fallback;
  }
}


async function previewProjectExchange(projectPath, options = {}) {
  let token = String(options.token || "");
  let pending = token ? state.pendingExchangeImports.get(token) : null;
  let filePath = pending?.filePath || "";
  if (!filePath) {
    const result = await dialog.showOpenDialog(state.mainWindow, { title: "选择项目交换包", properties: ["openFile"], filters: [{ name: "AI 小说项目交换包", extensions: ["zip", "ainovelx"] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    filePath = result.filePaths[0];
    token = crypto.randomBytes(16).toString("hex");
    pending = { filePath, projectPath, createdAt: Date.now() };
    state.pendingExchangeImports.set(token, pending);
  }
  if ((await fs.stat(filePath)).size > projectArchives.ARCHIVE_LIMITS.compressed) throw new Error("交换包超过 100 MB 上限。");
  const raw = await fs.readFile(filePath);
  const encrypted = exchangeSecurity.isEncrypted(raw);
  if (encrypted && !options.password) return { token, filePath, encrypted: true, requiresPassword: true };
  const zip = await projectArchives.readExchangeArchive(filePath, options.password || "");
  const manifest = readExchangeJson(zip, "manifest.json", null);
  const importedConfig = readExchangeJson(zip, "project/novel.config.json", null);
  if (manifest?.format !== "ai-novel-project-exchange" || !Array.isArray(importedConfig?.chapters)) throw new Error("这不是有效的 AI 小说项目交换包。");
  const currentConfig = await loadConfig(projectPath);
  const currentCharacters = await loadCharacters(projectPath);
  const currentWorld = await loadWorldDocs(projectPath);
  const importedCharacterNames = zip.getEntries().filter((entry) => entry.entryName.startsWith("project/characters/") && !entry.isDirectory).map((entry) => readExchangeJson(zip, entry.entryName, {})?.name).filter(Boolean);
  const importedWorldTitles = zip.getEntries().filter((entry) => entry.entryName.startsWith("project/worldbuilding/") && !entry.isDirectory).map((entry) => parseWorldDocFile(path.basename(entry.entryName), zip.readAsText(entry)).title);
  const conflicts = {
    chapters: importedConfig.chapters.filter((item) => currentConfig.chapters.some((current) => current.title === item.title)).map((item) => item.title),
    characters: importedCharacterNames.filter((name) => currentCharacters.some((item) => item.name === name)),
    worldDocs: importedWorldTitles.filter((title) => currentWorld.some((item) => item.title === title)),
  };
  state.pendingExchangeImports.set(token, { filePath, projectPath, createdAt: Date.now(), encrypted });
  for (const [key, pending] of state.pendingExchangeImports) if (Date.now() - pending.createdAt > 30 * 60 * 1000) state.pendingExchangeImports.delete(key);
  return { token, filePath, manifest, conflicts, encrypted, requiresPassword: false };
}


async function importProjectExchangeUnlocked(projectPath, token, options = {}) {
  const pending = state.pendingExchangeImports.get(String(token || ""));
  if (!pending || path.resolve(pending.projectPath) !== path.resolve(projectPath)) throw new Error("交换包预览已失效，请重新选择文件。");
  const zip = await projectArchives.readExchangeArchive(pending.filePath, options.password || "");
  const importedConfig = readExchangeJson(zip, "project/novel.config.json", null);
  if (!Array.isArray(importedConfig?.chapters)) throw new Error("交换包缺少项目目录信息。");
  const safetySnapshot = await projectSnapshots.createSnapshot(projectPath, { name: "导入项目交换包前", reason: `导入 ${path.basename(pending.filePath)} 前自动保存` });
  try {
  const assetMap = await projectArchives.importExchangeAssets(projectPath, zip, makeId("exchange"));
  const config = await loadConfig(projectPath);
  const chapterTitles = new Set(config.chapters.map((item) => item.title));
  const chapterIdMap = new Map();
  let importedChapters = 0;
  for (const source of options.includeChapters === false ? [] : importedConfig.chapters) {
    const entry = zip.getEntry(`project/chapters/${normalizeChapterFileName(source.fileName)}`);
    if (!entry) continue;
    const id = makeId("chapter");
    chapterIdMap.set(source.id, id);
    const extension = [".html", ".md"].includes(path.extname(source.fileName).toLowerCase()) ? path.extname(source.fileName).toLowerCase() : ".md";
    const title = importedCopyTitle(source.title, chapterTitles);
    const fileName = await uniqueChapterFileName(projectPath, config, `${sanitizeFileName(title)}_import`, extension);
    const content = projectArchives.remapAssetValue(zip.readAsText(entry), assetMap);
    await writeFileAtomic(path.join(projectPath, "chapters", fileName), content, "utf8");
    config.chapters.push({ ...source, id, title, fileName, order: config.chapters.length, importedFrom: undefined, originalDocxFile: undefined, wordCount: countWords(content), outline: extractOutline(content), createdAt: nowIso(), updatedAt: nowIso() });
    importedChapters += 1;
  }
  await calculateTotalWords(projectPath, config);
  await saveConfig(projectPath, config);

  const existingCharacters = await loadCharacters(projectPath);
  const characterNames = new Set(existingCharacters.map((item) => item.name));
  let importedCharacters = 0;
  for (const entry of (options.includeCharacters === false ? [] : zip.getEntries().filter((item) => item.entryName.startsWith("project/characters/") && !item.isDirectory))) {
    const source = projectArchives.remapAssetValue(readExchangeJson(zip, entry.entryName, null), assetMap);
    if (!source) continue;
    const id = makeId("character");
    const card = { ...source, id, name: importedCopyTitle(source.name, characterNames), fileName: `${id}.json`, createdAt: source.createdAt || nowIso(), updatedAt: nowIso() };
    await writeJson(getCharacterPath(projectPath, card), card);
    importedCharacters += 1;
  }

  const existingWorld = await loadWorldDocs(projectPath);
  const worldTitles = new Set(existingWorld.map((item) => item.title));
  let importedWorldDocs = 0;
  for (const entry of (options.includeWorld === false ? [] : zip.getEntries().filter((item) => item.entryName.startsWith("project/worldbuilding/") && !item.isDirectory))) {
    const source = parseWorldDocFile(path.basename(entry.entryName), projectArchives.remapAssetValue(zip.readAsText(entry), assetMap));
    const id = makeId("world");
    const fileName = await uniqueFileNameInDirectory(path.join(projectPath, "worldbuilding"), id, ".md");
    await writeWorldDoc(projectPath, { ...source, id, title: importedCopyTitle(source.title, worldTitles), fileName, updatedAt: nowIso() });
    importedWorldDocs += 1;
  }

  let importedMaterials = 0;
  for (const entry of (options.includeMaterials === false ? [] : zip.getEntries().filter((item) => item.entryName.startsWith("project/materials/") && !item.isDirectory))) {
    const source = projectArchives.remapAssetValue(readExchangeJson(zip, entry.entryName, null), assetMap);
    if (!source) continue;
    await saveMaterial(projectPath, { ...source, id: makeId("material"), title: `${source.title || "导入素材"}${options.renameMaterials === false ? "" : "（导入）"}` });
    importedMaterials += 1;
  }
  const importedWorkspace = projectArchives.remapAssetValue(readExchangeJson(zip, "project/analysis/creative-workspace/state.json", null), assetMap);
  if (importedWorkspace && options.includeWorkspace !== false && options.includeChapters !== false) await creativeWorkspace.mergeImportedWorkspace(projectPath, importedWorkspace, chapterIdMap);
  await rebuildIndex(projectPath);
  state.pendingExchangeImports.delete(String(token || ""));
  return { state: await buildAppState(projectPath), imported: { chapters: importedChapters, characters: importedCharacters, worldDocs: importedWorldDocs, materials: importedMaterials }, renamedConflicts: true, resourceWarnings: readExchangeJson(zip, "manifest.json", {})?.resourceWarnings || [] };
  } catch (error) {
    try { await projectSnapshots.restoreSnapshot(projectPath, safetySnapshot.id, { skipSafetySnapshot: true }); }
    catch (rollbackError) { error.message += `；回滚失败，请恢复快照 ${safetySnapshot.id}：${rollbackError.message}`; }
    throw error;
  }
}


const __moduleExports = {
  uniqueFileNameInDirectory,
  importedCopyTitle,
  buildProjectExchangeArchiveUnlocked,
  exportProjectExchange,
  readExchangeJson,
  previewProjectExchange,
  importProjectExchangeUnlocked,
};

// Augment the original exports object so cyclic requires (whose captured
// reference may be a Proxy over the pre-assignment exports) see every key.
Object.assign(module.exports, __moduleExports);
module.exports = __moduleExports;
