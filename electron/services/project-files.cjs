// 本文件由 P2 重构自 electron/main.cjs 机械搬迁（scripts/refactor-split.cjs），逻辑未改动。
"use strict";

const { toUSVString } = require("node:util");
const { createWriteStream, existsSync } = require("node:fs");
const crypto = require("node:crypto");
const AdmZip = require("adm-zip");
const { parse: parseHtml } = require("node-html-parser");
const { writeFileAtomic, writeJsonAtomic, withProjectTransaction, writeProjectFiles } = require("./project-storage.cjs");
const projectMigrations = require("./project-migrations.cjs");
const { DEFAULT_CHAT_BASE_URL, DEFAULT_EMBEDDING_BASE_URL, DEFAULT_PROJECT_NAME, DEFAULT_RETRIEVAL_SCAN_K, DEFAULT_CATEGORY } = require("./constants.cjs");
const { state, sendRendererEvent } = require("./runtime-state.cjs");
const __dep0 = require("./credentials.cjs");
const __dep1 = require("./project-ops.cjs");
const path = require("node:path");
const fs = require("node:fs/promises");

function loadCredentialSecrets(...args) { return __dep0.loadCredentialSecrets(...args); }
function loadConfig(...args) { return __dep1.loadConfig(...args); }

function nowIso() {
  return new Date().toISOString();
}


function todayKey() {
  return new Date().toISOString().slice(0, 10);
}


function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}


function sanitizeFileName(name) {
  return String(name || "未命名")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}


function sanitizeExportPathSegment(value, fallback = "未分类") {
  let segment = String(value || fallback)
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 80);
  if (!segment || segment === "." || segment === "..") segment = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)) segment = `_${segment}`;
  return segment;
}


function exportCategorySegments(value, fallback = "未分类") {
  const segments = String(value || "")
    .split(/[\\/]+/)
    .map((item) => item.trim())
    .filter((item) => item && item !== "." && item !== "..")
    .map((item) => sanitizeExportPathSegment(item, fallback));
  return segments.length ? segments : [sanitizeExportPathSegment(fallback, "未分类")];
}


function exportTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}


async function createUniqueDirectory(parentDirectory, baseName) {
  const safeBaseName = sanitizeExportPathSegment(baseName, "小说导出");
  let directoryPath = path.join(parentDirectory, safeBaseName);
  let index = 2;
  while (existsSync(directoryPath)) {
    directoryPath = path.join(parentDirectory, `${safeBaseName}_${index}`);
    index += 1;
  }
  await fs.mkdir(directoryPath, { recursive: true });
  return directoryPath;
}


async function uniqueExportFileName(directory, title, extension = ".docx") {
  const safeTitle = sanitizeExportPathSegment(title, "未命名文档");
  let fileName = `${safeTitle}${extension}`;
  let index = 2;
  while (existsSync(path.join(directory, fileName))) {
    fileName = `${safeTitle}_${index}${extension}`;
    index += 1;
  }
  return fileName;
}


function normalizeCategory(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40) || DEFAULT_CATEGORY;
}


function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}


async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, Math.floor(limit)), items.length || 1);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    }),
  );
  return results;
}


function sanitizeDocxText(value) {
  return toUSVString(String(value || ""))
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE\uFFFF]/g, "");
}


function stripWordBookmarkXml(xml) {
  return String(xml || "")
    .replace(/<w:bookmarkStart\b[^>]*\/>/g, "")
    .replace(/<w:bookmarkStart\b[^>]*>[\s\S]*?<\/w:bookmarkStart>/g, "")
    .replace(/<w:bookmarkEnd\b[^>]*\/>/g, "");
}


async function normalizeExportedDocxBuffer(buffer) {
  const zip = new AdmZip(buffer);
  let changed = false;
  for (const entry of zip.getEntries()) {
    if (!/^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(entry.entryName)) continue;
    const original = entry.getData().toString("utf8");
    const cleaned = stripWordBookmarkXml(original);
    if (cleaned !== original) {
      zip.updateFile(entry.entryName, Buffer.from(cleaned, "utf8"));
      changed = true;
    }
  }
  return changed ? zip.toBuffer() : buffer;
}


