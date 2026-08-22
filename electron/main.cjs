const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const crypto = require("node:crypto");
const { fileURLToPath, pathToFileURL } = require("node:url");
const AdmZip = require("adm-zip");
const mammoth = require("mammoth");
const { parse: parseHtml } = require("node-html-parser");
const {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
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
const CHAT_API_TIMEOUT_MS = Number(process.env.NOVEL_CHAT_TIMEOUT_MS || 300000);
const CHAT_HISTORY_MESSAGE_MAX_CHARS = 3500;
const CHAT_HISTORY_TOTAL_MAX_CHARS = 14000;
const USER_QUESTION_SYSTEM_PREVIEW_CHARS = 1200;
const SELECTED_TEXT_PROMPT_MAX_CHARS = 12000;
const STRUCTURING_CONTEXT_CHAR_BUDGET = 45000;
const DEFAULT_CATEGORY = "未分类";
const EMBEDDING_INDEX_CONCURRENCY = 4;

let mainWindow;
let currentProjectPath = "";
let importCancelRequested = false;

function sendRendererEvent(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function nowIso() {
  return new Date().toISOString();
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

function sanitizeFileName(name) {
  return String(name || "未命名")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
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
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
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

async function fetchJsonWithDiagnostics(url, payload, headers, label) {
  const body = JSON.stringify(payload);
  const bodyBytes = Buffer.byteLength(body, "utf8");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_API_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    return { response, bodyBytes };
  } catch (error) {
    const timeoutHint = error?.name === "AbortError" ? `请求超过 ${Math.round(CHAT_API_TIMEOUT_MS / 1000)} 秒未完成，已自动中断。` : "";
    const sizeHint = bodyBytes > 1024 * 1024 ? "请求体超过 1MB，可能被本地代理、网关或安全软件中断。" : "如果问题很长，可减少引用片段上限或拆成几次提问。";
    throw new Error(`${label}本地连接失败：${describeFetchError(error)}\n请求地址：${safeEndpointLabel(url)}\n请求体大小：${formatBytes(bodyBytes)}。${timeoutHint}${sizeHint}`);
  } finally {
    clearTimeout(timer);
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
  const previous = await loadAnalysisState(projectPath);
  const next = {
    ...previous,
    ...(patch || {}),
    updatedAt: nowIso(),
  };
  await writeJson(getAnalysisStatePath(projectPath), next);
  return next;
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
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const store = await loadVectorStore(projectPath);
  let changed = false;
  store.vectors = store.vectors.map((entry) => {
    const chapter = byId.get(entry.sourceId);
    if (!chapter) return entry;
    changed = true;
    return {
      ...entry,
      title: chapter.title,
      volume: chapter.volume || "未分卷",
      category: chapter.volume || "未分卷",
      knowledgeRole: getKnowledgeRole(chapter),
      updatedAt: nowIso(),
    };
  });
  if (changed) await saveVectorStore(projectPath, store);
}

async function updateKnowledgeItems(projectPath, items) {
  const updates = new Map((Array.isArray(items) ? items : []).map((item) => [String(item.id || item.sourceId || ""), item]));
  const config = await loadConfig(projectPath);
  let changed = false;
  config.chapters = config.chapters.map((chapter) => {
    const patch = updates.get(chapter.id);
    if (!patch) return chapter;
    const nextVolume = String(patch.volume || chapter.volume || "未分卷").trim() || "未分卷";
    const nextRole = normalizeKnowledgeRole(patch.knowledgeRole || chapter.knowledgeRole);
    if (nextVolume === chapter.volume && nextRole === getKnowledgeRole(chapter)) return chapter;
    changed = true;
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
    await updateVectorKnowledgeMetadata(projectPath, config.chapters);
  }
  return {
    items: await listKnowledgeItems(projectPath),
    state: await buildAppState(projectPath),
  };
}

function defaultConfig(title = DEFAULT_PROJECT_NAME) {
  const firstChapterId = makeId("chapter");
  return {
    version: 1,
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

  const configPath = getConfigPath(projectPath);
  if (!existsSync(configPath)) {
    const config = defaultConfig(title);
    await writeJson(configPath, config);
    const chapterFile = path.join(projectPath, "chapters", config.chapters[0].fileName);
    await fs.writeFile(chapterFile, "# 第一章 开篇\n\n从这里开始写下你的故事。\n", "utf8");
    await writeJson(getVectorsPath(projectPath), { version: 1, updatedAt: nowIso(), vectors: [] });
  }
}

async function loadConfig(projectPath) {
  const config = await readProjectConfig(projectPath);
  config.chapters = Array.isArray(config.chapters) ? config.chapters : [];
  config.api = { ...defaultConfig().api, ...(config.api || {}) };
  config.ui = { ...defaultConfig().ui, ...(config.ui || {}) };
  config.stats = { ...defaultConfig().stats, ...(config.stats || {}) };
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
      apiKey: decodeSecret(config.api.apiKey),
      embeddingApiKey: decodeSecret(config.api.embeddingApiKey),
    },
  };
}

function configFromRenderer(existingConfig, patch) {
  const api = patch.api || {};
  const ui = patch.ui || {};
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
      apiKey: encodeSecret(api.apiKey ?? decodeSecret(existingConfig.api.apiKey)),
      embeddingApiKey: encodeSecret(api.embeddingApiKey ?? decodeSecret(existingConfig.api.embeddingApiKey)),
    },
    ui: {
      ...existingConfig.ui,
      ...ui,
    },
  };
}

async function getDefaultProjectPath() {
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
  if (!chapter) return { chapter: null, content: "" };
  const filePath = getChapterPath(projectPath, chapter);
  let content = "";
  try {
    content = await fs.readFile(filePath, "utf8");
    if (isHtmlContent(content)) content = promoteMarkdownHeadingsInHtml(content);
  } catch {
    content = `# ${chapter.title}\n\n`;
    await fs.writeFile(filePath, content, "utf8");
  }
  return { chapter, content };
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
    const body = promoteMarkdownHeadingsInHtml((result.value || "").trim());
    const startsWithHeading = /^<h[1-6]\b/i.test(body);
    return {
      title: fallbackTitle,
      content: body ? `${startsWithHeading ? "" : `<h1>${fallbackTitle}</h1>\n`}${body}\n` : "",
      contentFormat: "html",
      imageCount: imageIndex,
      originalDocxFile: path.relative(projectPath, originalDocxPath),
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

  const imported = {
    chapter,
    content: converted.content,
    imageCount: converted.imageCount,
    warnings: converted.warnings,
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
  const selectedChapterId = preferredChapterId || config.chapters[0]?.id || "";
  const chapterPayload = await loadChapterContent(projectPath, selectedChapterId);
  const characters = await loadCharacters(projectPath);
  const worldDocs = await loadWorldDocs(projectPath);
  const vectorStore = await readJson(getVectorsPath(projectPath), { version: 1, vectors: [] });
  return {
    projectPath,
    config: configForRenderer(config),
    chapters: config.chapters,
    selectedChapter: chapterPayload.chapter,
    chapterContent: chapterPayload.content,
    characters,
    worldDocs,
    vectorStats: {
      chunks: vectorStore.vectors?.length || 0,
      updatedAt: vectorStore.updatedAt || "",
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

async function remoteEmbedding(text, apiConfig) {
  const embeddingKey = decodeSecret(apiConfig.embeddingApiKey);
  const chatKey = decodeSecret(apiConfig.apiKey);
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
  const { response, bodyBytes } = await fetchJsonWithDiagnostics(`${baseUrl}/embeddings`, { model, input: text }, headers, "向量 API ");
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Embedding API 请求失败：${response.status} ${detail.slice(0, 300)}\n请求地址：${safeEndpointLabel(`${baseUrl}/embeddings`)}\n请求体大小：${formatBytes(bodyBytes)}`);
  }
  const data = await response.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) throw new Error("Embedding API 返回格式不正确");
  return embedding;
}

async function getEmbedding(text, apiConfig) {
  try {
    const remote = await remoteEmbedding(text, apiConfig);
    if (remote) return { vector: remote, source: "api", warning: "" };
  } catch (error) {
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
  const fallback = { version: 1, updatedAt: nowIso(), vectors: [] };
  const store = await readJson(getVectorsPath(projectPath), fallback);
  store.vectors = Array.isArray(store.vectors) ? store.vectors : [];
  return store;
}

async function saveVectorStore(projectPath, store) {
  store.updatedAt = nowIso();
  await writeJson(getVectorsPath(projectPath), store);
}

async function indexSource(projectPath, source) {
  return indexSources(projectPath, [source]);
}

async function buildIndexEntries(source, config, characterNames) {
  const indexContent = contentToPlainText(source.content);
  const chunks = chunkText(indexContent);
  const embeddings = await mapWithConcurrency(chunks, EMBEDDING_INDEX_CONCURRENCY, (chunk) => getEmbedding(chunk.text, config.api));
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
      updatedAt: nowIso(),
    };
  });
}

async function indexSources(projectPath, sources) {
  const safeSources = Array.isArray(sources) ? sources.filter(Boolean) : [];
  if (!safeSources.length) {
    const store = await loadVectorStore(projectPath);
    return { chunks: 0, totalChunks: store.vectors.length };
  }
  const config = await loadConfig(projectPath);
  const characters = await loadCharacters(projectPath);
  const characterNames = characters.map((item) => item.name).filter(Boolean);
  const store = await loadVectorStore(projectPath);
  const sourceIds = new Set(safeSources.map((source) => source.id));
  store.vectors = store.vectors.filter((item) => !sourceIds.has(item.sourceId));

  let indexedChunks = 0;
  for (const source of safeSources) {
    const entries = await buildIndexEntries(source, config, characterNames);
    indexedChunks += entries.length;
    store.vectors.push(...entries);
  }

  await saveVectorStore(projectPath, store);
  return { chunks: indexedChunks, totalChunks: store.vectors.length };
}

async function removeSourceFromIndex(projectPath, sourceId) {
  const store = await loadVectorStore(projectPath);
  store.vectors = store.vectors.filter((item) => item.sourceId !== sourceId);
  await saveVectorStore(projectPath, store);
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

async function rebuildIndex(projectPath) {
  const config = await loadConfig(projectPath);
  const sources = [];
  sendRendererEvent("index:progress", { active: true, phase: "整理章节", current: 0, total: config.chapters.length, detail: "" });

  for (let index = 0; index < config.chapters.length; index += 1) {
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

  await saveVectorStore(projectPath, { version: 1, updatedAt: nowIso(), vectors: [] });
  const estimatedChunks = sources.reduce((sum, source) => sum + chunkText(contentToPlainText(source.content || "")).length, 0);
  sendRendererEvent("index:progress", { active: true, phase: "建立知识库", current: 0, total: estimatedChunks, detail: `预计 ${estimatedChunks} 个片段，${sources.length} 个来源` });
  const result = await indexSources(projectPath, sources);
  sendRendererEvent("index:progress", { active: false, phase: "完成", current: result.totalChunks, total: result.totalChunks, detail: `${result.totalChunks} 个片段` });
  return { chunks: result.totalChunks };
}

async function searchRelevantChunks(projectPath, question, topK, options = {}) {
  const config = await loadConfig(projectPath);
  const store = await loadVectorStore(projectPath);
  const embedding = await getEmbedding(question, config.api);
  const safeTopK = Math.floor(clampNumber(topK, 1, MAX_RETRIEVAL_TOP_K, 5));
  const safeScanLimit = Math.floor(clampNumber(options.scanLimit || config.api.scanK || Math.max(safeTopK * 4, DEFAULT_RETRIEVAL_SCAN_K), safeTopK, MAX_RETRIEVAL_SCAN_K, DEFAULT_RETRIEVAL_SCAN_K));
  const sourceIds = new Set((Array.isArray(options.sourceIds) ? options.sourceIds : []).map((id) => String(id || "")).filter(Boolean));
  const candidates = store.vectors
    .map((item) => {
      const vectorScore = cosineSimilarity(embedding.vector, item.embedding || []);
      const keywordScore = lexicalRelevanceScore(item, question);
      return { ...item, score: vectorScore + keywordScore, vectorScore, keywordScore };
    })
    .filter((item) => !sourceIds.size || sourceIds.has(item.sourceId))
    .sort((a, b) => b.score - a.score)
    .slice(0, safeScanLimit);
  const chunks = selectUsefulChunks(candidates, {
    maxChunks: safeTopK,
    minKeep: options.minKeep,
    minScore: options.minScore,
    maxChars: options.maxChars,
  });
  return { chunks, candidateCount: candidates.length, scannedCount: store.vectors.length, embeddingSource: embedding.source, embeddingWarning: embedding.warning };
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

function buildSystemPrompt({ retrievedContext, characterCards, worldbuilding, sourceCatalog, projectMemory, userQuestion, selectedText, retrieval, inventorySummary }) {
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

function buildInventorySummary(config, characters, worldDocs, store) {
  const chunkCounts = countBySourceId(store?.vectors || []);
  const chapters = (config.chapters || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const chapterLines = (role) =>
    chapters
      .filter((chapter) => getKnowledgeRole(chapter) === role)
      .map((chapter) => `- ${chapter.volume || "未分卷"}｜${chapter.title}｜${chunkCounts.get(chapter.id) || 0} 片段`)
      .join("\n") || "- 无";
  const characterLines = (characters || []).map((card) => `- ${card.name}｜${normalizeCategory(card.category)}｜${chunkCounts.get(card.id) || 0} 片段`).join("\n") || "- 无";
  const worldLines = (worldDocs || []).map((doc) => `- ${doc.title}｜${normalizeCategory(doc.category)}｜${chunkCounts.get(doc.id) || 0} 片段`).join("\n") || "- 无";
  return [
    `知识库总片段：${(store?.vectors || []).length}`,
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

function appendCoverageChunks(chunks, store, sourceIds, maxChunks) {
  const selected = Array.isArray(chunks) ? chunks.slice() : [];
  const existingChunkIds = new Set(selected.map((item) => item.id));
  const existingSourceIds = new Set(selected.map((item) => item.sourceId));
  for (const sourceId of sourceIds) {
    if (selected.length >= maxChunks) break;
    if (existingSourceIds.has(sourceId)) continue;
    const entry = (store.vectors || []).find((item) => item.sourceId === sourceId && !existingChunkIds.has(item.id));
    if (!entry) continue;
    selected.push({
      ...entry,
      score: Number(entry.score || 0.001),
      vectorScore: Number(entry.vectorScore || 0),
      keywordScore: Number(entry.keywordScore || 0),
    });
    existingChunkIds.add(entry.id);
    existingSourceIds.add(sourceId);
  }
  return selected;
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
    categoryCounts,
    notes: options.notes || [],
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
    knowledgeRole: item.knowledgeRole,
    volume: item.volume,
    category: item.category,
    text: item.text,
    metadata: item.metadata,
  }));
}

async function buildChatRetrievalPackage(projectPath, config, payload, question) {
  const requestedMode = normalizeRetrievalMode(payload?.retrievalMode || "auto");
  const selectedChapterId = String(payload?.selectedChapterId || "");
  const characters = await loadCharacters(projectPath);
  const worldDocs = await loadWorldDocs(projectPath);
  const store = await loadVectorStore(projectPath);
  let mode = classifyRetrievalMode(question, requestedMode, config, selectedChapterId);
  const mentionedEntityIds = findMentionedSourceIds(question, characters, worldDocs);
  if (mode === "normal" && requestedMode === "auto" && mentionedEntityIds.length) mode = "entity";
  const sendLimit = Math.floor(clampNumber(config.api.topK || 120, 1, MAX_RETRIEVAL_TOP_K, 120));
  const scanLimit = Math.floor(clampNumber(config.api.scanK || DEFAULT_RETRIEVAL_SCAN_K, sendLimit, MAX_RETRIEVAL_SCAN_K, DEFAULT_RETRIEVAL_SCAN_K));
  const notes = [];
  let sourceIds = [];
  let searchQuestion = question;
  let minKeep = Math.min(CHAT_CONTEXT_MIN_CHUNKS, sendLimit);
  let maxChars = CHAT_CONTEXT_CHAR_BUDGET;
  let catalogUsed = true;
  let inventoryUsed = false;

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

  const search = await searchRelevantChunks(projectPath, searchQuestion, sendLimit, {
    sourceIds,
    scanLimit,
    minKeep,
    maxChars,
  });
  let chunks = search.chunks;
  if (mode === "book") {
    const bodyIds = (config.chapters || []).filter((chapter) => getKnowledgeRole(chapter) === "正文").map((chapter) => chapter.id);
    chunks = appendCoverageChunks(chunks, store, bodyIds, sendLimit);
  }
  if (mode === "chapter" || mode === "current") {
    chunks = appendCoverageChunks(chunks, store, sourceIds, sendLimit);
  }
  const materials = await collectPromptMaterials(projectPath, chunks, question);
  const inventorySummary = buildInventorySummary(config, characters, worldDocs, store);
  const retrieval = summarizeRetrieval(chunks, config, characters, worldDocs, mode, requestedMode, search, {
    scanLimit,
    sendLimit,
    catalogUsed,
    inventoryUsed,
    notes,
  });
  return { search: { ...search, chunks }, materials, retrieval, inventorySummary };
}

async function callChatApi(config, systemPrompt, question, history = []) {
  const api = config.api || {};
  const apiKey = decodeSecret(api.apiKey);
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
  const { response, bodyBytes } = await fetchJsonWithDiagnostics(`${baseUrl}/chat/completions`, payload, headers, "聊天 API ");
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`聊天 API 请求失败：${response.status} ${detail.slice(0, 400)}\n请求地址：${safeEndpointLabel(`${baseUrl}/chat/completions`)}\n请求体大小：${formatBytes(bodyBytes)}`);
  }
  const data = await response.json();
  const answer = data?.choices?.[0]?.message?.content || data?.message?.content || "";
  return answer.trim() || "模型返回了空内容。";
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

async function buildAiTimelineEvents(projectPath, options = {}) {
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
  const answer = await callChatApi(materials.config, systemPrompt, question, []);
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

async function analyzeConsistency(projectPath, options = {}) {
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
    const answer = await callChatApi(materials.config, systemPrompt, question, []);
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

async function buildCreativeAdvice(projectPath, options = {}) {
  const mode = normalizeCreativeAdviceMode(options.mode);
  const focus = String(options.focus || "").trim().slice(0, 1200);
  const config = await loadConfig(projectPath);
  const ordered = config.chapters.slice().sort((a, b) => a.order - b.order);
  const selectedIndex = Math.max(0, ordered.findIndex((chapter) => chapter.id === options.chapterId));
  const chapter = ordered[selectedIndex] || ordered[0];
  if (!chapter) throw new Error("当前项目还没有可分析的章节。");
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
  const query = [modeQuestion, chapter.title, nextChapter?.title || "", focus].filter(Boolean).join(" ");
  const topK = Math.floor(clampNumber(config.api.topK || 40, 1, MAX_RETRIEVAL_TOP_K, 40));
  const search = await searchRelevantChunks(projectPath, query, topK, {
    minKeep: Math.min(24, topK),
    maxChars: STRUCTURING_CONTEXT_CHAR_BUDGET,
  });
  const retrieved = search.chunks
    .map((item, index) => {
      const role = item.sourceType === "chapter" ? knowledgeRoleLabel(item.knowledgeRole) : item.sourceType === "character" ? "角色卡" : "世界观";
      const group = item.volume || item.category || "";
      return `【检索片段${index + 1}｜${role}${group ? `｜${group}` : ""}｜${item.title}】\n${item.text}`;
    })
    .join("\n\n");
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

【当前章节】
${chapter.volume || "未分卷"} / ${chapter.title}
${currentText || "暂无正文"}

【上一章参考】
${previousChapter ? `${previousChapter.volume || "未分卷"} / ${previousChapter.title}\n${previousText}` : "无"}

【下一条目录参考】
${nextChapter ? `${nextChapter.volume || "未分卷"} / ${nextChapter.title}\n${nextText}` : "无"}

【项目大纲文档】
${outlineTitles || "未显式标记大纲文档"}

【检索片段】
${retrieved || "无"}`;
  try {
    const answer = await callChatApi(config, systemPrompt, question, []);
    const items = normalizeCreativeAdvicePayload(extractJsonFromModelText(answer), mode, chapter);
    if (!items.length) throw new Error("AI 没有返回可识别的建议卡片。");
    return {
      mode,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      generatedAt: nowIso(),
      contextCount: search.chunks.length,
      apiError: "",
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
      items: buildLocalCreativeAdvice(mode, chapter, nextChapter, focus),
    };
  }
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

function stripMarkdown(text) {
  return contentToPlainText(text);
}

function textRunsFromMarkdown(text, options = {}) {
  const clean = stripMarkdown(text);
  if (!clean) return [new TextRun({ text: "" })];
  return [
    new TextRun({
      text: clean,
      bold: Boolean(options.bold),
      italics: Boolean(options.italics),
      size: options.size,
    }),
  ];
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
      .map((cell) => stripMarkdown(cell)),
  );
  return { rows, nextIndex: index };
}

function markdownToDocxChildren(markdown) {
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
                            text: row[cellIndex] || "",
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
          children: textRunsFromMarkdown(heading[2], { bold: true }),
        }),
      );
      continue;
    }

    const quote = trimmed.match(/^>\s*(.+)$/);
    if (quote) {
      children.push(
        new Paragraph({
          indent: { left: 420 },
          children: textRunsFromMarkdown(quote[1], { italics: true }),
        }),
      );
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: textRunsFromMarkdown(bullet[1]),
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
        children: textRunsFromMarkdown(trimmed),
      }),
    );
  }

  return children.length ? children : [new Paragraph({ text: "" })];
}

