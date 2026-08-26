const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { createWriteStream, existsSync } = require("node:fs");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const crypto = require("node:crypto");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { toUSVString } = require("node:util");
const AdmZip = require("adm-zip");
const mammoth = require("mammoth");
const { parse: parseHtml } = require("node-html-parser");
const { writeJsonAtomic } = require("./services/project-storage.cjs");
const storyState = require("./services/story-state.cjs");
const { PersistentTaskCenter } = require("./services/task-center.cjs");
const projectSnapshots = require("./services/project-snapshots.cjs");
const vectorShards = require("./services/vector-shards.cjs");
const creativeWorkspace = require("./services/creative-workspace.cjs");
const operationJournal = require("./services/operation-journal.cjs");
const projectMigrations = require("./services/project-migrations.cjs");
const retrievalPlanner = require("./services/retrieval-planner.cjs");
const novelAgent = require("./services/novel-agent.cjs");
const knowledgeFreshness = require("./services/knowledge-freshness.cjs");
const creativeStatistics = require("./services/creative-statistics.cjs");
const windowsCredentials = require("./services/windows-credentials.cjs");
const exchangeSecurity = require("./services/project-exchange-security.cjs");
const docxFidelity = require("./services/docx-fidelity.cjs");
const releasePrivacy = require("./services/release-privacy.cjs");
const {
  AlignmentType,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTextRun,
  Document,
  HeadingLevel,
  ImageRun,
  InsertedTextRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} = require("docx");

const VECTOR_DIMENSIONS = 384;
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 100;
const DEFAULT_CHAT_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_EMBEDDING_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_PROJECT_NAME = "默认小说项目";
const MAX_CHAT_TOKENS = 393216;
const MAX_RETRIEVAL_TOP_K = 1000;
const MAX_RETRIEVAL_SCAN_K = 50000;
const DEFAULT_RETRIEVAL_SCAN_K = 5000;
const CHAT_CONTEXT_MIN_CHUNKS = 30;
const CHAT_CONTEXT_CHAR_BUDGET = 130000;
const CHAT_API_TIMEOUT_MS = Number(process.env.NOVEL_CHAT_TIMEOUT_MS || 0);
const CHAT_HISTORY_MESSAGE_MAX_CHARS = 3500;
const CHAT_HISTORY_TOTAL_MAX_CHARS = 14000;
const USER_QUESTION_SYSTEM_PREVIEW_CHARS = 1200;
const SELECTED_TEXT_PROMPT_MAX_CHARS = 12000;
const STRUCTURING_CONTEXT_CHAR_BUDGET = 45000;
const DEFAULT_CATEGORY = "未分类";
const EMBEDDING_INDEX_CONCURRENCY = 4;
const CREDENTIAL_CHAT_REF = "credential://windows/chat";
const CREDENTIAL_EMBEDDING_REF = "credential://windows/embedding";

let mainWindow;
let currentProjectPath = "";
let importCancelRequested = false;
const activeAiRequests = new Map();
const analysisSaveQueues = new Map();
const projectTaskCenters = new Map();
const deepAnalysisTimers = new Map();
const chapterRevisionCache = new Map();
const pendingExchangeImports = new Map();
const projectSessions = new Map();
const credentialSecretsCache = new Map();
let gracefulShutdownStarted = false;

function sendRendererEvent(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function activateProjectSession(projectPath) {
  const key = path.resolve(projectPath);
  if (projectSessions.has(key)) return projectSessions.get(key);
  for (const [otherPath, session] of projectSessions) {
    await operationJournal.endSession(otherPath, session.id).catch(() => null);
    projectSessions.delete(otherPath);
  }
  const result = await operationJournal.startSession(projectPath, app.getVersion?.() || "");
  projectSessions.set(key, result.session);
  return result.session;
}

async function finishProjectSessions() {
  const entries = [...projectSessions.entries()];
  projectSessions.clear();
  await Promise.all(entries.map(([projectPath, session]) => operationJournal.endSession(projectPath, session.id).catch(() => null)));
}

async function withJournalOperation(projectPath, payload, action, summarize = () => null) {
  const operation = await operationJournal.beginOperation(projectPath, payload);
  try {
    const result = await action(operation);
    await operationJournal.completeOperation(projectPath, operation.id, summarize(result));
    return result;
  } catch (error) {
    await operationJournal.failOperation(projectPath, operation.id, error).catch(() => null);
    throw error;
  }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function encodeSecret(value) {
  if (!value) return "";
  return Buffer.from(value, "utf8").toString("base64");
}

function decodeSecret(value) {
  const raw = String(value || "");
  if (!raw) return "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) return raw;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    if (!decoded || decoded.includes("\uFFFD")) return raw;
    const normalizedRaw = raw.replace(/=+$/, "");
    const normalizedDecoded = Buffer.from(decoded, "utf8").toString("base64").replace(/=+$/, "");
    return normalizedDecoded === normalizedRaw ? decoded : raw;
  } catch {
    return raw;
  }
}

function runtimeSecret(apiConfig, kind = "chat") {
  const runtimeKey = kind === "embedding" ? "__embeddingSecret" : "__chatSecret";
  return String(apiConfig?.[runtimeKey] || decodeSecret(kind === "embedding" ? apiConfig?.embeddingApiKey : apiConfig?.apiKey) || "");
}

async function loadCredentialSecrets(projectPath, config) {
  const cacheKey = path.resolve(projectPath);
  const legacyChat = config.api.apiKey && config.api.apiKey !== CREDENTIAL_CHAT_REF ? decodeSecret(config.api.apiKey) : "";
  const legacyEmbedding = config.api.embeddingApiKey && config.api.embeddingApiKey !== CREDENTIAL_EMBEDDING_REF ? decodeSecret(config.api.embeddingApiKey) : "";
  if (process.env.NOVEL_PLATFORM_TEST === "1" || process.platform !== "win32") {
    Object.defineProperty(config.api, "__chatSecret", { value: legacyChat, configurable: true, writable: true, enumerable: false });
    Object.defineProperty(config.api, "__embeddingSecret", { value: legacyEmbedding, configurable: true, writable: true, enumerable: false });
    return config;
  }
  let cached = credentialSecretsCache.get(cacheKey);
  let credentialError = "";
  try {
    if (!cached) {
      cached = {
        chat: config.api.apiKey === CREDENTIAL_CHAT_REF ? await windowsCredentials.getSecret(projectPath, "chat") : legacyChat,
        embedding: config.api.embeddingApiKey === CREDENTIAL_EMBEDDING_REF ? await windowsCredentials.getSecret(projectPath, "embedding") : legacyEmbedding,
      };
      if (legacyChat) {
        await windowsCredentials.setSecret(projectPath, "chat", legacyChat);
        config.api.apiKey = CREDENTIAL_CHAT_REF;
      }
      if (legacyEmbedding) {
        await windowsCredentials.setSecret(projectPath, "embedding", legacyEmbedding);
        config.api.embeddingApiKey = CREDENTIAL_EMBEDDING_REF;
      }
      credentialSecretsCache.set(cacheKey, cached);
      if (legacyChat || legacyEmbedding) await writeJson(getConfigPath(projectPath), config);
    }
  } catch (error) {
    credentialError = error?.message || String(error);
    cached = cached || { chat: legacyChat, embedding: legacyEmbedding };
  }
  Object.defineProperty(config.api, "__chatSecret", { value: String(cached?.chat || ""), configurable: true, writable: true, enumerable: false });
  Object.defineProperty(config.api, "__embeddingSecret", { value: String(cached?.embedding || ""), configurable: true, writable: true, enumerable: false });
  Object.defineProperty(config.api, "__credentialError", { value: credentialError, configurable: true, writable: true, enumerable: false });
  return config;
}

async function saveCredentialSecrets(projectPath, apiPatch = {}, existingConfig = null) {
  const current = existingConfig?.api || {};
  const chat = String(apiPatch.apiKey ?? runtimeSecret(current, "chat") ?? "");
  const embedding = String(apiPatch.embeddingApiKey ?? runtimeSecret(current, "embedding") ?? "");
  if (process.env.NOVEL_PLATFORM_TEST === "1" || process.platform !== "win32") return { chatRef: encodeSecret(chat), embeddingRef: encodeSecret(embedding), chat, embedding, storage: "legacy" };
  await Promise.all([
    chat ? windowsCredentials.setSecret(projectPath, "chat", chat) : windowsCredentials.deleteSecret(projectPath, "chat"),
    embedding ? windowsCredentials.setSecret(projectPath, "embedding", embedding) : windowsCredentials.deleteSecret(projectPath, "embedding"),
  ]);
  credentialSecretsCache.set(path.resolve(projectPath), { chat, embedding });
  return { chatRef: chat ? CREDENTIAL_CHAT_REF : "", embeddingRef: embedding ? CREDENTIAL_EMBEDDING_REF : "", chat, embedding, storage: "windows" };
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
    chapterRevisionCache.delete(filePath);
    return contentRevision("");
  }
  const signature = `${stat.size}|${stat.mtimeMs}|${stat.ctimeMs}`;
  const cached = chapterRevisionCache.get(filePath);
  if (cached?.signature === signature) return cached.revision;
  const content = await fs.readFile(filePath, "utf8").catch(() => "");
  const revision = contentRevision(content);
  chapterRevisionCache.set(filePath, { signature, revision });
  if (chapterRevisionCache.size > 3000) chapterRevisionCache.delete(chapterRevisionCache.keys().next().value);
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
    await snapshotChapterVersion(projectPath, chapter, content, options.reason || "拆分共享章节文件前版本").catch(() => null);
  }

  const extension = path.extname(currentFileName).toLowerCase() || (isHtmlContent(content) ? ".html" : ".md");
  const fallbackBase = `chapter_${String((chapter.order ?? 0) + 1).padStart(3, "0")}_${chapter.title || "未命名章节"}`;
  const baseName = path.basename(currentFileName || fallbackBase, extension) || fallbackBase;
  chapter.fileName = await uniqueChapterFileName(projectPath, config, baseName, extension, chapter.id);
  chapter.wordCount = countWords(content);
  chapter.outline = extractOutline(content);
  chapter.updatedAt = nowIso();
  await fs.writeFile(getChapterPath(projectPath, chapter), content, "utf8");
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
  await fs.writeFile(getWorldDocPath(projectPath, doc), buildWorldDocFile(doc), "utf8");
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
  };
  await fs.writeFile(path.join(versionDir, fileName), content, "utf8");
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

function safeEndpointLabel(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return String(url || "");
  }
}

function describeFetchError(error) {
  const parts = [];
  if (error?.name) parts.push(error.name);
  if (error?.message) parts.push(error.message);
  const cause = error?.cause;
  if (cause) {
    const causeParts = [cause.code, cause.name, cause.message].filter(Boolean);
    if (causeParts.length) parts.push(`底层原因：${causeParts.join(" / ")}`);
    const networkParts = [cause.syscall, cause.address, cause.port].filter(Boolean);
    if (networkParts.length) parts.push(`网络信息：${networkParts.join(" ")}`);
  }
  if (!parts.length) parts.push(String(error || "未知网络错误"));
  return [...new Set(parts)].join("；");
}

function compactChatHistory(history = []) {
  const compact = [];
  let usedChars = 0;
  for (const item of history.slice().reverse()) {
    if (item?.role !== "user" && item?.role !== "assistant") continue;
    if (usedChars >= CHAT_HISTORY_TOTAL_MAX_CHARS) break;
    const raw = String(item.content || "").trim();
    if (!raw) continue;
    const remaining = CHAT_HISTORY_TOTAL_MAX_CHARS - usedChars;
    const maxChars = Math.min(CHAT_HISTORY_MESSAGE_MAX_CHARS, remaining);
    const content = truncateForPrompt(raw, maxChars);
    compact.push({ role: item.role, content });
    usedChars += content.length;
  }
  return compact.reverse();
}