function countWords(text) {
  const clean = contentToPlainText(text);
  const cjk = (clean.match(/[\u4e00-\u9fff]/g) || []).length;
  const words = (clean.replace(/[\u4e00-\u9fff]/g, " ").match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || []).length;
  return cjk + words;
}


async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}


async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}


async function writeJson(file, data) {
  await writeJsonAtomic(file, data);
}


async function backupUnreadableConfig(projectPath, configPath, error) {
  if (!existsSync(configPath)) return;
  const backupDir = path.join(projectPath, "backups", "config_corrupt");
  await ensureDir(backupDir);
  const stamp = nowIso().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `novel.config_${stamp}.json`);
  await fs.copyFile(configPath, backupPath).catch(() => null);
  throw new Error(`项目配置文件读取失败。为避免覆盖原项目，软件已停止打开并备份问题配置：${backupPath}。原始错误：${error.message}`);
}


async function readProjectConfig(projectPath) {
  const configPath = getConfigPath(projectPath);
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    await backupUnreadableConfig(projectPath, configPath, error);
    return defaultConfig();
  }
}


function getConfigPath(projectPath) {
  return path.join(projectPath, "novel.config.json");
}


function getVectorsPath(projectPath) {
  return path.join(projectPath, "vector_db", "vectors.json");
}


function getKnowledgeSummariesPath(projectPath) {
  return path.join(projectPath, "vector_db", "summaries.json");
}


function getAnalysisDir(projectPath) {
  return path.join(projectPath, "analysis");
}


function getAnalysisStatePath(projectPath) {
  return path.join(getAnalysisDir(projectPath), "snapshot.json");
}


function getIssueStatusPath(projectPath) {
  return path.join(getAnalysisDir(projectPath), "issue-status.json");
}


function getMaterialsDir(projectPath) {
  return path.join(projectPath, "materials");
}


function normalizeChapterFileName(fileName) {
  return path.basename(String(fileName || ""));
}


function getChapterPath(projectPath, chapter) {
  return path.join(projectPath, "chapters", normalizeChapterFileName(chapter?.fileName));
}


function contentRevision(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}


async function cachedChapterRevision(projectPath, chapter) {
  const filePath = getChapterPath(projectPath, chapter);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) {
    state.chapterRevisionCache.delete(filePath);
    return contentRevision("");
  }
  const signature = `${stat.size}|${stat.mtimeMs}|${stat.ctimeMs}`;
  const cached = state.chapterRevisionCache.get(filePath);
  if (cached?.signature === signature) return cached.revision;
  const content = await fs.readFile(filePath, "utf8").catch(() => "");
  const revision = contentRevision(content);
  state.chapterRevisionCache.set(filePath, { signature, revision });
  if (state.chapterRevisionCache.size > 3000) state.chapterRevisionCache.delete(state.chapterRevisionCache.keys().next().value);
  return revision;
}


function getOriginalDocumentPath(projectPath, chapter) {
  if (chapter?.originalDocxFile) {
    return path.isAbsolute(chapter.originalDocxFile) ? chapter.originalDocxFile : path.join(projectPath, chapter.originalDocxFile);
  }
  if (chapter?.importedFrom && path.extname(chapter.importedFrom).toLowerCase() === ".docx") return chapter.importedFrom;
  return "";
}


async function uniqueFileName(dir, baseName, extension) {
  let fileName = `${sanitizeFileName(baseName)}${extension}`;
  let index = 2;
  while (existsSync(path.join(dir, fileName))) {
    fileName = `${sanitizeFileName(baseName)}_${index}${extension}`;
    index += 1;
  }
  return fileName;
}


async function uniqueFileNameAvoiding(dir, baseName, extension, reserved = new Set()) {
  const ext = String(extension || ".md").startsWith(".") ? String(extension || ".md") : `.${extension}`;
  const safeBaseName = sanitizeFileName(baseName || "未命名");
  let fileName = `${safeBaseName}${ext}`;
  let index = 2;
  while (reserved.has(fileName) || existsSync(path.join(dir, fileName))) {
    fileName = `${safeBaseName}_${index}${ext}`;
    index += 1;
  }
  return fileName;
}