function normalizeHtmlText(text) {
  return decodeBasicEntities(String(text || "").replace(/\s+/g, " ")).trim();
}

function htmlInlineRuns(node, options = {}) {
  const runs = [];
  const children = node.childNodes || [];
  if (!children.length) {
    const text = normalizeHtmlText(node.text || node.rawText || "");
    return text ? [new TextRun({ text, bold: options.bold, italics: options.italics, underline: options.underline })] : [];
  }
  for (const child of children) {
    if (child.nodeType === 3) {
      const text = normalizeHtmlText(child.rawText || child.text || "");
      if (text) runs.push(new TextRun({ text, bold: options.bold, italics: options.italics, underline: options.underline }));
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
      }),
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
    return new ImageRun({
      data: buffer,
      transformation: { width: 560, height: 320 },
    });
  } catch {
    return null;
  }
}

async function htmlNodeToDocxBlocks(node) {
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
    return [new Paragraph({ heading: headingMap[level], children: htmlInlineRuns(node, { bold: true }) })];
  }

  if (tag === "table") {
    const rows = node.querySelectorAll("tr").map((row) => {
      const cells = row.querySelectorAll("th,td");
      const columnCount = Math.max(1, cells.length);
      return new TableRow({
        children: cells.map(
          (cell) =>
            new TableCell({
              width: { size: Math.floor(100 / columnCount), type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({
                  children: htmlInlineRuns(cell, { bold: String(cell.rawTagName || cell.tagName).toLowerCase() === "th" }),
                }),
              ],
            }),
        ),
      });
    });
    return rows.length
      ? [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
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
          children: htmlInlineRuns(li),
        }),
      );
    }
    return blocks;
  }

  if (tag === "blockquote") {
    return [
      new Paragraph({
        indent: { left: 420 },
        children: htmlInlineRuns(node, { italics: true }),
      }),
    ];
  }

  if (tag === "img") {
    const imageRun = await imageRunFromHtmlNode(node);
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: imageRun ? [imageRun] : [new TextRun({ text: node.getAttribute?.("alt") || "图片", italics: true })],
      }),
    ];
  }

  if (tag === "p" || tag === "div") {
    const images = node.querySelectorAll("img");
    if (images.length === 1 && normalizeHtmlText(node.text || "") === "") {
      const imageRun = await imageRunFromHtmlNode(images[0]);
      return [new Paragraph({ alignment: AlignmentType.CENTER, children: imageRun ? [imageRun] : [new TextRun({ text: "图片" })] })];
    }
    const runs = htmlInlineRuns(node);
    return runs.length ? [new Paragraph({ spacing: { after: 160 }, children: runs })] : [new Paragraph({ text: "" })];
  }

  for (const child of node.childNodes || []) {
    blocks.push(...(await htmlNodeToDocxBlocks(child)));
  }
  return blocks;
}