async function fetchJsonWithDiagnostics(url, payload, headers, label, options = {}) {
  const body = JSON.stringify(payload);
  const bodyBytes = Buffer.byteLength(body, "utf8");
  const timeoutMs = Math.max(0, Number(CHAT_API_TIMEOUT_MS) || 0);
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: options.signal || controller?.signal,
    });
    return { response, bodyBytes };
  } catch (error) {
    const timeoutHint = error?.name === "AbortError" && timeoutMs > 0 ? `请求超过 ${Math.round(timeoutMs / 1000)} 秒未完成，已自动中断。` : "";
    const sizeHint = bodyBytes > 1024 * 1024 ? "请求体超过 1MB，可能被本地代理、网关或安全软件中断。" : "如果问题很长，可减少引用片段上限或拆成几次提问。";
    throw new Error(`${label}本地连接失败：${describeFetchError(error)}\n请求地址：${safeEndpointLabel(url)}\n请求体大小：${formatBytes(bodyBytes)}。${timeoutHint}${sizeHint}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function extractOpenAiCompatibleAnswer(data) {
  return String(data?.choices?.[0]?.message?.content || data?.message?.content || data?.output_text || "").trim();
}

function extractOpenAiCompatibleDelta(data) {
  const choice = data?.choices?.[0] || {};
  return String(choice.delta?.content || choice.message?.content || data?.message?.content || data?.output_text || "");
}

async function fetchOpenAiCompatibleStream(url, payload, headers, label, onToken, options = {}) {
  const body = JSON.stringify({ ...payload, stream: true });
  const bodyBytes = Buffer.byteLength(body, "utf8");
  const timeoutMs = Math.max(0, Number(CHAT_API_TIMEOUT_MS) || 0);
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(new Error("timeout")), timeoutMs) : null;
  let answer = "";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`${label}请求失败：${response.status} ${detail.slice(0, 400)}\n请求地址：${safeEndpointLabel(url)}\n请求体大小：${formatBytes(bodyBytes)}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!response.body || contentType.includes("application/json")) {
      const data = await response.json();
      answer = extractOpenAiCompatibleAnswer(data);
      if (answer) onToken?.(answer);
      return answer || "模型返回了空内容。";
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf8");
    let buffer = "";

    const consumeLine = (line) => {
      const trimmed = String(line || "").trim();
      if (!trimmed || !trimmed.startsWith("data:")) return;
      const raw = trimmed.replace(/^data:\s*/, "");
      if (!raw || raw === "[DONE]") return;
      try {
        const data = JSON.parse(raw);
        const token = extractOpenAiCompatibleDelta(data);
        if (!token) return;
        answer += token;
        onToken?.(token);
      } catch {
        // Some gateways include keep-alive or non-JSON diagnostic frames in SSE streams.
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        lines.forEach(consumeLine);
      }
      buffer += decoder.decode();
      buffer.split(/\r?\n/).forEach(consumeLine);
    } catch (error) {
      if (answer.trim()) {
        const reason = externalSignal?.aborted ? "用户已停止生成" : `连接中断：${describeFetchError(error)}`;
        return `${answer.trim()}\n\n【提示：${reason}，以上内容已保留。】`;
      }
      throw error;
    }

    return answer.trim() || "模型返回了空内容。";
  } catch (error) {
    if (externalSignal?.aborted) return answer.trim() || "【已停止生成，停止前尚未收到模型输出。】";
    if (String(error?.message || "").includes(`${label}请求失败`)) throw error;
    const timeoutHint = error?.name === "AbortError" && timeoutMs > 0 ? `请求超过 ${Math.round(timeoutMs / 1000)} 秒未完成，已自动中断。` : "";
    throw new Error(`${label}本地连接失败：${describeFetchError(error)}\n请求地址：${safeEndpointLabel(url)}\n请求体大小：${formatBytes(bodyBytes)}。${timeoutHint}如果网络中断，但模型已经开始输出，软件会保留已经收到的内容。`);
  } finally {
    if (timer) clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

function normalizeComparableTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[《》“”"'：:，,。.\s·_-]/g, "")
    .replace(/^(圣城|古城|王城|帝都|组织|势力|神器|物品|地点)/, "")
    .trim();
}

function findSimilarWorldDoc(title, docs) {
  const target = normalizeComparableTitle(title);
  if (!target) return null;
  let best = null;
  for (const doc of docs) {
    const candidate = normalizeComparableTitle(doc.title);
    if (!candidate) continue;
    const exact = candidate === target;
    const contains = candidate.includes(target) || target.includes(candidate);
    const score = exact ? 1 : contains ? Math.min(candidate.length, target.length) / Math.max(candidate.length, target.length) : 0;
    if (score > (best?.score || 0)) best = { doc, score };
  }
  return best && best.score >= 0.55 ? best.doc : null;
}

async function loadIssueStatuses(projectPath) {
  const data = await readJson(getIssueStatusPath(projectPath), {});
  return data && typeof data === "object" ? data : {};
}

async function saveIssueStatuses(projectPath, statuses) {
  await writeJson(getIssueStatusPath(projectPath), statuses || {});
}

async function loadAnalysisState(projectPath) {
  const data = await readJson(getAnalysisStatePath(projectPath), {});
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

async function saveAnalysisState(projectPath, patch) {
  const previousTask = analysisSaveQueues.get(projectPath) || Promise.resolve();
  const task = previousTask
    .catch(() => null)
    .then(async () => {
      const previous = await loadAnalysisState(projectPath);
      const next = {
        ...previous,
        ...(patch || {}),
        updatedAt: nowIso(),
      };
      await writeJson(getAnalysisStatePath(projectPath), next);
      return next;
    });
  analysisSaveQueues.set(projectPath, task);
  try {
    return await task;
  } finally {
    if (analysisSaveQueues.get(projectPath) === task) analysisSaveQueues.delete(projectPath);
  }
}

function applyIssueStatuses(issues, statuses) {
  return issues.map((issue) => ({
    ...issue,
    status: statuses[issue.id]?.status || "待处理",
    statusUpdatedAt: statuses[issue.id]?.updatedAt || "",
  }));
}

function normalizeKnowledgeRole(value) {
  return ["大纲", "正文", "补充材料"].includes(String(value || "")) ? String(value) : "正文";
}

function knowledgeRoleLabel(role) {
  const normalized = normalizeKnowledgeRole(role);
  if (normalized === "大纲") return "大纲";
  if (normalized === "补充材料") return "补充材料";
  return "正文";
}

function getKnowledgeRole(chapter) {
  return normalizeKnowledgeRole(chapter?.knowledgeRole || "正文");
}

function chapterToKnowledgeItem(chapter) {
  return {
    id: chapter.id,
    sourceId: chapter.id,
    sourceType: "chapter",
    title: chapter.title,
    volume: chapter.volume || "未分卷",
    knowledgeRole: getKnowledgeRole(chapter),
    order: chapter.order,
    wordCount: chapter.wordCount || 0,
    updatedAt: chapter.updatedAt || "",
  };
}

async function loadMaterials(projectPath) {
  const dir = getMaterialsDir(projectPath);
  await ensureDir(dir);
  const files = await fs.readdir(dir).catch(() => []);
  const items = [];
  for (const file of files.filter((item) => item.endsWith(".json"))) {
    const item = await readJson(path.join(dir, file), null);
    if (item?.id) items.push(item);
  }
  return items.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

async function saveMaterial(projectPath, payload) {
  const id = normalizeDataId(payload.id) || makeId("material");
  const item = {
    id,
    title: String(payload.title || "未命名素材").trim() || "未命名素材",
    category: normalizeCategory(payload.category || "灵感"),
    content: String(payload.content || "").trim(),
    createdAt: payload.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  await writeJson(getMaterialPath(projectPath, item.id), item);
  return item;
}

async function deleteMaterial(projectPath, materialId) {
  const id = normalizeDataId(materialId);
  if (!id) return;
  await fs.rm(getMaterialPath(projectPath, id), { force: true });
}

async function listKnowledgeItems(projectPath) {
  const config = await loadConfig(projectPath);
  return config.chapters.slice().sort((a, b) => a.order - b.order).map(chapterToKnowledgeItem);
}

async function updateVectorKnowledgeMetadata(projectPath, chapters) {
  const metadata = new Map(chapters.map((chapter) => [String(chapter.id), {
    title: chapter.title,
    volume: chapter.volume || "未分卷",
    category: chapter.volume || "未分卷",
    knowledgeRole: getKnowledgeRole(chapter),
  }]));
  await vectorShards.updateSourcesMetadata(projectPath, metadata);
}

async function updateKnowledgeItems(projectPath, items) {
  const updates = new Map((Array.isArray(items) ? items : []).map((item) => [String(item.id || item.sourceId || ""), item]));
  const config = await loadConfig(projectPath);
  let changed = false;
  const changedChapterIds = new Set();
  config.chapters = config.chapters.map((chapter) => {
    const patch = updates.get(chapter.id);
    if (!patch) return chapter;
    const nextVolume = String(patch.volume || chapter.volume || "未分卷").trim() || "未分卷";
    const nextRole = normalizeKnowledgeRole(patch.knowledgeRole || chapter.knowledgeRole);
    if (nextVolume === chapter.volume && nextRole === getKnowledgeRole(chapter)) return chapter;
    changed = true;
    changedChapterIds.add(chapter.id);
    return {
      ...chapter,
      volume: nextVolume,
      knowledgeRole: nextRole,
      updatedAt: nowIso(),
    };
  });
  if (changed) {
    await calculateTotalWords(projectPath, config);
    await saveConfig(projectPath, config);
    await updateVectorKnowledgeMetadata(projectPath, config.chapters.filter((chapter) => changedChapterIds.has(chapter.id)));
    const projectSources = await loadProjectSources(projectPath);
    await updateKnowledgeSummaries(
      projectPath,
      projectSources.sources.map((source) => ({
        id: source.id,
        type: source.sourceType,
        title: source.title,
        volume: source.volume,
        category: source.category,
        knowledgeRole: source.knowledgeRole,
        content: source.rawContent,
      })),
      { replaceAll: true },
    );
  }
  return {
    items: await listKnowledgeItems(projectPath),
    state: await buildAppState(projectPath),
  };
}

async function buildKnowledgeSourceDescriptors(projectPath, supplied = {}) {
  const config = supplied.config || await loadConfig(projectPath);
  const characters = supplied.characters || await loadCharacters(projectPath);
  const worldDocs = supplied.worldDocs || await loadWorldDocs(projectPath);
  const descriptors = config.chapters.slice().sort((a, b) => a.order - b.order).map((chapter) => ({
    sourceId: chapter.id,
    sourceType: "chapter",
    title: chapter.title,
    volume: chapter.volume || "未分卷",
    category: chapter.volume || "未分卷",
    group: chapter.volume || "未分卷",
    knowledgeRole: getKnowledgeRole(chapter),
    filePath: getChapterPath(projectPath, chapter),
    getContent: () => fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => ""),
  }));
  for (const card of characters) {
    descriptors.push({
      sourceId: card.id,
      sourceType: "character",
      title: card.name,
      category: normalizeCategory(card.category),
      group: `角色卡/${normalizeCategory(card.category)}`,
      filePath: getCharacterPath(projectPath, card),
      content: characterToMarkdown(card),
    });
  }
  for (const doc of worldDocs) {
    descriptors.push({
      sourceId: doc.id,
      sourceType: "world",
      title: doc.title,
      category: normalizeCategory(doc.category),
      group: `世界观/${normalizeCategory(doc.category)}`,
      filePath: getWorldDocPath(projectPath, doc),
      content: doc.content,
    });
  }
  return { config, characters, worldDocs, descriptors };
}

async function inspectKnowledgeFreshness(projectPath, supplied = {}) {
  const sourceSet = await buildKnowledgeSourceDescriptors(projectPath, supplied);
  const manifest = supplied.manifest || await vectorShards.migrateLegacyIfNeeded(projectPath);
  const summaries = supplied.summaries || await loadKnowledgeSummaries(projectPath);
  const freshness = await knowledgeFreshness.inspectSources(projectPath, sourceSet.descriptors, {
    vectorManifest: manifest,
    summaries,
    normalizeContent: contentToPlainText,
    persist: supplied.persist !== false,
  });
  return {
    ...freshness,
    hierarchy: {
      sourceSummaries: summaries.sources.length,
      volumeSummaries: summaries.volumes.length,
      hasBookSummary: Boolean(summaries.book?.summary),
      updatedAt: summaries.updatedAt,
    },
    sourceSet,
    manifest,
    summaries,
  };
}

async function indexFreshnessItems(projectPath, sourceSet, sourceIds, options = {}) {
  const wanted = new Set((sourceIds || []).map(String));
  const selected = sourceSet.descriptors.filter((item) => wanted.has(String(item.sourceId)));
  const sources = [];
  for (const descriptor of selected) {
    const content = typeof descriptor.getContent === "function" ? await descriptor.getContent() : String(descriptor.content || "");
    if (!contentToPlainText(content).trim()) continue;
    sources.push({
      id: descriptor.sourceId,
      type: descriptor.sourceType,
      title: descriptor.title,
      volume: descriptor.volume,
      category: descriptor.category,
      knowledgeRole: descriptor.knowledgeRole,
      content,
    });
  }
  if (sources.length) await indexSources(projectPath, sources, options);
  return sources.map((item) => item.id);
}

async function ensureKnowledgeFreshnessForRetrieval(projectPath, options = {}) {
  const before = await inspectKnowledgeFreshness(projectPath, options);
  const stale = before.items.filter((item) => ["未索引", "等待更新", "摘要待更新"].includes(item.status));
  if (!stale.length) {
    return { checked: true, checkedAt: before.checkedAt, staleSourceCount: 0, repairedSourceCount: 0, deferredSourceCount: 0, repairedSourceIds: [], deferredSources: [], reusedHashes: before.reusedHashes, recalculatedHashes: before.recalculatedHashes };
  }
  const explicitIds = new Set([
    ...(options.sourceIds || []),
    ...(options.candidateSourceIds || []),
    ...(options.boostSourceIds || []),
    ...(options.requiredSourceIds || []),
  ].map(String));
  const question = String(options.question || "");
  const broad = ["book", "inventory"].includes(options.mode) || options.repairAll === true;
  const relevant = stale.filter((item) => broad
    || explicitIds.has(String(item.sourceId))
    || lexicalRelevanceScore({ title: item.title, volume: item.group, category: item.group, text: "" }, question) > 0);
  if (!relevant.length && stale.length <= 3) relevant.push(...stale);
  const repairedSourceIds = await indexFreshnessItems(projectPath, before.sourceSet, relevant.map((item) => item.sourceId), { signal: options.signal });
  const repairedSet = new Set(repairedSourceIds);
  const deferredSources = stale.filter((item) => !repairedSet.has(item.sourceId)).map((item) => ({ sourceId: item.sourceId, title: item.title, status: item.status }));
  return {
    checked: true,
    checkedAt: before.checkedAt,
    staleSourceCount: stale.length,
    repairedSourceCount: repairedSourceIds.length,
    deferredSourceCount: deferredSources.length,
    repairedSourceIds,
    deferredSources,
    reusedHashes: before.reusedHashes,
    recalculatedHashes: before.recalculatedHashes,
  };
}

async function getKnowledgeSyncStatus(projectPath) {
  const result = await inspectKnowledgeFreshness(projectPath);
  return {
    updatedAt: result.checkedAt,
    counts: result.counts,
    items: result.items,
    orphanSourceIds: result.orphanSourceIds,
    hierarchy: result.hierarchy,
    freshness: {
      reusedHashes: result.reusedHashes,
      recalculatedHashes: result.recalculatedHashes,
    },
  };
}

async function repairKnowledgeSync(projectPath) {
  const inspection = await inspectKnowledgeFreshness(projectPath);
  const before = {
    counts: inspection.counts,
    items: inspection.items,
    orphanSourceIds: inspection.orphanSourceIds,
  };
  const pending = before.items.filter((item) => !["已同步", "空文档", "文件缺失"].includes(item.status));
  sendRendererEvent("index:progress", { active: true, phase: "补齐知识库", current: 0, total: pending.length, detail: "检查遗漏与过期文档" });
  await indexFreshnessItems(projectPath, inspection.sourceSet, pending.map((item) => item.sourceId), {
    onProgress: (progress) => sendRendererEvent("index:progress", { active: true, phase: "整理待更新资料", ...progress }),
  });
  for (const sourceId of before.orphanSourceIds) await removeSourceFromIndex(projectPath, sourceId);
  const status = await getKnowledgeSyncStatus(projectPath);
  sendRendererEvent("index:progress", { active: false, phase: "完成", current: status.counts.synced, total: status.counts.total, detail: "知识库已校验" });
  return { status, state: await buildAppState(projectPath) };
}

async function getMaintenanceDiagnostics(projectPath) {
  const [config, status, manifest, summaries, workspaceState, taskList] = await Promise.all([
    loadConfig(projectPath),
    getKnowledgeSyncStatus(projectPath),
    vectorShards.migrateLegacyIfNeeded(projectPath),
    loadKnowledgeSummaries(projectPath),
    creativeWorkspace.loadWorkspace(projectPath),
    getProjectTaskCenter(projectPath).then((center) => center.list()),
  ]);
  const [retrievalCache, freshnessCache] = await Promise.all([
    retrievalPlanner.inspectVolumeCache(projectPath, { manifest, summaries, config }),
    knowledgeFreshness.cacheHealth(projectPath, status.items.map((item) => item.sourceId)),
  ]);
  const taskIds = new Set(taskList.tasks.map((item) => item.id));
  const runIds = new Set(workspaceState.agentRuns.map((item) => item.id));
  const invalidReferences = [];
  for (const run of workspaceState.agentRuns) {
    if (run.taskId && !taskIds.has(run.taskId)) invalidReferences.push({ type: "Agent", id: run.id, title: run.chapterTitle, detail: "Agent 记录指向的后台任务已不存在" });
    const missingScopeIds = (run.scopeIds || []).filter((id) => !config.chapters.some((item) => item.id === id));
    if (missingScopeIds.length) invalidReferences.push({ type: "Agent", id: run.id, title: run.chapterTitle, detail: `分析范围中有 ${missingScopeIds.length} 个已删除文档` });
  }
  for (const task of taskList.tasks.filter((item) => item.type === "agent-workflow")) {
    const runId = String(task.options?.runId || "");
    if (runId && !runIds.has(runId)) invalidReferences.push({ type: "任务", id: task.id, title: task.title, detail: "后台任务对应的 Agent 记录已不存在" });
  }
  const interruptedAgentRuns = workspaceState.agentRuns.filter((item) => ["已中断", "失败"].includes(item.status)).map((item) => ({ id: item.id, title: item.chapterTitle, status: item.status, updatedAt: item.updatedAt }));
  const staleSourceCount = status.items.filter((item) => ["未索引", "等待更新", "摘要待更新"].includes(item.status)).length;
  const issues = [
    ...(!retrievalCache.valid ? ["分卷检索缓存需要刷新"] : []),
    ...(staleSourceCount ? [`${staleSourceCount} 份资料等待更新`] : []),
    ...(status.counts.orphans ? [`${status.counts.orphans} 个孤立索引来源`] : []),
    ...(freshnessCache.missingEntries.length || freshnessCache.orphanEntries.length ? ["新鲜度缓存与当前目录不一致"] : []),
    ...(invalidReferences.length ? [`${invalidReferences.length} 条任务/Agent 引用异常`] : []),
  ];
  return {
    checkedAt: nowIso(),
    healthy: issues.length === 0,
    issues,
    staleSourceCount,
    interruptedAgentRuns,
    invalidReferences,
    retrievalCache,
    freshnessCache,
    vectorIndex: { sources: manifest.sources.length, chunks: Number(manifest.totalChunks || 0), updatedAt: manifest.updatedAt || "" },
  };
}

async function repairMaintenance(projectPath) {
  const knowledge = await repairKnowledgeSync(projectPath);
  const [config, manifest, summaries] = await Promise.all([loadConfig(projectPath), vectorShards.migrateLegacyIfNeeded(projectPath), loadKnowledgeSummaries(projectPath)]);
  await retrievalPlanner.ensureVolumeCache(projectPath, { manifest, summaries, config });
  const workspaceState = await creativeWorkspace.loadWorkspace(projectPath);
  const center = await getProjectTaskCenter(projectPath);
  const taskList = await center.list();
  const taskIds = new Set(taskList.tasks.map((item) => item.id));
  const runIds = new Set(workspaceState.agentRuns.map((item) => item.id));
  for (const run of workspaceState.agentRuns) {
    const validScopeIds = (run.scopeIds || []).filter((id) => config.chapters.some((item) => item.id === id));
    const taskMissing = Boolean(run.taskId && !taskIds.has(run.taskId));
    if (!taskMissing && validScopeIds.length === (run.scopeIds || []).length) continue;
    const active = taskMissing && ["等待中", "运行中"].includes(run.status);
    await creativeWorkspace.upsertItem(projectPath, "agentRuns", {
      ...run,
      scopeIds: validScopeIds.length ? validScopeIds : config.chapters.some((item) => item.id === run.chapterId) ? [run.chapterId] : [],
      taskId: taskMissing ? "" : run.taskId,
      status: active ? "已中断" : run.status,
      error: active ? "原后台任务记录已丢失，已标记为中断；可重新准备计划。" : run.error,
    });
  }
  for (const task of taskList.tasks.filter((item) => item.type === "agent-workflow" && item.options?.runId && !runIds.has(String(item.options.runId)))) {
    if (["等待中", "已暂停"].includes(task.status)) await center.cancel(task.id);
    const latest = (await center.list()).tasks.find((item) => item.id === task.id);
    if (latest && !["等待中", "运行中", "正在停止", "已暂停"].includes(latest.status)) await center.remove(task.id);
  }
  return { diagnostics: await getMaintenanceDiagnostics(projectPath), status: knowledge.status, state: await buildAppState(projectPath) };
}

function assertExpectedChapterRevision(expectedRevision, currentContent) {
  if (!expectedRevision) return;
  const actualRevision = contentRevision(currentContent);
  if (expectedRevision !== actualRevision) {
    throw new Error("检测到该章节在本次编辑期间已被其他操作修改。为避免覆盖内容，保存已停止；请重新打开章节后对比历史版本。");
  }
}

async function inspectProjectHealth(projectPath) {
  const config = await loadConfig(projectPath);
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

async function repairProjectHealth(projectPath) {
  const config = await loadConfig(projectPath);
  await repairSharedChapterFiles(projectPath, config);
  for (const chapter of config.chapters) {
    if (existsSync(getChapterPath(projectPath, chapter))) continue;
    const versions = await listChapterVersions(projectPath, chapter.id);
    const latest = versions[0];
    if (!latest) continue;
    const content = await fs.readFile(getChapterVersionContentPath(projectPath, chapter.id, latest), "utf8").catch(() => "");
    if (content) await fs.writeFile(getChapterPath(projectPath, chapter), content, "utf8");
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
  await saveConfig(projectPath, config);
  return { health: await inspectProjectHealth(projectPath), state: await buildAppState(projectPath) };
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

async function ensureProjectStructure(projectPath, title) {
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
    await writeJson(configPath, config);
    const chapterFile = path.join(projectPath, "chapters", config.chapters[0].fileName);
    await fs.writeFile(chapterFile, "# 第一章 开篇\n\n从这里开始写下你的故事。\n", "utf8");
    await writeJson(getVectorsPath(projectPath), { version: 1, updatedAt: nowIso(), vectors: [] });
    await writeJson(getKnowledgeSummariesPath(projectPath), { version: 2, updatedAt: "", sources: [], volumes: [], book: null });
  }
  await projectMigrations.migrateProject(projectPath, {
    createSnapshot: (payload) => projectSnapshots.createSnapshot(projectPath, payload),
  });
}

async function loadConfig(projectPath) {
  const config = await readProjectConfig(projectPath);
  config.chapters = Array.isArray(config.chapters) ? config.chapters : [];
  config.api = { ...defaultConfig().api, ...(config.api || {}) };
  config.ui = { ...defaultConfig().ui, ...(config.ui || {}) };
  config.agent = { ...defaultConfig().agent, ...(config.agent || {}) };
  config.stats = { ...defaultConfig().stats, ...(config.stats || {}) };
  await loadCredentialSecrets(projectPath, config);
  await repairSharedChapterFiles(projectPath, config).catch(() => null);
  return config;
}

async function saveConfig(projectPath, config) {
  config.updatedAt = nowIso();
  await writeJson(getConfigPath(projectPath), config);
}

function configForRenderer(config) {
  return {
    ...config,
    api: {
      ...config.api,
      apiKey: runtimeSecret(config.api, "chat"),
      embeddingApiKey: runtimeSecret(config.api, "embedding"),
      credentialStorage: process.platform === "win32" && process.env.NOVEL_PLATFORM_TEST !== "1" ? "windows" : config.api.apiKey ? "legacy" : "none",
      credentialError: String(config.api.__credentialError || ""),
    },
  };
}

function configFromRenderer(existingConfig, patch) {
  const api = patch.api || {};
  const ui = patch.ui || {};
  const agent = patch.agent || {};
  const nextTemperature = clampNumber(api.temperature ?? existingConfig.api.temperature, 0, 2, 0.7);
  const nextMaxTokens = Math.floor(clampNumber(api.maxTokens ?? existingConfig.api.maxTokens, 1, MAX_CHAT_TOKENS, 8000));
  const nextTopK = Math.floor(clampNumber(api.topK ?? existingConfig.api.topK, 1, MAX_RETRIEVAL_TOP_K, 120));
  const nextScanK = Math.floor(clampNumber(api.scanK ?? existingConfig.api.scanK, nextTopK, MAX_RETRIEVAL_SCAN_K, DEFAULT_RETRIEVAL_SCAN_K));
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
  };
}

async function getDefaultProjectPath() {
  if (process.env.NOVEL_TEST_PROJECT_PATH) return path.resolve(process.env.NOVEL_TEST_PROJECT_PATH);
  const docs = app.getPath("documents");
  return path.join(docs, "AI小说创作平台", DEFAULT_PROJECT_NAME);
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
  const chapter = config.chapters.find((item) => item.id === chapterId) || config.chapters[0];
  if (!chapter) return { chapter: null, content: "", revision: contentRevision("") };
  const filePath = getChapterPath(projectPath, chapter);
  let content = "";
  let revision = contentRevision("");
  try {
    content = await fs.readFile(filePath, "utf8");
    revision = contentRevision(content);
    if (isHtmlContent(content)) content = promoteMarkdownHeadingsInHtml(content);
  } catch {
    content = `# ${chapter.title}\n\n`;
    await fs.writeFile(filePath, content, "utf8");
    revision = contentRevision(content);
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

async function convertDocumentToRichContent(projectPath, filePath, importId) {
  const ext = path.extname(filePath).toLowerCase();
  const fallbackTitle = path.basename(filePath, ext);
  if (ext === ".docx") {
    const assetDir = path.join(projectPath, "assets", "imports", importId);
    const originalDir = path.join(projectPath, "documents", "imports", importId);
    await ensureDir(assetDir);
    await ensureDir(originalDir);
    const originalFileName = await uniqueFileName(originalDir, fallbackTitle, ".docx");
    const originalDocxPath = path.join(originalDir, originalFileName);
    await fs.copyFile(filePath, originalDocxPath);
    let imageIndex = 0;
    const result = await mammoth.convertToHtml(
      { path: filePath },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          imageIndex += 1;
          const extension = extensionFromContentType(image.contentType);
          const imageFile = await uniqueFileName(assetDir, `image_${String(imageIndex).padStart(3, "0")}`, extension);
          const imagePath = path.join(assetDir, imageFile);
          const buffer = image.readAsBuffer ? await image.readAsBuffer() : Buffer.from(await image.read("base64"), "base64");
          await fs.writeFile(imagePath, buffer);
          return { src: pathToFileURL(imagePath).href };
        }),
      },
    );
    const fidelity = docxFidelity.readDocxFidelity(filePath);
    const body = promoteMarkdownHeadingsInHtml(docxFidelity.applyLayoutMetadata((result.value || "").trim(), fidelity));
    const startsWithHeading = /^<h[1-6]\b/i.test(body);
    return {
      title: fallbackTitle,
      content: body ? `${startsWithHeading ? "" : `<h1>${fallbackTitle}</h1>\n`}${body}\n` : "",
      contentFormat: "html",
      imageCount: imageIndex,
      originalDocxFile: path.relative(projectPath, originalDocxPath),
      comments: fidelity.comments,
      revisions: fidelity.revisions,
      warnings: (result.messages || []).map((item) => item.message || String(item)),
    };
  }
  if (ext === ".md") {
    const content = await fs.readFile(filePath, "utf8");
    return {
      title: fallbackTitle,
      content: content.trimStart().startsWith("#") ? content : `# ${fallbackTitle}\n\n${content}`,
      contentFormat: "markdown",
      imageCount: 0,
      originalDocxFile: "",
      comments: [],
      revisions: [],
      warnings: [],
    };
  }
  if (ext === ".txt") {
    const content = await fs.readFile(filePath, "utf8");
    return {
      title: fallbackTitle,
      content: `# ${fallbackTitle}\n\n${content}`,
      contentFormat: "markdown",
      imageCount: 0,
      originalDocxFile: "",
      comments: [],
      revisions: [],
      warnings: [],
    };
  }
  throw new Error("暂时只支持导入 .docx、.txt、.md 文件。");
}

async function importDocumentIntoProject(projectPath, filePath, options = {}) {
  const config = options.config || (await loadConfig(projectPath));
  const importId = makeId("import");
  const converted = await convertDocumentToRichContent(projectPath, filePath, importId);
  if (!converted.content.trim()) throw new Error("文档中没有可导入的正文内容。");
  const order = config.chapters.length;
  const fileName = await uniqueChapterFileName(projectPath, config, `document_${String(order + 1).padStart(3, "0")}_${converted.title}`, ".html");
  const volume = String(options.volume || "").trim() || "导入文档";
  const chapter = {
    id: makeId("chapter"),
    title: converted.title,
    volume,
    order,
    fileName,
    wordCount: countWords(converted.content),
    knowledgeRole: "正文",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    importedFrom: filePath,
    importId,
    imageCount: converted.imageCount,
    originalDocxFile: converted.originalDocxFile,
    contentFormat: converted.contentFormat,
    outline: extractOutline(converted.content),
  };
  await fs.writeFile(getChapterPath(projectPath, chapter), converted.content, "utf8");
  config.chapters.push(chapter);
  for (const [index, comment] of (converted.comments || []).entries()) {
    await creativeWorkspace.upsertItem(projectPath, "annotations", {
      id: `docx_comment_${chapter.id}_${comment.id || index}`,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      quote: comment.quote || chapter.title,
      comment: `${comment.author || "Word 批注"}${comment.date ? `（${comment.date}）` : ""}：${comment.comment}`,
      type: "作者批注",
      status: "待处理",
      sourceRevision: contentRevision(converted.content),
      origin: "manual",
    });
  }
  for (const [index, revision] of (converted.revisions || []).entries()) {
    const currentViewContainsReplacement = Boolean(revision.replacement && contentToPlainText(converted.content).includes(revision.replacement));
    await creativeWorkspace.upsertItem(projectPath, "revisions", {
      id: `docx_revision_${chapter.id}_${revision.id || index}`,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      action: "Word 修订",
      instruction: `${revision.author || "Word"}${revision.date ? `（${revision.date}）` : ""}导入的修订记录`,
      original: revision.original || "",
      replacement: revision.replacement || "",
      sourceRevision: contentRevision(converted.content),
      status: currentViewContainsReplacement ? "已采纳" : "待确认",
      error: "",
      appliedAt: currentViewContainsReplacement ? nowIso() : "",
      acceptedParts: currentViewContainsReplacement ? [{ original: revision.original || "", replacement: revision.replacement || "", appliedAt: nowIso() }] : [],
    });
  }

  const imported = {
    chapter,
    content: converted.content,
    imageCount: converted.imageCount,
    warnings: converted.warnings,
    commentCount: converted.comments?.length || 0,
    revisionCount: converted.revisions?.length || 0,
    source: {
      id: chapter.id,
      type: "chapter",
      title: chapter.title,
      volume: chapter.volume || "未分卷",
      category: chapter.volume || "未分卷",
      knowledgeRole: getKnowledgeRole(chapter),
      content: converted.content,
    },
  };

  if (options.skipFinalize) return [imported];

  await calculateTotalWords(projectPath, config);
  await saveConfig(projectPath, config);

  await indexSource(projectPath, imported.source);

  return [imported];
}

async function refreshChapterFromOriginalDocument(projectPath, chapterId) {
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error("文档不存在，无法恢复 Word 格式。");

  const sourcePath = getOriginalDocumentPath(projectPath, chapter);
  if (!sourcePath || !existsSync(sourcePath)) {
    throw new Error("找不到导入时的原始 Word 文档，请重新导入 docx。");
  }

  const existingContent = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
  await ensureExclusiveChapterFile(projectPath, config, chapter, existingContent, {
    reason: "恢复 Word 原文前自动拆分共享章节文件",
  });

  const oldPath = getChapterPath(projectPath, chapter);
  const backupDir = path.join(projectPath, "backups", "docx_refresh");
  await ensureDir(backupDir);
  let backupPath = "";
  if (existsSync(oldPath)) {
    const oldExt = path.extname(chapter.fileName) || ".txt";
    const backupName = await uniqueFileName(backupDir, `${sanitizeFileName(chapter.title)}_${Date.now()}_恢复前编辑副本`, oldExt);
    backupPath = path.join(backupDir, backupName);
    await fs.copyFile(oldPath, backupPath);
  }

  const importId = chapter.importId || makeId("import");
  const converted = await convertDocumentToRichContent(projectPath, sourcePath, importId);
  const chapterDir = path.join(projectPath, "chapters");
  const currentExt = path.extname(chapter.fileName).toLowerCase();
  if (currentExt !== ".html") {
    const baseName = path.basename(chapter.fileName, path.extname(chapter.fileName)) || `document_${String(chapter.order + 1).padStart(3, "0")}_${chapter.title}`;
    chapter.fileName = await uniqueChapterFileName(projectPath, config, baseName, ".html", chapter.id);
  }

  await fs.writeFile(getChapterPath(projectPath, chapter), converted.content, "utf8");
  chapter.wordCount = countWords(converted.content);
  chapter.outline = extractOutline(converted.content);
  chapter.updatedAt = nowIso();
  chapter.importId = importId;
  chapter.importedFrom = chapter.importedFrom || sourcePath;
  chapter.imageCount = converted.imageCount;
  chapter.originalDocxFile = converted.originalDocxFile || chapter.originalDocxFile;
  chapter.contentFormat = "html";

  await calculateTotalWords(projectPath, config);
  await saveConfig(projectPath, config);

  const indexResult = await indexSource(projectPath, {
    id: chapter.id,
    type: "chapter",
    title: chapter.title,
    volume: chapter.volume || "未分卷",
    category: chapter.volume || "未分卷",
    knowledgeRole: getKnowledgeRole(chapter),
    content: converted.content,
  });
  if (config.agent?.autoLocalAnalysis !== false) {
    await refreshLocalStoryState(projectPath, chapter.id, converted.content).catch(() => null);
  }

  return {
    state: await buildAppState(projectPath, chapter.id),
    chapter,
    backupPath,
    tableCount: (converted.content.match(/<table\b/gi) || []).length,
    imageCount: converted.imageCount,
    warnings: converted.warnings,
    indexResult,
  };
}

async function calculateTotalWords(projectPath, config) {
  let total = 0;
  for (const chapter of config.chapters) {
    const filePath = getChapterPath(projectPath, chapter);
    try {
      const content = await fs.readFile(filePath, "utf8");
      chapter.wordCount = countWords(content);
      chapter.outline = extractOutline(content);
      total += chapter.wordCount;
    } catch {
      chapter.wordCount = chapter.wordCount || 0;
      chapter.outline = chapter.outline || [];
    }
  }
  config.stats.totalWords = total;
}

async function buildAppState(projectPath, preferredChapterId = "") {
  await ensureProjectStructure(projectPath);
  const config = await loadConfig(projectPath);
  await calculateTotalWords(projectPath, config);
  await saveConfig(projectPath, config);
  const savedWindowState = preferredChapterId ? null : await operationJournal.loadWindowState(projectPath).catch(() => null);
  const recoveredChapterId = savedWindowState?.selectedChapterId && config.chapters.some((item) => item.id === savedWindowState.selectedChapterId)
    ? savedWindowState.selectedChapterId
    : "";
  const selectedChapterId = preferredChapterId || recoveredChapterId || config.chapters[0]?.id || "";
  const chapterPayload = await loadChapterContent(projectPath, selectedChapterId);
  const characters = await loadCharacters(projectPath);
  const worldDocs = await loadWorldDocs(projectPath);
  const vectorStats = await vectorShards.stats(projectPath);
  return {
    projectPath,
    config: configForRenderer(config),
    chapters: config.chapters,
    selectedChapter: chapterPayload.chapter,
    chapterContent: chapterPayload.content,
    chapterRevision: chapterPayload.revision,
    characters,
    worldDocs,
    vectorStats: {
      chunks: vectorStats.chunks,
      updatedAt: vectorStats.updatedAt,
    },
  };
}

function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(clean.length, start + chunkSize);
    const slice = clean.slice(start, end).trim();
    if (slice) chunks.push({ text: slice, start, end });
    if (end >= clean.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

function hashToken(token) {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function localEmbedding(text) {
  const vector = new Array(VECTOR_DIMENSIONS).fill(0);
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  const tokens = [];
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (char.trim()) tokens.push(char);
    if (i < normalized.length - 1) {
      const bigram = normalized.slice(i, i + 2).trim();
      if (bigram.length === 2) tokens.push(bigram);
    }
  }
  for (const token of tokens) {
    const hash = hashToken(token);
    const index = hash % VECTOR_DIMENSIONS;
    vector[index] += (hash & 1) === 0 ? 1 : -1;
  }
  const length = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;
  return vector.map((item) => item / length);
}

async function remoteEmbedding(text, apiConfig, options = {}) {
  const embeddingKey = runtimeSecret(apiConfig, "embedding");
  const chatKey = runtimeSecret(apiConfig, "chat");
  const baseUrl = (apiConfig.embeddingBaseUrl || apiConfig.baseUrl || "").replace(/\/$/, "");
  const chatBaseUrl = (apiConfig.baseUrl || "").replace(/\/$/, "");
  const model = apiConfig.embeddingModel || "text-embedding-3-small";
  const isLocal = baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
  const canReuseChatKey = chatKey && baseUrl && chatBaseUrl && baseUrl === chatBaseUrl;
  const apiKey = embeddingKey || (canReuseChatKey ? chatKey : "");
  if (!baseUrl || !model || (!apiKey && !isLocal)) {
    return null;
  }

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const { response, bodyBytes } = await fetchJsonWithDiagnostics(`${baseUrl}/embeddings`, { model, input: text }, headers, "向量 API ", { signal: options.signal });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Embedding API 请求失败：${response.status} ${detail.slice(0, 300)}\n请求地址：${safeEndpointLabel(`${baseUrl}/embeddings`)}\n请求体大小：${formatBytes(bodyBytes)}`);
  }
  const data = await response.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) throw new Error("Embedding API 返回格式不正确");
  return embedding;
}

async function getEmbedding(text, apiConfig, options = {}) {
  try {
    const remote = await remoteEmbedding(text, apiConfig, options);
    if (remote) return { vector: remote, source: "api", warning: "" };
  } catch (error) {
    if (options.signal?.aborted || error?.name === "AbortError") throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
    return { vector: localEmbedding(text), source: "local", warning: error.message };
  }
  return { vector: localEmbedding(text), source: "local", warning: "" };
}

function extractMetadata(text, characterNames = []) {
  const characters = new Set();
  const locations = new Set();
  const timeHints = new Set();
  for (const name of characterNames) {
    if (name && text.includes(name)) characters.add(name);
  }

  const speakerMatches = text.matchAll(/([\u4e00-\u9fa5]{2,4})(?:说|问|道|喊|答|笑道|低声)/g);
  for (const match of speakerMatches) characters.add(match[1]);

  const locationMatches = text.matchAll(/([\u4e00-\u9fa5]{2,8}(?:城|镇|村|山|河|湖|海|宫|殿|阁|府|院|国|洲|谷|林|岛))/g);
  for (const match of locationMatches) locations.add(match[1]);

  const timeMatches = text.matchAll(/(清晨|黎明|上午|正午|午后|黄昏|傍晚|午夜|昨日|今天|明日|次日|第[一二三四五六七八九十百\d]+天|[一二三四五六七八九十百\d]+年前|[一二三四五六七八九十百\d]+年后)/g);
  for (const match of timeMatches) timeHints.add(match[1]);

  return {
    characters: [...characters],
    locations: [...locations],
    timeHints: [...timeHints],
  };
}

function cosineSimilarity(a, b) {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function compactSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[《》“”"'‘’：:，,。.!！?？、；;（）()[\]{}【】\s·_\-—]/g, "");
}

function lexicalRelevanceScore(item, question) {
  const tokens = queryTokens(question)
    .map((token) => String(token || "").trim())
    .filter((token) => token.length >= 2);
  if (!tokens.length) return 0;
  const title = String(item.title || "").toLowerCase();
  const titleCompact = compactSearchText(item.title);
  const meta = `${item.volume || ""} ${item.category || ""} ${knowledgeRoleLabel(item.knowledgeRole || "")}`.toLowerCase();
  const text = String(item.text || "").toLowerCase();
  const questionCompact = compactSearchText(question);
  let score = 0;
  let titleHits = 0;
  for (const token of tokens) {
    const tokenCompact = compactSearchText(token);
    if (!tokenCompact) continue;
    if (title.includes(token) || titleCompact.includes(tokenCompact)) {
      score += tokenCompact.length >= 4 ? 0.42 : 0.28;
      titleHits += 1;
    }
    if (meta.includes(token) || compactSearchText(meta).includes(tokenCompact)) score += 0.1;
    if (text.includes(token) || compactSearchText(text).includes(tokenCompact)) score += tokenCompact.length >= 4 ? 0.16 : 0.08;
  }
  if (questionCompact && titleCompact && (titleCompact.includes(questionCompact) || questionCompact.includes(titleCompact))) score += 0.75;
  if (titleHits >= Math.min(2, tokens.length)) score += 0.35;
  return Math.min(score, 1.8);
}

async function loadVectorStore(projectPath) {
  return vectorShards.loadStore(projectPath);
}

async function saveVectorStore(projectPath, store) {
  await vectorShards.saveAll(projectPath, store);
}

async function loadKnowledgeSummaries(projectPath) {
  const fallback = { version: 2, updatedAt: "", sources: [], volumes: [], book: null };
  const data = await readJson(getKnowledgeSummariesPath(projectPath), fallback);
  return {
    version: 2,
    updatedAt: String(data?.updatedAt || ""),
    sources: Array.isArray(data?.sources) ? data.sources : [],
    volumes: Array.isArray(data?.volumes) ? data.volumes : [],
    book: data?.book && typeof data.book === "object" ? data.book : null,
  };
}

function summarizeSourceText(source) {
  const plain = contentToPlainText(source.content || "").replace(/\s+/g, " ").trim();
  const outline = extractOutline(source.content || "")
    .slice(0, 24)
    .map((item) => item.title)
    .filter(Boolean);
  const paragraphs = contentToPlainText(source.content || "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 12);
  const selected = [...paragraphs.slice(0, 4), ...paragraphs.slice(-2)];
  const body = selected.join(" ").slice(0, 1600) || plain.slice(0, 1600);
  return [outline.length ? `小标题：${outline.join("；")}` : "", body].filter(Boolean).join("\n").slice(0, 2000);
}

function rebuildSummaryHierarchy(sources, projectTitle = "") {
  const grouped = new Map();
  for (const item of sources) {
    const group = item.volume || item.category || (item.sourceType === "character" ? "角色卡" : item.sourceType === "world" ? "世界观" : "未分卷");
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(item);
  }
  const volumes = [...grouped.entries()].map(([title, items]) => ({
    id: `volume_${stableHash(title)}`,
    title,
    sourceIds: items.map((item) => item.sourceId),
    documentCount: items.length,
    summary: items.map((item) => `${item.title}：${item.summary}`).join("\n").slice(0, 8000),
    updatedAt: nowIso(),
  }));
  const book = {
    id: "book_summary",
    title: projectTitle || "全书",
    documentCount: sources.length,
    volumeCount: volumes.length,
    summary: volumes.map((item) => `【${item.title}】${item.summary}`).join("\n").slice(0, 16000),
    updatedAt: nowIso(),
  };
  return { volumes, book };
}

async function updateKnowledgeSummaries(projectPath, sources, options = {}) {
  const config = await loadConfig(projectPath);
  const previous = options.replaceAll ? { sources: [] } : await loadKnowledgeSummaries(projectPath);
  const sourceMap = new Map((previous.sources || []).map((item) => [item.sourceId, item]));
  for (const source of Array.isArray(sources) ? sources : []) {
    const plain = contentToPlainText(source.content || "");
    sourceMap.set(source.id, {
      sourceId: source.id,
      sourceType: source.type,
      title: source.title,
      volume: source.volume || "",
      category: source.category || "",
      knowledgeRole: source.type === "chapter" ? normalizeKnowledgeRole(source.knowledgeRole || "正文") : "",
      contentHash: contentRevision(plain),
      wordCount: countWords(plain),
      summary: summarizeSourceText(source),
      updatedAt: nowIso(),
    });
  }
  const sourceSummaries = [...sourceMap.values()].sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "zh-CN"));
  const hierarchy = rebuildSummaryHierarchy(sourceSummaries, config.title);
  const next = { version: 2, updatedAt: nowIso(), sources: sourceSummaries, ...hierarchy };
  await writeJson(getKnowledgeSummariesPath(projectPath), next);
  return next;
}

async function removeSourceFromKnowledgeSummaries(projectPath, sourceId) {
  const config = await loadConfig(projectPath);
  const previous = await loadKnowledgeSummaries(projectPath);
  const sources = previous.sources.filter((item) => item.sourceId !== sourceId);
  const hierarchy = rebuildSummaryHierarchy(sources, config.title);
  await writeJson(getKnowledgeSummariesPath(projectPath), { version: 2, updatedAt: nowIso(), sources, ...hierarchy });
}

async function indexSource(projectPath, source) {
  return indexSources(projectPath, [source]);
}

async function buildIndexEntries(source, config, characterNames, options = {}) {
  const indexContent = contentToPlainText(source.content);
  const sourceHash = contentRevision(indexContent);
  const chunks = chunkText(indexContent);
  const embeddings = await mapWithConcurrency(chunks, EMBEDDING_INDEX_CONCURRENCY, async (chunk, index) => {
    if (options.signal?.aborted) throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
    if (index % 12 === 0) await new Promise((resolve) => setImmediate(resolve));
    return getEmbedding(chunk.text, config.api, { signal: options.signal });
  });
  return chunks.map((chunk, index) => {
    const embedding = embeddings[index];
    return {
      id: `${source.id}_${index}`,
      projectTitle: config.title,
      sourceId: source.id,
      sourceType: source.type,
      title: source.title,
      volume: source.volume || source.category || "",
      category: source.category || source.volume || "",
      knowledgeRole: normalizeKnowledgeRole(source.knowledgeRole || "正文"),
      chunkIndex: index,
      text: chunk.text,
      embedding: embedding.vector,
      embeddingSource: embedding.source,
      embeddingWarning: embedding.warning,
      metadata: extractMetadata(chunk.text, characterNames),
      sourceHash,
      updatedAt: nowIso(),
    };
  });
}

async function indexSources(projectPath, sources, options = {}) {
  const safeSources = Array.isArray(sources) ? sources.filter(Boolean) : [];
  if (!safeSources.length) {
    const stats = await vectorShards.stats(projectPath);
    return { chunks: 0, totalChunks: stats.chunks };
  }
  const config = await loadConfig(projectPath);
  const characters = await loadCharacters(projectPath);
  const characterNames = characters.map((item) => item.name).filter(Boolean);
  let indexedChunks = 0;
  const entriesBySource = new Map();
  for (let sourceIndex = 0; sourceIndex < safeSources.length; sourceIndex += 1) {
    if (options.signal?.aborted) throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
    const source = safeSources[sourceIndex];
    if (typeof options.onProgress === "function") await options.onProgress({ current: sourceIndex, total: safeSources.length, detail: source.title || source.id });
    const entries = await buildIndexEntries(source, config, characterNames, options);
    indexedChunks += entries.length;
    entriesBySource.set(source.id, entries);
    if (typeof options.onProgress === "function") await options.onProgress({ current: sourceIndex + 1, total: safeSources.length, detail: source.title || source.id });
  }

  if (options.signal?.aborted) throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
  const manifest = options.replaceAllIndex
    ? await vectorShards.replaceSources(projectPath, entriesBySource)
    : await vectorShards.upsertSources(projectPath, entriesBySource);
  await updateKnowledgeSummaries(projectPath, safeSources, { replaceAll: Boolean(options.replaceSummaries) });
  return { chunks: indexedChunks, totalChunks: manifest.totalChunks };
}

async function removeSourceFromIndex(projectPath, sourceId) {
  await vectorShards.removeSource(projectPath, sourceId);
  await removeSourceFromKnowledgeSummaries(projectPath, sourceId);
}

function selectUsefulChunks(chunks, options = {}) {
  const safeChunks = Array.isArray(chunks) ? chunks.filter((item) => Number.isFinite(Number(item.score))) : [];
  if (!safeChunks.length) return [];
  const maxChunks = Math.max(1, Math.floor(options.maxChunks || safeChunks.length));
  const minKeep = Math.min(maxChunks, Math.max(0, Math.floor(options.minKeep ?? 3)));
  const maxChars = Math.max(1000, Math.floor(options.maxChars || CHAT_CONTEXT_CHAR_BUDGET));
  const topScore = Number(safeChunks[0]?.score || 0);
  const minScore = Number.isFinite(Number(options.minScore))
    ? Number(options.minScore)
    : topScore >= 0.4
      ? Math.max(0.18, topScore * 0.55)
      : topScore >= 0.2
        ? Math.max(0.1, topScore * 0.45)
        : 0.08;
  const selected = [];
  let totalChars = 0;
  for (let index = 0; index < safeChunks.length && selected.length < maxChunks; index += 1) {
    const chunk = safeChunks[index];
    const textLength = String(chunk.text || "").length;
    const relevant = index < minKeep || (Number(chunk.score) > 0 && Number(chunk.score) >= minScore);
    if (!relevant) continue;
    if (selected.length >= minKeep && totalChars + textLength > maxChars) break;
    selected.push(chunk);
    totalChars += textLength;
  }
  return selected;
}

async function rebuildIndex(projectPath, options = {}) {
  const config = await loadConfig(projectPath);
  const sources = [];
  sendRendererEvent("index:progress", { active: true, phase: "整理章节", current: 0, total: config.chapters.length, detail: "" });

  for (let index = 0; index < config.chapters.length; index += 1) {
    if (options.signal?.aborted) throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
    const chapter = config.chapters[index];
    sendRendererEvent("index:progress", { active: true, phase: "整理章节", current: index + 1, total: config.chapters.length, detail: chapter.title });
    const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
    sources.push({
      id: chapter.id,
      type: "chapter",
      title: chapter.title,
      volume: chapter.volume || "未分卷",
      category: chapter.volume || "未分卷",
      knowledgeRole: getKnowledgeRole(chapter),
      content,
    });
  }

  const characters = await loadCharacters(projectPath);
  for (const card of characters) {
    const content = characterToMarkdown(card);
    sources.push({
      id: card.id,
      type: "character",
      title: card.name,
      content,
    });
  }

  const worldDocs = await loadWorldDocs(projectPath);
  for (const doc of worldDocs) {
    sources.push({
      id: doc.id,
      type: "world",
      title: doc.title,
      content: doc.content,
    });
  }

  const estimatedChunks = sources.reduce((sum, source) => sum + chunkText(contentToPlainText(source.content || "")).length, 0);
  sendRendererEvent("index:progress", { active: true, phase: "建立知识库", current: 0, total: estimatedChunks, detail: `预计 ${estimatedChunks} 个片段，${sources.length} 个来源` });
  const result = await indexSources(projectPath, sources, {
    replaceSummaries: true,
    replaceAllIndex: true,
    signal: options.signal,
    onProgress: options.onProgress,
  });
  sendRendererEvent("index:progress", { active: false, phase: "完成", current: result.totalChunks, total: result.totalChunks, detail: `${result.totalChunks} 个片段` });
  return { chunks: result.totalChunks };
}

async function searchRelevantChunks(projectPath, question, topK, options = {}) {
  const config = await loadConfig(projectPath);
  const safeTopK = Math.floor(clampNumber(topK, 1, MAX_RETRIEVAL_TOP_K, 5));
  const safeScanLimit = Math.floor(clampNumber(options.scanLimit || config.api.scanK || Math.max(safeTopK * 4, DEFAULT_RETRIEVAL_SCAN_K), safeTopK, MAX_RETRIEVAL_SCAN_K, DEFAULT_RETRIEVAL_SCAN_K));
  const sourceIds = new Set((Array.isArray(options.sourceIds) ? options.sourceIds : []).map((id) => String(id || "")).filter(Boolean));
  const candidateSourceIds = new Set((Array.isArray(options.candidateSourceIds) ? options.candidateSourceIds : []).map((id) => String(id || "")).filter(Boolean));
  const excludedSourceIds = new Set((Array.isArray(options.excludeSourceIds) ? options.excludeSourceIds : []).map((id) => String(id || "")).filter(Boolean));
  const freshness = options.freshness || (options.skipFreshnessCheck ? null : await ensureKnowledgeFreshnessForRetrieval(projectPath, {
    config,
    question,
    mode: options.mode || "normal",
    sourceIds: [...sourceIds],
    candidateSourceIds: [...candidateSourceIds],
    boostSourceIds: options.boostSourceIds || [],
    requiredSourceIds: options.retrievalContext?.requiredSourceIds || [],
    signal: options.signal,
  }));
  const loadSourceIds = [...new Set([...sourceIds, ...candidateSourceIds, ...(Array.isArray(options.additionalLoadSourceIds) ? options.additionalLoadSourceIds : [])].map(String).filter(Boolean))];
  const store = await vectorShards.loadStore(projectPath, loadSourceIds.length ? { sourceIds: loadSourceIds } : {});
  const embedding = await getEmbedding(question, config.api);
  const boostSourceIds = new Set((Array.isArray(options.boostSourceIds) ? options.boostSourceIds : []).map((id) => String(id || "")).filter(Boolean));
  const candidates = store.vectors
    .map((item) => {
      const vectorScore = cosineSimilarity(embedding.vector, item.embedding || []);
      const keywordScore = lexicalRelevanceScore(item, question);
      const hierarchyBoost = boostSourceIds.has(item.sourceId) ? 0.2 : 0;
      const hybrid = retrievalPlanner.scoreCandidate(item, {
        signals: options.retrievalContext?.signals,
        adjacencyScores: options.retrievalContext?.adjacencyScores,
        storyScores: options.retrievalContext?.storyScores,
        subQueries: options.retrievalContext?.subQueries,
        lexicalScore: lexicalRelevanceScore,
      });
      return {
        ...item,
        score: vectorScore + keywordScore + hierarchyBoost + hybrid.entityScore + hybrid.adjacencyScore + hybrid.storyScore + hybrid.subQueryScore,
        vectorScore,
        keywordScore,
        hierarchyBoost,
        ...hybrid,
      };
    })
    .filter((item) => !excludedSourceIds.has(String(item.sourceId)) && (!sourceIds.size || sourceIds.has(item.sourceId)))
    .sort((a, b) => b.score - a.score)
    .slice(0, safeScanLimit);
  const evidenceTargets = retrievalPlanner.buildEvidenceTargets({
    subQueries: options.retrievalContext?.subQueries || [],
    signals: options.retrievalContext?.signals || {},
    routedVolumes: options.retrievalContext?.routedVolumes || [],
    requiredSourceIds: options.retrievalContext?.requiredSourceIds || [],
    mode: options.mode || "normal",
  });
  const reserveForCoverage = Math.min(Math.max(0, safeTopK - Math.max(1, Number(options.minKeep || 3))), Math.min(24, Math.ceil(evidenceTargets.length * 1.5), Math.ceil(safeTopK * 0.2)));
  const firstPass = selectUsefulChunks(candidates, {
    maxChunks: Math.max(1, safeTopK - reserveForCoverage),
    minKeep: options.minKeep,
    minScore: options.minScore,
    maxChars: options.maxChars,
  });
  const secondPass = retrievalPlanner.addCoverageSecondPass({
    firstPass,
    candidates,
    targets: evidenceTargets,
    maxChunks: safeTopK,
    maxChars: options.maxChars || CHAT_CONTEXT_CHAR_BUDGET,
    lexicalScore: lexicalRelevanceScore,
  });
  return {
    chunks: secondPass.chunks,
    candidateCount: candidates.length,
    scannedCount: store.vectors.length,
    totalIndexedCount: Number(store.totalChunks || store.vectors.length),
    embeddingSource: embedding.source,
    embeddingWarning: embedding.warning,
    coveragePass: secondPass.audit,
    freshness,
    _store: store,
  };
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

function truncateForPrompt(value, maxChars) {
  const text = String(value || "").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n【内容过长，已截断】`;
}

function buildProjectSourceCatalog(config, characters, worldDocs) {
  const chapters = (config.chapters || [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((chapter) => `- ${knowledgeRoleLabel(getKnowledgeRole(chapter))}｜${chapter.volume || "未分卷"}｜${chapter.title}`)
    .join("\n");
  const characterLines = (characters || [])
    .map((card) => `- ${card.name}｜${normalizeCategory(card.category)}`)
    .join("\n");
  const worldLines = (worldDocs || [])
    .map((doc) => `- ${doc.title}｜${normalizeCategory(doc.category)}`)
    .join("\n");
  return [
    "【章节与资料文档】",
    chapters || "- 暂无章节或资料文档",
    "【角色卡】",
    characterLines || "- 暂无角色卡",
    "【世界观条目】",
    worldLines || "- 暂无世界观条目",
  ].join("\n");
}

async function collectPromptMaterials(projectPath, retrievedChunks, question = "") {
  const config = await loadConfig(projectPath);
  const characters = await loadCharacters(projectPath);
  const worldDocs = await loadWorldDocs(projectPath);
  const sourceCatalog = buildProjectSourceCatalog(config, characters, worldDocs);
  const characterNames = new Set();
  const worldIds = new Set();
  const questionText = String(question || "");
  for (const chunk of retrievedChunks || []) {
    if (chunk.sourceType === "character") characterNames.add(chunk.title);
    if (chunk.sourceType === "world") worldIds.add(chunk.sourceId);
    for (const name of chunk.metadata?.characters || []) characterNames.add(name);
  }
  for (const card of characters) {
    if (card.name && questionText.includes(card.name)) characterNames.add(card.name);
  }
  for (const doc of worldDocs) {
    if (doc.title && questionText.includes(doc.title)) worldIds.add(doc.id);
  }
  const relevantCharacters = characters.filter((card) => characterNames.has(card.name)).slice(0, 12);
  const relevantWorldDocs = worldDocs.filter((doc) => worldIds.has(doc.id)).slice(0, 10);
  const characterIndex = characters.map((card) => `${card.name}（${normalizeCategory(card.category)}）`).slice(0, 80).join("；");
  const worldIndex = worldDocs.map((doc) => `${doc.title}（${normalizeCategory(doc.category)}）`).slice(0, 80).join("；");
  const characterCards = relevantCharacters.length
    ? relevantCharacters.map((card) => truncateForPrompt(characterToMarkdown(card), 900)).join("\n\n")
    : `角色索引：${characterIndex || "暂无角色卡"}`;
  const worldbuilding = relevantWorldDocs.length
    ? relevantWorldDocs.map((doc) => truncateForPrompt(`# ${doc.title}\n分类：${normalizeCategory(doc.category)}\n${doc.content}`, 1000)).join("\n\n")
    : `世界观索引：${worldIndex || "暂无世界观条目"}`;
  const retrievedContext = retrievedChunks
    .map((item, index) => {
      const sourceName = item.sourceType === "chapter" ? "章节" : item.sourceType === "character" ? "角色卡" : "世界观";
      return `【片段${index + 1}｜${sourceName}｜${item.title}｜相关度 ${item.score.toFixed(3)}】\n${item.text}`;
    })
    .join("\n\n");
  return { characterCards, worldbuilding, retrievedContext, sourceCatalog };
}

function buildProjectMemorySummary(snapshot, extraMemory = "") {
  const manualMemory = [String(snapshot?.aiProjectMemory || "").trim(), String(extraMemory || "").trim()].filter(Boolean).join("\n").slice(0, 3000);
  const sessions = Array.isArray(snapshot?.chatSessions) ? snapshot.chatSessions : [];
  const sessionLines = sessions
    .slice()
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, 10)
    .map((session) => {
      const messages = Array.isArray(session.messages) ? session.messages : [];
      const recentUserMessages = messages
        .filter((message) => message.role === "user")
        .slice(-3)
        .map((message) => String(message.content || "").replace(/\s+/g, " ").slice(0, 120))
        .filter(Boolean);
      if (!recentUserMessages.length) return "";
      return `- ${String(session.title || "会话").slice(0, 40)}：${recentUserMessages.join("；")}`;
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 2500);
  return [manualMemory ? `【手动项目记忆】\n${manualMemory}` : "", sessionLines ? `【最近会话摘要】\n${sessionLines}` : ""].filter(Boolean).join("\n\n");
}

function buildSystemPrompt({ retrievedContext, characterCards, worldbuilding, sourceCatalog, hierarchicalContext, projectMemory, userQuestion, selectedText, retrieval, inventorySummary }) {
  const questionPreview = truncateForPrompt(userQuestion, USER_QUESTION_SYSTEM_PREVIEW_CHARS);
  const selected = selectedText
    ? `\n【用户选中的文本】\n"""\n${truncateForPrompt(selectedText, SELECTED_TEXT_PROMPT_MAX_CHARS)}\n"""\n`
    : "";
  const memory = projectMemory
    ? `\n【项目内 AI 记忆】\n${projectMemory}\n`
    : "";
  return `你是一位专业的小说创作助手。用户正在创作一部小说，你将基于小说的已有内容为其提供建议。

【本次检索模式】
${retrieval ? `${retrieval.modeLabel || retrieval.mode}；候选扫描 ${retrieval.candidateCount || 0}/${retrieval.scannedCount || 0} 片段；实际发送 ${retrieval.contextCount || 0} 片段。${retrieval.catalogUsed ? "已使用项目资料目录兜底。" : ""}` : "普通检索。"}
${retrieval?.notes?.length ? retrieval.notes.map((note) => `- ${note}`).join("\n") : ""}

【项目资料目录】
${sourceCatalog || "暂无项目资料目录。"}

【项目资料盘点清单】
${inventorySummary || "未生成资料盘点清单。"}

【分层知识库摘要】
${hierarchicalContext || "暂无分层摘要；请以原始检索片段为准。"}

【检索到的小说内容】
${retrievedContext || "没有检索到相关片段。"}

【角色设定】
${characterCards || "暂无角色设定。"}

【世界观设定】
${worldbuilding || "暂无世界观设定。"}
${memory}
${selected}
规则：
1. 你的回答必须基于上述提供的小说内容，不要编造未出现的信息。
2. 如果用户的问题在提供的内容中没有答案，请明确说明“根据已有内容，暂时无法回答这个问题”。
3. 回答时可以引用具体的章节或段落。
4. 如果用户要求创作建议，请结合小说的风格、角色性格和已有情节给出建议。
5. “项目内 AI 记忆”只用于承接用户偏好、已确认方向和跨会话沟通，不可替代检索片段中的事实设定；涉及具体剧情和设定时优先以检索片段、角色卡和世界观为准。
6. 如果“项目资料目录”列出了某个章节或资料，但“检索到的小说内容”没有对应片段，不要说该资料不存在；应说明“目录中存在，但本次未检索到具体片段”。
7. 当用户询问“有哪些资料、有哪些章节、有哪些角色卡、知识库里有什么”时，优先依据“项目资料目录”给出完整清单，再说明哪些资料在本次检索片段中出现。
8. 保持专业、鼓励性的语气。

用户问题预览：${questionPreview || "见用户消息"}`;
}

const RETRIEVAL_MODE_LABELS = {
  auto: "自动判断",
  inventory: "资料盘点",
  chapter: "指定章节",
  entity: "角色/设定聚焦",
  book: "全书分析",
  current: "当前文档",
  normal: "普通问答",
};

function normalizeRetrievalMode(value) {
  return Object.prototype.hasOwnProperty.call(RETRIEVAL_MODE_LABELS, String(value || "")) ? String(value) : "auto";
}

function classifyRetrievalMode(question, requestedMode = "auto", config = {}, selectedChapterId = "") {
  const manual = normalizeRetrievalMode(requestedMode);
  if (manual !== "auto") return manual;
  const text = String(question || "");
  if (/当前(章节|文档|正文)|这[一这]章|本章/.test(text) && selectedChapterId) return "current";
  if (/(有哪些|知识库|资料|清单|列表|盘点|已导入|已有).*(章节|正文|资料|文档|角色|世界观|设定)|章节.*(有哪些|清单|列表|缺少|统计)|知识库里有什么/.test(text)) return "inventory";
  if (/第[零〇一二三四五六七八九十百千万\d]+章|序章|终章|\d+\s*[.、]\s*第/.test(text)) return "chapter";
  if (/(全书|全文|整体|全部|所有|整本|长篇|五百万|500万|全局).*(分析|检查|梳理|整理|时间线|一致性|节奏|伏笔|人物|设定)|检查.*(全书|全文|整体|全部|所有)/.test(text)) return "book";
  const chapters = Array.isArray(config.chapters) ? config.chapters : [];
  if (chapters.some((chapter) => chapter.title && text.includes(chapter.title))) return "chapter";
  return "normal";
}

function normalizeTitleForMatch(value) {
  return compactSearchText(value)
    .replace(/^\d+/, "")
    .replace(/^第[零〇一二三四五六七八九十百千万\d]+章/, "");
}

function findMentionedChapters(config, question, selectedChapterId = "", mode = "normal") {
  const chapters = (config.chapters || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (mode === "current" && selectedChapterId) return chapters.filter((chapter) => chapter.id === selectedChapterId);
  const text = String(question || "");
  const compactQuestion = compactSearchText(text);
  const matches = [];
  for (const chapter of chapters) {
    const title = String(chapter.title || "");
    const compactTitle = compactSearchText(title);
    if (!compactTitle) continue;
    const titleNoPrefix = normalizeTitleForMatch(title);
    const orderNumber = (chapter.order ?? -1) + 1;
    const patterns = [
      title,
      compactTitle,
      titleNoPrefix,
      `第${orderNumber}章`,
      `${orderNumber}.`,
      `${orderNumber}、`,
    ].filter(Boolean);
    const matched = patterns.some((pattern) => {
      const raw = String(pattern || "");
      return raw && (text.includes(raw) || compactQuestion.includes(compactSearchText(raw)));
    });
    if (matched) matches.push(chapter);
  }
  return matches;
}

function findMentionedSourceIds(question, characters, worldDocs) {
  const text = String(question || "");
  const compactQuestion = compactSearchText(text);
  const ids = [];
  for (const card of characters || []) {
    const name = String(card.name || "");
    if (name && (text.includes(name) || compactQuestion.includes(compactSearchText(name)))) ids.push(card.id);
  }
  for (const doc of worldDocs || []) {
    const title = String(doc.title || "");
    if (title && (text.includes(title) || compactQuestion.includes(compactSearchText(title)))) ids.push(doc.id);
  }
  return [...new Set(ids)];
}

function buildInventorySummary(config, characters, worldDocs, manifest) {
  const chunkCounts = new Map((manifest?.sources || []).map((entry) => [entry.sourceId, Number(entry.chunkCount || 0)]));
  const chapters = (config.chapters || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const chapterLines = (role) =>
    chapters
      .filter((chapter) => getKnowledgeRole(chapter) === role)
      .map((chapter) => `- ${chapter.volume || "未分卷"}｜${chapter.title}｜${chunkCounts.get(chapter.id) || 0} 片段`)
      .join("\n") || "- 无";
  const characterLines = (characters || []).map((card) => `- ${card.name}｜${normalizeCategory(card.category)}｜${chunkCounts.get(card.id) || 0} 片段`).join("\n") || "- 无";
  const worldLines = (worldDocs || []).map((doc) => `- ${doc.title}｜${normalizeCategory(doc.category)}｜${chunkCounts.get(doc.id) || 0} 片段`).join("\n") || "- 无";
  return [
    `知识库总片段：${Number(manifest?.totalChunks || 0)}`,
    "【正文章节】",
    chapterLines("正文"),
    "【大纲】",
    chapterLines("大纲"),
    "【补充材料】",
    chapterLines("补充材料"),
    "【角色卡】",
    characterLines,
    "【世界观】",
    worldLines,
  ].join("\n");
}

function countBySourceId(vectors) {
  const counts = new Map();
  for (const entry of vectors || []) counts.set(entry.sourceId, (counts.get(entry.sourceId) || 0) + 1);
  return counts;
}

function appendCoverageChunks(chunks, store, sourceIds, maxChunks, maxChars = Number.POSITIVE_INFINITY) {
  const selected = Array.isArray(chunks) ? chunks.slice() : [];
  const existingChunkIds = new Set(selected.map((item) => item.id));
  const existingSourceIds = new Set(selected.map((item) => item.sourceId));
  let totalChars = selected.reduce((sum, item) => sum + String(item.text || "").length, 0);
  for (const sourceId of sourceIds) {
    if (selected.length >= maxChunks) break;
    if (existingSourceIds.has(sourceId)) continue;
    const entry = (store.vectors || []).find((item) => item.sourceId === sourceId && !existingChunkIds.has(item.id));
    if (!entry) continue;
    const entryChars = String(entry.text || "").length;
    if (totalChars + entryChars > maxChars) continue;
    selected.push({
      ...entry,
      score: Number(entry.score || 0.001),
      vectorScore: Number(entry.vectorScore || 0),
      keywordScore: Number(entry.keywordScore || 0),
    });
    existingChunkIds.add(entry.id);
    existingSourceIds.add(sourceId);
    totalChars += entryChars;
  }
  return selected;
}

function forceIncludeSourceChunks(chunks, store, sourceIds, maxChunks) {
  const selected = Array.isArray(chunks) ? chunks.slice(0, maxChunks) : [];
  const included = new Set(selected.map((item) => item.sourceId));
  for (const sourceId of sourceIds) {
    if (included.has(sourceId)) continue;
    const entry = (store.vectors || []).find((item) => item.sourceId === sourceId);
    if (!entry) continue;
    if (selected.length >= maxChunks) selected.pop();
    selected.push({ ...entry, score: Math.max(Number(entry.score || 0), 2), vectorScore: Number(entry.vectorScore || 0), keywordScore: Number(entry.keywordScore || 0) });
    included.add(sourceId);
  }
  return selected.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

function summarizeRetrieval(chunks, config, characters, worldDocs, mode, requestedMode, search, options = {}) {
  const chaptersById = new Map((config.chapters || []).map((chapter) => [chapter.id, chapter]));
  const characterIds = new Set((characters || []).map((item) => item.id));
  const worldIds = new Set((worldDocs || []).map((item) => item.id));
  const includedTitles = [];
  const includedSet = new Set();
  const categoryCounts = {};
  for (const chunk of chunks || []) {
    const chapter = chaptersById.get(chunk.sourceId);
    const sourceLabel = chapter ? knowledgeRoleLabel(getKnowledgeRole(chapter)) : characterIds.has(chunk.sourceId) ? "角色卡" : worldIds.has(chunk.sourceId) ? "世界观" : "其他";
    categoryCounts[sourceLabel] = (categoryCounts[sourceLabel] || 0) + 1;
    const key = `${sourceLabel}_${chunk.title}`;
    if (!includedSet.has(key)) {
      includedSet.add(key);
      includedTitles.push(`${sourceLabel}｜${chunk.title}`);
    }
  }
  const allChapterTitles = (config.chapters || []).map((chapter) => chapter.title);
  const includedChapterTitles = new Set((chunks || []).filter((chunk) => chaptersById.has(chunk.sourceId)).map((chunk) => chunk.title));
  const existingButNotRead = allChapterTitles.filter((title) => !includedChapterTitles.has(title));
  const existingButNotReadSources = (config.chapters || [])
    .filter((chapter) => !includedChapterTitles.has(chapter.title))
    .map((chapter) => ({ sourceId: chapter.id, title: chapter.title, group: chapter.volume || "未分卷" }));
  return {
    requestedMode,
    mode,
    modeLabel: RETRIEVAL_MODE_LABELS[mode] || mode,
    catalogUsed: Boolean(options.catalogUsed),
    inventoryUsed: Boolean(options.inventoryUsed),
    scanLimit: options.scanLimit || 0,
    sendLimit: options.sendLimit || 0,
    scannedCount: search?.scannedCount || 0,
    candidateCount: search?.candidateCount || 0,
    contextCount: chunks?.length || 0,
    documentCount: includedTitles.length,
    includedTitles: includedTitles.slice(0, 80),
    existingButNotRead: existingButNotRead.slice(0, 120),
    existingButNotReadSources: existingButNotReadSources.slice(0, 500),
    categoryCounts,
    notes: options.notes || [],
    plannedTitles: options.plannedTitles || [],
    layersUsed: options.layersUsed || [],
    additionalSourceIds: options.additionalSourceIds || [],
    subQueries: options.subQueries || [],
    routedVolumes: options.routedVolumes || [],
    coverageByVolume: options.coverageByVolume || [],
    rawChapterCoverage: options.rawChapterCoverage || { selected: 0, total: 0 },
    coverageWarnings: options.coverageWarnings || [],
    selectedSourceReasons: options.selectedSourceReasons || [],
    skippedSourceReasons: options.skippedSourceReasons || [],
    firstPassCount: Number(search?.coveragePass?.firstPassCount || chunks?.length || 0),
    secondPassCount: Number(search?.coveragePass?.secondPassCount || 0),
    evidenceTargets: search?.coveragePass?.targets || [],
    uncoveredTargets: search?.coveragePass?.uncoveredTargets || [],
    addedSources: search?.coveragePass?.addedSources || [],
    evidenceConfidence: search?.coveragePass?.evidenceConfidence || (chunks?.length ? "中" : "低"),
    evidenceCoverageRatio: Number(search?.coveragePass?.coverageRatio || 0),
    freshness: search?.freshness || null,
  };
}

function contextFromChunks(chunks) {
  return (chunks || []).map((item) => ({
    id: item.id,
    title: item.title,
    sourceType: item.sourceType,
    score: item.score,
    vectorScore: item.vectorScore,
    keywordScore: item.keywordScore,
    entityScore: item.entityScore,
    adjacencyScore: item.adjacencyScore,
    storyScore: item.storyScore,
    subQueryScore: item.subQueryScore,
    matchedSubQuery: item.matchedSubQuery,
    knowledgeRole: item.knowledgeRole,
    volume: item.volume,
    category: item.category,
    text: item.text,
    metadata: item.metadata,
  }));
}

function planHierarchicalRetrieval(question, summaries, mode) {
  const rankedSources = (summaries.sources || [])
    .map((item) => ({
      ...item,
      score: lexicalRelevanceScore(
        { title: item.title, volume: item.volume, category: item.category, knowledgeRole: item.knowledgeRole, text: item.summary },
        question,
      ),
    }))
    .sort((a, b) => b.score - a.score);
  const sourceLimit = mode === "book" ? 240 : mode === "inventory" ? 120 : 80;
  const routedSources = rankedSources.filter((item) => item.score > 0).slice(0, sourceLimit);
  const fallbackSources = routedSources.length ? routedSources : rankedSources.slice(0, Math.min(24, sourceLimit));
  const relevantGroups = new Set(fallbackSources.map((item) => item.volume || item.category).filter(Boolean));
  const volumes = (summaries.volumes || []).filter((item) => mode === "book" || relevantGroups.has(item.title)).slice(0, mode === "book" ? 80 : 12);
  const hierarchyContext = [
    summaries.book?.summary ? `【全书结构摘要｜${summaries.book.documentCount || 0} 份资料】\n${truncateForPrompt(summaries.book.summary, mode === "book" ? 8000 : 3000)}` : "",
    volumes.length
      ? `【分卷/分类摘要】\n${volumes.map((item) => `【${item.title}｜${item.documentCount} 份】${truncateForPrompt(item.summary, 1600)}`).join("\n")}`
      : "",
    fallbackSources.length
      ? `【候选文档摘要】\n${fallbackSources.slice(0, mode === "book" ? 60 : 24).map((item) => `- ${item.title}：${truncateForPrompt(item.summary, 420)}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, mode === "book" ? 30000 : 14000);
  return {
    sourceIds: fallbackSources.map((item) => item.sourceId),
    plannedTitles: fallbackSources.map((item) => item.title).slice(0, 80),
    hierarchyContext,
    layersUsed: [summaries.book?.summary ? "全书" : "", volumes.length ? "分卷" : "", fallbackSources.length ? "文档" : "", "原始片段"].filter(Boolean),
  };
}

async function buildChatRetrievalPackage(projectPath, config, payload, question) {
  const requestedMode = normalizeRetrievalMode(payload?.retrievalMode || "auto");
  const selectedChapterId = String(payload?.selectedChapterId || "");
  const characters = await loadCharacters(projectPath);
  const worldDocs = await loadWorldDocs(projectPath);
  let mode = classifyRetrievalMode(question, requestedMode, config, selectedChapterId);
  const mentionedEntityIds = findMentionedSourceIds(question, characters, worldDocs);
  if (mode === "normal" && requestedMode === "auto" && mentionedEntityIds.length) mode = "entity";
  const preliminaryChapters = findMentionedChapters(config, question, selectedChapterId, mode === "current" ? "current" : "chapter");
  const freshness = await ensureKnowledgeFreshnessForRetrieval(projectPath, {
    config,
    characters,
    worldDocs,
    question,
    mode,
    sourceIds: [...preliminaryChapters.map((item) => item.id), ...mentionedEntityIds],
    repairAll: mode === "book" || mode === "inventory",
  });
  const manifest = await vectorShards.migrateLegacyIfNeeded(projectPath);
  const summaries = await loadKnowledgeSummaries(projectPath);
  const sendLimit = Math.floor(clampNumber(config.api.topK || 120, 1, MAX_RETRIEVAL_TOP_K, 120));
  const scanLimit = Math.floor(clampNumber(config.api.scanK || DEFAULT_RETRIEVAL_SCAN_K, sendLimit, MAX_RETRIEVAL_SCAN_K, DEFAULT_RETRIEVAL_SCAN_K));
  const notes = [];
  if (freshness.repairedSourceCount) notes.push(`检索前自动更新了 ${freshness.repairedSourceCount} 份过期资料。`);
  if (freshness.deferredSourceCount) notes.push(`另有 ${freshness.deferredSourceCount} 份过期资料与本次问题无直接关联，未作为“不存在”处理。`);
  let sourceIds = [];
  let searchQuestion = question;
  let minKeep = Math.min(CHAT_CONTEXT_MIN_CHUNKS, sendLimit);
  let maxChars = CHAT_CONTEXT_CHAR_BUDGET;
  let catalogUsed = true;
  let inventoryUsed = false;
  const additionalSourceIds = [...new Set((Array.isArray(payload?.additionalSourceIds) ? payload.additionalSourceIds : []).map((item) => String(item || "")).filter(Boolean))];
  const subQueries = retrievalPlanner.decomposeQuery(question, mode);
  const querySignals = retrievalPlanner.extractQuerySignals(question, characters, worldDocs);

  if (mode === "inventory") {
    inventoryUsed = true;
    minKeep = Math.min(20, sendLimit);
    maxChars = Math.min(50000, CHAT_CONTEXT_CHAR_BUDGET);
    searchQuestion = `${question}\n资料 章节 正文 大纲 补充材料 角色卡 世界观 清单`;
    notes.push("资料盘点模式：完整清单来自项目配置与知识库索引，引用片段只作补充。");
  }

  if (mode === "current") {
    const current = findMentionedChapters(config, question, selectedChapterId, "current");
    sourceIds = current.map((chapter) => chapter.id);
    minKeep = Math.min(12, sendLimit);
    notes.push(sourceIds.length ? "当前文档模式：优先只读取当前打开文档。" : "当前文档模式未找到当前文档，已回退到普通检索。");
  }

  if (mode === "chapter") {
    const matched = findMentionedChapters(config, question, selectedChapterId, "chapter");
    sourceIds = matched.map((chapter) => chapter.id);
    minKeep = Math.min(24, sendLimit);
    notes.push(sourceIds.length ? `指定章节模式：已锁定 ${matched.map((item) => item.title).join("、")}。` : "指定章节模式未锁定章节，已回退到混合检索。");
  }

  if (mode === "entity") {
    sourceIds = mentionedEntityIds;
    minKeep = Math.min(18, sendLimit);
    notes.push(sourceIds.length ? "角色/设定聚焦模式：优先读取点名角色卡或世界观。" : "角色/设定聚焦模式未锁定资料，已回退到混合检索。");
  }

  if (mode === "book") {
    minKeep = Math.min(120, sendLimit);
    maxChars = CHAT_CONTEXT_CHAR_BUDGET;
    searchQuestion = `${question}\n全书 正文 大纲 角色 世界观 时间线 一致性 节奏 伏笔`;
    notes.push("全书分析模式：扩大候选扫描，并尽量补足正文章节覆盖。");
  }

  const mentionedChapters = findMentionedChapters(config, question, selectedChapterId, mode === "current" ? "current" : "chapter");
  const anchorChapterIds = [...new Set([selectedChapterId, ...mentionedChapters.map((item) => item.id)].filter(Boolean))];
  const adjacencyScores = retrievalPlanner.buildChapterAdjacency(config.chapters || [], anchorChapterIds);
  const workspaceState = await creativeWorkspace.loadWorkspace(projectPath).catch(() => ({}));
  const storyContext = anchorChapterIds[0]
    ? await storyState.getAgentContext(projectPath, anchorChapterIds[0], querySignals.characters, []).catch(() => ({}))
    : {};
  const storyScores = retrievalPlanner.buildStoryBoosts(workspaceState, storyContext, subQueries);
  const volumeCache = await retrievalPlanner.ensureVolumeCache(projectPath, { manifest, summaries, config });
  const routedVolumes = retrievalPlanner.rankVolumeCache(volumeCache, subQueries, mode, lexicalRelevanceScore);
  if (volumeCache.reused) notes.push("已复用分卷检索缓存。");
  if (subQueries.length > 1) notes.push(`已拆分为 ${subQueries.length} 个检索子问题。`);

  const hierarchyPlan = planHierarchicalRetrieval(searchQuestion, summaries, mode);
  const bodyIds = (config.chapters || []).filter((chapter) => getKnowledgeRole(chapter) === "正文").map((chapter) => chapter.id);
  const candidateSourceIds = mode === "book"
    ? [...(config.chapters || []).map((chapter) => chapter.id), ...characters.map((item) => item.id), ...worldDocs.map((item) => item.id)]
    : [...sourceIds, ...hierarchyPlan.sourceIds, ...routedVolumes.flatMap((item) => item.sourceIds || []), ...additionalSourceIds];
  const searchResult = await searchRelevantChunks(projectPath, searchQuestion, sendLimit, {
    sourceIds,
    candidateSourceIds,
    boostSourceIds: [...hierarchyPlan.sourceIds, ...routedVolumes.flatMap((item) => item.sourceIds || []), ...additionalSourceIds],
    scanLimit,
    minKeep,
    maxChars,
    retrievalContext: {
      subQueries,
      signals: querySignals,
      adjacencyScores,
      storyScores,
      routedVolumes: routedVolumes.map((item) => item.title),
      requiredSourceIds: [...sourceIds, ...additionalSourceIds],
    },
    mode,
    freshness,
    skipFreshnessCheck: true,
  });
  const { _store: store, ...search } = searchResult;
  let chunks = search.chunks;
  if (mode === "book") {
    chunks = appendCoverageChunks(chunks, store, bodyIds, sendLimit, maxChars);
  }
  if (mode === "chapter" || mode === "current") {
    chunks = appendCoverageChunks(chunks, store, sourceIds, sendLimit, maxChars);
  }
  if (additionalSourceIds.length) {
    chunks = forceIncludeSourceChunks(chunks, store, additionalSourceIds, sendLimit);
    notes.push(`用户补选了 ${additionalSourceIds.length} 份资料。`);
  }
  const materials = { ...(await collectPromptMaterials(projectPath, chunks, question)), hierarchicalContext: hierarchyPlan.hierarchyContext };
  const inventorySummary = buildInventorySummary(config, characters, worldDocs, manifest);
  const coverage = retrievalPlanner.buildCoverageAudit(chunks, config, summaries, manifest);
  const sourceReasons = retrievalPlanner.buildSourceReasons(chunks, manifest, config);
  if (mode === "book" && coverage.rawChapterCoverage.selected < coverage.rawChapterCoverage.total) {
    notes.push(`正文原始证据覆盖 ${coverage.rawChapterCoverage.selected}/${coverage.rawChapterCoverage.total} 章，其余章节通过分卷与文档摘要参与结构判断。`);
  }
  const retrieval = summarizeRetrieval(chunks, config, characters, worldDocs, mode, requestedMode, search, {
    scanLimit,
    sendLimit,
    catalogUsed,
    inventoryUsed,
    notes,
    plannedTitles: hierarchyPlan.plannedTitles,
    layersUsed: hierarchyPlan.layersUsed,
    additionalSourceIds,
    subQueries: subQueries.map((item) => ({ id: item.id, label: item.label, query: item.query, kind: item.kind })),
    routedVolumes: routedVolumes.map((item) => item.title),
    ...coverage,
    ...sourceReasons,
  });
  return { search: { ...search, chunks }, materials, retrieval, inventorySummary };
}

async function callChatApi(config, systemPrompt, question, history = [], options = {}) {
  const api = config.api || {};
  const apiKey = runtimeSecret(api, "chat");
  const provider = api.provider || "custom";
  const baseUrl = (api.baseUrl || DEFAULT_CHAT_BASE_URL).replace(/\/$/, "");
  const model = api.chatModel || "deepseek-chat";
  const temperature = clampNumber(api.temperature ?? 0.7, 0, 2, 0.7);
  const maxTokens = Math.floor(clampNumber(api.maxTokens ?? 8000, 1, MAX_CHAT_TOKENS, 8000));

  if (!apiKey && provider !== "ollama" && !baseUrl.includes("localhost") && !baseUrl.includes("127.0.0.1")) {
    throw new Error("尚未配置可用的聊天接口密钥。请在“设置”中填写提供商、接口地址、模型名称和接口密钥。");
  }

  if (provider === "claude") {
    const payload = {
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: question }],
    };
    const { response, bodyBytes } = await fetchJsonWithDiagnostics(
      `${baseUrl || "https://api.anthropic.com"}/v1/messages`,
      payload,
      {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      "Claude API ",
      { signal: options.signal },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Claude API 请求失败：${response.status} ${detail.slice(0, 400)}\n请求体大小：${formatBytes(bodyBytes)}`);
    }
    const data = await response.json();
    const text = (data.content || []).map((item) => item.text || "").join("\n").trim();
    return text || "Claude 返回了空内容。";
  }

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const safeHistory = compactChatHistory(history);

  const payload = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [{ role: "system", content: systemPrompt }, ...safeHistory, { role: "user", content: question }],
  };
  if (options.stream && provider !== "claude") {
    return fetchOpenAiCompatibleStream(`${baseUrl}/chat/completions`, payload, headers, "聊天 API ", options.onToken, { signal: options.signal });
  }
  const { response, bodyBytes } = await fetchJsonWithDiagnostics(`${baseUrl}/chat/completions`, payload, headers, "聊天 API ", { signal: options.signal });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`聊天 API 请求失败：${response.status} ${detail.slice(0, 400)}\n请求地址：${safeEndpointLabel(`${baseUrl}/chat/completions`)}\n请求体大小：${formatBytes(bodyBytes)}`);
  }
  const data = await response.json();
  const answer = data?.choices?.[0]?.message?.content || data?.message?.content || "";
  return answer.trim() || "模型返回了空内容。";
}

function estimateTokenCount(value) {
  const text = String(value || "");
  const asciiLength = (text.match(/[\x00-\x7f]/g) || []).length;
  return Math.max(1, Math.ceil((text.length - asciiLength) / 1.6 + asciiLength / 4));
}

async function callStructuredChatWithProgress(config, systemPrompt, question, control = {}, phase = "AI 正在整理") {
  if (typeof control.update !== "function" && !control.signal) return callChatApi(config, systemPrompt, question, []);
  let partialOutput = "";
  let lastCheckpointAt = 0;
  const promptTokens = estimateTokenCount(`${systemPrompt}\n${question}`);
  await control.update?.({ phase, usage: { promptTokens, completionTokens: 0, totalTokens: promptTokens } });
  const answer = await callChatApi(config, systemPrompt, question, [], {
    stream: true,
    signal: control.signal,
    onToken: (token) => {
      partialOutput += token;
      if (Date.now() - lastCheckpointAt < 900) return;
      lastCheckpointAt = Date.now();
      const completionTokens = estimateTokenCount(partialOutput);
      void control.update?.({
        phase,
        partialOutput,
        usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      });
    },
  });
  const completionTokens = estimateTokenCount(answer);
  await control.update?.({ partialOutput: answer, usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens } });
  return answer;
}

function extractJsonFromModelText(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw.slice(Math.max(0, raw.indexOf("{")), raw.lastIndexOf("}") + 1).trim();
  if (!candidate) throw new Error("AI 没有返回可识别的 JSON。");
  try {
    return JSON.parse(candidate);
  } catch {
    const repaired = candidate.replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(repaired);
  }
}

function makeIdSet(values) {
  return new Set((Array.isArray(values) ? values : []).map((id) => String(id || "")).filter(Boolean));
}

async function collectOutlineCorpus(projectPath, maxChars = 80000, options = {}) {
  const config = await loadConfig(projectPath);
  const chapterIds = makeIdSet(options.chapterIds);
  const parts = [];
  for (const chapter of config.chapters.slice().sort((a, b) => a.order - b.order)) {
    if (chapterIds.size && !chapterIds.has(chapter.id)) continue;
    const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
    const plain = contentToPlainText(content);
    if (!plain) continue;
    parts.push(`【${knowledgeRoleLabel(getKnowledgeRole(chapter))}｜${chapter.volume || "未分卷"}｜${chapter.title}】\n${plain}`);
  }
  const full = parts.join("\n\n");
  if (full.length <= maxChars) return full;
  const head = full.slice(0, Math.floor(maxChars * 0.7));
  const tail = full.slice(-Math.floor(maxChars * 0.3));
  return `${head}\n\n【中间内容过长，已截断，以下为文档后段】\n\n${tail}`;
}

async function collectKnowledgeSourceCorpus(projectPath, sourceIds, maxChars = 60000) {
  const selectedIds = makeIdSet(sourceIds);
  if (!selectedIds.size) return "";
  const { sources } = await loadProjectSources(projectPath);
  const parts = [];
  for (const source of sources) {
    if (!selectedIds.has(source.id)) continue;
    const typeLabel = source.sourceType === "chapter" ? knowledgeRoleLabel(source.knowledgeRole) : source.sourceType === "character" ? "角色卡" : "世界观";
    const group = source.volume || source.category || "未分类";
    const plain = contentToPlainText(source.rawContent || source.text || "");
    if (!plain) continue;
    parts.push(`【${typeLabel}｜${group}｜${source.title}】\n${plain}`);
  }
  const full = parts.join("\n\n");
  if (full.length <= maxChars) return full;
  return `${full.slice(0, Math.floor(maxChars * 0.7))}\n\n【参考资料过长，已截断，以下为后段】\n\n${full.slice(-Math.floor(maxChars * 0.3))}`;
}

async function buildStructuringMaterials(projectPath, query, options = {}) {
  const config = await loadConfig(projectPath);
  const topK = Math.floor(clampNumber(config.api.topK || 20, 1, MAX_RETRIEVAL_TOP_K, 20));
  const knowledgeSourceIds = Array.isArray(options.knowledgeSourceIds) ? options.knowledgeSourceIds : [];
  const search = await searchRelevantChunks(projectPath, query, topK, {
    sourceIds: knowledgeSourceIds,
    minKeep: Math.min(12, topK),
    maxChars: STRUCTURING_CONTEXT_CHAR_BUDGET,
  });
  const retrieved = search.chunks
    .map((item, index) => {
      const role = item.sourceType === "chapter" ? knowledgeRoleLabel(item.knowledgeRole) : item.sourceType === "character" ? "角色卡" : "世界观";
      const group = item.volume || item.category || "";
      return `【检索片段${index + 1}｜${role}${group ? `｜${group}` : ""}｜${item.title}】\n${item.text}`;
    })
    .join("\n\n");
  const inspectedCorpus = await collectOutlineCorpus(projectPath, 80000, { chapterIds: options.chapterIds });
  const knowledgeCorpus = await collectKnowledgeSourceCorpus(projectPath, knowledgeSourceIds, 60000);
  const corpus = [inspectedCorpus ? `【审查/整理对象】\n${inspectedCorpus}` : "", knowledgeCorpus ? `【指定参考资料】\n${knowledgeCorpus}` : ""].filter(Boolean).join("\n\n");
  return { config, search, retrieved, corpus };
}

function normalizeGeneratedCharacters(payload) {
  const items = Array.isArray(payload?.characters) ? payload.characters : [];
  return items
    .map((item) => ({
      name: String(item.name || "").trim(),
      category: String(item.category || "").replace(/\s+/g, " ").trim().slice(0, 40),
      appearance: String(item.appearance || "").trim(),
      personality: String(item.personality || "").trim(),
      background: String(item.background || "").trim(),
      relationships: String(item.relationships || "").trim(),
      notes: String(item.notes || "").trim(),
    }))
    .filter((item) => item.name)
    .slice(0, 40);
}

function normalizeGeneratedWorldDocs(payload) {
  const items = Array.isArray(payload?.worldDocs) ? payload.worldDocs : Array.isArray(payload?.worldbuilding) ? payload.worldbuilding : [];
  return items
    .map((item) => {
      const title = String(item.title || "").trim();
      const content = String(item.content || "").trim();
      return {
        title,
        category: String(item.category || "").replace(/\s+/g, " ").trim().slice(0, 40),
        content: content.startsWith("#") ? content : `# ${title}\n\n${content}`,
      };
    })
    .filter((item) => item.title && item.content.replace(/^#.+/m, "").trim())
    .slice(0, 20);
}

async function generateCharactersFromOutline(projectPath) {
  const materials = await buildStructuringMaterials(projectPath, "角色 人物 主角 配角 英雄 反派 关系 外貌 性格 背景");
  const existing = await loadCharacters(projectPath);
  const existingNames = existing.map((item) => item.name).filter(Boolean).join("、") || "暂无";
  const systemPrompt = `你是小说资料整理助手。请只基于用户提供的大纲和检索片段，整理角色卡片。只输出 JSON，不要 Markdown，不要解释。
JSON 格式必须是：
{"characters":[{"name":"","category":"","appearance":"","personality":"","background":"","relationships":"","notes":""}]}
字段要求：
1. name 为角色名称。
2. category 为分类，优先使用：主角团、十二英雄、反派、重要配角、势力人物、神明/超凡、未分类；也可按大纲里的阵营自拟短分类。
3. appearance 写外貌、身份标识或可识别特征；没有就留空字符串。
4. personality 写性格、价值观、行为倾向；没有就留空字符串。
5. background 写身世、阵营、能力、剧情位置。
6. relationships 写与其他角色、势力或神明的关系。
7. notes 写道、权柄、命运、伏笔、牺牲、风险等补充信息。
8. 不要编造大纲没有的角色。已有角色名：${existingNames}`;
  const question = `请从下面的大纲材料中生成角色卡片，优先整理主角、十二英雄、重要配角和关键势力人物。最多 30 张。

【检索片段】
${materials.retrieved || "无"}

【大纲材料】
${materials.corpus}`;
  const answer = await callChatApi(materials.config, systemPrompt, question, []);
  const generated = normalizeGeneratedCharacters(extractJsonFromModelText(answer));
  if (!generated.length) throw new Error("AI 没有生成可写入的角色卡片。");

  let created = 0;
  let updated = 0;
  const existingByName = new Map(existing.map((item) => [item.name, item]));
  for (const item of generated) {
    const previous = existingByName.get(item.name);
    const fileName = previous?.fileName || (await uniqueContentFileName(projectPath, "characters", item.name, ".json"));
    const card = {
      id: previous?.id || makeId("character"),
      name: item.name,
      category: normalizeCategory(item.category || previous?.category),
      appearance: item.appearance || previous?.appearance || "",
      personality: item.personality || previous?.personality || "",
      background: item.background || previous?.background || "",
      relationships: item.relationships || previous?.relationships || "",
      notes: item.notes || previous?.notes || "",
      fileName,
      updatedAt: nowIso(),
    };
    await writeJson(getCharacterPath(projectPath, card), card);
    await indexSource(projectPath, {
      id: card.id,
      type: "character",
      title: card.name,
      content: characterToMarkdown(card),
    });
    if (previous) updated += 1;
    else created += 1;
  }

  return {
    state: await buildAppState(projectPath),
    created,
    updated,
    count: generated.length,
    names: generated.map((item) => item.name),
    contextCount: materials.search.chunks.length,
  };
}

async function generateWorldDocsFromOutline(projectPath) {
  const materials = await buildStructuringMaterials(projectPath, "世界观 设定 地理 大陆 势力 神明 腐化 规则 权柄 时间线 历史");
  const existing = await loadWorldDocs(projectPath);
  const existingTitles = existing.map((item) => item.title).filter(Boolean).join("、") || "暂无";
  const systemPrompt = `你是小说世界观资料整理助手。请只基于用户提供的大纲和检索片段，把设定整理成软件可保存的世界观文档。只输出 JSON，不要 Markdown 解释。
JSON 格式必须是：
{"worldDocs":[{"title":"","category":"","content":""}]}
字段要求：
1. title 是清晰的世界观条目标题。
2. category 为分类，优先使用：世界规则、地理、势力、神明/权柄、历史时间线、物品材料、种族/生物、未分类；也可按大纲里的体系自拟短分类。
3. content 使用 Markdown，第一行用 # 标题，下面按小标题和要点整理。
4. 优先整理：世界基础规则、地理大陆、腐化机制、神明/权柄、十二英雄、主要势力、六幕时间线、关键物品或材料。
5. 不要编造大纲没有的信息。
6. 已有世界观标题：${existingTitles}`;
  const question = `请从下面的大纲材料中生成世界观设定条目，建议 6 到 12 个条目。

【检索片段】
${materials.retrieved || "无"}

【大纲材料】
${materials.corpus}`;
  const answer = await callChatApi(materials.config, systemPrompt, question, []);
  const generated = normalizeGeneratedWorldDocs(extractJsonFromModelText(answer));
  if (!generated.length) throw new Error("AI 没有生成可写入的世界观条目。");

  let created = 0;
  let updated = 0;
  const existingByTitle = new Map(existing.map((item) => [item.title, item]));
  for (const item of generated) {
    const previous = existingByTitle.get(item.title);
    const fileName = previous?.fileName || (await uniqueContentFileName(projectPath, "worldbuilding", item.title, ".md"));
    const doc = {
      id: previous?.id || fileName.replace(/\.md$/i, ""),
      title: item.title,
      category: normalizeCategory(item.category || previous?.category),
      fileName,
      content: item.content,
      updatedAt: nowIso(),
    };
    await writeWorldDoc(projectPath, doc);
    await indexSource(projectPath, {
      id: doc.id,
      type: "world",
      title: doc.title,
      content: doc.content,
    });
    if (previous) updated += 1;
    else created += 1;
  }

  return {
    state: await buildAppState(projectPath),
    created,
    updated,
    count: generated.length,
    titles: generated.map((item) => item.title),
    contextCount: materials.search.chunks.length,
  };
}

function queryTokens(query) {
  const normalized = String(query || "").toLowerCase().trim();
  if (!normalized) return [];
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.includes(normalized)) tokens.unshift(normalized);
  return [...new Set(tokens)].slice(0, 8);
}

function makeSearchSnippet(text, tokens) {
  const content = String(text || "").replace(/\s+/g, " ").trim();
  if (!content) return "";
  const lower = content.toLowerCase();
  let index = -1;
  for (const token of tokens) {
    const found = lower.indexOf(token);
    if (found >= 0 && (index < 0 || found < index)) index = found;
  }
  if (index < 0) index = 0;
  const start = Math.max(0, index - 70);
  const end = Math.min(content.length, index + 150);
  return `${start > 0 ? "..." : ""}${content.slice(start, end)}${end < content.length ? "..." : ""}`;
}

async function globalSearch(projectPath, query) {
  const tokens = queryTokens(query);
  if (!tokens.length) return { query: "", results: [] };
  const { sources } = await loadProjectSources(projectPath);
  const results = sources
    .map((source) => {
      const haystack = `${source.title}\n${source.category || ""}\n${source.text}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        let index = haystack.indexOf(token);
        while (index >= 0) {
          score += token.length >= 4 ? 4 : 2;
          index = haystack.indexOf(token, index + token.length);
        }
        if (String(source.title || "").toLowerCase().includes(token)) score += 12;
        if (String(source.category || "").toLowerCase().includes(token)) score += 6;
      }
      return {
        id: `${source.sourceType}_${source.id}`,
        sourceId: source.id,
        sourceType: source.sourceType,
        title: source.title,
        volume: source.volume || "",
        category: source.category || "",
        updatedAt: source.updatedAt || "",
        score,
        snippet: makeSearchSnippet(source.text, tokens),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title), "zh-CN"))
    .slice(0, 80);
  return { query, results };
}

function extractTimeHints(text) {
  const matches = String(text || "").match(
    /(?:第[一二三四五六七八九十百千万零\d]+(?:年|月|日|天|夜|幕|卷|章)|[一二三四五六七八九十百千万零\d]+(?:年前|年后|个月前|个月后|日后|天后)|多年后|多年以前|很久以前|彼时|此后|后来|此前|清晨|黎明|上午|正午|午后|黄昏|傍晚|深夜|午夜|今日|昨日|明日|当天|当夜|同年|次年|翌日|\d{1,4}年(?:\d{1,2}月)?(?:\d{1,2}日)?)/g,
  );
  return [...new Set(matches || [])].slice(0, 4);
}

async function buildTimelineEvents(projectPath, options = {}) {
  const { chapters, characters } = await loadProjectSources(projectPath);
  const chapterIds = makeIdSet(options.chapterIds);
  const visibleChapters = chapterIds.size ? chapters.filter((chapter) => chapterIds.has(chapter.id)) : chapters;
  const characterNames = characters.map((item) => item.name).filter(Boolean);
  const events = [];
  let order = 0;

  for (const chapter of visibleChapters) {
    const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
    const plain = contentToPlainText(content);
    const paragraphs = plain
      .split(/\n+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 8);
    const candidates = [];
    for (const paragraph of paragraphs) {
      const timeHints = extractTimeHints(paragraph);
      if (timeHints.length) candidates.push({ title: timeHints[0], summary: paragraph, timeHint: timeHints.join("、") });
      if (candidates.length >= 5) break;
    }

    if (!candidates.length && Array.isArray(chapter.outline) && chapter.outline.length > 1) {
      for (const outline of chapter.outline.slice(1, 6)) {
        candidates.push({ title: outline.title, summary: `章节小标题：${outline.title}`, timeHint: "" });
      }
    }

    if (!candidates.length && paragraphs[0]) {
      candidates.push({ title: chapter.title, summary: paragraphs[0], timeHint: "" });
    }

    for (const candidate of candidates) {
      const metadata = extractMetadata(candidate.summary, characterNames);
      events.push({
        id: `event_${chapter.id}_${order}`,
        order,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        volume: chapter.volume || "未分卷",
        title: candidate.title || chapter.title,
        timeHint: candidate.timeHint,
        summary: candidate.summary.slice(0, 220),
        characters: metadata.characters.slice(0, 8),
      });
      order += 1;
    }
  }

  return { events: events.slice(0, 300), options: { mode: "local", chapterIds: [...chapterIds], knowledgeSourceIds: Array.isArray(options.knowledgeSourceIds) ? options.knowledgeSourceIds : [] } };
}

function normalizeTimelinePayload(payload, chapters, characterNames) {
  const items = Array.isArray(payload?.events) ? payload.events : [];
  return items
    .map((item, index) => {
      const chapterTitle = String(item.chapterTitle || "").trim();
      const chapter =
        chapters.find((chapter) => chapter.title === chapterTitle) ||
        chapters.find((chapter) => chapterTitle && chapter.title.includes(chapterTitle)) ||
        chapters[Math.min(index, Math.max(0, chapters.length - 1))];
      const summary = String(item.summary || item.detail || "").trim();
      const characters = Array.isArray(item.characters)
        ? item.characters.map((name) => String(name || "").trim()).filter(Boolean)
        : characterNames.filter((name) => summary.includes(name)).slice(0, 8);
      return {
        id: `ai_event_${stableHash(`${index}_${item.title}_${summary}`)}`,
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
        chapterId: chapter?.id || "",
        chapterTitle: chapter?.title || chapterTitle || "未指定章节",
        volume: chapter?.volume || String(item.volume || "未分卷"),
        title: String(item.title || item.timeHint || chapter?.title || "剧情事件").trim(),
        timeHint: String(item.timeHint || "").trim(),
        summary: summary.slice(0, 260),
        characters: characters.slice(0, 8),
      };
    })
    .filter((item) => item.summary)
    .sort((a, b) => a.order - b.order)
    .slice(0, 300)
    .map((item, index) => ({ ...item, order: index }));
}

async function buildAiTimelineEvents(projectPath, options = {}, control = {}) {
  const materials = await buildStructuringMaterials(projectPath, "时间线 事件 起因 结果 转折 冲突 章节顺序", options);
  const { chapters, characters } = await loadProjectSources(projectPath);
  const characterNames = characters.map((item) => item.name).filter(Boolean);
  const systemPrompt = `你是长篇小说剧情时间线整理助手。请只基于用户提供的材料，提取真实剧情事件，不要把目录标题当作事件。只输出 JSON，不要解释。
JSON 格式必须是：
{"events":[{"order":0,"title":"","timeHint":"","chapterTitle":"","volume":"","summary":"","characters":[""]}]}
要求：
1. 按剧情发生顺序排序。
2. title 写事件名，不要只写章节名。
3. summary 写起因、行动、结果，尽量具体。
4. timeHint 没有明确时间就留空。
5. 不要编造材料中没有的事件。`;
  const question = `请从下面材料整理小说真实剧情时间线，最多 120 个事件。

【检索片段】
${materials.retrieved || "无"}

【大纲与正文】
${materials.corpus}`;
  const answer = await callStructuredChatWithProgress(materials.config, systemPrompt, question, control, "AI 正在识别剧情事件");
  const events = normalizeTimelinePayload(extractJsonFromModelText(answer), chapters, characterNames);
  if (!events.length) throw new Error("AI 没有返回可识别的剧情事件。");
  return { events, contextCount: materials.search.chunks.length, apiError: "", options: { mode: "ai", chapterIds: Array.isArray(options.chapterIds) ? options.chapterIds : [], knowledgeSourceIds: Array.isArray(options.knowledgeSourceIds) ? options.knowledgeSourceIds : [] } };
}

function addRelationEdge(edgeMap, source, target, weight, label, evidence) {
  if (!source || !target || source === target) return;
  const ordered = [source, target].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const key = `${ordered[0]}__${ordered[1]}`;
  const current = edgeMap.get(key) || { id: key, source: ordered[0], target: ordered[1], label, weight: 0, evidence: [] };
  current.weight += weight;
  if (label && !current.label.includes(label)) current.label = current.label ? `${current.label}、${label}` : label;
  if (evidence && current.evidence.length < 3) current.evidence.push(evidence);
  edgeMap.set(key, current);
}

async function buildRelationshipGraph(projectPath, options = {}) {
  const { chapters, characters } = await loadProjectSources(projectPath);
  const selectedNames = new Set(Array.isArray(options.characterNames) ? options.characterNames.filter(Boolean) : []);
  const categoryFilter = normalizeCategory(options.categoryFilter || "");
  const customTypes = (Array.isArray(options.relationTypes) ? options.relationTypes : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 30);
  const categoryCharacters =
    categoryFilter && categoryFilter !== DEFAULT_CATEGORY
      ? characters.filter((item) => {
          const category = normalizeCategory(item.category);
          return category === categoryFilter || category.startsWith(`${categoryFilter}/`);
        })
      : characters;
  const visibleCharacters = selectedNames.size ? categoryCharacters.filter((item) => selectedNames.has(item.name)) : categoryCharacters;
  const names = visibleCharacters.map((item) => item.name).filter(Boolean);
  const mentionCounts = new Map(names.map((name) => [name, 0]));
  const edgeMap = new Map();

  function labelsFromText(text, fallback) {
    const matched = customTypes.filter((type) => String(text || "").includes(type));
    return matched.length ? matched.join("、") : fallback;
  }

  for (const card of visibleCharacters) {
    const relationshipText = String(card.relationships || "");
    for (const target of names) {
      if (target !== card.name && relationshipText.includes(target)) {
        addRelationEdge(edgeMap, card.name, target, 4, labelsFromText(relationshipText, "关系设定"), relationshipText.slice(0, 120));
      }
    }
  }

  for (const chapter of chapters) {
    const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
    const paragraphs = contentToPlainText(content)
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
    for (const paragraph of paragraphs) {
      const present = names.filter((name) => paragraph.includes(name)).slice(0, 8);
      present.forEach((name) => mentionCounts.set(name, (mentionCounts.get(name) || 0) + 1));
      for (let i = 0; i < present.length; i += 1) {
        for (let j = i + 1; j < present.length; j += 1) {
          addRelationEdge(edgeMap, present[i], present[j], 1, labelsFromText(paragraph, "同场"), `《${chapter.title}》：${paragraph.slice(0, 120)}`);
        }
      }
    }
  }

  const nodes = visibleCharacters.map((card) => ({
    id: card.name,
    name: card.name,
    category: normalizeCategory(card.category),
    size: Math.min(26, 10 + Math.sqrt(mentionCounts.get(card.name) || 0) * 3),
    notes: card.notes || "",
  }));
  const edges = [...edgeMap.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 120)
    .map((edge) => ({ ...edge, weight: Math.min(12, edge.weight) }));
  return { nodes, edges, options: { characterNames: [...selectedNames], categoryFilter: categoryFilter === DEFAULT_CATEGORY ? "" : categoryFilter, relationTypes: customTypes } };
}

function normalizeConsistencyIssues(payload) {
  const items = Array.isArray(payload?.issues) ? payload.issues : [];
  return items
    .map((item, index) => ({
      id: `issue_${stableHash(`${item.category || ""}_${item.title || ""}_${item.detail || ""}_${index}`)}`,
      severity: ["高", "中", "低"].includes(String(item.severity)) ? String(item.severity) : "中",
      category: String(item.category || "其他").trim() || "其他",
      title: String(item.title || "未命名问题").trim(),
      detail: String(item.detail || "").trim(),
      suggestion: String(item.suggestion || "").trim(),
      evidence: Array.isArray(item.evidence) ? item.evidence.map((text) => String(text).trim()).filter(Boolean).slice(0, 4) : [],
    }))
    .filter((item) => item.title && item.detail)
    .slice(0, 30);
}

async function buildLocalConsistencyIssues(projectPath, options = {}) {
  const { chapters, characters, worldDocs } = await loadProjectSources(projectPath);
  const chapterIds = makeIdSet(options.chapterIds);
  const sourceIds = makeIdSet(options.knowledgeSourceIds);
  const visibleChapters = chapterIds.size ? chapters.filter((chapter) => chapterIds.has(chapter.id)) : chapters;
  const visibleCharacters = sourceIds.size ? characters.filter((card) => sourceIds.has(card.id)) : characters;
  const visibleWorldDocs = sourceIds.size ? worldDocs.filter((doc) => sourceIds.has(doc.id)) : worldDocs;
  const issues = [];
  const titleMap = new Map();
  for (const chapter of visibleChapters) {
    const key = `${chapter.volume || ""}/${chapter.title || ""}`;
    titleMap.set(key, [...(titleMap.get(key) || []), chapter]);
    if ((chapter.wordCount || 0) < 20) {
      issues.push({
        id: `local_short_${chapter.id}`,
        severity: "低",
        category: "章节",
        title: `《${chapter.title}》内容较少`,
        detail: "这个章节或导入文档的字数很少，可能是空章节、占位章节或导入不完整。",
        suggestion: "检查该章节正文是否已经写入，或重新导入原文档。",
        evidence: [`${chapter.volume || "未分卷"} / ${chapter.title}`],
      });
    }
  }
  for (const [key, items] of titleMap.entries()) {
    if (items.length > 1) {
      issues.push({
        id: `local_duplicate_${sanitizeFileName(key)}`,
        severity: "中",
        category: "章节",
        title: `重复章节标题：${items[0].title}`,
        detail: "同一分组下出现重复章节标题，后续整书导出或检索时可能不容易分辨。",
        suggestion: "给重复条目补充编号、用途或版本说明。",
        evidence: items.map((item) => `${item.volume || "未分卷"} / ${item.title}`),
      });
    }
  }
  for (const card of visibleCharacters) {
    if (!String(card.background || card.personality || card.relationships || "").trim()) {
      issues.push({
        id: `local_empty_character_${card.id}`,
        severity: "低",
        category: "角色",
        title: `${card.name} 的角色卡信息较少`,
        detail: "这个角色缺少背景、性格和关系说明，后续 AI 检索时能利用的信息有限。",
        suggestion: "补充角色目标、秘密、阵营和关键关系。",
        evidence: [normalizeCategory(card.category)],
      });
    }
  }
  const worldTitleMap = new Map();
  for (const doc of visibleWorldDocs) {
    worldTitleMap.set(doc.title, [...(worldTitleMap.get(doc.title) || []), doc]);
    if (contentToPlainText(doc.content).length < 20) {
      issues.push({
        id: `local_short_world_${doc.id}`,
        severity: "低",
        category: "世界观",
        title: `世界观条目《${doc.title}》内容较少`,
        detail: "该设定条目几乎没有正文，AI 检索时能提供的信息有限。",
        suggestion: "补充规则、限制、关联角色或剧情作用。",
        evidence: [doc.category || "未分类"],
      });
    }
  }
  for (const [title, items] of worldTitleMap.entries()) {
    if (items.length > 1) {
      issues.push({
        id: `local_duplicate_world_${sanitizeFileName(title)}`,
        severity: "中",
        category: "世界观",
        title: `重复世界观标题：${title}`,
        detail: "多个世界观条目使用了相同标题，后续维护时容易混淆。",
        suggestion: "合并重复条目，或用更具体的标题区分。",
        evidence: items.map((item) => item.category || "未分类"),
      });
    }
  }
  return issues.slice(0, 40);
}

async function analyzeConsistency(projectPath, options = {}, control = {}) {
  const localIssues = await buildLocalConsistencyIssues(projectPath, options);
  const statuses = await loadIssueStatuses(projectPath);
  const materials = await buildStructuringMaterials(projectPath, "设定矛盾 时间线 冲突 角色 动机 世界规则 前后不一致", options);
  const systemPrompt = `你是长篇小说设定校对助手。请只基于用户提供的大纲、正文和检索片段，找出可能的前后矛盾、设定冲突、角色动机断裂、时间线问题。只输出 JSON，不要 Markdown，不要解释。
JSON 格式必须是：
{"issues":[{"severity":"高","category":"时间线","title":"","detail":"","evidence":[""],"suggestion":""}]}
要求：
1. severity 只能是 高、中、低。
2. category 可用：时间线、角色、世界观、剧情、章节、其他。
3. evidence 写引用到的章节名、设定名或简短原文。
4. 不确定的问题标为低，不要把风格建议当矛盾。`;
  const question = `请检查下面材料中的设定一致性问题，最多返回 20 条最值得处理的问题。

【检索片段】
${materials.retrieved || "无"}

【大纲与正文】
${materials.corpus}`;

  try {
    const answer = await callStructuredChatWithProgress(materials.config, systemPrompt, question, control, "AI 正在核对一致性问题");
    const aiIssues = normalizeConsistencyIssues(extractJsonFromModelText(answer));
    const seen = new Set();
    const issues = [...aiIssues, ...localIssues].filter((item) => {
      const key = `${item.category}_${item.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      issues: applyIssueStatuses(issues, statuses),
      contextCount: materials.search.chunks.length,
      apiError: "",
      options: {
        chapterIds: Array.isArray(options.chapterIds) ? options.chapterIds : [],
        knowledgeSourceIds: Array.isArray(options.knowledgeSourceIds) ? options.knowledgeSourceIds : [],
      },
    };
  } catch (error) {
    return {
      issues: applyIssueStatuses(localIssues, statuses),
      contextCount: materials.search.chunks.length,
      apiError: error.message || String(error),
      options: {
        chapterIds: Array.isArray(options.chapterIds) ? options.chapterIds : [],
        knowledgeSourceIds: Array.isArray(options.knowledgeSourceIds) ? options.knowledgeSourceIds : [],
      },
    };
  }
}

function normalizeExtractedWorldCards(payload) {
  const items = Array.isArray(payload?.worldDocs) ? payload.worldDocs : Array.isArray(payload?.cards) ? payload.cards : [];
  return items
    .map((item) => {
      const title = String(item.title || item.name || "").trim();
      const type = ["地点", "势力", "物品"].includes(String(item.type)) ? String(item.type) : "设定";
      const rawCategory = String(item.category || type).replace(/\s+/g, " ").trim();
      const category = rawCategory.startsWith(type) ? rawCategory : `${type}/${rawCategory}`;
      const content = String(item.content || item.description || "").trim();
      return {
        title,
        category,
        content: content.startsWith("#") ? content : `# ${title}\n\n${content}`,
      };
    })
    .filter((item) => item.title && item.content.replace(/^#.+/m, "").trim())
    .slice(0, 60);
}

async function buildExtractionMaterials(projectPath, options = {}) {
  const selectedText = contentToPlainText(String(options.text || "")).trim();
  if (selectedText) {
    const config = await loadConfig(projectPath);
    return {
      config,
      search: { chunks: [], embeddingSource: "selection", embeddingWarning: "" },
      retrieved: "",
      corpus: `【选中文字】\n${truncateForPrompt(selectedText, 20000)}`,
    };
  }
  const scope = options.scope === "chapter" ? "chapter" : "book";
  if (scope !== "chapter") {
    return buildStructuringMaterials(projectPath, "地点 城市 国家 大陆 势力 组织 家族 教会 物品 神器 道具 材料");
  }
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === options.chapterId);
  if (!chapter) throw new Error("请选择要提取资料的当前文档。");
  const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
  return {
    config,
    search: { chunks: [], embeddingSource: "local", embeddingWarning: "" },
    retrieved: "",
    corpus: `【${chapter.volume || "未分卷"}｜${chapter.title}】\n${contentToPlainText(content)}`,
  };
}

async function prepareWorldCardCandidates(projectPath, options = {}) {
  const materials = await buildExtractionMaterials(projectPath, options);
  const existing = await loadWorldDocs(projectPath);
  const existingTitles = existing.map((item) => item.title).filter(Boolean).join("、") || "暂无";
  const systemPrompt = `你是小说资料拆分助手。请只基于用户提供的大纲和检索片段，提取地点、势力、物品三类资料，并整理成世界观条目。只输出 JSON，不要 Markdown 解释。
JSON 格式必须是：
{"worldDocs":[{"type":"地点","title":"","category":"","content":""}]}
要求：
1. type 只能是 地点、势力、物品。
2. category 用分级分类，例如 地点/城市、地点/大陆、势力/教会、势力/家族、物品/神器、物品/材料。
3. content 使用 Markdown，第一行 # 标题，后面写来源、作用、相关角色、剧情功能、限制或疑点。
4. 不要编造材料中没有的信息。
5. 已有世界观标题：${existingTitles}`;
  const question = `请从下面材料中提取地点、势力、物品条目，最多 45 条，优先选择后续写作和检索会反复用到的资料。

【检索片段】
${materials.retrieved || "无"}

【大纲材料】
${materials.corpus}`;
  const answer = await callChatApi(materials.config, systemPrompt, question, []);
  const generated = normalizeExtractedWorldCards(extractJsonFromModelText(answer));
  if (!generated.length) throw new Error("AI 没有生成可识别的地点、势力或物品候选。");
  const candidates = generated.map((item, index) => {
    const matched = findSimilarWorldDoc(item.title, existing);
    return {
      id: `candidate_${stableHash(`${index}_${item.title}_${item.category}`)}`,
      title: item.title,
      category: item.category,
      content: item.content,
      selected: true,
      action: matched ? "merge" : "create",
      matchedDocId: matched?.id || "",
      matchedTitle: matched?.title || "",
    };
  });
  return { candidates, contextCount: materials.search.chunks.length, scope: options.scope === "chapter" ? "chapter" : "book" };
}

async function saveWorldCardCandidates(projectPath, candidates) {
  const selected = (Array.isArray(candidates) ? candidates : []).filter((item) => item?.selected !== false);
  if (!selected.length) throw new Error("请至少勾选一个要写入的资料条目。");
  const existing = await loadWorldDocs(projectPath);
  let created = 0;
  let updated = 0;
  const indexedSources = [];
  for (const item of selected) {
    const previous = existing.find((doc) => doc.id === item.matchedDocId) || findSimilarWorldDoc(item.title, existing);
    const fileName = previous?.fileName || (await uniqueContentFileName(projectPath, "worldbuilding", item.title, ".md"));
    const mergedContent =
      previous && item.action === "merge"
        ? `${stripWorldDocFrontMatter(previous.content).trim()}\n\n## 新提取资料 ${new Date().toLocaleDateString("zh-CN")}\n\n${stripWorldDocFrontMatter(item.content).replace(/^#.+\n?/, "").trim()}`
        : item.content;
    const doc = {
      id: previous?.id || fileName.replace(/\.md$/i, ""),
      title: item.title,
      category: normalizeCategory(item.category || previous?.category),
      fileName,
      content: mergedContent,
      updatedAt: nowIso(),
    };
    await writeWorldDoc(projectPath, doc);
    indexedSources.push({ id: doc.id, type: "world", title: doc.title, content: doc.content });
    if (previous) updated += 1;
    else created += 1;
  }
  await indexSources(projectPath, indexedSources);
  return {
    state: await buildAppState(projectPath),
    created,
    updated,
    count: selected.length,
    titles: selected.map((item) => item.title),
  };
}

async function refreshLocalStoryState(projectPath, chapterId, contentOverride = null, context = {}) {
  const config = context.config || await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error("章节不存在，无法更新创作状态。");
  const content = contentOverride === null ? await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "") : String(contentOverride || "");
  const characters = context.characters || await loadCharacters(projectPath);
  const ledger = storyState.analyzeChapterLocally({ chapter, content, characters });
  return storyState.saveChapterLedger(projectPath, ledger);
}

async function getStoryOverviewForProject(projectPath, options = {}) {
  const config = await loadConfig(projectPath);
  const projectChapters = await mapWithConcurrency(config.chapters, 8, async (chapter) => {
    return { id: chapter.id, title: chapter.title, volume: chapter.volume || "未分卷", revision: await cachedChapterRevision(projectPath, chapter) };
  });
  return storyState.getStoryOverview(projectPath, { chapterLimit: 500, ...options, projectChapters });
}

function storyAnalysisSystemPrompt() {
  return `你是小说项目的剧情事实整理工具。只记录输入正文中可以直接找到证据的事实，不要补写、推测或完善设定。
输出 JSON，不要 Markdown，不要解释。格式：
{"facts":[{"type":"剧情事件","subject":"","predicate":"","object":"","confidence":0.8,"evidence":[{"quote":"原文短句"}]}],"characterStates":[{"characterName":"","location":"","route":["行动路线"],"physical":["身体状态"],"mental":["精神状态"],"abilities":["能力变化"],"goals":["当前目标"],"obstacles":["当前阻碍"],"knowledge":["已知信息"],"knowledgeSources":["信息来源"],"possessions":["携带物品"],"relationships":["当前关系"],"relationshipChanges":["关系变化"],"lastAppearance":"最近一次出场原句","confidence":0.8,"evidence":[{"quote":"原文短句"}]}],"foreshadows":[{"title":"","description":"","stage":"埋设|强化|回收","plannedPayoff":"","relatedCharacters":[""],"confidence":0.7,"evidence":[{"quote":"原文短句"}]}]}
事实类型优先使用：剧情事件、地点变化、物品变化、知情变化、关系变化、状态变化。
每一条都必须带正文中的原句证据；没有证据就不要输出。角色“知道什么”必须严格区分叙述者信息与角色知情范围，并在 knowledgeSources 中写清得知渠道。伏笔如果是既有线索的强化或回收，沿用同一简洁标题并准确填写 stage。`;
}

async function analyzeStoryStateWithAI(projectPath, chapterId, control = {}) {
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error("章节不存在，无法执行 AI 剧情分析。");
  const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
  const characters = await loadCharacters(projectPath);
  const localLedger = storyState.analyzeChapterLocally({ chapter, content, characters });
  if (!runtimeSecret(config.api, "chat")) {
    const saved = await storyState.saveChapterLedger(projectPath, localLedger);
    return { ledger: saved, apiError: "未配置聊天 API，已完成本地基础分析。" };
  }
  const characterCatalog = characters.slice(0, 120).map((item) => `${item.name}${item.category ? `（${item.category}）` : ""}`).join("、");
  const question = `【章节】${chapter.volume || "未分卷"} / ${chapter.title}
【已有角色卡】${characterCatalog || "无"}
【正文】
${truncateForPrompt(contentToPlainText(content), 70000)}`;
  let partialOutput = "";
  let lastCheckpointAt = 0;
  const promptTokens = estimateTokenCount(`${storyAnalysisSystemPrompt()}\n${question}`);
  await control.update?.({ usage: { promptTokens, completionTokens: 0, totalTokens: promptTokens } });
  const answer = await callChatApi(config, storyAnalysisSystemPrompt(), question, [], {
    stream: true,
    signal: control.signal,
    onToken: (token) => {
      partialOutput += token;
      if (Date.now() - lastCheckpointAt < 900) return;
      lastCheckpointAt = Date.now();
      if (typeof control.update === "function") {
        const completionTokens = estimateTokenCount(partialOutput);
        void control.update({
          phase: `正在分析《${chapter.title}》`,
          partialOutput,
          usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
        });
      }
    },
  });
  const completionTokens = estimateTokenCount(answer);
  await control.update?.({ partialOutput: answer, usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens } });
  const normalized = storyState.normalizeAiChapterAnalysis(extractJsonFromModelText(answer), chapter, localLedger.sourceRevision, characters);
  const usefulLedger = normalized.facts.length || normalized.characterStates.length || normalized.foreshadows.length ? normalized : localLedger;
  const saved = await storyState.saveChapterLedger(projectPath, usefulLedger);
  return { ledger: saved, partialOutput: answer, apiError: usefulLedger === localLedger ? "AI 返回结构无法识别，已保留本地分析结果。" : "" };
}

function normalizeCreativeAdviceMode(value) {
  return ["next", "plot", "foreshadow"].includes(String(value || "")) ? String(value) : "next";
}

function creativeAdviceTypeForMode(mode) {
  if (mode === "plot") return "剧情推进";
  if (mode === "foreshadow") return "伏笔建议";
  return "下一章建议";
}

function normalizeStringArray(value, maxItems = 6) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, maxItems);
  const text = String(value || "").trim();
  return text ? [text].slice(0, maxItems) : [];
}

function normalizeCreativeAdvicePayload(payload, mode, chapter) {
  const fallbackType = creativeAdviceTypeForMode(mode);
  const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.advice) ? payload.advice : [];
  return items
    .map((item, index) => {
      const title = String(item.title || item.name || "").trim();
      const summary = String(item.summary || item.detail || item.description || "").trim();
      const type = ["下一章建议", "剧情推进", "伏笔建议"].includes(String(item.type)) ? String(item.type) : fallbackType;
      const priority = ["高", "中", "低"].includes(String(item.priority)) ? String(item.priority) : index < 2 ? "高" : "中";
      return {
        id: `advice_${stableHash(`${mode}_${chapter?.id || ""}_${index}_${title}_${summary}`)}`,
        type,
        title: title || `${fallbackType} ${index + 1}`,
        priority,
        summary,
        rationale: String(item.rationale || item.reason || item.why || "").trim(),
        benefits: normalizeStringArray(item.benefits || item.value || item.effect),
        risks: normalizeStringArray(item.risks || item.risk || item.warning),
        relatedCharacters: normalizeStringArray(item.relatedCharacters || item.characters),
        relatedSettings: normalizeStringArray(item.relatedSettings || item.settings || item.worldbuilding),
        targetChapter: String(item.targetChapter || item.chapter || chapter?.title || "").trim(),
        suggestedUse: String(item.suggestedUse || item.use || item.action || "").trim(),
      };
    })
    .filter((item) => item.title && item.summary)
    .slice(0, 12);
}

function buildLocalCreativeAdvice(mode, chapter, nextChapter, focus = "") {
  const type = creativeAdviceTypeForMode(mode);
  const focusText = String(focus || "").trim();
  const target = nextChapter?.title || chapter?.title || "下一章";
  const shared = {
    type,
    priority: "中",
    relatedCharacters: [],
    relatedSettings: [],
    targetChapter: target,
  };
  if (mode === "foreshadow") {
    return [
      {
        ...shared,
        id: `advice_${stableHash(`${chapter?.id || ""}_foreshadow_1`)}`,
        title: "用一个异常细节提前露出后续冲突",
        summary: `围绕《${chapter?.title || "当前章节"}》刚出现的线索，埋一个看似无关的小异常。`,
        rationale: "本地兜底无法调用模型，但伏笔最稳的做法是先给读者一个可记住的细节，暂时不解释。",
        benefits: ["增强后续回收的满足感", "让设定显得不是临时出现"],
        risks: ["异常太明显会破坏悬念", "细节如果后续不回收会变成噪音"],
        suggestedUse: focusText ? `结合你的关注点“${focusText}”，把伏笔藏在人物反应、物品状态或环境变化里。` : "优先藏在人物反应、物品状态或环境变化里。",
      },
    ];
  }
  if (mode === "plot") {
    return [
      {
        ...shared,
        id: `advice_${stableHash(`${chapter?.id || ""}_plot_1`)}`,
        title: "用一个选择题推动剧情，而不是只用信息推动剧情",
        summary: `下一步可以让角色面对一个必须取舍的事件，把线索推进和人物塑造绑在一起。`,
        rationale: "长篇剧情推进最怕只靠说明信息。让人物做选择，可以同时推进事件、关系和主题。",
        benefits: ["角色主动性更强", "读者更容易记住本章作用"],
        risks: ["选择代价需要明确", "不要让选择和主线目标脱节"],
        suggestedUse: focusText ? `围绕“${focusText}”设计一个短期选择：追线索、救人、隐瞒、交易或冒险。` : "设计一个短期选择：追线索、救人、隐瞒、交易或冒险。",
      },
    ];
  }
  return [
    {
      ...shared,
      id: `advice_${stableHash(`${chapter?.id || ""}_next_1`)}`,
      title: "下一章先承接上一章结果，再给出新的麻烦",
      summary: `从《${chapter?.title || "当前章节"}》的后果开场，随后引出一个更具体的目标或阻碍。`,
      rationale: "先承接能保持因果连续，再抛出新麻烦能让章节有推进感。",
      benefits: ["节奏自然", "读者不会觉得转场突兀"],
      risks: ["承接过长会拖慢开篇", "新麻烦需要和主线或人物目标有关"],
      suggestedUse: focusText ? `结合“${focusText}”，把开场控制在一到两个场景内。` : "把开场控制在一到两个场景内，尽快给出本章目标。",
    },
  ];
}

async function collectCreativeAgentToolReport(projectPath, ordered, selectedIndex, currentText, contextIds = []) {
  const characters = await loadCharacters(projectPath);
  const worldDocs = await loadWorldDocs(projectPath);
  const matchedCharacters = characters.filter((card) => card.name && currentText.includes(card.name)).slice(0, 20);
  const matchedWorld = worldDocs.filter((doc) => doc.title && currentText.includes(doc.title)).slice(0, 20);
  const earlierChapters = ordered.slice(0, selectedIndex + 1);
  const earlierTexts = await mapWithConcurrency(earlierChapters, 6, async (chapter) => ({
    chapter,
    text: contentToPlainText(await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "")),
  }));
  const lastAppearances = [];
  for (const card of matchedCharacters) {
    for (let index = earlierTexts.length - 1; index >= 0; index -= 1) {
      if (!earlierTexts[index].text.includes(card.name)) continue;
      lastAppearances.push(`${card.name}：${earlierTexts[index].chapter.title}`);
      break;
    }
  }
  const analysis = await loadAnalysisState(projectPath);
  const unresolvedIssues = (analysis.consistency?.issues || []).filter((item) => !["已修复", "忽略"].includes(item.status)).slice(0, 12);
  const timelineCount = Array.isArray(analysis.timeline?.events) ? analysis.timeline.events.length : 0;
  const summaries = await loadKnowledgeSummaries(projectPath);
  const health = await inspectProjectHealth(projectPath);
  const storyContext = await storyState.getAgentContext(projectPath, ordered[selectedIndex]?.id || "", matchedCharacters.map((item) => item.name), contextIds);
  const selectedIds = new Set((contextIds || []).map(String));
  const contextRefs = selectedIds.size
    ? [
        ...storyContext.facts.filter((item) => selectedIds.has(item.id)).flatMap((item) => item.evidence || []),
        ...storyContext.characterStates.filter((item) => selectedIds.has(item.id) || selectedIds.has(item.characterId)).flatMap((item) => item.evidence || []),
        ...storyContext.foreshadows.filter((item) => selectedIds.has(item.id)).flatMap((item) => item.plantedAt || []),
      ].filter((item, index, array) => item?.chapterId && array.findIndex((candidate) => candidate.chapterId === item.chapterId && candidate.quote === item.quote) === index).slice(0, 20)
    : [];
  const foreshadowCandidates = [];
  for (const item of earlierTexts) {
    if (/(伏笔|线索|预兆|异常|秘密|谜团)/.test(item.text)) foreshadowCandidates.push(item.chapter.title);
  }
  const tools = [
    { name: "当前与相邻章节", detail: `${ordered[Math.max(0, selectedIndex - 1)]?.title || "无"} / ${ordered[selectedIndex]?.title || "无"} / ${ordered[selectedIndex + 1]?.title || "无"}` },
    { name: "角色最近出场", detail: lastAppearances.join("；") || "当前章节未命中已有角色卡" },
    { name: "关联世界观", detail: matchedWorld.map((item) => item.title).join("；") || "当前章节未直接命名世界观条目" },
    { name: "伏笔候选", detail: foreshadowCandidates.slice(-12).join("；") || "暂未发现显式伏笔词" },
    { name: "时间线与一致性", detail: `时间线 ${timelineCount} 个事件；待处理问题 ${unresolvedIssues.length} 个` },
    { name: "知识库结构", detail: `文档摘要 ${summaries.sources.length}；分卷摘要 ${summaries.volumes.length}；全书摘要 ${summaries.book?.summary ? "可用" : "待建立"}` },
    { name: "章节健康", detail: health.healthy ? "未发现高风险结构问题" : `发现 ${health.issues.filter((item) => item.severity === "高").length} 个高风险问题` },
    { name: "剧情事实账本", detail: `当前章节可用事实 ${storyContext.facts.length} 条；角色状态 ${storyContext.characterStates.length} 条` },
    { name: "待处理伏笔", detail: storyContext.foreshadows.slice(0, 8).map((item) => `${item.title}（${item.status}）`).join("；") || "暂无已记录的待处理伏笔" },
  ];
  const evidencePrompt = [
    storyContext.facts.length ? `【已发生事实】\n${storyContext.facts.slice(0, 24).map((item) => `- ${item.subject}：${item.object}（${item.chapterTitle}）`).join("\n")}` : "",
    storyContext.characterStates.length ? `【角色最新状态】\n${storyContext.characterStates.slice(0, 16).map((item) => `- ${item.characterName}：地点 ${item.location || "未记录"}；目标 ${(item.goals || []).join("、") || "未记录"}；知情 ${(item.knowledge || []).join("、") || "未记录"}`).join("\n")}` : "",
    storyContext.foreshadows.length ? `【未回收伏笔】\n${storyContext.foreshadows.slice(0, 20).map((item) => `- ${item.title}：${item.description}（${item.status}）`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  const prompt = `${tools.map((item) => `- ${item.name}：${item.detail}`).join("\n")}${evidencePrompt ? `\n\n${evidencePrompt}` : ""}`;
  return { tools, prompt, storyContext, contextRefs };
}

async function buildAgentRetrievalContext(projectPath, config, query, chapterId, contextIds = []) {
  const [characters, worldDocs, workspace] = await Promise.all([
    loadCharacters(projectPath),
    loadWorldDocs(projectPath),
    creativeWorkspace.loadWorkspace(projectPath),
  ]);
  const subQueries = retrievalPlanner.decomposeQuery(query, "normal");
  const signals = retrievalPlanner.extractQuerySignals(query, characters, worldDocs);
  const anchorIds = [chapterId].filter(Boolean);
  const adjacencyScores = retrievalPlanner.buildChapterAdjacency(config.chapters || [], anchorIds);
  const storyContext = chapterId
    ? await storyState.getAgentContext(projectPath, chapterId, signals.characters, contextIds).catch(() => ({}))
    : {};
  const storyScores = retrievalPlanner.buildStoryBoosts(workspace, storyContext, subQueries);
  return { subQueries, signals, adjacencyScores, storyScores };
}

async function buildCreativeAdvice(projectPath, options = {}, control = {}) {
  const mode = normalizeCreativeAdviceMode(options.mode);
  const focus = String(options.focus || "").trim().slice(0, 1200);
  const contextIds = Array.isArray(options.contextIds) ? options.contextIds.map(String).slice(0, 60) : [];
  const includeSourceIds = [...new Set((Array.isArray(options.includeSourceIds) ? options.includeSourceIds : []).map(String).filter(Boolean))].slice(0, 500);
  const excludeSourceIds = [...new Set((Array.isArray(options.excludeSourceIds) ? options.excludeSourceIds : []).map(String).filter(Boolean))].filter((id) => !includeSourceIds.includes(id)).slice(0, 500);
  const config = await loadConfig(projectPath);
  const ordered = config.chapters.slice().sort((a, b) => a.order - b.order);
  const requestedIndex = ordered.findIndex((chapter) => chapter.id === options.chapterId);
  if (options.chapterId && requestedIndex < 0) throw new Error("创作参谋对应的章节已不存在，请重新选择章节。");
  const selectedIndex = requestedIndex >= 0 ? requestedIndex : 0;
  const chapter = ordered[selectedIndex];
  if (!chapter) throw new Error("当前项目还没有可分析的章节。");
  const resolvedScope = novelAgent.resolveScope(config, chapter, options.scopeType || "chapter", focus, mode);
  const suppliedScopeIds = Array.isArray(options.scopeIds) ? options.scopeIds.map(String).filter((id) => ordered.some((item) => item.id === id)) : [];
  const scope = suppliedScopeIds.length
    ? { ...resolvedScope, ids: suppliedScopeIds, label: String(options.scopeLabel || resolvedScope.label) }
    : resolvedScope;
  const previousChapter = ordered[selectedIndex - 1] || null;
  const nextChapter = ordered[selectedIndex + 1] || null;
  const readPlain = async (item, maxChars) => {
    if (!item) return "";
    const content = await fs.readFile(getChapterPath(projectPath, item), "utf8").catch(() => "");
    return truncateForPrompt(contentToPlainText(content), maxChars);
  };
  const currentText = await readPlain(chapter, 12000);
  const previousText = await readPlain(previousChapter, 5000);
  const nextText = await readPlain(nextChapter, 5000);
  const toolReport = await collectCreativeAgentToolReport(projectPath, ordered, selectedIndex, currentText, contextIds);
  toolReport.tools.unshift({ name: "分析范围", detail: scope.label });
  toolReport.prompt = `- 分析范围：${scope.label}\n${toolReport.prompt}`;
  const workflowToolReports = Array.isArray(options.workflowToolReports) ? options.workflowToolReports.slice(0, 20) : [];
  if (workflowToolReports.length) {
    toolReport.tools.push(...workflowToolReports.map((item) => ({ name: item.name || item.label || "Agent 工具", detail: item.detail || "已完成检查" })));
    toolReport.prompt += `\n\n【本次工作流工具结果】\n${workflowToolReports.map((item) => `- ${item.name || item.label}：${item.detail || "已完成检查"}`).join("\n")}`;
  }
  const workspaceState = await creativeWorkspace.loadWorkspace(projectPath);
  const memories = creativeWorkspace.relevantMemories(workspaceState, chapter);
  if (memories.length) {
    toolReport.tools.push({ name: "分层项目记忆", detail: memories.slice(0, 12).map((item) => `${item.scope}：${item.title}`).join("；") });
    toolReport.prompt += `\n\n【作者确认的分层记忆】\n${memories.slice(0, 30).map((item) => `- [${item.scope}] ${item.title}：${item.content}`).join("\n")}`;
  }
  const outlineTitles = ordered
    .filter((item) => getKnowledgeRole(item) === "大纲")
    .slice(0, 8)
    .map((item) => `${item.volume || "未分卷"} / ${item.title}`)
    .join("；");
  const modeQuestion =
    mode === "plot"
      ? "剧情推进 合理化 冲突 动机 节奏 事件 选择"
      : mode === "foreshadow"
        ? "伏笔 埋设 回收 线索 异常 预兆 悬念"
        : "下一章 建议 节奏 人物 事件 主线 转场";
  const query = [modeQuestion, scope.label, chapter.title, nextChapter?.title || "", focus].filter(Boolean).join(" ");
  const topK = Math.floor(clampNumber(config.api.topK || 40, 1, MAX_RETRIEVAL_TOP_K, 40));
  const retrievalContext = await buildAgentRetrievalContext(projectPath, config, query, chapter.id, contextIds);
  retrievalContext.routedVolumes = [...new Set(ordered.filter((item) => scope.ids.includes(item.id)).map((item) => item.volume || "未分卷"))];
  retrievalContext.requiredSourceIds = [...(scope.ids.length <= 60 ? scope.ids.filter((id) => !excludeSourceIds.includes(id)) : []), ...includeSourceIds];
  const search = await searchRelevantChunks(projectPath, query, topK, {
    minKeep: Math.min(24, topK),
    maxChars: STRUCTURING_CONTEXT_CHAR_BUDGET,
    retrievalContext,
    mode: scope.type === "book" ? "book" : "normal",
    additionalLoadSourceIds: includeSourceIds,
    boostSourceIds: includeSourceIds,
    excludeSourceIds,
  });
  if (includeSourceIds.length) search.chunks = forceIncludeSourceChunks(search.chunks, search._store, includeSourceIds, topK);
  const retrieved = search.chunks
    .map((item, index) => {
      const role = item.sourceType === "chapter" ? knowledgeRoleLabel(item.knowledgeRole) : item.sourceType === "character" ? "角色卡" : "世界观";
      const group = item.volume || item.category || "";
      return `【检索片段${index + 1}｜${role}${group ? `｜${group}` : ""}｜${item.title}】\n${item.text}`;
    })
    .join("\n\n");
  const retrievalAudit = {
    query,
    requestedTopK: topK,
    selectedChunks: search.chunks.length,
    selectedSources: [...new Set(search.chunks.map((item) => item.title))],
    knowledgeRoles: search.chunks.reduce((counts, item) => {
      const role = item.sourceType === "chapter" ? knowledgeRoleLabel(item.knowledgeRole) : item.sourceType === "character" ? "角色卡" : "世界观";
      counts[role] = (counts[role] || 0) + 1;
      return counts;
    }, {}),
    memoryCount: memories.length,
    estimatedPromptTokens: 0,
    warnings: [
      ...(search.chunks.length < Math.min(12, topK) ? ["命中的原始片段较少，请确认知识库已同步。"] : []),
      ...(search.coveragePass?.uncoveredTargets?.length ? [`${search.coveragePass.uncoveredTargets.length} 个证据目标尚未覆盖。`] : []),
      ...(includeSourceIds.length ? [`作者强制纳入 ${includeSourceIds.length} 份资料。`] : []),
      ...(excludeSourceIds.length ? [`作者排除 ${excludeSourceIds.length} 份资料。`] : []),
    ],
    firstPassCount: search.coveragePass?.firstPassCount || search.chunks.length,
    secondPassCount: search.coveragePass?.secondPassCount || 0,
    evidenceConfidence: search.coveragePass?.evidenceConfidence || "低",
    uncoveredTargets: search.coveragePass?.uncoveredTargets || [],
  };
  const systemPrompt = `你是一个“小说创作参谋 Agent”，不是代写机器。你的任务是辅助作者判断下一步怎么写，而不是替作者完成正文。
必须只基于提供的大纲、正文、角色卡、世界观和检索片段提出建议；不确定就写风险，不要硬编事实。
请输出 JSON，不要 Markdown，不要解释。JSON 格式必须是：
{"items":[{"type":"下一章建议","priority":"高","title":"","summary":"","rationale":"","benefits":[""],"risks":[""],"relatedCharacters":[""],"relatedSettings":[""],"targetChapter":"","suggestedUse":""}]}

字段要求：
1. type 只能是：下一章建议、剧情推进、伏笔建议。
2. priority 只能是：高、中、低。
3. summary 写具体建议，不要空泛。
4. rationale 写为什么它适合当前文本和大纲。
5. benefits 写收益，risks 写风险或注意事项。
6. suggestedUse 写作者可以怎样使用这个建议，但不要写完整正文。
7. 每条建议尽量能被作者采纳、改造或存为素材。`;
  const task =
    mode === "plot"
      ? "请给出 5 到 8 个剧情推进/合理化方案，重点是事件因果、角色动机、冲突升级和节奏控制。"
      : mode === "foreshadow"
        ? "请给出 5 到 8 个伏笔建议，包含现在怎么轻轻埋下、未来如何回收、风险是什么。"
        : "请给出 5 到 8 个下一章创作建议，重点是可用事件、章节目标、节奏、人物表现和自然转场。";
  const question = `${task}

【当前关注点】
${focus || "无"}

【本次分析范围】
${scope.label}

【当前章节】
${chapter.volume || "未分卷"} / ${chapter.title}
${currentText || "暂无正文"}

【上一章参考】
${previousChapter ? `${previousChapter.volume || "未分卷"} / ${previousChapter.title}\n${previousText}` : "无"}

【下一条目录参考】
${nextChapter ? `${nextChapter.volume || "未分卷"} / ${nextChapter.title}\n${nextText}` : "无"}

【项目大纲文档】
${outlineTitles || "未显式标记大纲文档"}

【Agent 工具检查结果】
${toolReport.prompt}

【检索片段】
${retrieved || "无"}`;
  retrievalAudit.estimatedPromptTokens = estimateTokenCount(`${systemPrompt}\n${question}`);
  try {
    const answer = await callStructuredChatWithProgress(config, systemPrompt, question, control, "创作参谋正在整理建议");
    const items = normalizeCreativeAdvicePayload(extractJsonFromModelText(answer), mode, chapter)
      .map((item) => ({ ...item, sourceRefs: toolReport.contextRefs }));
    if (!items.length) throw new Error("AI 没有返回可识别的建议卡片。");
    return {
      mode,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      generatedAt: nowIso(),
      contextCount: search.chunks.length,
      apiError: "",
      toolReport: toolReport.tools,
      retrievalAudit,
      items,
    };
  } catch (error) {
    return {
      mode,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      generatedAt: nowIso(),
      contextCount: search.chunks.length,
      apiError: error.message || String(error),
      toolReport: toolReport.tools,
      retrievalAudit,
      items: buildLocalCreativeAdvice(mode, chapter, nextChapter, focus).map((item) => ({ ...item, sourceRefs: toolReport.contextRefs })),
    };
  }
}

async function getCreativeWorkspaceView(projectPath) {
  const state = await creativeWorkspace.loadWorkspace(projectPath);
  const config = await loadConfig(projectPath);
  const revisionsByChapter = new Map();
  for (const chapter of config.chapters) revisionsByChapter.set(chapter.id, await cachedChapterRevision(projectPath, chapter));
  return {
    ...state,
    annotations: state.annotations.map((item) => ({
      ...item,
      stale: Boolean(item.sourceRevision && revisionsByChapter.get(item.chapterId) && item.sourceRevision !== revisionsByChapter.get(item.chapterId)),
    })),
    revisions: state.revisions.map((item) => ({
      ...item,
      stale: item.status === "待确认" && Boolean(item.sourceRevision && revisionsByChapter.get(item.chapterId) && item.sourceRevision !== revisionsByChapter.get(item.chapterId)),
    })),
  };
}

async function prepareCreativeAgentRun(projectPath, options = {}) {
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === options.chapterId) || config.chapters[0];
  if (!chapter) throw new Error("当前项目没有可供参谋分析的文档。");
  const mode = normalizeCreativeAdviceMode(options.mode);
  const focus = String(options.focus || "").trim().slice(0, 1200);
  const selectedText = String(options.selectedText || "").trim().slice(0, 20000);
  const includeSourceIds = [...new Set((Array.isArray(options.includeSourceIds) ? options.includeSourceIds : []).map(String).filter(Boolean))].slice(0, 500);
  const excludeSourceIds = [...new Set((Array.isArray(options.excludeSourceIds) ? options.excludeSourceIds : []).map(String).filter(Boolean))].filter((id) => !includeSourceIds.includes(id)).slice(0, 500);
  const permissionLevel = novelAgent.normalizePermission(options.permissionLevel || config.agent.permissionLevel);
  const requestedScope = String(options.scopeType || "auto");
  const scope = novelAgent.resolveScope(config, chapter, requestedScope, focus, mode);
  const workspaceState = await creativeWorkspace.loadWorkspace(projectPath);
  const memories = creativeWorkspace.relevantMemories(workspaceState, chapter);
  const query = [scope.label, chapter.title, focus, mode === "plot" ? "剧情推进 因果 动机" : mode === "foreshadow" ? "伏笔 埋设 回收" : "下一章 节奏 人物"].filter(Boolean).join(" ");
  const topK = Math.floor(clampNumber(config.api.topK || 120, 1, MAX_RETRIEVAL_TOP_K, 120));
  const retrievalContext = await buildAgentRetrievalContext(projectPath, config, query, chapter.id, options.contextIds || []);
  retrievalContext.routedVolumes = [...new Set(config.chapters.filter((item) => scope.ids.includes(item.id)).map((item) => item.volume || "未分卷"))];
  retrievalContext.requiredSourceIds = [...(scope.ids.length <= 60 ? scope.ids.filter((id) => !excludeSourceIds.includes(id)) : []), ...includeSourceIds];
  const search = await searchRelevantChunks(projectPath, query, topK, {
    minKeep: Math.min(24, topK),
    maxChars: STRUCTURING_CONTEXT_CHAR_BUDGET,
    retrievalContext,
    mode: scope.type === "book" ? "book" : "normal",
    additionalLoadSourceIds: includeSourceIds,
    boostSourceIds: includeSourceIds,
    excludeSourceIds,
  });
  if (includeSourceIds.length) search.chunks = forceIncludeSourceChunks(search.chunks, search._store, includeSourceIds, topK);
  const sourceTitles = [...new Set(search.chunks.map((item) => item.title))];
  const warnings = [];
  if (!search.chunks.length) warnings.push("知识库没有命中原文，请先检查同步状态。");
  if (!config.chapters.some((item) => getKnowledgeRole(item) === "大纲")) warnings.push("项目中没有标记为“大纲”的文档，建议可能缺少长期方向依据。");
  if (search.chunks.length >= topK) warnings.push("本次命中达到发送上限，执行后请查看检索审计中的未读资料。");
  if (search.freshness?.repairedSourceCount) warnings.push(`执行前已自动更新 ${search.freshness.repairedSourceCount} 份过期资料。`);
  if (search.coveragePass?.uncoveredTargets?.length) warnings.push(`仍有 ${search.coveragePass.uncoveredTargets.length} 个证据目标未覆盖，执行结果会明确标出证据不足。`);
  if (includeSourceIds.length) warnings.push(`已强制纳入 ${includeSourceIds.length} 份作者指定资料。`);
  if (excludeSourceIds.length) warnings.push(`已排除 ${excludeSourceIds.length} 份作者指定资料。`);
  const plannedTools = novelAgent.selectTools(focus || query, mode, permissionLevel, selectedText);
  const steps = [
    { tool: "scope_checkpoint", label: `分析范围：${scope.label}`, reason: scope.recommended ? "Agent 根据目标自动推荐，可在执行前改为章节、分卷或全书" : "使用作者手动指定的分析范围" },
    ...plannedTools.map((item) => ({ tool: item.tool, label: item.allowed ? item.label : `${item.label}（跳过）`, reason: item.allowed ? item.reason : item.skipReason })),
    { tool: "knowledge_retrieval", label: `长篇检索与证据汇总（最多 ${topK} 个片段）`, reason: "综合分层摘要、角色地点、相邻章节、剧情事实和伏笔证据" },
    { tool: "creative_advisor", label: "汇总为可选择的创作建议", reason: "保存工具阶段结果，不直接覆盖正文" },
  ];
  const retrievalAudit = {
    query,
    requestedTopK: topK,
    selectedChunks: search.chunks.length,
    selectedSources: sourceTitles,
    memoryCount: memories.length,
    estimatedPromptTokens: estimateTokenCount(search.chunks.map((item) => item.text).join("\n")) + 5000,
    warnings,
    firstPassCount: search.coveragePass?.firstPassCount || search.chunks.length,
    secondPassCount: search.coveragePass?.secondPassCount || 0,
    evidenceConfidence: search.coveragePass?.evidenceConfidence || "低",
    uncoveredTargets: search.coveragePass?.uncoveredTargets || [],
  };
  const run = await creativeWorkspace.upsertItem(projectPath, "agentRuns", {
    mode,
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    scopeType: scope.type,
    scopeIds: scope.ids,
    scopeLabel: scope.label,
    scopeRecommended: scope.recommended,
    objective: focus || "根据当前正文和项目资料提供下一步创作建议",
    status: "待确认",
    permissionLevel,
    selectedText,
    selectedTextRevision: String(options.selectedTextRevision || ""),
    contextIds: Array.isArray(options.contextIds) ? options.contextIds : [],
    includeSourceIds,
    excludeSourceIds,
    memoryIds: memories.map((item) => item.id),
    steps,
    toolStates: novelAgent.initialToolStates(plannedTools),
    stageCheckpoints: [
      ...novelAgent.initialToolStates(plannedTools).map((item) => ({ id: item.tool, label: item.label, status: item.status, detail: item.detail, startedAt: "", completedAt: item.status === "已跳过" ? nowIso() : "", error: "" })),
      { id: "creative_advisor", label: "汇总创作建议", status: "等待中", detail: "等待各项检查完成", startedAt: "", completedAt: "", error: "" },
    ],
    stageSummary: { completed: [], failed: [], skipped: plannedTools.filter((item) => !item.allowed).map((item) => item.tool) },
    taskId: "",
    partialOutput: "",
    retrievalAudit,
  });
  return run;
}

async function buildCreativeAgentExecutionContext(projectPath, run) {
  const config = await loadConfig(projectPath);
  const ordered = config.chapters.slice().sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((item) => item.id === run.chapterId);
  const chapter = ordered[index];
  if (!chapter) throw new Error("Agent 计划对应的章节已不存在，请重新准备计划。");
  const raw = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
  const currentText = contentToPlainText(raw);
  const scopedIds = new Set((run.scopeIds?.length ? run.scopeIds : [chapter.id]).map(String));
  const includeIds = new Set((run.includeSourceIds || []).map(String));
  const excludeIds = new Set((run.excludeSourceIds || []).map(String).filter((id) => !includeIds.has(id)));
  const scopeChapters = ordered.filter((item) => (scopedIds.has(String(item.id)) || includeIds.has(String(item.id))) && !excludeIds.has(String(item.id)));
  const scopeTexts = await mapWithConcurrency(scopeChapters, 8, async (item) => ({
    chapter: item,
    text: contentToPlainText(await fs.readFile(getChapterPath(projectPath, item), "utf8").catch(() => "")),
  }));
  const [characters, worldDocs, workspace, analysis, storyContext, board, summaries] = await Promise.all([
    loadCharacters(projectPath),
    loadWorldDocs(projectPath),
    creativeWorkspace.loadWorkspace(projectPath),
    loadAnalysisState(projectPath),
    storyState.getAgentContext(projectPath, chapter.id, [], run.contextIds || []).catch(() => ({})),
    storyState.getBoard(projectPath, chapter.id).catch(() => null),
    loadKnowledgeSummaries(projectPath),
  ]);
  return { config, ordered, index, chapter, previous: ordered[index - 1] || null, next: ordered[index + 1] || null, currentText, scopeChapters, scopeTexts, characters, worldDocs, workspace, analysis, storyContext, board, summaries };
}

function pacingReport(text) {
  const body = String(text || "");
  const paragraphs = body.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const sentences = body.split(/[。！？!?]/).map((item) => item.trim()).filter(Boolean);
  const dialogueChars = [...body.matchAll(/“([^”]*)”/g)].reduce((sum, match) => sum + String(match[1] || "").length, 0);
  const headingCount = paragraphs.filter((item) => /^第.+章|^[一二三四五六七八九十\d]+[.、]|^场景/.test(item)).length;
  const dialogueRatio = body.length ? Math.round((dialogueChars / body.length) * 100) : 0;
  const averageSentence = sentences.length ? Math.round(body.length / sentences.length) : 0;
  return `正文 ${countWords(body)} 字；${paragraphs.length} 段；平均句长约 ${averageSentence} 字；对话约 ${dialogueRatio}%；显式场景/小标题 ${headingCount} 个`;
}

async function runCreativeAgentTool(tool, context, run) {
  const { chapter, previous, next, currentText, scopeChapters, scopeTexts, characters, worldDocs, workspace, analysis, storyContext, board, summaries } = context;
  const scopedText = (scopeTexts || []).map((item) => item.text).join("\n");
  if (tool === "read_adjacent_chapters") {
    const previousText = (scopeTexts || []).find((item) => item.chapter.id === previous?.id)?.text || "";
    const nextText = (scopeTexts || []).find((item) => item.chapter.id === next?.id)?.text || "";
    return `前章：${previous?.title || "无"}（末尾：${previousText.slice(-260) || "未纳入本次范围"}）；当前：${chapter.title}；后章：${next?.title || "无"}（开头：${nextText.slice(0, 260) || "未纳入本次范围"}）`;
  }
  if (tool === "character_state_lookup") {
    const states = storyContext.characterStates || [];
    return states.length ? states.slice(0, 20).map((item) => `${item.characterName}：地点 ${item.location || "未知"}；身心 ${[...(item.physical || []), ...(item.mental || [])].join("、") || "未记录"}；能力 ${item.abilities?.join("、") || "未记录"}；目标 ${item.goals?.join("、") || "未记录"}；阻碍 ${item.obstacles?.join("、") || "未记录"}`).join("\n") : "当前范围没有角色状态快照";
  }
  if (tool === "recent_appearance_lookup") {
    const states = storyContext.characterStates || [];
    return states.length ? states.slice(0, 30).map((item) => `${item.characterName}：${item.chapterTitle} / ${item.lastAppearance || "未记录原文位置"}`).join("\n") : "当前范围没有角色最近出场记录";
  }
  if (tool === "knowledge_scope_lookup") {
    const states = storyContext.characterStates || [];
    return states.length ? states.slice(0, 25).map((item) => `${item.characterName}：${item.knowledge?.join("；") || "未记录知情"}${item.knowledgeSources?.length ? `（来源：${item.knowledgeSources.join("；")}）` : "（来源待核对）"}`).join("\n") : "当前范围没有人物知情记录";
  }
  if (tool === "world_rule_lookup") {
    const matched = worldDocs.filter((item) => item.title && (scopedText || currentText).includes(item.title));
    return `直接命中世界观 ${matched.length} 条：${matched.slice(0, 20).map((item) => `${item.category || "未分类"}/${item.title}`).join("、") || "无直接标题命中"}；项目世界观共 ${worldDocs.length} 条`;
  }
  if (tool === "open_foreshadow_lookup") {
    const open = (storyContext.foreshadows || []).filter((item) => !["已经回收", "已废弃"].includes(item.status));
    return open.length ? open.slice(0, 30).map((item) => `${item.title}（${item.status}）：埋设 ${item.plantedAt?.length || 0} / 强化 ${item.reinforcedAt?.length || 0} / 回收 ${item.payoffAt?.length || 0}`).join("\n") : "没有未回收伏笔";
  }
  if (tool === "timeline_lookup") {
    const events = analysis.timeline?.events || [];
    return events.length ? events.slice(0, 80).map((item) => `${item.order + 1}. ${item.timeHint || item.title} / ${item.chapterTitle}：${item.summary}`).join("\n") : "尚未保存时间线，请先在分析页刷新时间线";
  }
  if (tool === "chapter_transition_check") {
    return `衔接位置：${previous?.title || "开篇"} -> ${chapter.title} -> ${next?.title || "目录末尾"}；当前开头：${currentText.slice(0, 220)}；当前结尾：${currentText.slice(-220)}`;
  }
  if (tool === "setting_conflict_check") {
    const unresolved = (analysis.consistency?.issues || []).filter((item) => !["已修复", "已忽略"].includes(item.status));
    return unresolved.length ? unresolved.slice(0, 40).map((item) => `${item.severity}/${item.category}：${item.title} - ${item.detail}`).join("\n") : "没有已保存的待处理一致性问题";
  }
  if (tool === "outline_goal_lookup") {
    const outlines = (summaries.sources || []).filter((item) => item.knowledgeRole === "大纲");
    return `项目大纲 ${outlines.length} 份：${outlines.slice(0, 30).map((item) => `${item.volume || "未分卷"}/${item.title}`).join("、") || "知识库未标记大纲"}`;
  }
  if (tool === "knowledge_coverage_check") {
    const audit = run.retrievalAudit || {};
    return `本次范围 ${run.scopeLabel}；已选 ${audit.selectedChunks || 0} 个片段 / ${(audit.selectedSources || []).length} 份资料；证据置信度 ${audit.evidenceConfidence || "未评估"}；仍缺证据 ${(audit.uncoveredTargets || []).join("、") || "无"}`;
  }
  if (tool === "chapter_health_check") return `${run.scopeLabel || chapter.title}：${pacingReport(scopedText || currentText)}；场景计划 ${(workspace.scenes || []).filter((item) => item.chapterId === chapter.id).length} 个；筹备项 ${board?.items?.length || 0} 个`;
  if (tool === "chapter_planner") {
    return `范围：${run.scopeLabel || chapter.title}；位置：${previous?.title || "开篇"} → ${chapter.title} → ${next?.title || "目录末尾"}；当前筹备板 ${board?.items?.length || 0} 项；大纲摘要 ${summaries.sources.filter((item) => item.knowledgeRole === "大纲").length} 份`;
  }
  if (tool === "plot_causality_advisor") {
    const nodes = (workspace.causalNodes || []).filter((item) => !item.chapterId || item.chapterId === chapter.id);
    return `当前相关因果节点 ${nodes.length} 个；剧情事实 ${(storyContext.facts || []).length} 条；${nodes.slice(0, 6).map((item) => item.title).join("、") || "尚无人工确认的因果节点"}`;
  }
  if (tool === "character_development_advisor") {
    const matched = characters.filter((item) => item.name && (scopedText || currentText).includes(item.name));
    const scopedIds = new Set((scopeChapters || []).map((item) => item.id));
    const arcs = (workspace.arcs || []).filter((item) => (!item.chapterId || scopedIds.has(item.chapterId)) && matched.some((card) => card.id === item.characterId || card.name === item.characterName));
    return `当前范围命中角色卡 ${matched.length} 张：${matched.slice(0, 12).map((item) => item.name).join("、") || "无"}；相关人物弧节点 ${arcs.length} 个；最新角色状态 ${(storyContext.characterStates || []).length} 条`;
  }
  if (tool === "foreshadow_manager") {
    const open = (storyContext.foreshadows || []).filter((item) => !["已经回收", "已废弃"].includes(item.status));
    return `待处理伏笔 ${open.length} 条：${open.slice(0, 10).map((item) => `${item.title}（${item.status}）`).join("、") || "暂无已记录伏笔"}`;
  }
  if (tool === "pacing_analyzer") return `${run.scopeLabel || chapter.title}：${pacingReport(scopedText || currentText)}；覆盖 ${scopeChapters?.length || 1} 份文档`;
  if (tool === "continuity_checker") {
    const unresolved = (analysis.consistency?.issues || []).filter((item) => !["已修复", "忽略"].includes(item.status));
    const scopedIds = new Set((scopeChapters || []).map((item) => item.id));
    return `现有一致性问题 ${unresolved.length} 个；当前范围相关 ${unresolved.filter((item) => scopedIds.has(item.chapterId) || (scopeChapters || []).some((chapterItem) => chapterItem.title === item.chapterTitle)).length} 个；时间线事件 ${analysis.timeline?.events?.length || 0} 个`;
  }
  if (tool === "setting_verifier") {
    const matched = worldDocs.filter((item) => item.title && (scopedText || currentText).includes(item.title));
    return `当前范围直接命中世界观 ${matched.length} 条：${matched.slice(0, 12).map((item) => item.title).join("、") || "无"}；项目共有 ${worldDocs.length} 条世界观资料`;
  }
  if (tool === "safe_revision_proposer") {
    return run.selectedText ? `已取得作者选中的 ${countWords(run.selectedText)} 字原文，将生成独立的待确认修订，不会覆盖正文` : "没有选中文字，已跳过修订候选";
  }
  throw new Error(`未知的 Agent 工具：${tool}`);
}

function inferRevisionAction(objective) {
  if (/扩写/.test(objective)) return "扩写";
  if (/精简/.test(objective)) return "精简";
  if (/改写/.test(objective)) return "改写";
  return "润色";
}

function updateAgentStage(run, stageId, patch) {
  const checkpoints = (run.stageCheckpoints || []).map((item) => item.id === stageId ? { ...item, ...patch } : item);
  const stageSummary = {
    completed: checkpoints.filter((item) => item.status === "已完成").map((item) => item.id),
    failed: checkpoints.filter((item) => item.status === "失败").map((item) => item.id),
    skipped: checkpoints.filter((item) => item.status === "已跳过").map((item) => item.id),
  };
  return { ...run, stageCheckpoints: checkpoints, stageSummary };
}

async function executeCreativeAgentRun(projectPath, runId, control = {}, onlyTool = "") {
  const workspaceState = await creativeWorkspace.loadWorkspace(projectPath);
  let run = workspaceState.agentRuns.find((item) => item.id === runId);
  if (!run) throw new Error("没有找到待执行的 Agent 计划，请重新准备。");
  run = await creativeWorkspace.upsertItem(projectPath, "agentRuns", { ...run, status: "运行中", error: "" });
  const reports = onlyTool
    ? run.toolStates.filter((item) => item.status === "已完成" && item.tool !== onlyTool).map((item) => ({ name: item.label, detail: item.partialOutput || item.detail }))
    : [];
  const total = Math.max(1, run.toolStates.filter((item) => item.status !== "已跳过" && (!onlyTool || item.tool === onlyTool)).length + 1);
  let current = 0;
  try {
    const context = await buildCreativeAgentExecutionContext(projectPath, run);
    for (const state of run.toolStates) {
      if (state.status === "已跳过" || (onlyTool && state.tool !== onlyTool)) continue;
      if (!onlyTool && state.status === "已完成") {
        reports.push({ name: state.label, detail: state.partialOutput || state.detail });
        current += 1;
        continue;
      }
      if (control.signal?.aborted) throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
      run = await creativeWorkspace.upsertItem(projectPath, "agentRuns", {
        ...updateAgentStage(run, state.tool, { status: "运行中", startedAt: nowIso(), completedAt: "", detail: "正在检查", error: "" }),
        toolStates: run.toolStates.map((item) => item.tool === state.tool ? { ...item, status: "运行中", error: "" } : item),
      });
      await control.update?.({ phase: `${state.label}正在检查`, current, total, detail: run.chapterTitle });
      try {
        const detail = await runCreativeAgentTool(state.tool, context, run);
        reports.push({ name: state.label, detail });
        current += 1;
        const partialLine = `【${state.label}】${detail}`;
        run = await creativeWorkspace.upsertItem(projectPath, "agentRuns", {
          ...updateAgentStage(run, state.tool, { status: "已完成", completedAt: nowIso(), detail, error: "" }),
          partialOutput: `${run.partialOutput || ""}\n${partialLine}`.trim(),
          toolStates: run.toolStates.map((item) => item.tool === state.tool ? { ...item, status: "已完成", detail: "检查完成", partialOutput: detail, error: "" } : item),
        });
        await control.appendPartial?.(`${partialLine}\n`);
        await control.update?.({ current, total, detail });
      } catch (error) {
        current += 1;
        run = await creativeWorkspace.upsertItem(projectPath, "agentRuns", {
          ...updateAgentStage(run, state.tool, { status: "失败", completedAt: nowIso(), error: error?.message || String(error) }),
          toolStates: run.toolStates.map((item) => item.tool === state.tool ? { ...item, status: "失败", error: error?.message || String(error) } : item),
        });
        await control.update?.({ current, total, detail: `${state.label}失败，继续执行其他工具` });
      }
    }

    run = await creativeWorkspace.upsertItem(projectPath, "agentRuns", updateAgentStage(run, "creative_advisor", { status: "运行中", startedAt: nowIso(), completedAt: "", detail: "正在汇总已完成阶段", error: "" }));
    await control.update?.({ phase: "正在汇总创作建议", current, total, detail: "已完成的工具结果会持续保留" });
    const advice = await buildCreativeAdvice(projectPath, {
      mode: run.mode,
      chapterId: run.chapterId,
      focus: run.objective,
      contextIds: run.contextIds,
      includeSourceIds: run.includeSourceIds,
      excludeSourceIds: run.excludeSourceIds,
      scopeType: run.scopeType,
      scopeIds: run.scopeIds,
      scopeLabel: run.scopeLabel,
      workflowToolReports: reports,
    }, control);
    const outputs = { ...(run.outputs || {}) };
    const completedTools = new Set(run.toolStates.filter((item) => item.status === "已完成").map((item) => item.tool));
    if (novelAgent.permissionRank(run.permissionLevel) >= novelAgent.permissionRank("可创建规划") && completedTools.has("chapter_planner")) {
      let board = context.board || await storyState.generateLocalBoard(projectPath, context.chapter, context.next);
      const retained = (board.items || []).filter((item) => item.locked);
      const generated = advice.items.map((item, index) => ({
        id: `beat_agent_${stableHash(`${run.id}_${item.id}`)}`,
        type: item.type,
        title: item.title,
        detail: `${item.summary}${item.suggestedUse ? `\n使用建议：${item.suggestedUse}` : ""}`,
        order: retained.length + index,
        locked: false,
        completed: false,
        sourceRefs: item.sourceRefs || [],
      }));
      board = await storyState.saveBoard(projectPath, { ...board, items: [...retained, ...generated], generatedAt: nowIso() });
      outputs.boardId = board.id;
    }
    if (novelAgent.permissionRank(run.permissionLevel) >= novelAgent.permissionRank("可生成修订候选") && completedTools.has("safe_revision_proposer") && run.selectedText) {
      try {
        const revision = await createSafeRevision(projectPath, {
          chapterId: run.chapterId,
          original: run.selectedText,
          sourceRevision: run.selectedTextRevision,
          action: inferRevisionAction(run.objective),
          instruction: run.objective,
        }, control);
        outputs.revisionId = revision.id;
      } catch (error) {
        run = await creativeWorkspace.upsertItem(projectPath, "agentRuns", {
          ...run,
          toolStates: run.toolStates.map((item) => item.tool === "safe_revision_proposer" ? { ...item, status: "失败", error: error?.message || String(error) } : item),
        });
      }
    }
    const completed = await creativeWorkspace.upsertItem(projectPath, "agentRuns", {
      ...updateAgentStage(run, "creative_advisor", { status: "已完成", completedAt: nowIso(), detail: `${advice.items.length} 条建议`, error: "" }),
      status: "已完成",
      retrievalAudit: advice.retrievalAudit || run.retrievalAudit,
      result: advice,
      outputs,
      error: "",
    });
    await control.update?.({ phase: "创作 Agent 已完成", current: total, total, detail: `${advice.items.length} 条建议` });
    return { run: completed, advice, outputs };
  } catch (error) {
    const interrupted = control.signal?.aborted || error?.name === "AbortError";
    const activeStage = (run.stageCheckpoints || []).find((item) => item.status === "运行中")?.id;
    const failedRun = activeStage ? updateAgentStage(run, activeStage, { status: "失败", completedAt: nowIso(), error: error?.message || String(error) }) : run;
    await creativeWorkspace.upsertItem(projectPath, "agentRuns", { ...failedRun, status: interrupted ? "已中断" : "失败", error: error?.message || String(error) });
    throw error;
  }
}

async function queueCreativeAgentRun(projectPath, runId, onlyTool = "") {
  const workspaceState = await creativeWorkspace.loadWorkspace(projectPath);
  let run = workspaceState.agentRuns.find((item) => item.id === runId);
  if (!run) throw new Error("没有找到待执行的 Agent 计划，请重新准备。");
  if (onlyTool && !run.toolStates.some((item) => item.tool === onlyTool && item.status === "失败")) throw new Error("只能单独重试执行失败的工具。");
  const task = await (await getProjectTaskCenter(projectPath)).enqueue({
    type: "agent-workflow",
    title: onlyTool ? `重试 Agent 工具：${run.chapterTitle}` : `创作 Agent：${run.chapterTitle}`,
    total: Math.max(1, run.toolStates.filter((item) => item.status !== "已跳过" && (!onlyTool || item.tool === onlyTool)).length + 1),
    scope: { chapterId: run.chapterId, chapterIds: run.scopeIds?.length ? run.scopeIds : [run.chapterId] },
    options: { runId: run.id, onlyTool },
  });
  run = await creativeWorkspace.upsertItem(projectPath, "agentRuns", { ...run, status: "等待中", taskId: task.id, error: "" });
  return { run, task };
}

async function createSafeRevision(projectPath, payload = {}, control = {}) {
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === payload.chapterId);
  if (!chapter) throw new Error("没有找到选中文字所属的章节。");
  const original = String(payload.original || "").trim();
  if (!original) throw new Error("请先在正文中选中要修订的文字。");
  const action = ["改写", "润色", "扩写", "精简"].includes(payload.action) ? payload.action : "润色";
  let revision = await creativeWorkspace.upsertItem(projectPath, "revisions", {
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    action,
    instruction: String(payload.instruction || "").trim(),
    original,
    replacement: "",
    sourceRevision: String(payload.sourceRevision || await cachedChapterRevision(projectPath, chapter)),
    status: "生成中",
  });
  try {
    const systemPrompt = `你是小说文字修订助手。请按“${action}”处理原文，保留人物、事实、视角和专有名词，不补写未经资料支持的剧情。只输出可直接替换原文的文字，不要解释，不要 Markdown 标记。`;
    const instruction = String(payload.instruction || "").trim();
    const revisionQuestion = `${instruction ? `【作者要求】\n${instruction}\n\n` : ""}【待修订原文】\n${original}`;
    const replacement = typeof control.update === "function" || control.signal
      ? await callStructuredChatWithProgress(config, systemPrompt, revisionQuestion, control, "正在生成安全修订候选")
      : await callChatApi(config, systemPrompt, revisionQuestion, []);
    revision = await creativeWorkspace.upsertItem(projectPath, "revisions", { ...revision, replacement, status: "待确认", error: "" });
    return revision;
  } catch (error) {
    await creativeWorkspace.upsertItem(projectPath, "revisions", { ...revision, status: "生成失败", error: error?.message || String(error) });
    throw error;
  }
}

function countExactOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function replaceUniqueSelection(content, original, replacement) {
  const directCount = countExactOccurrences(content, original);
  if (directCount === 1) return content.replace(original, replacement);
  if (directCount > 1) throw new Error("原文在章节中出现多次，无法确定要替换哪一处。修订已保留，请重新选中更长的文字后生成。");
  if (isHtmlContent(content)) {
    const escapedOriginal = escapeHtml(original);
    const escapedCount = countExactOccurrences(content, escapedOriginal);
    if (escapedCount === 1) return content.replace(escapedOriginal, escapeHtml(replacement).replace(/\r?\n/g, "<br>"));
  }
  throw new Error("修订对应的原文已经变化或跨越了复杂格式，无法安全替换。请重新选中文字生成修订。");
}

async function applySafeRevision(projectPath, revisionId) {
  const workspaceState = await creativeWorkspace.loadWorkspace(projectPath);
  const revision = workspaceState.revisions.find((item) => item.id === revisionId);
  if (!revision) throw new Error("没有找到这条修订建议。");
  if (revision.status !== "待确认") throw new Error("只有待确认的修订建议可以采纳。");
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === revision.chapterId);
  if (!chapter) throw new Error("修订对应的章节已不存在。");
  let filePath = getChapterPath(projectPath, chapter);
  const previousContent = await fs.readFile(filePath, "utf8").catch(() => "");
  const currentRevision = contentRevision(previousContent);
  if (revision.sourceRevision && revision.sourceRevision !== currentRevision && countExactOccurrences(previousContent, revision.original) !== 1) {
    await creativeWorkspace.upsertItem(projectPath, "revisions", { ...revision, status: "已失效", error: "正文已变化，无法唯一定位原文。" });
    throw new Error("正文已经变化，并且无法唯一定位原文；修订已标记为失效，没有修改章节。");
  }
  const nextContent = replaceUniqueSelection(previousContent, revision.original, revision.replacement);
  const didSplitSharedFile = await ensureExclusiveChapterFile(projectPath, config, chapter, previousContent, { snapshot: false, reason: "应用安全修订前拆分共享文件" });
  if (didSplitSharedFile) filePath = getChapterPath(projectPath, chapter);
  await snapshotChapterVersion(projectPath, chapter, previousContent, `应用安全修订：${revision.action}`);
  await fs.writeFile(filePath, nextContent, "utf8");
  chapter.wordCount = countWords(nextContent);
  chapter.outline = extractOutline(nextContent);
  chapter.updatedAt = nowIso();
  await calculateTotalWords(projectPath, config);
  await saveConfig(projectPath, config);
  await indexSource(projectPath, { id: chapter.id, type: "chapter", title: chapter.title, volume: chapter.volume || "未分卷", category: chapter.volume || "未分卷", knowledgeRole: getKnowledgeRole(chapter), content: nextContent });
  if (config.agent?.autoLocalAnalysis !== false) await refreshLocalStoryState(projectPath, chapter.id, nextContent).catch(() => null);
  await creativeWorkspace.upsertItem(projectPath, "revisions", { ...revision, status: "已采纳", appliedAt: nowIso(), error: "" });
  return { state: await buildAppState(projectPath, chapter.id), revision: { ...revision, status: "已采纳" } };
}

async function applySafeRevisionPart(projectPath, payload = {}) {
  const workspaceState = await creativeWorkspace.loadWorkspace(projectPath);
  const revision = workspaceState.revisions.find((item) => item.id === payload.revisionId);
  if (!revision) throw new Error("没有找到这条修订建议。");
  if (!["待确认", "部分采纳"].includes(revision.status)) throw new Error("这条修订建议当前不能局部采纳。");
  const originalPart = String(payload.original || "").trim();
  const replacementPart = String(payload.replacement || "").trim();
  if (!originalPart) throw new Error("局部采纳必须包含可定位的原文。");
  if (!revision.original.includes(originalPart)) throw new Error("所选原文不属于这条修订建议。");
  if (replacementPart && !revision.replacement.includes(replacementPart)) throw new Error("所选建议文字不属于这条修订建议。");
  if ((revision.acceptedParts || []).some((item) => item.original === originalPart && item.replacement === replacementPart)) throw new Error("这一部分已经采纳过了。");
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === revision.chapterId);
  if (!chapter) throw new Error("修订对应的章节已不存在。");
  let filePath = getChapterPath(projectPath, chapter);
  const previousContent = await fs.readFile(filePath, "utf8").catch(() => "");
  const nextContent = replaceUniqueSelection(previousContent, originalPart, replacementPart);
  const didSplitSharedFile = await ensureExclusiveChapterFile(projectPath, config, chapter, previousContent, { snapshot: false, reason: "局部应用安全修订前拆分共享文件" });
  if (didSplitSharedFile) filePath = getChapterPath(projectPath, chapter);
  await snapshotChapterVersion(projectPath, chapter, previousContent, `局部应用安全修订：${revision.action}`);
  await fs.writeFile(filePath, nextContent, "utf8");
  chapter.wordCount = countWords(nextContent);
  chapter.outline = extractOutline(nextContent);
  chapter.updatedAt = nowIso();
  await calculateTotalWords(projectPath, config);
  await saveConfig(projectPath, config);
  await indexSource(projectPath, { id: chapter.id, type: "chapter", title: chapter.title, volume: chapter.volume || "未分卷", category: chapter.volume || "未分卷", knowledgeRole: getKnowledgeRole(chapter), content: nextContent });
  if (config.agent?.autoLocalAnalysis !== false) await refreshLocalStoryState(projectPath, chapter.id, nextContent).catch(() => null);
  const appliedAt = nowIso();
  const updated = await creativeWorkspace.upsertItem(projectPath, "revisions", {
    ...revision,
    status: "部分采纳",
    appliedAt,
    acceptedParts: [...(revision.acceptedParts || []), { original: originalPart, replacement: replacementPart, appliedAt }],
    error: "",
  });
  return { state: await buildAppState(projectPath, chapter.id), revision: updated, workspace: await getCreativeWorkspaceView(projectPath) };
}

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

async function buildProjectExchangeArchive(projectPath, targetFile, options = {}) {
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
  const manifest = {
    format: "ai-novel-project-exchange",
    version: 1,
    createdAt: nowIso(),
    appVersion: options.appVersion || app.getVersion(),
    project: { title: config.title, author: config.author },
    counts: { chapters: config.chapters.length, characters: characters.length, worldDocs: worldDocs.length, materials: materials.length },
    workspaceIncluded: includeWorkspace,
    security: { apiSettingsIncluded: false, vectorIndexIncluded: false, backupsIncluded: false, passwordProtected: Boolean(options.password) },
  };
  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));
  zip.addFile("project/novel.config.json", Buffer.from(JSON.stringify(exportConfig, null, 2), "utf8"));
  for (const chapter of config.chapters) {
    const buffer = await fs.readFile(getChapterPath(projectPath, chapter)).catch(() => Buffer.from("", "utf8"));
    zip.addFile(`project/chapters/${normalizeChapterFileName(chapter.fileName)}`, buffer);
  }
  for (const card of characters) zip.addFile(`project/characters/${path.basename(card.fileName || `${card.id}.json`)}`, Buffer.from(JSON.stringify({ ...card, fileName: undefined }, null, 2), "utf8"));
  for (const doc of worldDocs) zip.addFile(`project/worldbuilding/${path.basename(doc.fileName || `${doc.id}.md`)}`, Buffer.from(buildWorldDocFile(doc), "utf8"));
  for (const item of materials) zip.addFile(`project/materials/${item.id}.json`, Buffer.from(JSON.stringify(item, null, 2), "utf8"));
  if (includeWorkspace) {
    const workspace = await creativeWorkspace.loadWorkspace(projectPath);
    zip.addFile("project/analysis/creative-workspace/state.json", Buffer.from(JSON.stringify(workspace, null, 2), "utf8"));
  }
  const archive = zip.toBuffer();
  const output = options.password ? await exchangeSecurity.encryptBuffer(archive, options.password) : archive;
  await fs.writeFile(targetFile, output);
  return { filePath: targetFile, manifest, encrypted: Boolean(options.password) };
}

async function exportProjectExchange(projectPath, options = {}) {
  const config = await loadConfig(projectPath);
  const result = await dialog.showSaveDialog(mainWindow, {
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
  let pending = token ? pendingExchangeImports.get(token) : null;
  let filePath = pending?.filePath || "";
  if (!filePath) {
    const result = await dialog.showOpenDialog(mainWindow, { title: "选择项目交换包", properties: ["openFile"], filters: [{ name: "AI 小说项目交换包", extensions: ["zip", "ainovelx"] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    filePath = result.filePaths[0];
    token = crypto.randomBytes(16).toString("hex");
    pending = { filePath, projectPath, createdAt: Date.now() };
    pendingExchangeImports.set(token, pending);
  }
  const raw = await fs.readFile(filePath);
  const encrypted = exchangeSecurity.isEncrypted(raw);
  if (encrypted && !options.password) return { token, filePath, encrypted: true, requiresPassword: true };
  const archive = await exchangeSecurity.decryptBuffer(raw, options.password || "");
  const zip = new AdmZip(archive);
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
  pendingExchangeImports.set(token, { filePath, projectPath, createdAt: Date.now(), encrypted });
  for (const [key, pending] of pendingExchangeImports) if (Date.now() - pending.createdAt > 30 * 60 * 1000) pendingExchangeImports.delete(key);
  return { token, filePath, manifest, conflicts, encrypted, requiresPassword: false };
}

async function importProjectExchange(projectPath, token, options = {}) {
  const pending = pendingExchangeImports.get(String(token || ""));
  if (!pending || path.resolve(pending.projectPath) !== path.resolve(projectPath)) throw new Error("交换包预览已失效，请重新选择文件。");
  const raw = await fs.readFile(pending.filePath);
  const archive = await exchangeSecurity.decryptBuffer(raw, options.password || "");
  const zip = new AdmZip(archive);
  const importedConfig = readExchangeJson(zip, "project/novel.config.json", null);
  if (!Array.isArray(importedConfig?.chapters)) throw new Error("交换包缺少项目目录信息。");
  await projectSnapshots.createSnapshot(projectPath, { name: "导入项目交换包前", reason: `导入 ${path.basename(pending.filePath)} 前自动保存` });
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
    const content = zip.readAsText(entry);
    await fs.writeFile(path.join(projectPath, "chapters", fileName), content, "utf8");
    config.chapters.push({ ...source, id, title, fileName, order: config.chapters.length, importedFrom: undefined, originalDocxFile: undefined, wordCount: countWords(content), outline: extractOutline(content), createdAt: nowIso(), updatedAt: nowIso() });
    importedChapters += 1;
  }
  await calculateTotalWords(projectPath, config);
  await saveConfig(projectPath, config);

  const existingCharacters = await loadCharacters(projectPath);
  const characterNames = new Set(existingCharacters.map((item) => item.name));
  let importedCharacters = 0;
  for (const entry of (options.includeCharacters === false ? [] : zip.getEntries().filter((item) => item.entryName.startsWith("project/characters/") && !item.isDirectory))) {
    const source = readExchangeJson(zip, entry.entryName, null);
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
    const source = parseWorldDocFile(path.basename(entry.entryName), zip.readAsText(entry));
    const id = makeId("world");
    const fileName = await uniqueFileNameInDirectory(path.join(projectPath, "worldbuilding"), id, ".md");
    await writeWorldDoc(projectPath, { ...source, id, title: importedCopyTitle(source.title, worldTitles), fileName, updatedAt: nowIso() });
    importedWorldDocs += 1;
  }

  let importedMaterials = 0;
  for (const entry of (options.includeMaterials === false ? [] : zip.getEntries().filter((item) => item.entryName.startsWith("project/materials/") && !item.isDirectory))) {
    const source = readExchangeJson(zip, entry.entryName, null);
    if (!source) continue;
    await saveMaterial(projectPath, { ...source, id: makeId("material"), title: `${source.title || "导入素材"}${options.renameMaterials === false ? "" : "（导入）"}` });
    importedMaterials += 1;
  }
  const importedWorkspace = readExchangeJson(zip, "project/analysis/creative-workspace/state.json", null);
  if (importedWorkspace && options.includeWorkspace !== false && options.includeChapters !== false) await creativeWorkspace.mergeImportedWorkspace(projectPath, importedWorkspace, chapterIdMap);
  await rebuildIndex(projectPath);
  pendingExchangeImports.delete(String(token || ""));
  return { state: await buildAppState(projectPath), imported: { chapters: importedChapters, characters: importedCharacters, worldDocs: importedWorldDocs, materials: importedMaterials }, renamedConflicts: true };
}

async function buildCreativeStatistics(projectPath, label = "", control = null) {
  const config = await loadConfig(projectPath);
  const workspace = await creativeWorkspace.loadWorkspace(projectPath);
  const overview = await storyState.getStoryOverview(projectPath, { projectChapters: config.chapters, factLimit: 2000, characterLimit: 1000, foreshadowLimit: 2000 });
  const characters = await loadCharacters(projectPath);
  const contents = {};
  const chapters = config.chapters.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  for (let index = 0; index < chapters.length; index += 1) {
    control?.throwIfCanceled?.();
    const chapter = chapters[index];
    contents[chapter.id] = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
    if (control?.update && (index % 10 === 0 || index === chapters.length - 1)) await control.update({ phase: "正在统计章节", current: index + 1, total: chapters.length, detail: chapter.title });
  }
  const snapshot = creativeStatistics.analyzeProjectStatistics({ chapters, contents, characters, workspace, storyOverview: overview, label });
  await creativeWorkspace.upsertItem(projectPath, "statisticsHistory", snapshot);
  return { snapshot, workspace: await getCreativeWorkspaceView(projectPath) };
}

async function executeBackgroundTask(projectPath, task, control) {
  const config = await loadConfig(projectPath);
  if (task.type === "agent-workflow") {
    return executeCreativeAgentRun(projectPath, String(task.options?.runId || ""), control, String(task.options?.onlyTool || ""));
  }
  if (task.type === "story-analysis") {
    const requestedIds = new Set((task.scope?.chapterIds || []).map(String));
    const chapters = config.chapters
      .filter((chapter) => !requestedIds.size || requestedIds.has(chapter.id))
      .sort((a, b) => a.order - b.order);
    let aiCount = 0;
    let localCount = 0;
    const warnings = [];
    const characters = task.options?.useAI ? null : await loadCharacters(projectPath);
    await control.update({ phase: "准备剧情事实分析", current: 0, total: chapters.length, detail: `${chapters.length} 个文档` });
    for (let index = 0; index < chapters.length; index += 1) {
      if (control.isCanceled()) throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
      const chapter = chapters[index];
      await control.update({ phase: task.options?.useAI ? "AI 深度整理" : "本地增量整理", current: index, total: chapters.length, detail: chapter.title });
      if (task.options?.useAI) {
        const result = await analyzeStoryStateWithAI(projectPath, chapter.id, control);
        if (result.apiError) warnings.push(`${chapter.title}：${result.apiError}`);
        if (result.ledger.analysisMode === "ai") aiCount += 1;
        else localCount += 1;
      } else {
        await refreshLocalStoryState(projectPath, chapter.id, null, { config, characters });
        localCount += 1;
      }
      await control.update({ current: index + 1, total: chapters.length, detail: chapter.title });
      await new Promise((resolve) => setImmediate(resolve));
    }
    return { analyzed: chapters.length, aiCount, localCount, warnings: warnings.slice(0, 40) };
  }

  if (task.type === "creative-board") {
    const ordered = config.chapters.slice().sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((chapter) => chapter.id === task.scope?.chapterId);
    const chapter = ordered[index];
    if (!chapter) throw new Error("没有找到筹备板对应的章节。");
    await control.update({ phase: "整理本地创作状态", current: 1, total: task.options?.useAI ? 3 : 2, detail: chapter.title });
    let board = await storyState.generateLocalBoard(projectPath, chapter, ordered[index + 1] || null);
    if (task.options?.useAI && !control.isCanceled()) {
      await control.update({ phase: "创作参谋正在补充筹备项", current: 2, total: 3, detail: chapter.title });
      const advice = await buildCreativeAdvice(projectPath, { mode: "next", chapterId: chapter.id, focus: task.options?.focus || "" }, control);
      const locked = board.items.filter((item) => item.locked);
      const generated = advice.items.map((item, itemIndex) => ({
        id: `beat_${stableHash(`${chapter.id}_${item.id}_${itemIndex}`)}`,
        type: item.type,
        title: item.title,
        detail: `${item.summary}${item.suggestedUse ? `\n使用建议：${item.suggestedUse}` : ""}${item.risks?.length ? `\n注意：${item.risks.join("；")}` : ""}`,
        order: locked.length + itemIndex,
        locked: false,
        completed: false,
        sourceRefs: item.sourceRefs || [],
      }));
      board = await storyState.saveBoard(projectPath, { ...board, items: [...locked, ...generated], generatedAt: nowIso(), apiError: advice.apiError || "" });
    }
    await control.update({ phase: "筹备板已保存", current: task.options?.useAI ? 3 : 2, total: task.options?.useAI ? 3 : 2, detail: `${board.items.length} 项` });
    return { board };
  }

  if (task.type === "consistency-check") {
    await control.update({ phase: "正在执行全书一致性检查", current: 0, total: 1, detail: "可继续编辑正文" });
    const result = await analyzeConsistency(projectPath, { ...(task.options || {}), refresh: true }, control);
    await saveAnalysisState(projectPath, { consistency: result, consistencyOptions: task.options || {} });
    await control.update({ current: 1, total: 1, detail: `${result.issues.length} 个问题` });
    return result;
  }

  if (task.type === "timeline-analysis") {
    await control.update({ phase: "正在识别剧情时间线", current: 0, total: 1, detail: "可继续编辑正文" });
    const result = task.options?.mode === "local" ? await buildTimelineEvents(projectPath, task.options || {}) : await buildAiTimelineEvents(projectPath, task.options || {}, control);
    await saveAnalysisState(projectPath, { timeline: result, timelineOptions: task.options || {} });
    await control.update({ current: 1, total: 1, detail: `${result.events.length} 个事件` });
    return result;
  }

  if (task.type === "knowledge-rebuild") {
    await control.update({ phase: "正在重建长篇知识库", current: 0, total: 1, detail: "索引会增量写入" });
    const result = await rebuildIndex(projectPath, {
      signal: control.signal,
      onProgress: (progress) => control.update({ phase: "正在重建长篇知识库", ...progress }),
    });
    await control.update({ current: 1, total: 1, detail: `${result.chunks} 个片段` });
    return result;
  }

  if (task.type === "snapshot") {
    const manifest = await projectSnapshots.createSnapshot(projectPath, {
      name: task.options?.name || task.title,
      reason: task.options?.reason || "后台创建项目快照",
      onProgress: (progress) => control.update({ phase: "正在创建项目快照", ...progress }),
    });
    return { snapshot: manifest };
  }
  if (task.type === "creative-statistics") {
    return buildCreativeStatistics(projectPath, String(task.options?.label || ""), control);
  }

  throw new Error(`不支持的后台任务类型：${task.type}`);
}

async function getProjectTaskCenter(projectPath) {
  if (!projectTaskCenters.has(projectPath)) {
    projectTaskCenters.set(projectPath, new PersistentTaskCenter({
      projectPath,
      executor: (task, control) => executeBackgroundTask(projectPath, task, control),
      onEvent: (task) => sendRendererEvent("task:progress", { ...task, projectPath }),
    }));
  }
  const center = projectTaskCenters.get(projectPath);
  await center.init();
  if (!center.agentRunsReconciled) {
    center.agentRunsReconciled = true;
    const interrupted = (await center.list()).tasks.filter((task) => task.type === "agent-workflow" && task.status === "已中断");
    if (interrupted.length) {
      const workspace = await creativeWorkspace.loadWorkspace(projectPath);
      for (const task of interrupted) {
        const run = workspace.agentRuns.find((item) => item.id === task.options?.runId && ["等待中", "运行中"].includes(item.status));
        if (run) await creativeWorkspace.upsertItem(projectPath, "agentRuns", { ...run, status: "已中断", taskId: task.id, error: "软件关闭时工作流尚未完成，可在任务中心重试。" });
      }
    }
  }
  return center;
}

async function queueKnowledgeRebuildAfterRestore(projectPath, reason) {
  await vectorShards.reset(projectPath);
  await writeJson(getKnowledgeSummariesPath(projectPath), { version: 2, updatedAt: "", sources: [], volumes: [], book: null });
  return (await getProjectTaskCenter(projectPath)).enqueue({
    type: "knowledge-rebuild",
    title: "恢复后重建知识库",
    total: 1,
    options: { automatic: true, reason },
  });
}

function scheduleIdleDeepAnalysis(projectPath, chapter) {
  const key = `${projectPath}\u0000${chapter.id}`;
  const previous = deepAnalysisTimers.get(key);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(async () => {
    deepAnalysisTimers.delete(key);
    try {
      const center = await getProjectTaskCenter(projectPath);
      const { tasks } = await center.list();
      const duplicate = tasks.some((task) => ["等待中", "运行中", "正在停止", "已暂停"].includes(task.status) && task.type === "story-analysis" && task.scope?.chapterIds?.includes(chapter.id));
      if (duplicate) return;
      await center.enqueue({
        type: "story-analysis",
        title: `空闲后深度分析：${chapter.title}`,
        total: 1,
        scope: { chapterIds: [chapter.id] },
        options: { useAI: true, automatic: true },
      });
    } catch {
      // Automatic deep analysis must never interfere with editing or saving.
    }
  }, 45000);
  deepAnalysisTimers.set(key, timer);
}

async function buildAppearanceStats(projectPath) {
  const { chapters, characters } = await loadProjectSources(projectPath);
  const stats = characters.map((card) => {
    const appearances = [];
    let total = 0;
    return { card, appearances, total };
  });
  for (const stat of stats) {
    for (const chapter of chapters) {
      const rawContent = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
      const content = contentToPlainText(rawContent);
      const count = stat.card.name ? (content.match(new RegExp(stat.card.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length : 0;
      if (count > 0) stat.appearances.push({ chapterId: chapter.id, chapterTitle: chapter.title, volume: chapter.volume || "未分卷", count });
      stat.total += count;
    }
  }
  const result = stats.map(({ card, appearances, total }) => ({
    id: card.id,
    name: card.name,
    category: normalizeCategory(card.category),
    total,
    chapters: appearances,
  }));
  return { stats: result.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "zh-CN")) };
}

async function buildWorldMap(projectPath) {
  const worldDocs = await loadWorldDocs(projectPath);
  const nodes = [];
  const edges = [];
  const byTitle = new Map(worldDocs.map((doc) => [doc.title, doc]));
  for (const doc of worldDocs) {
    const category = normalizeCategory(doc.category);
    const type = category.includes("地点") ? "地点" : category.includes("势力") ? "势力" : category.includes("物品") ? "物品" : "设定";
    nodes.push({ id: doc.id, title: doc.title, category, type, summary: contentToPlainText(doc.content).slice(0, 160) });
  }
  for (const doc of worldDocs) {
    const text = contentToPlainText(doc.content);
    for (const [title, target] of byTitle.entries()) {
      if (target.id !== doc.id && text.includes(title)) {
        edges.push({ id: `${doc.id}_${target.id}`, source: doc.id, target: target.id, label: "提及" });
      }
    }
  }
  return { nodes, edges: edges.slice(0, 200) };
}

function diffLines(oldContent, newContent) {
  const oldLines = contentToPlainText(oldContent).split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const newLines = contentToPlainText(newContent).split(/\n+/).map((item) => item.trim()).filter(Boolean);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let oldSuffix = oldLines.length - 1;
  let newSuffix = newLines.length - 1;
  while (oldSuffix >= prefix && newSuffix >= prefix && oldLines[oldSuffix] === newLines[newSuffix]) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }
  const before = oldLines.slice(0, prefix).map((text) => ({ type: "same", text }));
  const after = oldLines.slice(oldSuffix + 1).map((text) => ({ type: "same", text }));
  const oldMiddle = oldLines.slice(prefix, oldSuffix + 1);
  const newMiddle = newLines.slice(prefix, newSuffix + 1);
  const middle = [];

  if (oldMiddle.length * newMiddle.length <= 360000) {
    const dp = Array.from({ length: oldMiddle.length + 1 }, () => new Array(newMiddle.length + 1).fill(0));
    for (let i = oldMiddle.length - 1; i >= 0; i -= 1) {
      for (let j = newMiddle.length - 1; j >= 0; j -= 1) {
        dp[i][j] = oldMiddle[i] === newMiddle[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < oldMiddle.length && j < newMiddle.length) {
      if (oldMiddle[i] === newMiddle[j]) {
        middle.push({ type: "same", text: oldMiddle[i] });
        i += 1;
        j += 1;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        middle.push({ type: "removed", text: oldMiddle[i] });
        i += 1;
      } else {
        middle.push({ type: "added", text: newMiddle[j] });
        j += 1;
      }
    }
    while (i < oldMiddle.length) {
      middle.push({ type: "removed", text: oldMiddle[i] });
      i += 1;
    }
    while (j < newMiddle.length) {
      middle.push({ type: "added", text: newMiddle[j] });
      j += 1;
    }
  } else {
    oldMiddle.forEach((text) => middle.push({ type: "removed", text }));
    newMiddle.forEach((text) => middle.push({ type: "added", text }));
  }

  const diff = [...before, ...middle, ...after];
  return {
    added: diff.filter((item) => item.type === "added").length,
    removed: diff.filter((item) => item.type === "removed").length,
    diff: diff.slice(0, 900),
    truncated: diff.length > 900,
  };
}

async function compareChapterVersion(projectPath, chapterId, versionId) {
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error("章节不存在，无法对比版本。");
  const versions = await listChapterVersions(projectPath, chapterId);
  const version = versions.find((item) => item.id === versionId);
  if (!version) throw new Error("找不到这个历史版本。");
  const oldContent = await fs.readFile(getChapterVersionContentPath(projectPath, chapterId, version), "utf8");
  const currentContent = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
  return {
    version,
    currentTitle: chapter.title,
    currentUpdatedAt: chapter.updatedAt,
    ...diffLines(oldContent, currentContent),
  };
}

async function restoreChapterVersion(projectPath, chapterId, versionId) {
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error("章节不存在，无法恢复版本。");
  const versions = await listChapterVersions(projectPath, chapterId);
  const version = versions.find((item) => item.id === versionId);
  if (!version) throw new Error("找不到要恢复的历史版本。");
  const currentContent = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
  const restoredContent = await fs.readFile(getChapterVersionContentPath(projectPath, chapterId, version), "utf8");
  if (currentContent && currentContent !== restoredContent) await snapshotChapterVersion(projectPath, chapter, currentContent, "恢复历史版本前自动备份");
  await ensureExclusiveChapterFile(projectPath, config, chapter, currentContent, { snapshot: false });
  await fs.writeFile(getChapterPath(projectPath, chapter), restoredContent, "utf8");
  chapter.wordCount = countWords(restoredContent);
  chapter.outline = extractOutline(restoredContent);
  chapter.updatedAt = nowIso();
  await calculateTotalWords(projectPath, config);
  await saveConfig(projectPath, config);
  await indexSource(projectPath, {
    id: chapter.id,
    type: "chapter",
    title: chapter.title,
    volume: chapter.volume || "未分卷",
    category: chapter.volume || "未分卷",
    knowledgeRole: getKnowledgeRole(chapter),
    content: restoredContent,
  });
  return { state: await buildAppState(projectPath, chapter.id), restoredVersion: version };
}

function stripMarkdown(text) {
  return contentToPlainText(text);
}

function createDocxReviewContext(annotations = [], revisions = []) {
  const comments = annotations
    .filter((item) => item?.quote && item?.comment)
    .map((item, index) => ({ ...item, commentId: index }));
  const tracked = revisions
    .filter((item) => item && ["待确认", "部分采纳", "已采纳"].includes(item.status) && (item.original || item.replacement))
    .map((item, index) => ({ ...item, revisionId: index * 2 + 1 }));
  return { comments, revisions: tracked };
}

function reviewRunsForText(text, options = {}, reviewContext = null) {
  const clean = sanitizeDocxText(String(text || ""));
  if (!clean || !reviewContext) return clean ? [new TextRun({ text: clean, ...options })] : [];
  const commentCandidates = [];
  for (const item of reviewContext.comments || []) {
    const quote = sanitizeDocxText(String(item.quote || "")).replace(/\s+/g, " ").trim();
    const start = quote ? clean.indexOf(quote) : -1;
    if (start >= 0) commentCandidates.push({ kind: "comment", start, end: start + quote.length, item });
  }
  const revisionCandidates = [];
  for (const item of reviewContext.revisions || []) {
    const anchorText = item.status === "已采纳" ? item.replacement : item.original;
    const anchor = sanitizeDocxText(String(anchorText || "")).replace(/\s+/g, " ").trim();
    const start = anchor ? clean.indexOf(anchor) : -1;
    if (start >= 0) revisionCandidates.push({ kind: "revision", start, end: start + anchor.length, item });
  }
  revisionCandidates.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const selectedRevisions = [];
  for (const candidate of revisionCandidates) {
    if (selectedRevisions.some((item) => candidate.start < item.end && candidate.end > item.start)) continue;
    selectedRevisions.push(candidate);
  }
  commentCandidates.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const selectedComments = [];
  for (const candidate of commentCandidates) {
    const revision = selectedRevisions.find((item) => candidate.start < item.end && candidate.end > item.start);
    if (revision) {
      revision.comments = [...(revision.comments || []), candidate.item];
      continue;
    }
    if (selectedComments.some((item) => candidate.start < item.end && candidate.end > item.start)) continue;
    selectedComments.push(candidate);
  }
  const selected = [...selectedRevisions, ...selectedComments];
  selected.sort((a, b) => a.start - b.start);
  if (!selected.length) return [new TextRun({ text: clean, ...options })];
  const runs = [];
  let cursor = 0;
  for (const match of selected) {
    if (match.start > cursor) runs.push(new TextRun({ text: clean.slice(cursor, match.start), ...options }));
    if (match.kind === "comment") {
      runs.push(new CommentRangeStart(match.item.commentId));
      runs.push(new TextRun({ text: clean.slice(match.start, match.end), ...options }));
      runs.push(new CommentRangeEnd(match.item.commentId));
      runs.push(new CommentReference(match.item.commentId));
    } else {
      for (const comment of match.comments || []) runs.push(new CommentRangeStart(comment.commentId));
      const author = sanitizeDocxText(match.item.instruction || "AI小说创作平台").slice(0, 80) || "AI小说创作平台";
      const date = match.item.updatedAt || nowIso();
      if (match.item.original) runs.push(new DeletedTextRun({ id: match.item.revisionId, author, date, text: sanitizeDocxText(match.item.original), ...options }));
      if (match.item.replacement) runs.push(new InsertedTextRun({ id: match.item.revisionId + 1, author, date, text: sanitizeDocxText(match.item.replacement), ...options }));
      for (const comment of [...(match.comments || [])].reverse()) {
        runs.push(new CommentRangeEnd(comment.commentId));
        runs.push(new CommentReference(comment.commentId));
      }
    }
    cursor = match.end;
  }
  if (cursor < clean.length) runs.push(new TextRun({ text: clean.slice(cursor), ...options }));
  return runs;
}

function textRunsFromMarkdown(text, options = {}, reviewContext = null) {
  const clean = sanitizeDocxText(stripMarkdown(text));
  if (!clean) return [new TextRun({ text: "" })];
  return reviewRunsForText(clean, { bold: Boolean(options.bold), italics: Boolean(options.italics), size: options.size }, reviewContext);
}

function parseMarkdownTable(lines, startIndex) {
  const tableLines = [];
  let index = startIndex;
  while (index < lines.length && /^\s*\|.+\|\s*$/.test(lines[index])) {
    tableLines.push(lines[index]);
    index += 1;
  }
  if (tableLines.length < 2 || !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(tableLines[1])) {
    return null;
  }
  const rows = [tableLines[0], ...tableLines.slice(2)].map((line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => sanitizeDocxText(stripMarkdown(cell))),
  );
  return { rows, nextIndex: index };
}

function markdownToDocxChildren(markdown, reviewContext = null) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const children = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      children.push(new Paragraph({ text: "" }));
      continue;
    }

    const table = parseMarkdownTable(lines, index);
    if (table) {
      const columnCount = Math.max(...table.rows.map((row) => row.length));
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: table.rows.map(
            (row, rowIndex) =>
              new TableRow({
                children: Array.from({ length: columnCount }).map((_, cellIndex) =>
                  new TableCell({
                    width: { size: Math.floor(100 / columnCount), type: WidthType.PERCENTAGE },
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: sanitizeDocxText(row[cellIndex] || ""),
                            bold: rowIndex === 0,
                          }),
                        ],
                      }),
                    ],
                  }),
                ),
              }),
          ),
        }),
      );
      index = table.nextIndex - 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const headingMap = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6,
      };
      children.push(
        new Paragraph({
          heading: headingMap[level],
          children: textRunsFromMarkdown(heading[2], { bold: true }, reviewContext),
        }),
      );
      continue;
    }

    const quote = trimmed.match(/^>\s*(.+)$/);
    if (quote) {
      children.push(
        new Paragraph({
          indent: { left: 420 },
          children: textRunsFromMarkdown(quote[1], { italics: true }, reviewContext),
        }),
      );
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: textRunsFromMarkdown(bullet[1], {}, reviewContext),
        }),
      );
      continue;
    }

    const image = trimmed.match(/^!\[([^\]]*)]\(([^)]+)\)$/);
    if (image) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: image[1] || "图片", italics: true })],
        }),
      );
      continue;
    }

    children.push(
      new Paragraph({
        spacing: { after: 160 },
        children: textRunsFromMarkdown(trimmed, {}, reviewContext),
      }),
    );
  }

  return children.length ? children : [new Paragraph({ text: "" })];
}

function normalizeHtmlText(text) {
  return sanitizeDocxText(decodeBasicEntities(String(text || "").replace(/\s+/g, " ")).trim());
}

function htmlInlineRuns(node, options = {}, reviewContext = null) {
  const runs = [];
  const children = node.childNodes || [];
  if (!children.length) {
    const text = normalizeHtmlText(node.text || node.rawText || "");
    return text ? reviewRunsForText(text, { bold: options.bold, italics: options.italics, underline: options.underline }, reviewContext) : [];
  }
  for (const child of children) {
    if (child.nodeType === 3) {
      const text = normalizeHtmlText(child.rawText || child.text || "");
      if (text) runs.push(...reviewRunsForText(text, { bold: options.bold, italics: options.italics, underline: options.underline }, reviewContext));
      continue;
    }
    const tag = String(child.rawTagName || child.tagName || "").toLowerCase();
    if (tag === "br") {
      runs.push(new TextRun({ text: "\n" }));
      continue;
    }
    runs.push(
      ...htmlInlineRuns(child, {
        bold: options.bold || tag === "strong" || tag === "b" || tag === "th",
        italics: options.italics || tag === "em" || tag === "i",
        underline: options.underline || tag === "u",
      }, reviewContext),
    );
  }
  return runs;
}

async function imageRunFromHtmlNode(node) {
  const src = node.getAttribute?.("src") || "";
  if (!src || src.startsWith("http")) return null;
  try {
    let buffer;
    if (src.startsWith("data:")) {
      const base64 = src.split(",")[1] || "";
      buffer = Buffer.from(base64, "base64");
    } else if (src.startsWith("file://")) {
      buffer = await fs.readFile(fileURLToPath(src));
    } else {
      buffer = await fs.readFile(src);
    }
    const sourceWidth = Number(node.getAttribute?.("data-docx-width") || node.getAttribute?.("width") || 560);
    const sourceHeight = Number(node.getAttribute?.("data-docx-height") || node.getAttribute?.("height") || 320);
    const width = Math.max(1, Math.min(640, Number.isFinite(sourceWidth) ? sourceWidth : 560));
    const ratio = sourceWidth > 0 && sourceHeight > 0 ? sourceHeight / sourceWidth : 320 / 560;
    const height = Math.max(1, Math.round(width * ratio));
    return new ImageRun({ data: buffer, transformation: { width, height } });
  } catch {
    return null;
  }
}

async function htmlNodeToDocxBlocks(node, reviewContext = null) {
  const blocks = [];
  const tag = String(node.rawTagName || node.tagName || "").toLowerCase();
  if (!tag) {
    const text = normalizeHtmlText(node.rawText || node.text || "");
    return text ? [new Paragraph({ children: [new TextRun({ text })] })] : [];
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    const headingMap = {
      1: HeadingLevel.HEADING_1,
      2: HeadingLevel.HEADING_2,
      3: HeadingLevel.HEADING_3,
      4: HeadingLevel.HEADING_4,
      5: HeadingLevel.HEADING_5,
      6: HeadingLevel.HEADING_6,
    };
    return [new Paragraph({ heading: headingMap[level], children: htmlInlineRuns(node, { bold: true }, reviewContext) })];
  }

  if (tag === "table") {
    const tableWidth = Math.max(10, Math.min(100, Number(node.getAttribute?.("data-docx-width") || String(node.getAttribute?.("style") || "").match(/width\s*:\s*(\d+(?:\.\d+)?)%/i)?.[1] || 100)));
    const rows = node.querySelectorAll("tr").map((row) => {
      const cells = row.querySelectorAll("th,td");
      const columnCount = Math.max(1, cells.length);
      return new TableRow({
        children: cells.map(
          (cell) =>
            new TableCell({
              width: { size: Math.max(3, Math.min(100, Number(cell.getAttribute?.("style")?.match(/width\s*:\s*(\d+(?:\.\d+)?)%/i)?.[1] || Math.floor(100 / columnCount)))), type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({
                  children: htmlInlineRuns(cell, { bold: String(cell.rawTagName || cell.tagName).toLowerCase() === "th" }, reviewContext),
                }),
              ],
            }),
        ),
      });
    });
    return rows.length
      ? [
          new Table({
            width: { size: tableWidth, type: WidthType.PERCENTAGE },
            rows,
          }),
        ]
      : [];
  }

  if (tag === "ul" || tag === "ol") {
    for (const li of node.querySelectorAll("li")) {
      blocks.push(
        new Paragraph({
          bullet: tag === "ul" ? { level: 0 } : undefined,
          numbering: tag === "ol" ? { reference: "default-numbering", level: 0 } : undefined,
          children: htmlInlineRuns(li, {}, reviewContext),
        }),
      );
    }
    return blocks;
  }

  if (tag === "blockquote") {
    return [
      new Paragraph({
        indent: { left: 420 },
        children: htmlInlineRuns(node, { italics: true }, reviewContext),
      }),
    ];
  }

  if (tag === "img") {
    const imageRun = await imageRunFromHtmlNode(node);
    const imageAlign = String(node.getAttribute?.("data-docx-align") || "center").toLowerCase();
    return [
      new Paragraph({
        alignment: imageAlign === "left" ? AlignmentType.LEFT : imageAlign === "right" ? AlignmentType.RIGHT : AlignmentType.CENTER,
        children: imageRun ? [imageRun] : [new TextRun({ text: sanitizeDocxText(node.getAttribute?.("alt") || "图片"), italics: true })],
      }),
    ];
  }

  if (tag === "p" || tag === "div") {
    const images = node.querySelectorAll("img");
    if (images.length === 1 && normalizeHtmlText(node.text || "") === "") {
      const imageRun = await imageRunFromHtmlNode(images[0]);
      const imageAlign = String(images[0].getAttribute?.("data-docx-align") || "center").toLowerCase();
      return [new Paragraph({ alignment: imageAlign === "left" ? AlignmentType.LEFT : imageAlign === "right" ? AlignmentType.RIGHT : AlignmentType.CENTER, children: imageRun ? [imageRun] : [new TextRun({ text: sanitizeDocxText("图片") })] })];
    }
    const runs = htmlInlineRuns(node, {}, reviewContext);
    return runs.length ? [new Paragraph({ spacing: { after: 160 }, children: runs })] : [new Paragraph({ text: "" })];
  }

  for (const child of node.childNodes || []) {
    blocks.push(...(await htmlNodeToDocxBlocks(child, reviewContext)));
  }
  return blocks;
}

async function htmlToDocxChildren(html, reviewContext = null) {
  const root = parseHtml(promoteMarkdownHeadingsInHtml(String(html || "")));
  const blocks = [];
  for (const child of root.childNodes) {
    blocks.push(...(await htmlNodeToDocxBlocks(child, reviewContext)));
  }
  return blocks.length ? blocks : [new Paragraph({ text: "" })];
}

async function exportContentToDocx(title, content, targetFile, description = "由 AI小说创作平台导出的文档", reviewData = {}) {
  const reviewContext = createDocxReviewContext(reviewData.annotations || [], reviewData.revisions || []);
  let children;
  if (isHtmlContent(content)) {
    children = await htmlToDocxChildren(content, reviewContext);
  } else {
    children = markdownToDocxChildren(content, reviewContext);
  }
  const doc = new Document({
    creator: "AI小说创作平台",
    title: sanitizeDocxText(title),
    description: sanitizeDocxText(description),
    comments: reviewContext.comments.length ? {
      children: reviewContext.comments.map((item) => ({
        id: item.commentId,
        author: sanitizeDocxText(item.origin === "ai" ? "AI小说创作平台" : "作者"),
        initials: item.origin === "ai" ? "AI" : "作者",
        date: new Date(item.updatedAt || nowIso()),
        children: [new Paragraph({ children: [new TextRun({ text: sanitizeDocxText(item.comment) })] })],
      })),
    } : undefined,
    features: { trackRevisions: reviewContext.revisions.length > 0 },
    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });
  const buffer = await normalizeExportedDocxBuffer(await Packer.toBuffer(doc));
  await fs.writeFile(targetFile, buffer);
  return targetFile;
}

async function exportChapterToDocx(projectPath, chapter, targetFile) {
  const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8");
  const workspace = await creativeWorkspace.loadWorkspace(projectPath);
  return exportContentToDocx(chapter.title, content, targetFile, "由 AI小说创作平台导出的目录树文档", {
    annotations: workspace.annotations.filter((item) => item.chapterId === chapter.id),
    revisions: workspace.revisions.filter((item) => item.chapterId === chapter.id),
  });
}

async function exportBookDocumentsToDirectory(projectPath, parentDirectory, options = {}) {
  const config = await loadConfig(projectPath);
  const includedRoles = new Set(["正文"]);
  if (options.includeOutline) includedRoles.add("大纲");
  if (options.includeMaterials) includedRoles.add("补充材料");

  const chapters = config.chapters
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter((chapter) => includedRoles.has(getKnowledgeRole(chapter)));
  const characters = options.includeCharacters ? await loadCharacters(projectPath) : [];
  const worldDocs = options.includeWorld ? await loadWorldDocs(projectPath) : [];
  if (!chapters.length && !characters.length && !worldDocs.length) {
    throw new Error("当前导出选项下没有可导出的文档。");
  }

  const rootName = `${config.title || "未命名小说"}_逐篇导出_${exportTimestamp()}`;
  const directoryPath = await createUniqueDirectory(parentDirectory, rootName);
  const exportedFiles = [];
  const failures = [];

  async function exportOne({ directorySegments, title, sourceType, sourceId, write }) {
    try {
      const categoryDirectory = path.join(directoryPath, ...directorySegments);
      await fs.mkdir(categoryDirectory, { recursive: true });
      const fileName = await uniqueExportFileName(categoryDirectory, title);
      const filePath = path.join(categoryDirectory, fileName);
      await write(filePath);
      exportedFiles.push({ sourceType, sourceId, title, filePath });
    } catch (error) {
      failures.push({ sourceType, sourceId, title, message: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const chapter of chapters) {
    await exportOne({
      directorySegments: exportCategorySegments(chapter.volume, "未分卷"),
      title: chapter.title,
      sourceType: "chapter",
      sourceId: chapter.id,
      write: (filePath) => exportChapterToDocx(projectPath, chapter, filePath),
    });
  }

  for (const card of characters) {
    await exportOne({
      directorySegments: ["角色卡", ...exportCategorySegments(card.category, "未分类")],
      title: card.name,
      sourceType: "character",
      sourceId: card.id,
      write: (filePath) => exportContentToDocx(card.name, characterToMarkdown(card), filePath, "由 AI小说创作平台导出的角色卡"),
    });
  }

  for (const worldDoc of worldDocs) {
    await exportOne({
      directorySegments: ["世界观", ...exportCategorySegments(worldDoc.category, "未分类")],
      title: worldDoc.title,
      sourceType: "world",
      sourceId: worldDoc.id,
      write: (filePath) => exportContentToDocx(worldDoc.title, worldDoc.content, filePath, "由 AI小说创作平台导出的世界观文档"),
    });
  }

  return {
    directoryPath,
    exportedCount: exportedFiles.length,
    failedCount: failures.length,
    chapterCount: chapters.length,
    characterCount: characters.length,
    worldCount: worldDocs.length,
    files: exportedFiles,
    failures,
  };
}

async function chapterContentToDocxChildren(content) {
  return isHtmlContent(content) ? htmlToDocxChildren(content) : markdownToDocxChildren(content);
}

async function exportBookToDocx(projectPath, targetFile, options = {}) {
  const config = await loadConfig(projectPath);
  const chapters = config.chapters.slice().sort((a, b) => a.order - b.order);
  const bodyChapters = chapters.filter((chapter) => getKnowledgeRole(chapter) === "正文");
  const outlineChapters = chapters.filter((chapter) => getKnowledgeRole(chapter) === "大纲");
  const children = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: sanitizeDocxText(config.title || "未命名小说"), bold: true, size: 36 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: sanitizeDocxText(config.author ? `作者：${config.author}` : "由 AI小说创作平台导出"), size: 22 })],
    }),
    new Paragraph({ text: "" }),
  ];
  let currentVolume = "";
  for (const chapter of bodyChapters) {
    const volume = chapter.volume || "未分卷";
    if (volume !== currentVolume) {
      currentVolume = volume;
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: children.length > 3,
          children: [new TextRun({ text: sanitizeDocxText(volume), bold: true })],
        }),
      );
    }
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: sanitizeDocxText(chapter.title || "未命名章节"), bold: true })],
      }),
    );
    const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
    const blocks = await chapterContentToDocxChildren(content);
    children.push(...blocks, new Paragraph({ text: "" }));
  }
  if (options.includeOutline) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun({ text: "大纲目录", bold: true })] }));
    for (const chapter of outlineChapters) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: sanitizeDocxText(`${chapter.volume || "未分卷"} / ${chapter.title}`), bold: true })] }));
      const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
      const blocks = await chapterContentToDocxChildren(content);
      children.push(...blocks, new Paragraph({ text: "" }));
    }
    if (bodyChapters.some((chapter) => chapter.outline?.length)) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "正文小标题目录", bold: true })] }));
    }
    for (const chapter of bodyChapters) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: sanitizeDocxText(`${chapter.volume || "未分卷"} / ${chapter.title}`), bold: true })] }));
      for (const item of chapter.outline || []) {
        children.push(
          new Paragraph({
            indent: { left: Math.max(0, (Number(item.level || 1) - 1) * 260) },
            children: [new TextRun({ text: sanitizeDocxText(`${"  ".repeat(Math.max(0, Number(item.level || 1) - 1))}${item.title}`) })],
          }),
        );
      }
    }
  }
  if (options.includeCharacters) {
    const characters = await loadCharacters(projectPath);
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun({ text: sanitizeDocxText("角色卡片"), bold: true })] }));
    for (const card of characters) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: sanitizeDocxText(card.name), bold: true })] }));
      children.push(...markdownToDocxChildren(characterToMarkdown(card)));
    }
  }
  if (options.includeWorld) {
    const worldDocs = await loadWorldDocs(projectPath);
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun({ text: sanitizeDocxText("世界观资料"), bold: true })] }));
    for (const doc of worldDocs) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: sanitizeDocxText(`${doc.category || "未分类"} / ${doc.title}`), bold: true })] }));
      children.push(...markdownToDocxChildren(doc.content));
    }
  }
  const doc = new Document({
    creator: "AI小说创作平台",
    title: sanitizeDocxText(config.title),
    description: sanitizeDocxText("由 AI小说创作平台导出的整书 Word 文档"),
    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(targetFile, buffer);
  return targetFile;
}

async function inlineLocalImagesInHtml(html) {
  let output = String(html || "");
  const matches = [...output.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)];
  for (const match of matches) {
    const src = match[1];
    if (!src.startsWith("file://")) continue;
    try {
      const filePath = fileURLToPath(src);
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType =
        ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".gif"
            ? "image/gif"
            : ext === ".webp"
              ? "image/webp"
              : "image/png";
      const dataUri = `data:${contentType};base64,${buffer.toString("base64")}`;
      output = output.replaceAll(src, dataUri);
    } catch {
      // 导出时如果个别图片文件已经丢失，保留原链接并继续导出正文。
    }
  }
  return output;
}

async function createBackup(projectPath, targetFile = "") {
  await ensureDir(path.join(projectPath, "backups"));
  const config = await loadConfig(projectPath);
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const filePath = targetFile || path.join(projectPath, "backups", `backup_${stamp}.zip`);
  const zip = new AdmZip();
  zip.addLocalFolder(projectPath, sanitizeFileName(config.title || "NovelProject"), (filename) => {
    return !filename.includes("node_modules") && !filename.includes("\\release\\") && !filename.includes("/release/");
  });
  zip.writeZip(filePath);
  return filePath;
}

function compareVersionNumbers(left, right) {
  const parse = (value) => String(value || "0").replace(/^v/i, "").split(/[.-]/).slice(0, 3).map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

async function checkForAppUpdate() {
  const endpoint = "https://api.github.com/repos/MC-freshman/ai-novel-writing-platform/releases/latest";
  const response = await fetch(endpoint, { headers: { Accept: "application/vnd.github+json", "User-Agent": "AI-Novel-Writing-Platform" }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
  const release = await response.json();
  const latestVersion = String(release.tag_name || release.name || "").replace(/^v/i, "");
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const executable = assets.find((item) => /setup.*\.exe$/i.test(item.name)) || assets.find((item) => /\.exe$/i.test(item.name));
  const currentVersion = app.getVersion();
  return {
    currentVersion,
    latestVersion,
    updateAvailable: Boolean(latestVersion) && compareVersionNumbers(latestVersion, currentVersion) > 0,
    releaseName: String(release.name || release.tag_name || latestVersion),
    notes: String(release.body || "").slice(0, 12000),
    pageUrl: String(release.html_url || "https://github.com/MC-freshman/ai-novel-writing-platform/releases"),
    downloadUrl: String(executable?.browser_download_url || ""),
    assetName: String(executable?.name || ""),
  };
}

async function downloadAndOpenAppUpdate(url, suggestedName = "") {
  const parsed = new URL(String(url || ""));
  if (parsed.protocol !== "https:" || !["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"].includes(parsed.hostname)) throw new Error("更新下载地址不是受信任的 GitHub 地址。");
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "保存软件更新",
    defaultPath: path.join(app.getPath("downloads"), sanitizeFileName(suggestedName || path.basename(parsed.pathname) || "AI小说创作平台_更新.exe")),
    filters: [{ name: "Windows 程序", extensions: ["exe"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const response = await fetch(url, { headers: { "User-Agent": "AI-Novel-Writing-Platform" }, redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`下载更新失败：HTTP ${response.status}`);
  const temporary = `${result.filePath}.download`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    await fs.rename(temporary, result.filePath).catch(async () => {
      await fs.copyFile(temporary, result.filePath);
      await fs.rm(temporary, { force: true });
    });
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => null);
    throw error;
  }
  const confirmation = await dialog.showMessageBox(mainWindow, { type: "question", title: "更新已下载", message: "是否现在打开更新程序？", detail: "请先保存正在编辑的章节。软件不会在未确认时自动安装。", buttons: ["暂不打开", "打开更新程序"], defaultId: 1, cancelId: 0 });
  if (confirmation.response === 1) {
    const openError = await shell.openPath(result.filePath);
    if (openError) throw new Error(openError);
  }
  return { filePath: result.filePath, opened: confirmation.response === 1 };
}

async function createWindow() {
  const savedWindowState = currentProjectPath ? await operationJournal.loadWindowState(currentProjectPath).catch(() => null) : null;
  const savedBounds = savedWindowState?.bounds || {};
  mainWindow = new BrowserWindow({
    width: Math.max(1180, Number(savedBounds.width) || 1440),
    height: Math.max(720, Number(savedBounds.height) || 900),
    ...(Number.isFinite(savedBounds.x) && Number.isFinite(savedBounds.y) ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: 1180,
    minHeight: 720,
    title: "AI小说创作平台",
    backgroundColor: "#f7f1e8",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (savedWindowState?.maximized) mainWindow.maximize();
  mainWindow.on("close", () => {
    if (!currentProjectPath || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getNormalBounds();
    const maximized = mainWindow.isMaximized();
    void operationJournal.loadWindowState(currentProjectPath)
      .then((current) => operationJournal.saveWindowState(currentProjectPath, { ...(current || {}), bounds, maximized }))
      .catch(() => null);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function sendMenuAction(action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("menu:action", action);
  }
}

function setChineseApplicationMenu() {
  const template = [
    {
      label: "文件",
      submenu: [
        { label: "新建项目", accelerator: "CmdOrCtrl+N", click: () => sendMenuAction("newProject") },
        { label: "打开项目", accelerator: "CmdOrCtrl+O", click: () => sendMenuAction("openProject") },
        { label: "导入文档", accelerator: "CmdOrCtrl+I", click: () => sendMenuAction("importDocument") },
        { label: "导出当前章节为Word", accelerator: "CmdOrCtrl+E", click: () => sendMenuAction("exportChapterDocx") },
        { label: "按目录树逐篇导出Word", click: () => sendMenuAction("exportBookDocx") },
        { type: "separator" },
        { label: "导出备份", click: () => sendMenuAction("exportBackup") },
        { type: "separator" },
        { label: "退出", role: "quit" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { label: "保存当前章节", accelerator: "CmdOrCtrl+S", click: () => sendMenuAction("saveChapter") },
        { type: "separator" },
        { label: "撤销", role: "undo" },
        { label: "重做", role: "redo" },
        { type: "separator" },
        { label: "剪切", role: "cut" },
        { label: "复制", role: "copy" },
        { label: "粘贴", role: "paste" },
        { label: "全选", role: "selectAll" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { label: "切换主题", click: () => sendMenuAction("toggleTheme") },
        { label: "专注模式", accelerator: "F11", click: () => sendMenuAction("toggleFocus") },
        { label: "重建知识库", click: () => sendMenuAction("rebuildIndex") },
        { type: "separator" },
        { label: "重新加载", role: "reload" },
      ],
    },
    {
      label: "设置",
      submenu: [{ label: "模型与项目设置", click: () => sendMenuAction("showSettings") }],
    },
    {
      label: "窗口",
      submenu: [
        { label: "最小化", role: "minimize" },
        { label: "关闭窗口", role: "close" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function ensureCurrentProject() {
  if (!currentProjectPath) currentProjectPath = await getDefaultProjectPath();
  await ensureProjectStructure(currentProjectPath);
  await activateProjectSession(currentProjectPath);
  return currentProjectPath;
}

function registerIpcHandlers() {
  ipcMain.handle("app:get-state", async () => {
    const projectPath = await ensureCurrentProject();
    return buildAppState(projectPath);
  });

  ipcMain.handle("app:check-update", async () => checkForAppUpdate());

  ipcMain.handle("app:download-update", async (_event, payload) => downloadAndOpenAppUpdate(String(payload?.url || ""), String(payload?.assetName || "")));

  ipcMain.handle("app:privacy-scan", async () => releasePrivacy.scanReleaseInputs(path.resolve(__dirname, "..")));

  ipcMain.handle("recovery:get", async () => {
    const projectPath = await ensureCurrentProject();
    return operationJournal.getRecoveryStatus(projectPath);
  });

  ipcMain.handle("recovery:save-draft", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    if (config.ui?.recoveryEnabled === false) return { disabled: true };
    return operationJournal.saveDraft(projectPath, payload || {});
  });

  ipcMain.handle("recovery:clear-draft", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    return operationJournal.clearDraft(projectPath, String(chapterId || ""));
  });

  ipcMain.handle("recovery:save-window", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const current = await operationJournal.loadWindowState(projectPath).catch(() => null);
    const bounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getNormalBounds() : current?.bounds;
    return operationJournal.saveWindowState(projectPath, {
      ...(current || {}),
      ...(payload || {}),
      bounds,
      maximized: mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : current?.maximized,
    });
  });

  ipcMain.handle("operations:list", async () => {
    const projectPath = await ensureCurrentProject();
    const journal = await operationJournal.loadJournal(projectPath);
    return { operations: journal.operations.slice(0, 200), sessions: journal.sessions.slice(0, 20) };
  });

  ipcMain.handle("project:create", async (_event, payload) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择新小说项目保存位置",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const title = payload?.title?.trim() || "新小说项目";
    currentProjectPath = path.join(result.filePaths[0], sanitizeFileName(title));
    await ensureProjectStructure(currentProjectPath, title);
    await activateProjectSession(currentProjectPath);
    return buildAppState(currentProjectPath);
  });

  ipcMain.handle("project:open", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "打开小说项目文件夹",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    currentProjectPath = result.filePaths[0];
    await ensureProjectStructure(currentProjectPath);
    await activateProjectSession(currentProjectPath);
    return buildAppState(currentProjectPath);
  });

  ipcMain.handle("document:import", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const targetVolume = String(payload?.volume || "").trim();
    importCancelRequested = false;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: targetVolume ? `导入一个或多个文档到「${targetVolume}」` : "导入一个或多个文档为章节",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "支持的文档", extensions: ["docx", "txt", "md"] },
        { name: "Word 文档", extensions: ["docx"] },
        { name: "文本与 Markdown", extensions: ["txt", "md"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const imported = [];
    const failures = [];
    const config = await loadConfig(projectPath);
    if (result.filePaths.length > 1 && config.agent?.snapshotBeforeBulkChanges !== false) {
      sendRendererEvent("import:progress", { active: true, phase: "创建导入前快照", current: 0, total: result.filePaths.length, fileName: "正在保护当前项目", cancellable: false });
      await projectSnapshots.createSnapshot(projectPath, { name: "批量导入前", reason: `导入 ${result.filePaths.length} 个文档前自动保存` });
    }
    sendRendererEvent("import:progress", { active: true, phase: "导入文档", current: 0, total: result.filePaths.length, fileName: "", cancellable: true });
    for (let index = 0; index < result.filePaths.length; index += 1) {
      if (importCancelRequested) break;
      const filePath = result.filePaths[index];
      sendRendererEvent("import:progress", {
        active: true,
        phase: "导入文档",
        current: index + 1,
        total: result.filePaths.length,
        fileName: path.basename(filePath),
        cancellable: true,
      });
      try {
        const importedItems = await withJournalOperation(projectPath, {
          type: "document-import",
          title: `导入文档：${path.basename(filePath)}`,
          targetIds: [],
          recoverable: true,
          metadata: { fileName: path.basename(filePath), targetVolume: targetVolume || "导入文档" },
        }, () => importDocumentIntoProject(projectPath, filePath, { volume: targetVolume || "导入文档", config, skipFinalize: true }),
        (items) => ({ importedChapterIds: items.map((item) => item.chapter.id) }));
        imported.push(...importedItems);
      } catch (error) {
        failures.push({ filePath, message: error.message || String(error) });
      }
    }
    if (!imported.length && failures.length) {
      throw new Error(`导入失败：${failures.map((item) => `${path.basename(item.filePath)}：${item.message}`).join("；")}`);
    }
    if (imported.length) {
      await calculateTotalWords(projectPath, config);
      await saveConfig(projectPath, config);
      sendRendererEvent("import:progress", {
        active: true,
        phase: "建立知识库",
        current: imported.length,
        total: imported.length,
        fileName: "正在为成功导入的文档建立索引",
        cancellable: false,
      });
      await indexSources(
        projectPath,
        imported.map((item) => item.source),
      );
      if (config.agent?.autoLocalAnalysis !== false && imported.length) {
        const center = await getProjectTaskCenter(projectPath);
        await center.enqueue({
          type: "story-analysis",
          title: imported.length === 1 ? `整理导入文档：${imported[0].chapter.title}` : `整理 ${imported.length} 份导入文档的创作状态`,
          total: imported.length,
          scope: { chapterIds: imported.map((item) => item.chapter.id) },
          options: { useAI: false, automatic: true, source: "import" },
        });
      }
    }
    sendRendererEvent("import:progress", { active: false, phase: importCancelRequested ? "已取消" : "完成", current: imported.length, total: result.filePaths.length, fileName: "" });
    const state = await buildAppState(projectPath, imported[imported.length - 1]?.chapter.id);
    return {
      ...state,
      importSummary: {
        total: result.filePaths.length,
        imported: imported.length,
        failed: failures.length,
        failures,
        canceled: importCancelRequested,
      },
    };
  });

  ipcMain.handle("document:cancel-import", async () => {
    importCancelRequested = true;
    sendRendererEvent("import:progress", { active: true, phase: "正在取消", current: 0, total: 0, fileName: "当前文档处理完后停止", cancellable: false });
    return { ok: true };
  });

  ipcMain.handle("project:save-settings", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const secrets = await saveCredentialSecrets(projectPath, payload?.api || {}, config);
    const nextConfig = configFromRenderer(config, payload || {});
    nextConfig.api.apiKey = secrets.chatRef;
    nextConfig.api.embeddingApiKey = secrets.embeddingRef;
    Object.defineProperty(nextConfig.api, "__chatSecret", { value: secrets.chat, configurable: true, writable: true, enumerable: false });
    Object.defineProperty(nextConfig.api, "__embeddingSecret", { value: secrets.embedding, configurable: true, writable: true, enumerable: false });
    await saveConfig(projectPath, nextConfig);
    return buildAppState(projectPath, payload?.selectedChapterId);
  });

  ipcMain.handle("project:export-backup", async () => {
    const projectPath = await ensureCurrentProject();
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "导出小说项目备份",
      defaultPath: path.join(projectPath, "backups", `backup_${Date.now()}.zip`),
      filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const filePath = await createBackup(projectPath, result.filePath);
    return { filePath };
  });

  ipcMain.handle("project:export-exchange", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return exportProjectExchange(projectPath, payload || {});
  });

  ipcMain.handle("project:preview-exchange", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return previewProjectExchange(projectPath, payload || {});
  });

  ipcMain.handle("project:import-exchange", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withJournalOperation(projectPath, { type: "project-exchange-import", title: "导入项目交换包", recoverable: true },
      () => importProjectExchange(projectPath, payload?.token, payload || {}),
      (result) => ({ imported: result.imported }));
  });

  ipcMain.handle("project:export-book-docx", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择逐篇 Word 文档的保存位置",
      defaultPath: projectPath,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    return exportBookDocumentsToDirectory(projectPath, result.filePaths[0], payload || {});
  });

  ipcMain.handle("global:search", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return globalSearch(projectPath, payload?.query || "");
  });

  ipcMain.handle("analysis:get-state", async () => {
    const projectPath = await ensureCurrentProject();
    return loadAnalysisState(projectPath);
  });

  ipcMain.handle("analysis:save-state", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return saveAnalysisState(projectPath, payload || {});
  });

  ipcMain.handle("analysis:timeline", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const snapshot = await loadAnalysisState(projectPath);
    if (payload?.refresh === false && snapshot.timeline?.events) return snapshot.timeline;
    let result;
    if (payload?.mode === "ai") {
      try {
        result = await buildAiTimelineEvents(projectPath, payload || {});
      } catch (error) {
        const fallback = await buildTimelineEvents(projectPath, payload || {});
        result = { ...fallback, contextCount: 0, apiError: error.message || String(error) };
      }
    } else {
      result = await buildTimelineEvents(projectPath, payload || {});
    }
    await saveAnalysisState(projectPath, { timeline: result, timelineOptions: result.options || payload || {} });
    return result;
  });

  ipcMain.handle("analysis:relationships", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const snapshot = await loadAnalysisState(projectPath);
    if (payload?.refresh === false && snapshot.relationships?.nodes) return snapshot.relationships;
    const result = await buildRelationshipGraph(projectPath, payload || {});
    await saveAnalysisState(projectPath, { relationships: result, relationshipOptions: result.options || payload || {} });
    return result;
  });

  ipcMain.handle("analysis:consistency", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const snapshot = await loadAnalysisState(projectPath);
    if (payload?.refresh === false && snapshot.consistency?.issues) return snapshot.consistency;
    const result = await analyzeConsistency(projectPath, payload || {});
    await saveAnalysisState(projectPath, { consistency: result, consistencyOptions: result.options || payload || {} });
    return result;
  });

  ipcMain.handle("analysis:update-issue-status", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const issueId = String(payload?.issueId || "");
    const status = String(payload?.status || "待处理");
    if (!issueId) throw new Error("缺少问题 ID。");
    const statuses = await loadIssueStatuses(projectPath);
    statuses[issueId] = { status, updatedAt: nowIso() };
    await saveIssueStatuses(projectPath, statuses);
    const snapshot = await loadAnalysisState(projectPath);
    if (Array.isArray(snapshot.consistency?.issues)) {
      await saveAnalysisState(projectPath, {
        consistency: {
          ...snapshot.consistency,
          issues: snapshot.consistency.issues.map((issue) => (issue.id === issueId ? { ...issue, status, statusUpdatedAt: statuses[issueId].updatedAt } : issue)),
        },
      });
    }
    return { issueId, status, updatedAt: statuses[issueId].updatedAt };
  });

  ipcMain.handle("knowledge:list", async () => {
    const projectPath = await ensureCurrentProject();
    return { items: await listKnowledgeItems(projectPath) };
  });

  ipcMain.handle("knowledge:update", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return updateKnowledgeItems(projectPath, payload?.items || []);
  });

  ipcMain.handle("knowledge:status", async () => {
    const projectPath = await ensureCurrentProject();
    return getKnowledgeSyncStatus(projectPath);
  });

  ipcMain.handle("knowledge:repair", async () => {
    const projectPath = await ensureCurrentProject();
    return repairKnowledgeSync(projectPath);
  });

  ipcMain.handle("maintenance:diagnostics", async () => {
    const projectPath = await ensureCurrentProject();
    return getMaintenanceDiagnostics(projectPath);
  });

  ipcMain.handle("maintenance:repair", async () => {
    const projectPath = await ensureCurrentProject();
    return repairMaintenance(projectPath);
  });

  ipcMain.handle("project:health", async () => {
    const projectPath = await ensureCurrentProject();
    return inspectProjectHealth(projectPath);
  });

  ipcMain.handle("project:repair-health", async () => {
    const projectPath = await ensureCurrentProject();
    return repairProjectHealth(projectPath);
  });

  ipcMain.handle("story:get-overview", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return getStoryOverviewForProject(projectPath, payload || {});
  });

  ipcMain.handle("story:analyze-local", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const requestedIds = new Set((payload?.chapterIds || []).map(String));
    const chapters = config.chapters.filter((chapter) => !requestedIds.size || requestedIds.has(chapter.id));
    for (const chapter of chapters) await refreshLocalStoryState(projectPath, chapter.id);
    return getStoryOverviewForProject(projectPath, payload || {});
  });

  ipcMain.handle("story:update-fact", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return storyState.updateFact(projectPath, String(payload?.factId || ""), payload?.patch || {});
  });

  ipcMain.handle("story:create-fact", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const chapter = config.chapters.find((item) => item.id === payload?.chapterId);
    if (!chapter) throw new Error("请选择要关联的章节或大纲文档。");
    return storyState.createManualFact(projectPath, { ...payload, chapterTitle: chapter.title, volume: chapter.volume || "未分卷" });
  });

  ipcMain.handle("story:delete-fact", async (_event, factId) => {
    const projectPath = await ensureCurrentProject();
    return storyState.deleteFact(projectPath, String(factId || ""));
  });

  ipcMain.handle("story:update-foreshadow", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return storyState.updateForeshadow(projectPath, String(payload?.foreshadowId || ""), payload?.patch || {});
  });

  ipcMain.handle("story:create-foreshadow", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const chapter = config.chapters.find((item) => item.id === payload?.chapterId);
    if (!chapter) throw new Error("请选择伏笔首次埋下的章节或大纲文档。");
    return storyState.createManualForeshadow(projectPath, { ...payload, chapterTitle: chapter.title, volume: chapter.volume || "未分卷" });
  });

  ipcMain.handle("story:delete-foreshadow", async (_event, foreshadowId) => {
    const projectPath = await ensureCurrentProject();
    return storyState.deleteForeshadow(projectPath, String(foreshadowId || ""));
  });

  ipcMain.handle("story:get-board", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    return { board: await storyState.getBoard(projectPath, String(chapterId || "")) };
  });

  ipcMain.handle("story:generate-board", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const ordered = config.chapters.slice().sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((chapter) => chapter.id === payload?.chapterId);
    const chapter = ordered[index];
    if (!chapter) throw new Error("没有找到要生成筹备板的章节。");
    return { board: await storyState.generateLocalBoard(projectPath, chapter, ordered[index + 1] || null) };
  });

  ipcMain.handle("story:save-board", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return { board: await storyState.saveBoard(projectPath, payload?.board || {}) };
  });

  ipcMain.handle("workspace:get", async () => {
    const projectPath = await ensureCurrentProject();
    return getCreativeWorkspaceView(projectPath);
  });

  ipcMain.handle("workspace:upsert", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const item = await creativeWorkspace.upsertItem(projectPath, String(payload?.collection || ""), payload?.item || {});
    return { item, workspace: await getCreativeWorkspaceView(projectPath) };
  });

  ipcMain.handle("workspace:delete", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    await creativeWorkspace.deleteItem(projectPath, String(payload?.collection || ""), String(payload?.itemId || ""));
    return { workspace: await getCreativeWorkspaceView(projectPath) };
  });

  ipcMain.handle("workspace:reorder-scenes", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const scenes = await creativeWorkspace.reorderScenes(projectPath, String(payload?.chapterId || ""), payload?.sceneIds || []);
    return { scenes, workspace: await getCreativeWorkspaceView(projectPath) };
  });

  ipcMain.handle("workspace:rebuild-causality", async () => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const overview = await storyState.getStoryOverview(projectPath, { projectChapters: config.chapters, factLimit: 2000, characterLimit: 500, foreshadowLimit: 1000 });
    const chapterOrder = Object.fromEntries(config.chapters.map((chapter) => [chapter.id, chapter.order]));
    const result = await creativeWorkspace.rebuildCausality(projectPath, { facts: overview.facts, foreshadows: overview.foreshadows, chapterOrder });
    return { ...result, workspace: await getCreativeWorkspaceView(projectPath) };
  });

  ipcMain.handle("workspace:generate-arcs", async () => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const overview = await storyState.getStoryOverview(projectPath, { projectChapters: config.chapters, characterLimit: 500 });
    const arcs = await creativeWorkspace.generateArcs(projectPath, overview.characterStates);
    return { arcs, workspace: await getCreativeWorkspaceView(projectPath) };
  });

  ipcMain.handle("workspace:quality", async () => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const overview = await storyState.getStoryOverview(projectPath, { projectChapters: config.chapters, factLimit: 2000, characterLimit: 500, foreshadowLimit: 1000 });
    const workspace = await creativeWorkspace.loadWorkspace(projectPath);
    return { reports: creativeWorkspace.qualityReport(workspace, config.chapters, overview), generatedAt: nowIso() };
  });

  ipcMain.handle("workspace:statistics", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return buildCreativeStatistics(projectPath, String(payload?.label || ""));
  });

  ipcMain.handle("agent:prepare", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return prepareCreativeAgentRun(projectPath, payload || {});
  });

  ipcMain.handle("agent:execute", async (_event, runId) => {
    const projectPath = await ensureCurrentProject();
    return queueCreativeAgentRun(projectPath, String(runId || ""));
  });

  ipcMain.handle("agent:retry-tool", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return queueCreativeAgentRun(projectPath, String(payload?.runId || ""), String(payload?.tool || ""));
  });

  ipcMain.handle("revision:create", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return createSafeRevision(projectPath, payload || {});
  });

  ipcMain.handle("revision:apply", async (_event, revisionId) => {
    const projectPath = await ensureCurrentProject();
    return withJournalOperation(projectPath, { type: "safe-revision-apply", title: "应用安全修订", targetIds: [revisionId], recoverable: true },
      () => applySafeRevision(projectPath, String(revisionId || "")),
      (result) => ({ chapterId: result.revision.chapterId, revisionId: result.revision.id }));
  });

  ipcMain.handle("revision:apply-part", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withJournalOperation(projectPath, { type: "safe-revision-apply-part", title: "局部应用安全修订", targetIds: [String(payload?.revisionId || "")], recoverable: true },
      () => applySafeRevisionPart(projectPath, payload || {}),
      (result) => ({ chapterId: result.revision.chapterId, revisionId: result.revision.id }));
  });

  ipcMain.handle("revision:update-status", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const workspace = await creativeWorkspace.loadWorkspace(projectPath);
    const revision = workspace.revisions.find((item) => item.id === payload?.revisionId);
    if (!revision) throw new Error("没有找到这条修订建议。");
    const status = ["已拒绝", "已失效"].includes(payload?.status) ? payload.status : "已拒绝";
    const item = await creativeWorkspace.upsertItem(projectPath, "revisions", { ...revision, status });
    return { item, workspace: await getCreativeWorkspaceView(projectPath) };
  });

  ipcMain.handle("tasks:list", async () => {
    const projectPath = await ensureCurrentProject();
    return (await getProjectTaskCenter(projectPath)).list();
  });

  ipcMain.handle("tasks:enqueue", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const allowedTypes = new Set(["story-analysis", "creative-board", "consistency-check", "timeline-analysis", "knowledge-rebuild", "snapshot", "creative-statistics"]);
    if (!allowedTypes.has(payload?.type)) throw new Error("不支持的后台任务类型。");
    return { task: await (await getProjectTaskCenter(projectPath)).enqueue(payload || {}) };
  });

  ipcMain.handle("tasks:cancel", async (_event, taskId) => {
    const projectPath = await ensureCurrentProject();
    return (await getProjectTaskCenter(projectPath)).cancel(String(taskId || ""));
  });

  ipcMain.handle("tasks:pause", async (_event, taskId) => {
    const projectPath = await ensureCurrentProject();
    return (await getProjectTaskCenter(projectPath)).pause(String(taskId || ""));
  });

  ipcMain.handle("tasks:resume", async (_event, taskId) => {
    const projectPath = await ensureCurrentProject();
    return (await getProjectTaskCenter(projectPath)).resume(String(taskId || ""));
  });

  ipcMain.handle("tasks:retry", async (_event, taskId) => {
    const projectPath = await ensureCurrentProject();
    return { task: await (await getProjectTaskCenter(projectPath)).retry(String(taskId || "")) };
  });

  ipcMain.handle("tasks:remove", async (_event, taskId) => {
    const projectPath = await ensureCurrentProject();
    return (await getProjectTaskCenter(projectPath)).remove(String(taskId || ""));
  });

  ipcMain.handle("tasks:clear-history", async () => {
    const projectPath = await ensureCurrentProject();
    return (await getProjectTaskCenter(projectPath)).clearHistory();
  });

  ipcMain.handle("snapshots:list", async () => {
    const projectPath = await ensureCurrentProject();
    return projectSnapshots.listSnapshots(projectPath);
  });

  ipcMain.handle("snapshots:create", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return { snapshot: await projectSnapshots.createSnapshot(projectPath, payload || {}) };
  });

  ipcMain.handle("snapshots:compare", async (_event, snapshotId) => {
    const projectPath = await ensureCurrentProject();
    return projectSnapshots.compareSnapshot(projectPath, String(snapshotId || ""));
  });

  ipcMain.handle("snapshots:restore", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const result = await projectSnapshots.restoreSnapshot(projectPath, String(payload?.snapshotId || ""), { paths: payload?.paths || [] });
    const task = await queueKnowledgeRebuildAfterRestore(projectPath, `恢复快照：${result.snapshot.name}`);
    return { ...result, task, state: await buildAppState(projectPath) };
  });

  ipcMain.handle("snapshots:rename", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return { snapshot: await projectSnapshots.renameSnapshot(projectPath, String(payload?.snapshotId || ""), String(payload?.name || "")) };
  });

  ipcMain.handle("snapshots:delete", async (_event, snapshotId) => {
    const projectPath = await ensureCurrentProject();
    const activeSnapshotTask = (await (await getProjectTaskCenter(projectPath)).list()).tasks.some((task) => task.type === "snapshot" && ["等待中", "运行中", "正在停止", "已暂停"].includes(task.status));
    if (activeSnapshotTask) throw new Error("项目快照仍在创建中，请等待任务完成后再删除。");
    return projectSnapshots.deleteSnapshot(projectPath, String(snapshotId || ""));
  });

  ipcMain.handle("snapshots:cleanup", async () => {
    const projectPath = await ensureCurrentProject();
    const activeSnapshotTask = (await (await getProjectTaskCenter(projectPath)).list()).tasks.some((task) => task.type === "snapshot" && ["等待中", "运行中", "正在停止", "已暂停"].includes(task.status));
    if (activeSnapshotTask) throw new Error("项目快照仍在创建中，请等待任务完成后再清理。");
    return projectSnapshots.garbageCollectObjects(projectPath);
  });

  ipcMain.handle("snapshots:create-branch", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return projectSnapshots.createBranch(projectPath, String(payload?.name || "实验分支"), String(payload?.snapshotId || ""));
  });

  ipcMain.handle("snapshots:switch-branch", async (_event, branchId) => {
    const projectPath = await ensureCurrentProject();
    const result = await projectSnapshots.switchBranch(projectPath, String(branchId || ""));
    const task = result.restored ? await queueKnowledgeRebuildAfterRestore(projectPath, `切换分支：${result.activeBranch.name}`) : null;
    return { ...result, task, state: await buildAppState(projectPath) };
  });

  ipcMain.handle("snapshots:delete-branch", async (_event, branchId) => {
    const projectPath = await ensureCurrentProject();
    return projectSnapshots.deleteBranch(projectPath, String(branchId || ""));
  });

  ipcMain.handle("experiments:appearance-stats", async () => {
    const projectPath = await ensureCurrentProject();
    return buildAppearanceStats(projectPath);
  });

  ipcMain.handle("experiments:world-map", async () => {
    const projectPath = await ensureCurrentProject();
    return buildWorldMap(projectPath);
  });

  ipcMain.handle("materials:list", async () => {
    const projectPath = await ensureCurrentProject();
    return { materials: await loadMaterials(projectPath) };
  });

  ipcMain.handle("materials:save", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const item = await saveMaterial(projectPath, payload || {});
    return { material: item, materials: await loadMaterials(projectPath) };
  });

  ipcMain.handle("materials:delete", async (_event, materialId) => {
    const projectPath = await ensureCurrentProject();
    await deleteMaterial(projectPath, String(materialId || ""));
    return { materials: await loadMaterials(projectPath) };
  });

  ipcMain.handle("ai:creative-advice", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const result = await buildCreativeAdvice(projectPath, payload || {});
    await saveAnalysisState(projectPath, {
      creativeAdvice: result,
      creativeOptions: {
        mode: result.mode,
        chapterId: result.chapterId,
        focus: String(payload?.focus || "").trim(),
        contextIds: Array.isArray(payload?.contextIds) ? payload.contextIds.map(String).slice(0, 60) : [],
      },
    });
    return result;
  });

  ipcMain.handle("chapter:create", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const order = config.chapters.length;
    const title = payload?.title?.trim() || `第${order + 1}章 新章节`;
    const chapterDir = path.join(projectPath, "chapters");
    await ensureDir(chapterDir);
    const fileName = await uniqueChapterFileName(projectPath, config, `chapter_${String(order + 1).padStart(3, "0")}_${title}`, ".md");
    const chapter = {
      id: makeId("chapter"),
      title,
      volume: payload?.volume || "卷一",
      order,
      fileName,
      wordCount: 0,
      knowledgeRole: "正文",
      outline: [{ id: `0_${title}`, level: 1, title, line: 0 }],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    config.chapters.push(chapter);
    await fs.writeFile(getChapterPath(projectPath, chapter), `# ${title}\n\n`, "utf8");
    await saveConfig(projectPath, config);
    return buildAppState(projectPath, chapter.id);
  });

  ipcMain.handle("chapter:load", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    return loadChapterContent(projectPath, chapterId);
  });

  ipcMain.handle("chapter:save", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withJournalOperation(projectPath, {
      type: "chapter-save", title: "保存章节", targetIds: [payload?.chapterId], recoverable: true,
      metadata: { expectedRevision: String(payload?.expectedRevision || "").slice(0, 128) },
    }, async () => {
    const config = await loadConfig(projectPath);
    const chapter = config.chapters.find((item) => item.id === payload.chapterId);
    if (!chapter) throw new Error("章节不存在，无法保存。");
    let filePath = getChapterPath(projectPath, chapter);
    const previousContent = await fs.readFile(filePath, "utf8").catch(() => "");
    assertExpectedChapterRevision(String(payload?.expectedRevision || ""), previousContent);
    const previousWords = countWords(previousContent);
    const nextContent = String(payload.content ?? "");
    const didSplitSharedFile = await ensureExclusiveChapterFile(projectPath, config, chapter, previousContent, {
      snapshot: false,
      reason: "保存前自动拆分共享章节文件",
    });
    if (didSplitSharedFile) filePath = getChapterPath(projectPath, chapter);
    if (previousContent && previousContent !== nextContent) {
      await snapshotChapterVersion(projectPath, chapter, previousContent).catch(() => null);
    }
    await fs.writeFile(filePath, nextContent, "utf8");

    if (payload.title && payload.title.trim()) chapter.title = payload.title.trim();
    if (payload.volume && payload.volume.trim()) chapter.volume = payload.volume.trim();
    chapter.wordCount = countWords(nextContent);
    chapter.outline = extractOutline(nextContent);
    chapter.updatedAt = nowIso();
    if (config.stats.todayDate !== todayKey()) {
      config.stats.todayDate = todayKey();
      config.stats.todayWords = 0;
    }
    config.stats.todayWords += Math.max(0, chapter.wordCount - previousWords);
    await calculateTotalWords(projectPath, config);
    await saveConfig(projectPath, config);

    const indexResult = await indexSource(projectPath, {
      id: chapter.id,
      type: "chapter",
      title: chapter.title,
      volume: chapter.volume || "未分卷",
      category: chapter.volume || "未分卷",
      knowledgeRole: getKnowledgeRole(chapter),
      content: nextContent,
    });
    let storyStateWarning = "";
    if (config.agent?.autoLocalAnalysis !== false) {
      await refreshLocalStoryState(projectPath, chapter.id, nextContent).catch((error) => {
        storyStateWarning = error?.message || String(error);
      });
    }
    if (config.agent?.autoDeepAnalysis === true) scheduleIdleDeepAnalysis(projectPath, chapter);

    if (config.ui.backupOnSave) {
      await createBackup(projectPath).catch(() => null);
    }

    return {
      chapter,
      config: configForRenderer(config),
      indexResult,
      vectorStats: { chunks: indexResult.totalChunks, updatedAt: nowIso() },
      revision: contentRevision(nextContent),
      storyStateWarning,
    };
    }, (result) => ({ chapterId: result.chapter.id, revision: result.revision, chunks: result.indexResult.chunks }));
  });

  ipcMain.handle("chapter:delete", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const chapter = config.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在，无法删除。");
    const deepAnalysisKey = `${projectPath}\u0000${chapterId}`;
    if (deepAnalysisTimers.has(deepAnalysisKey)) {
      clearTimeout(deepAnalysisTimers.get(deepAnalysisKey));
      deepAnalysisTimers.delete(deepAnalysisKey);
    }
    if (config.chapters.length <= 1) throw new Error("至少需要保留一个章节。");
    const hasOtherChapterUsingFile = config.chapters.some(
      (item) => item.id !== chapterId && normalizeChapterFileName(item.fileName) === normalizeChapterFileName(chapter.fileName),
    );
    if (!hasOtherChapterUsingFile) {
      await fs.rm(getChapterPath(projectPath, chapter), { force: true });
    }
    config.chapters = config.chapters.filter((item) => item.id !== chapterId).map((item, index) => ({ ...item, order: index }));
    await removeSourceFromIndex(projectPath, chapterId);
    await storyState.removeChapterLedger(projectPath, chapterId).catch(() => null);
    await creativeWorkspace.removeChapterReferences(projectPath, chapterId).catch(() => null);
    await calculateTotalWords(projectPath, config);
    await saveConfig(projectPath, config);
    return buildAppState(projectPath, config.chapters[0]?.id);
  });

  ipcMain.handle("chapter:export-docx", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const chapter = config.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在，无法导出。");
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "导出当前章节为 Word 文档",
      defaultPath: path.join(projectPath, `${sanitizeFileName(chapter.title)}.docx`),
      filters: [{ name: "Word 文档", extensions: ["docx"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const filePath = await exportChapterToDocx(projectPath, chapter, result.filePath);
    return { filePath };
  });

  ipcMain.handle("chapter:open-original", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const chapter = config.chapters.find((item) => item.id === chapterId);
    const originalPath = getOriginalDocumentPath(projectPath, chapter);
    if (!originalPath || !existsSync(originalPath)) {
      return { error: "这个条目没有保留的 Word 原文档。" };
    }
    const error = await shell.openPath(originalPath);
    return error ? { filePath: originalPath, error } : { filePath: originalPath };
  });

  ipcMain.handle("chapter:refresh-original", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    return refreshChapterFromOriginalDocument(projectPath, chapterId);
  });

  ipcMain.handle("chapter:list-versions", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    return { versions: await listChapterVersions(projectPath, chapterId) };
  });

  ipcMain.handle("chapter:compare-version", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return compareChapterVersion(projectPath, String(payload?.chapterId || ""), String(payload?.versionId || ""));
  });

  ipcMain.handle("chapter:restore-version", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return restoreChapterVersion(projectPath, String(payload?.chapterId || ""), String(payload?.versionId || ""));
  });

  ipcMain.handle("chapter:reorder", async (_event, chapterIds) => {
    const projectPath = await ensureCurrentProject();
    return withJournalOperation(projectPath, { type: "chapter-reorder", title: "调整目录顺序", targetIds: chapterIds, recoverable: true }, async () => {
    const config = await loadConfig(projectPath);
    const idOrder = new Map(chapterIds.map((id, index) => [id, index]));
    config.chapters = config.chapters
      .slice()
      .sort((a, b) => (idOrder.get(a.id) ?? a.order) - (idOrder.get(b.id) ?? b.order))
      .map((item, index) => ({ ...item, order: index }));
    await saveConfig(projectPath, config);
    return { chapters: config.chapters };
    }, (result) => ({ count: result.chapters.length }));
  });

  ipcMain.handle("chapter:move-to-volume", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withJournalOperation(projectPath, { type: "chapter-move", title: "移动目录文档", targetIds: [payload?.chapterId], recoverable: true, metadata: { volume: String(payload?.volume || "") } }, async () => {
    const config = await loadConfig(projectPath);
    const chapterId = String(payload?.chapterId || "");
    const targetVolume = String(payload?.volume || "未分卷").trim() || "未分卷";
    const beforeChapterId = String(payload?.beforeChapterId || "");
    const chapter = config.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("文档不存在，无法移动。");

    const ordered = config.chapters.slice().sort((a, b) => a.order - b.order);
    const moving = { ...chapter, volume: targetVolume, updatedAt: nowIso() };
    const rest = ordered.filter((item) => item.id !== chapterId);
    let insertIndex = -1;
    if (beforeChapterId && beforeChapterId !== chapterId) {
      insertIndex = rest.findIndex((item) => item.id === beforeChapterId);
    }
    if (insertIndex < 0) {
      const lastInVolume = rest.reduce((last, item, index) => ((item.volume || "未分卷") === targetVolume ? index : last), -1);
      insertIndex = lastInVolume >= 0 ? lastInVolume + 1 : rest.length;
    }
    rest.splice(insertIndex, 0, moving);
    config.chapters = rest.map((item, index) => ({ ...item, order: index }));
    await saveConfig(projectPath, config);
    return buildAppState(projectPath, chapterId);
    }, (result) => ({ chapterId: result.selectedChapter?.id || "" }));
  });

  ipcMain.handle("character:save", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const characters = await loadCharacters(projectPath);
    const previous = payload.id ? characters.find((item) => item.id === payload.id) : null;
    const fileName = await uniqueContentFileName(projectPath, "characters", payload.name || payload.id || "未命名角色", ".json", previous?.fileName || "");
    const card = {
      id: payload.id || makeId("character"),
      name: payload.name || "未命名角色",
      category: normalizeCategory(payload.category),
      appearance: payload.appearance || "",
      personality: payload.personality || "",
      background: payload.background || "",
      relationships: payload.relationships || "",
      notes: payload.notes || "",
      fileName,
      updatedAt: nowIso(),
    };
    const nextPath = getCharacterPath(projectPath, card);
    // 角色改名会改变文件名，保存前清理旧文件，避免同一角色出现重复卡片。
    if (previous?.fileName && path.basename(nextPath) !== normalizeManagedFileName(previous.fileName, ".json")) {
      await fs.rm(getCharacterPath(projectPath, previous), { force: true });
    }
    await writeJson(nextPath, card);
    await indexSource(projectPath, {
      id: card.id,
      type: "character",
      title: card.name,
      content: characterToMarkdown(card),
    });
    return buildAppState(projectPath);
  });

  ipcMain.handle("character:delete", async (_event, characterId) => {
    const projectPath = await ensureCurrentProject();
    const characters = await loadCharacters(projectPath);
    const card = characters.find((item) => item.id === characterId);
    if (card) await fs.rm(getCharacterPath(projectPath, card), { force: true });
    await removeSourceFromIndex(projectPath, characterId);
    return buildAppState(projectPath);
  });

  ipcMain.handle("world:save", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const title = payload.title || "未命名设定";
    const worldDocs = await loadWorldDocs(projectPath);
    const previous = payload.id ? worldDocs.find((item) => item.id === payload.id) : null;
    const fileName = previous?.fileName || (await uniqueContentFileName(projectPath, "worldbuilding", title, ".md"));
    const doc = {
      id: previous?.id || fileName.replace(/\.md$/i, ""),
      title,
      category: normalizeCategory(payload.category),
      fileName,
      content: payload.content || "",
      updatedAt: nowIso(),
    };
    await writeWorldDoc(projectPath, doc);
    await indexSource(projectPath, {
      id: doc.id,
      type: "world",
      title: doc.title,
      content: doc.content,
    });
    return buildAppState(projectPath);
  });

  ipcMain.handle("world:delete", async (_event, docId) => {
    const projectPath = await ensureCurrentProject();
    const worldDocs = await loadWorldDocs(projectPath);
    const doc = worldDocs.find((item) => item.id === docId);
    if (doc) await fs.rm(getWorldDocPath(projectPath, doc), { force: true });
    await removeSourceFromIndex(projectPath, docId);
    return buildAppState(projectPath);
  });

  ipcMain.handle("ai:generate-characters", async () => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    if (config.agent?.snapshotBeforeBulkChanges !== false) {
      await projectSnapshots.createSnapshot(projectPath, { name: "AI 生成角色卡前", reason: "批量更新角色卡前自动保存" });
    }
    return generateCharactersFromOutline(projectPath);
  });

  ipcMain.handle("ai:generate-world", async () => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    if (config.agent?.snapshotBeforeBulkChanges !== false) {
      await projectSnapshots.createSnapshot(projectPath, { name: "AI 生成世界观前", reason: "批量更新世界观前自动保存" });
    }
    return generateWorldDocsFromOutline(projectPath);
  });

  ipcMain.handle("ai:extract-world-cards", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return prepareWorldCardCandidates(projectPath, payload || {});
  });

  ipcMain.handle("ai:save-world-card-candidates", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    if (config.agent?.snapshotBeforeBulkChanges !== false && (payload?.candidates || []).length > 1) {
      await projectSnapshots.createSnapshot(projectPath, { name: "写入设定候选前", reason: "批量写入世界观候选前自动保存" });
    }
    return saveWorldCardCandidates(projectPath, payload?.candidates || []);
  });

  ipcMain.handle("ai:edit-selection", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const action = String(payload?.action || "润色");
    const text = String(payload?.text || "").trim();
    if (!text) throw new Error("请先选中一段文字。");
    const actionPrompts = {
      改写: "在不改变核心含义的前提下，改写得更自然、更适合小说正文。",
      润色: "润色语言，使节奏、措辞和画面感更好。",
      扩写: "扩写细节，增加动作、感官和情绪，但不要偏离原意。",
      总结: "总结这段文字的剧情作用、关键信息和可改进点。",
    };
    const systemPrompt = `你是小说写作助手。${actionPrompts[action] || actionPrompts.润色}只输出结果，不要解释。`;
    const answer = await callChatApi(config, systemPrompt, `【原文】\n${text}`, []);
    return { answer };
  });

  ipcMain.handle("ai:ask", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const question = String(payload.question || "").trim();
    if (!question) throw new Error("请输入要询问 AI 的内容。");
    const requestId = String(payload?.requestId || makeId("ai_stream"));
    activeAiRequests.get(requestId)?.abort();
    const requestController = new AbortController();
    activeAiRequests.set(requestId, requestController);
    sendRendererEvent("ai:stream", { requestId, type: "phase", phase: "正在规划检索范围" });
    let retrievalPackage;
    try {
      retrievalPackage = await buildChatRetrievalPackage(projectPath, config, payload || {}, question);
    } catch (error) {
      activeAiRequests.delete(requestId);
      throw error;
    }
    const { search, materials, retrieval, inventorySummary } = retrievalPackage;
    sendRendererEvent("ai:stream", { requestId, type: "retrieval", phase: "检索完成，正在生成", retrieval });
    const analysisState = await loadAnalysisState(projectPath);
    const projectMemory = buildProjectMemorySummary(analysisState, payload.projectMemory || "");
    const systemPrompt = buildSystemPrompt({
      ...materials,
      projectMemory,
      userQuestion: question,
      selectedText: payload.selectedText || "",
      retrieval,
      inventorySummary,
    });

    let streamedChars = 0;
    let partialAnswer = "";
    let lastCheckpointAt = 0;
    let lastCheckpointChars = 0;
    const saveStreamCheckpoint = (status = "streaming") =>
      saveAnalysisState(projectPath, {
        aiStreamRecovery: { requestId, question, answer: partialAnswer, status, updatedAt: nowIso() },
      });
    try {
      const answer = await callChatApi(config, systemPrompt, question, payload.history || [], {
        stream: true,
        signal: requestController.signal,
        onToken: (token) => {
          const text = String(token || "");
          streamedChars += text.length;
          partialAnswer += text;
          sendRendererEvent("ai:stream", { requestId, type: "chunk", text: token, streamedChars });
          const now = Date.now();
          if (now - lastCheckpointAt >= 1800 || partialAnswer.length - lastCheckpointChars >= 2400) {
            lastCheckpointAt = now;
            lastCheckpointChars = partialAnswer.length;
            void saveStreamCheckpoint("streaming").catch(() => null);
          }
        },
      });
      partialAnswer = answer;
      await saveStreamCheckpoint(requestController.signal.aborted ? "interrupted" : "completed").catch(() => null);
      sendRendererEvent("ai:stream", { requestId, type: "done", phase: requestController.signal.aborted ? "已停止，内容已保留" : "生成完成", streamedChars });
      return {
        answer,
        context: contextFromChunks(search.chunks),
        retrieval,
        contextCount: search.chunks.length,
        candidateCount: search.candidateCount || search.chunks.length,
        scannedCount: search.scannedCount || search.candidateCount || search.chunks.length,
        embeddingSource: search.embeddingSource,
        embeddingWarning: search.embeddingWarning,
        streamedChars,
      };
    } catch (error) {
      if (partialAnswer) await saveStreamCheckpoint("interrupted").catch(() => null);
      sendRendererEvent("ai:stream", { requestId, type: "error", phase: "生成中断，已保留收到的内容", error: error.message || String(error) });
      return {
        answer: `我已经完成本地检索，但暂时没有成功连接到大模型接口。\n\n${error.message}\n\n你可以先查看下方“引用片段”，确认知识库是否已经索引成功。配置接口后再次提问即可获得模型回答。`,
        context: contextFromChunks(search.chunks),
        retrieval,
        contextCount: search.chunks.length,
        candidateCount: search.candidateCount || search.chunks.length,
        scannedCount: search.scannedCount || search.candidateCount || search.chunks.length,
        embeddingSource: search.embeddingSource,
        embeddingWarning: search.embeddingWarning,
        apiError: error.message,
      };
    } finally {
      activeAiRequests.delete(requestId);
    }
  });

  ipcMain.handle("ai:cancel", async (_event, requestId) => {
    const id = String(requestId || "");
    const controller = activeAiRequests.get(id);
    if (!controller) return { canceled: false };
    controller.abort(new Error("user-canceled"));
    return { canceled: true };
  });

  ipcMain.handle("index:rebuild", async () => {
    const projectPath = await ensureCurrentProject();
    const result = await rebuildIndex(projectPath);
    return { ...result, state: await buildAppState(projectPath) };
  });
}