function normalizeManagedFileName(fileName, extension) {
  const ext = String(extension || "").startsWith(".") ? String(extension || "") : `.${extension || ""}`;
  const raw = path.basename(String(fileName || ""));
  if (!raw) return "";
  return raw.toLowerCase().endsWith(ext.toLowerCase()) ? raw : `${sanitizeFileName(raw)}${ext}`;
}


function normalizeDataId(value) {
  const raw = path.basename(String(value || "")).replace(/\.(json|md|html)$/i, "").trim();
  if (!raw) return "";
  return raw
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}


function normalizeChapterVersionFileName(fileName) {
  const raw = path.basename(String(fileName || ""));
  return /\.(md|html)$/i.test(raw) ? raw : "";
}


function getMaterialPath(projectPath, materialId) {
  return path.join(getMaterialsDir(projectPath), `${normalizeDataId(materialId)}.json`);
}


async function uniqueFileNameAllowingCurrent(dir, baseName, extension, currentFileName = "") {
  const ext = String(extension || ".md").startsWith(".") ? String(extension || ".md") : `.${extension}`;
  const safeBaseName = sanitizeFileName(baseName || "未命名");
  const current = normalizeManagedFileName(currentFileName, ext);
  let fileName = `${safeBaseName}${ext}`;
  let index = 2;
  while (fileName !== current && existsSync(path.join(dir, fileName))) {
    fileName = `${safeBaseName}_${index}${ext}`;
    index += 1;
  }
  return fileName;
}


async function uniqueContentFileName(projectPath, dirName, baseName, extension, currentFileName = "") {
  const dir = path.join(projectPath, dirName);
  await ensureDir(dir);
  return uniqueFileNameAllowingCurrent(dir, baseName, extension, currentFileName);
}


async function uniqueChapterFileName(projectPath, config, baseName, extension, excludeChapterId = "") {
  const chapterDir = path.join(projectPath, "chapters");
  const reserved = new Set(
    (config.chapters || [])
      .filter((chapter) => chapter.id !== excludeChapterId)
      .map((chapter) => normalizeChapterFileName(chapter.fileName))
      .filter(Boolean),
  );
  return uniqueFileNameAvoiding(chapterDir, baseName, extension, reserved);
}


function getSharedChapterFileGroups(config) {
  const groups = new Map();
  for (const chapter of config.chapters || []) {
    const fileName = normalizeChapterFileName(chapter.fileName);
    if (!fileName) continue;
    if (!groups.has(fileName)) groups.set(fileName, []);
    groups.get(fileName).push(chapter);
  }
  return [...groups.entries()]
    .filter(([, chapters]) => chapters.length > 1)
    .map(([fileName, chapters]) => ({
      fileName,
      chapters: chapters.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    }));
}


async function ensureExclusiveChapterFile(projectPath, config, chapter, contentOverride = null, options = {}) {
  if (!chapter) return false;
  const chapterDir = path.join(projectPath, "chapters");
  await ensureDir(chapterDir);

  const currentFileName = normalizeChapterFileName(chapter.fileName);
  const users = (config.chapters || []).filter((item) => normalizeChapterFileName(item.fileName) === currentFileName);
  if (currentFileName && users.length <= 1) return false;

  let content = contentOverride;
  if (content === null || content === undefined) {
    content = currentFileName ? await fs.readFile(path.join(chapterDir, currentFileName), "utf8").catch(() => "") : "";
  }
  if (!String(content || "").trim()) content = `# ${chapter.title || "未命名章节"}\n\n`;

  if (options.snapshot !== false) {
    await snapshotChapterVersion(projectPath, chapter, content, options.reason || "拆分共享章节文件前版本");
  }

  const extension = path.extname(currentFileName).toLowerCase() || (isHtmlContent(content) ? ".html" : ".md");
  const fallbackBase = `chapter_${String((chapter.order ?? 0) + 1).padStart(3, "0")}_${chapter.title || "未命名章节"}`;
  const baseName = path.basename(currentFileName || fallbackBase, extension) || fallbackBase;
  chapter.fileName = await uniqueChapterFileName(projectPath, config, baseName, extension, chapter.id);
  chapter.wordCount = countWords(content);
  chapter.outline = extractOutline(content);
  chapter.updatedAt = nowIso();
  await writeFileAtomic(getChapterPath(projectPath, chapter), content, "utf8");
  return true;
}