async function htmlToDocxChildren(html) {
  const root = parseHtml(promoteMarkdownHeadingsInHtml(String(html || "")));
  const blocks = [];
  for (const child of root.childNodes) {
    blocks.push(...(await htmlNodeToDocxBlocks(child)));
  }
  return blocks.length ? blocks : [new Paragraph({ text: "" })];
}

async function exportChapterToDocx(projectPath, chapter, targetFile) {
  const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8");
  if (isHtmlContent(content)) {
    const children = await htmlToDocxChildren(content);
    const doc = new Document({
      creator: "AI小说创作平台",
      title: chapter.title,
      description: "由 AI小说创作平台导出的富文档",
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
  const doc = new Document({
    creator: "AI小说创作平台",
    title: chapter.title,
    description: "由 AI小说创作平台导出的章节文档",
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: markdownToDocxChildren(content),
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(targetFile, buffer);
  return targetFile;
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
      children: [new TextRun({ text: config.title || "未命名小说", bold: true, size: 36 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: config.author ? `作者：${config.author}` : "由 AI小说创作平台导出", size: 22 })],
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
          children: [new TextRun({ text: volume, bold: true })],
        }),
      );
    }
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: chapter.title || "未命名章节", bold: true })],
      }),
    );
    const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
    const blocks = await chapterContentToDocxChildren(content);
    children.push(...blocks, new Paragraph({ text: "" }));
  }
  if (options.includeOutline) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun({ text: "大纲目录", bold: true })] }));
    for (const chapter of outlineChapters) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: `${chapter.volume || "未分卷"} / ${chapter.title}`, bold: true })] }));
      const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
      const blocks = await chapterContentToDocxChildren(content);
      children.push(...blocks, new Paragraph({ text: "" }));
    }
    if (bodyChapters.some((chapter) => chapter.outline?.length)) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "正文小标题目录", bold: true })] }));
    }
    for (const chapter of bodyChapters) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: `${chapter.volume || "未分卷"} / ${chapter.title}`, bold: true })] }));
      for (const item of chapter.outline || []) {
        children.push(
          new Paragraph({
            indent: { left: Math.max(0, (Number(item.level || 1) - 1) * 260) },
            children: [new TextRun({ text: `${"  ".repeat(Math.max(0, Number(item.level || 1) - 1))}${item.title}` })],
          }),
        );
      }
    }
  }
  if (options.includeCharacters) {
    const characters = await loadCharacters(projectPath);
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun({ text: "角色卡片", bold: true })] }));
    for (const card of characters) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: card.name, bold: true })] }));
      children.push(...markdownToDocxChildren(characterToMarkdown(card)));
    }
  }
  if (options.includeWorld) {
    const worldDocs = await loadWorldDocs(projectPath);
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun({ text: "世界观资料", bold: true })] }));
    for (const doc of worldDocs) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: `${doc.category || "未分类"} / ${doc.title}`, bold: true })] }));
      children.push(...markdownToDocxChildren(doc.content));
    }
  }
  const doc = new Document({
    creator: "AI小说创作平台",
    title: config.title,
    description: "由 AI小说创作平台导出的整书 Word 文档",
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

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
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
        { label: "导出整书为Word", click: () => sendMenuAction("exportBookDocx") },
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
  return currentProjectPath;
}

function registerIpcHandlers() {
  ipcMain.handle("app:get-state", async () => {
    const projectPath = await ensureCurrentProject();
    return buildAppState(projectPath);
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
        imported.push(...(await importDocumentIntoProject(projectPath, filePath, { volume: targetVolume || "导入文档", config, skipFinalize: true })));
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
    const nextConfig = configFromRenderer(config, payload || {});
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

  ipcMain.handle("project:export-book-docx", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "导出整本小说为 Word 文档",
      defaultPath: path.join(projectPath, `${sanitizeFileName(config.title || "整本小说")}_整书.docx`),
      filters: [{ name: "Word 文档", extensions: ["docx"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const filePath = await exportBookToDocx(projectPath, result.filePath, payload || {});
    return { filePath };
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
    const config = await loadConfig(projectPath);
    const chapter = config.chapters.find((item) => item.id === payload.chapterId);
    if (!chapter) throw new Error("章节不存在，无法保存。");
    let filePath = getChapterPath(projectPath, chapter);
    const previousContent = await fs.readFile(filePath, "utf8").catch(() => "");
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

    if (config.ui.backupOnSave) {
      await createBackup(projectPath).catch(() => null);
    }

    return {
      chapter,
      config: configForRenderer(config),
      indexResult,
      vectorStats: { chunks: indexResult.totalChunks, updatedAt: nowIso() },
    };
  });

  ipcMain.handle("chapter:delete", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const chapter = config.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在，无法删除。");
    if (config.chapters.length <= 1) throw new Error("至少需要保留一个章节。");
    const hasOtherChapterUsingFile = config.chapters.some(
      (item) => item.id !== chapterId && normalizeChapterFileName(item.fileName) === normalizeChapterFileName(chapter.fileName),
    );
    if (!hasOtherChapterUsingFile) {
      await fs.rm(getChapterPath(projectPath, chapter), { force: true });
    }
    config.chapters = config.chapters.filter((item) => item.id !== chapterId).map((item, index) => ({ ...item, order: index }));
    await removeSourceFromIndex(projectPath, chapterId);
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

  ipcMain.handle("chapter:reorder", async (_event, chapterIds) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const idOrder = new Map(chapterIds.map((id, index) => [id, index]));
    config.chapters = config.chapters
      .slice()
      .sort((a, b) => (idOrder.get(a.id) ?? a.order) - (idOrder.get(b.id) ?? b.order))
      .map((item, index) => ({ ...item, order: index }));
    await saveConfig(projectPath, config);
    return { chapters: config.chapters };
  });

  ipcMain.handle("chapter:move-to-volume", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
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
    return generateCharactersFromOutline(projectPath);
  });

  ipcMain.handle("ai:generate-world", async () => {
    const projectPath = await ensureCurrentProject();
    return generateWorldDocsFromOutline(projectPath);
  });

  ipcMain.handle("ai:extract-world-cards", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return prepareWorldCardCandidates(projectPath, payload || {});
  });

  ipcMain.handle("ai:save-world-card-candidates", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
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
    const retrievalPackage = await buildChatRetrievalPackage(projectPath, config, payload || {}, question);
    const { search, materials, retrieval, inventorySummary } = retrievalPackage;
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

    try {
      const answer = await callChatApi(config, systemPrompt, question, payload.history || []);
      return {
        answer,
        context: contextFromChunks(search.chunks),
        retrieval,
        contextCount: search.chunks.length,
        candidateCount: search.candidateCount || search.chunks.length,
        scannedCount: search.scannedCount || search.candidateCount || search.chunks.length,
        embeddingSource: search.embeddingSource,
        embeddingWarning: search.embeddingWarning,
      };
    } catch (error) {
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
    }
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
    exportBookToDocx,
    generateCharactersFromOutline,
    getChapterPath,
    getConfigPath,
    getKnowledgeRole,
    importDocumentIntoProject,
    indexSource,
    indexSources,
    loadAnalysisState,
    loadCharacters,
    loadConfig,
    loadVectorStore,
    loadWorldDocs,
    prepareWorldCardCandidates,
    rebuildIndex,
    saveConfig,
    saveAnalysisState,
    saveWorldCardCandidates,
    searchRelevantChunks,
  };
} else {
  app.whenReady().then(async () => {
    app.setName("AI小说创作平台");
    setChineseApplicationMenu();
    registerIpcHandlers();
    currentProjectPath = await getDefaultProjectPath();
    await ensureProjectStructure(currentProjectPath);
    await createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