if (process.env.NOVEL_PLATFORM_TEST === "1") {
  module.exports = {
    analyzeConsistency,
    buildAiTimelineEvents,
    buildAppState,
    buildChatRetrievalPackage,
    buildCreativeAdvice,
    buildProjectExchangeArchive,
    buildInventorySummary,
    buildProjectSourceCatalog,
    buildRelationshipGraph,
    buildSystemPrompt,
    buildTimelineEvents,
    callChatApi,
    chunkText,
    collectPromptMaterials,
    contentToPlainText,
    defaultConfig,
    ensureProjectStructure,
    getCreativeWorkspaceView,
    assertExpectedChapterRevision,
    exportBookToDocx,
    exportBookDocumentsToDirectory,
    exportChapterToDocx,
    generateCharactersFromOutline,
    getChapterPath,
    getConfigPath,
    getKnowledgeRole,
    getKnowledgeSyncStatus,
    getMaintenanceDiagnostics,
    inspectProjectHealth,
    applySafeRevision,
    applySafeRevisionPart,
    buildCreativeStatistics,
    replaceUniqueSelection,
    importDocumentIntoProject,
    indexSource,
    indexSources,
    loadAnalysisState,
    loadCharacters,
    loadConfig,
    loadKnowledgeSummaries,
    loadVectorStore,
    loadWorldDocs,
    prepareWorldCardCandidates,
    prepareCreativeAgentRun,
    analyzeStoryStateWithAI,
    executeBackgroundTask,
    getStoryOverviewForProject,
    refreshLocalStoryState,
    repairKnowledgeSync,
    repairMaintenance,
    rebuildIndex,
    saveConfig,
    saveAnalysisState,
    saveWorldCardCandidates,
    searchRelevantChunks,
    updateKnowledgeSummaries,
    projectSnapshots,
    storyState,
  };
} else {
  app.whenReady().then(async () => {
    app.setName("AI小说创作平台");
    setChineseApplicationMenu();
    registerIpcHandlers();
    currentProjectPath = await getDefaultProjectPath();
    await ensureProjectStructure(currentProjectPath);
    await activateProjectSession(currentProjectPath);
    await createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (gracefulShutdownStarted || !projectSessions.size) return;
    event.preventDefault();
    gracefulShutdownStarted = true;
    void finishProjectSessions().finally(() => app.quit());
  });
}