async function repairSharedChapterFiles(projectPath, config) {
  const repaired = [];
  for (const group of getSharedChapterFileGroups(config)) {
    const sharedPath = path.join(projectPath, "chapters", group.fileName);
    const content = await fs.readFile(sharedPath, "utf8").catch(() => "");
    for (const chapter of group.chapters.slice(1)) {
      const previousFileName = normalizeChapterFileName(chapter.fileName);
      const changed = await ensureExclusiveChapterFile(projectPath, config, chapter, content, {
        snapshot: false,
        reason: "自动拆分共享章节文件",
      });
      if (changed) repaired.push({ chapterId: chapter.id, title: chapter.title, from: previousFileName, to: chapter.fileName });
    }
  }
  if (repaired.length) {
    config.updatedAt = nowIso();
    await writeJson(getConfigPath(projectPath), config);
  }
  return repaired;
}


function extensionFromContentType(contentType) {
  const map = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "image/webp": ".webp",
    "image/tiff": ".tiff",
    "image/svg+xml": ".svg",
  };
  return map[contentType] || ".png";
}


function isHtmlContent(content) {
  return /<\/?(h[1-6]|p|div|table|img|ul|ol|li|blockquote|section|details|summary|figure)\b/i.test(String(content || ""));
}


function decodeBasicEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}


function contentToPlainText(content) {
  return decodeBasicEntities(
    String(content || "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<img\b[^>]*alt=["']?([^"'>]*)["']?[^>]*>/gi, " $1 ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr|table|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
      .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
      .replace(/https?:\/\/\S+|file:\/\/\/\S+/g, " ")
      .replace(/[*_`~>#|-]/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n"),
  ).trim();
}


function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


function promoteMarkdownHeadingsInHtml(html) {
  const root = parseHtml(String(html || ""));
  root.querySelectorAll("p,div").forEach((node) => {
    if (node.querySelector("img,table,ul,ol,blockquote")) return;
    const text = decodeBasicEntities(String(node.text || node.rawText || "").replace(/\s+/g, " ")).trim();
    const match = text.match(/^(#{1,6})\s+(.+)$/);
    if (!match) return;
    node.replaceWith(`<h${match[1].length}>${escapeHtml(match[2].trim())}</h${match[1].length}>`);
  });
  return root.toString();
}


function getCharacterPath(projectPath, card) {
  const fileName = normalizeManagedFileName(card?.fileName, ".json") || `${sanitizeFileName(card?.name || card?.id)}.json`;
  return path.join(projectPath, "characters", fileName);
}


function getWorldDocPath(projectPath, doc) {
  const fileName = normalizeManagedFileName(doc?.fileName, ".md") || `${sanitizeFileName(doc?.title || doc?.id)}.md`;
  return path.join(projectPath, "worldbuilding", fileName);
}


function stripWorldDocFrontMatter(content) {
  const raw = String(content || "");
  const match = raw.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/);
  return match ? raw.slice(match[0].length).trimStart() : raw;
}


function parseWorldDocFile(file, rawContent) {
  const id = file.replace(/\.md$/i, "");
  let content = String(rawContent || "");
  const meta = {};
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      meta[key] = value;
    }
    content = content.slice(match[0].length).trimStart();
  }
  return {
    id,
    title: String(meta.title || id).trim() || id,
    category: normalizeCategory(meta.category),
    fileName: file,
    content,
    updatedAt: nowIso(),
  };
}


function buildWorldDocFile(doc) {
  const title = String(doc.title || "未命名设定").replace(/\r?\n/g, " ").trim();
  const category = normalizeCategory(doc.category);
  const content = stripWorldDocFrontMatter(doc.content || "").trimStart();
  return `---\ntitle: ${title}\ncategory: ${category}\n---\n\n${content}`;
}


async function writeWorldDoc(projectPath, doc) {
  await writeFileAtomic(getWorldDocPath(projectPath, doc), buildWorldDocFile(doc), "utf8");
}


function getChapterVersionDir(projectPath, chapterId) {
  return path.join(projectPath, "backups", "versions", normalizeDataId(chapterId));
}


function getChapterVersionContentPath(projectPath, chapterId, version) {
  const fileName = normalizeChapterVersionFileName(version?.fileName);
  if (!fileName) throw new Error("历史版本文件名异常，已停止读取。");
  return path.join(getChapterVersionDir(projectPath, chapterId), fileName);
}


async function snapshotChapterVersion(projectPath, chapter, content, reason = "保存前版本") {
  if (!chapter?.id || !String(content || "").trim()) return null;
  const versionDir = getChapterVersionDir(projectPath, chapter.id);
  await ensureDir(versionDir);
  const revision = contentRevision(content);
  const existingVersions = await listChapterVersions(projectPath, chapter.id);
  const existingVersion = existingVersions.find((item) => item.contentRevision === revision);
  if (existingVersion) return existingVersion;
  const createdAt = nowIso();
  const stamp = createdAt.replace(/[:.]/g, "-");
  const extension = path.extname(chapter.fileName).toLowerCase() === ".html" || isHtmlContent(content) ? ".html" : ".md";
  const id = `version_${stamp}`;
  const fileName = `${id}${extension}`;
  const version = {
    id,
    chapterId: chapter.id,
    title: chapter.title,
    createdAt,
    wordCount: countWords(content),
    fileName,
    reason,
    contentRevision: revision,
  };
  await writeFileAtomic(path.join(versionDir, fileName), content, "utf8");
  await writeJson(path.join(versionDir, `${id}.json`), version);

  const versions = await listChapterVersions(projectPath, chapter.id);
  for (const oldVersion of versions.slice(40)) {
    const oldContentFileName = normalizeChapterVersionFileName(oldVersion.fileName);
    if (oldContentFileName) await fs.rm(path.join(versionDir, oldContentFileName), { force: true }).catch(() => null);
    const oldMetaFileName = normalizeManagedFileName(oldVersion.id, ".json");
    if (oldMetaFileName) await fs.rm(path.join(versionDir, oldMetaFileName), { force: true }).catch(() => null);
  }
  return version;
}


async function listChapterVersions(projectPath, chapterId) {
  const versionDir = getChapterVersionDir(projectPath, chapterId);
  if (!existsSync(versionDir)) return [];
  const files = await fs.readdir(versionDir).catch(() => []);
  const versions = [];
  for (const file of files.filter((item) => item.endsWith(".json"))) {
    const version = await readJson(path.join(versionDir, file), null);
    if (version?.id && normalizeChapterVersionFileName(version?.fileName)) versions.push({ ...version, fileName: normalizeChapterVersionFileName(version.fileName) });
  }
  return versions.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}


async function loadProjectSources(projectPath) {
  const config = await loadConfig(projectPath);
  const chapters = config.chapters.slice().sort((a, b) => a.order - b.order);
  const sources = [];
  for (const chapter of chapters) {
    const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
    sources.push({
      id: chapter.id,
      sourceType: "chapter",
      title: chapter.title,
      volume: chapter.volume || "未分卷",
      category: chapter.volume || "未分卷",
      knowledgeRole: getKnowledgeRole(chapter),
      order: chapter.order,
      updatedAt: chapter.updatedAt,
      rawContent: content,
      text: contentToPlainText(content),
      chapter,
    });
  }
  const characters = await loadCharacters(projectPath);
  for (const card of characters) {
    const content = characterToMarkdown(card);
    sources.push({
      id: card.id,
      sourceType: "character",
      title: card.name,
      category: normalizeCategory(card.category),
      updatedAt: card.updatedAt,
      rawContent: content,
      text: contentToPlainText(content),
      card,
    });
  }
  const worldDocs = await loadWorldDocs(projectPath);
  for (const doc of worldDocs) {
    sources.push({
      id: doc.id,
      sourceType: "world",
      title: doc.title,
      category: normalizeCategory(doc.category),
      updatedAt: doc.updatedAt,
      rawContent: doc.content,
      text: contentToPlainText(doc.content),
      doc,
    });
  }
  return { config, chapters, characters, worldDocs, sources };
}


function stableHash(value) {
  return crypto.createHash("sha1").update(String(value || ""), "utf8").digest("hex").slice(0, 16);
}


function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}


async function loadCharacters(projectPath) {
  const dir = path.join(projectPath, "characters");
  await ensureDir(dir);
  const files = await fs.readdir(dir);
  const cards = [];
  for (const file of files.filter((item) => item.endsWith(".json"))) {
    const card = await readJson(path.join(dir, file), null);
    if (card) cards.push({ ...card, category: normalizeCategory(card.category), fileName: file });
  }
  return cards.sort(
    (a, b) =>
      normalizeCategory(a.category).localeCompare(normalizeCategory(b.category), "zh-CN") ||
      (a.name || "").localeCompare(b.name || "", "zh-CN"),
  );
}


async function loadWorldDocs(projectPath) {
  const dir = path.join(projectPath, "worldbuilding");
  await ensureDir(dir);
  const files = await fs.readdir(dir);
  const docs = [];
  for (const file of files.filter((item) => item.endsWith(".md"))) {
    const content = await fs.readFile(path.join(dir, file), "utf8");
    docs.push(parseWorldDocFile(file, content));
  }
  return docs.sort(
    (a, b) =>
      normalizeCategory(a.category).localeCompare(normalizeCategory(b.category), "zh-CN") ||
      a.title.localeCompare(b.title, "zh-CN"),
  );
}


async function loadChapterContent(projectPath, chapterId) {
  const config = await loadConfig(projectPath);
  const requestedChapterId = String(chapterId || "");
  const chapter = requestedChapterId ? config.chapters.find((item) => item.id === requestedChapterId) : config.chapters[0];
  if (requestedChapterId && !chapter) throw new Error("要打开的章节已经不存在，已停止加载，当前章节不会改变。");
  if (!chapter) return { chapter: null, content: "", revision: contentRevision("") };
  const filePath = getChapterPath(projectPath, chapter);
  let content;
  let revision;
  try {
    content = await fs.readFile(filePath, "utf8");
    revision = contentRevision(content);
    if (isHtmlContent(content)) content = promoteMarkdownHeadingsInHtml(content);
  } catch (error) {
    throw new Error(`章节正文读取失败，已停止打开以保护原稿：${error.message}。可在恢复中心检查历史版本。`, { cause: error });
  }
  return { chapter, content, revision };
}


function extractOutline(content) {
  const outline = [];
  if (isHtmlContent(content)) {
    const html = promoteMarkdownHeadingsInHtml(String(content || ""));
    const headingPattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
    let match;
    let index = 0;
    while ((match = headingPattern.exec(html))) {
      const level = Number(match[1]);
      const title = contentToPlainText(match[2]).trim();
      if (!title) continue;
      outline.push({ id: `${index}_${title}`, level, title, line: index, anchor: `heading-${index}` });
      index += 1;
    }
    return outline;
  }

  const lines = String(content || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!match) continue;
    const title = match[2]
      .replace(/<a\b[^>]*><\/a>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\\([\\`*_[\]{}()#+\-.!>])/g, "$1")
      .trim();
    if (!title) continue;
    outline.push({ id: `${index}_${title}`, level: match[1].length, title, line: index });
  }
  return outline;
}


function defaultConfig(title = DEFAULT_PROJECT_NAME) {
  const firstChapterId = makeId("chapter");
  return {
    version: 1,
    projectSchemaVersion: projectMigrations.CURRENT_PROJECT_SCHEMA,
    title,
    author: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    api: {
      provider: "deepseek",
      apiKey: "",
      baseUrl: DEFAULT_CHAT_BASE_URL,
      chatModel: "deepseek-chat",
      embeddingProvider: "openai-compatible",
      embeddingApiKey: "",
      embeddingBaseUrl: DEFAULT_EMBEDDING_BASE_URL,
      embeddingModel: "text-embedding-3-small",
      temperature: 0.7,
      maxTokens: 8000,
      topK: 120,
      scanK: DEFAULT_RETRIEVAL_SCAN_K,
      sendFullText: false,
    },
    ui: {
      theme: "light",
      fontSize: 17,
      lineHeight: 1.85,
      autosaveMs: 1800,
      backupOnSave: false,
      recoveryEnabled: true,
    },
    agent: {
      autoLocalAnalysis: true,
      autoDeepAnalysis: false,
      evidenceRequired: true,
      snapshotBeforeBulkChanges: true,
      permissionLevel: "只读分析",
    },
    stats: {
      todayDate: todayKey(),
      todayWords: 0,
      totalWords: 0,
      lastAutoBackupAt: "",
    },
    chapters: [
      {
        id: firstChapterId,
        title: "第一章 开篇",
        volume: "卷一",
        order: 0,
        fileName: "chapter_001_开篇.md",
        wordCount: 0,
        knowledgeRole: "正文",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
    ],
  };
}


async function loadConfigUnlocked(projectPath) {
  const config = await readProjectConfig(projectPath);
  config.chapters = Array.isArray(config.chapters) ? config.chapters : [];
  config.api = { ...defaultConfig().api, ...(config.api || {}) };
  config.ui = { ...defaultConfig().ui, ...(config.ui || {}) };
  config.agent = { ...defaultConfig().agent, ...(config.agent || {}) };
  config.stats = { ...defaultConfig().stats, ...(config.stats || {}) };
  await loadCredentialSecrets(projectPath, config);
  await repairSharedChapterFiles(projectPath, config);
  return config;
}


function getKnowledgeRole(chapter) {
  return normalizeKnowledgeRole(chapter?.knowledgeRole || "正文");
}


function knowledgeRoleLabel(role) {
  const normalized = normalizeKnowledgeRole(role);
  if (normalized === "大纲") return "大纲";
  if (normalized === "补充材料") return "补充材料";
  return "正文";
}


function normalizeKnowledgeRole(value) {
  return ["大纲", "正文", "补充材料"].includes(String(value || "")) ? String(value) : "正文";
}


function characterToMarkdown(card) {
  return [
    `# 角色：${card.name || "未命名角色"}`,
    `分类：${normalizeCategory(card.category)}`,
    `外貌：${card.appearance || ""}`,
    `性格：${card.personality || ""}`,
    `背景：${card.background || ""}`,
    `关系：${card.relationships || ""}`,
    `备注：${card.notes || ""}`,
  ].join("\n");
}


const __moduleExports = {
  nowIso,
  todayKey,
  makeId,
  sanitizeFileName,
  sanitizeExportPathSegment,
  exportCategorySegments,
  exportTimestamp,
  createUniqueDirectory,
  uniqueExportFileName,
  normalizeCategory,
  clampNumber,
  mapWithConcurrency,
  sanitizeDocxText,
  stripWordBookmarkXml,
  normalizeExportedDocxBuffer,
  countWords,
  ensureDir,
  readJson,
  writeJson,
  backupUnreadableConfig,
  readProjectConfig,
  getConfigPath,
  getVectorsPath,
  getKnowledgeSummariesPath,
  getAnalysisDir,
  getAnalysisStatePath,
  getIssueStatusPath,
  getMaterialsDir,
  normalizeChapterFileName,
  getChapterPath,
  contentRevision,
  cachedChapterRevision,
  getOriginalDocumentPath,
  uniqueFileName,
  uniqueFileNameAvoiding,
  normalizeManagedFileName,
  normalizeDataId,
  normalizeChapterVersionFileName,
  getMaterialPath,
  uniqueFileNameAllowingCurrent,
  uniqueContentFileName,
  uniqueChapterFileName,
  getSharedChapterFileGroups,
  ensureExclusiveChapterFile,
  repairSharedChapterFiles,
  extensionFromContentType,
  isHtmlContent,
  decodeBasicEntities,
  contentToPlainText,
  escapeHtml,
  promoteMarkdownHeadingsInHtml,
  getCharacterPath,
  getWorldDocPath,
  stripWorldDocFrontMatter,
  parseWorldDocFile,
  buildWorldDocFile,
  writeWorldDoc,
  getChapterVersionDir,
  getChapterVersionContentPath,
  snapshotChapterVersion,
  listChapterVersions,
  loadProjectSources,
  stableHash,
  formatBytes,
  loadCharacters,
  loadWorldDocs,
  loadChapterContent,
  extractOutline,
  defaultConfig,
  loadConfigUnlocked,
  getKnowledgeRole,
  knowledgeRoleLabel,
  normalizeKnowledgeRole,
  characterToMarkdown,
};

// Augment the original exports object so cyclic requires (whose captured
// reference may be a Proxy over the pre-assignment exports) see every key.
Object.assign(module.exports, __moduleExports);
module.exports = __moduleExports;
