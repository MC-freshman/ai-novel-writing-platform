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
const MAX_RETRIEVAL_TOP_K = 250;
const DEFAULT_CATEGORY = "未分类";
const EMBEDDING_INDEX_CONCURRENCY = 4;

let mainWindow;
let currentProjectPath = "";

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
  if (!value) return "";
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return "";
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

function getConfigPath(projectPath) {
  return path.join(projectPath, "novel.config.json");
}

function getVectorsPath(projectPath) {
  return path.join(projectPath, "vector_db", "vectors.json");
}

function getChapterPath(projectPath, chapter) {
  return path.join(projectPath, "chapters", chapter.fileName);
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
  return path.join(projectPath, "characters", `${sanitizeFileName(card.name || card.id)}.json`);
}

function getWorldDocPath(projectPath, doc) {
  return path.join(projectPath, "worldbuilding", doc.fileName);
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
  return path.join(projectPath, "backups", "versions", chapterId);
}

function getChapterVersionContentPath(projectPath, chapterId, version) {
  return path.join(getChapterVersionDir(projectPath, chapterId), version.fileName);
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
    await fs.rm(path.join(versionDir, oldVersion.fileName), { force: true }).catch(() => null);
    await fs.rm(path.join(versionDir, `${oldVersion.id}.json`), { force: true }).catch(() => null);
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
    if (version?.id && version?.fileName) versions.push(version);
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
      topK: 5,
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
  const config = await readJson(getConfigPath(projectPath), defaultConfig());
  config.chapters = Array.isArray(config.chapters) ? config.chapters : [];
  config.api = { ...defaultConfig().api, ...(config.api || {}) };
  config.ui = { ...defaultConfig().ui, ...(config.ui || {}) };
  config.stats = { ...defaultConfig().stats, ...(config.stats || {}) };
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
  const nextTopK = Math.floor(clampNumber(api.topK ?? existingConfig.api.topK, 1, MAX_RETRIEVAL_TOP_K, 5));
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
  const chapterDir = path.join(projectPath, "chapters");
  const order = config.chapters.length;
  const fileName = await uniqueFileName(chapterDir, `document_${String(order + 1).padStart(3, "0")}_${converted.title}`, ".html");
  const volume = String(options.volume || "").trim() || "导入文档";
  const chapter = {
    id: makeId("chapter"),
    title: converted.title,
    volume,
    order,
    fileName,
    wordCount: countWords(converted.content),
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
    chapter.fileName = await uniqueFileName(chapterDir, baseName, ".html");
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
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, input: text }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Embedding API 请求失败：${response.status} ${detail.slice(0, 300)}`);
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

async function rebuildIndex(projectPath) {
  const config = await loadConfig(projectPath);
  const sources = [];

  for (const chapter of config.chapters) {
    const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
    sources.push({
      id: chapter.id,
      type: "chapter",
      title: chapter.title,
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
  const result = await indexSources(projectPath, sources);
  return { chunks: result.totalChunks };
}

async function searchRelevantChunks(projectPath, question, topK) {
  const config = await loadConfig(projectPath);
  const store = await loadVectorStore(projectPath);
  const embedding = await getEmbedding(question, config.api);
  const safeTopK = Math.floor(clampNumber(topK, 1, MAX_RETRIEVAL_TOP_K, 5));
  const scored = store.vectors
    .map((item) => ({ ...item, score: cosineSimilarity(embedding.vector, item.embedding || []) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, safeTopK);
  return { chunks: scored, embeddingSource: embedding.source, embeddingWarning: embedding.warning };
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

async function collectPromptMaterials(projectPath, retrievedChunks) {
  const characters = await loadCharacters(projectPath);
  const worldDocs = await loadWorldDocs(projectPath);
  const characterCards = characters.map(characterToMarkdown).join("\n\n").slice(0, 12000);
  const worldbuilding = worldDocs.map((doc) => `# ${doc.title}\n分类：${normalizeCategory(doc.category)}\n${doc.content}`).join("\n\n").slice(0, 12000);
  const retrievedContext = retrievedChunks
    .map((item, index) => {
      const sourceName = item.sourceType === "chapter" ? "章节" : item.sourceType === "character" ? "角色卡" : "世界观";
      return `【片段${index + 1}｜${sourceName}｜${item.title}｜相关度 ${item.score.toFixed(3)}】\n${item.text}`;
    })
    .join("\n\n");
  return { characterCards, worldbuilding, retrievedContext };
}

function buildSystemPrompt({ retrievedContext, characterCards, worldbuilding, userQuestion, selectedText }) {
  const selected = selectedText
    ? `\n【用户选中的文本】\n"""\n${selectedText}\n"""\n`
    : "";
  return `你是一位专业的小说创作助手。用户正在创作一部小说，你将基于小说的已有内容为其提供建议。

【检索到的小说内容】
${retrievedContext || "没有检索到相关片段。"}

【角色设定】
${characterCards || "暂无角色设定。"}

【世界观设定】
${worldbuilding || "暂无世界观设定。"}
${selected}
规则：
1. 你的回答必须基于上述提供的小说内容，不要编造未出现的信息。
2. 如果用户的问题在提供的内容中没有答案，请明确说明“根据已有内容，暂时无法回答这个问题”。
3. 回答时可以引用具体的章节或段落。
4. 如果用户要求创作建议，请结合小说的风格、角色性格和已有情节给出建议。
5. 保持专业、鼓励性的语气。

用户问题：${userQuestion}`;
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
    const response = await fetch(`${baseUrl || "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: "user", content: question }],
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Claude API 请求失败：${response.status} ${detail.slice(0, 400)}`);
    }
    const data = await response.json();
    const text = (data.content || []).map((item) => item.text || "").join("\n").trim();
    return text || "Claude 返回了空内容。";
  }

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const safeHistory = history
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-8)
    .map((item) => ({ role: item.role, content: item.content }));

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: systemPrompt }, ...safeHistory, { role: "user", content: question }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`聊天 API 请求失败：${response.status} ${detail.slice(0, 400)}`);
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

async function collectOutlineCorpus(projectPath, maxChars = 80000) {
  const config = await loadConfig(projectPath);
  const parts = [];
  for (const chapter of config.chapters.slice().sort((a, b) => a.order - b.order)) {
    const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
    const plain = contentToPlainText(content);
    if (!plain) continue;
    parts.push(`【${chapter.volume || "未分卷"}｜${chapter.title}】\n${plain}`);
  }
  const full = parts.join("\n\n");
  if (full.length <= maxChars) return full;
  const head = full.slice(0, Math.floor(maxChars * 0.7));
  const tail = full.slice(-Math.floor(maxChars * 0.3));
  return `${head}\n\n【中间内容过长，已截断，以下为文档后段】\n\n${tail}`;
}

async function buildStructuringMaterials(projectPath, query) {
  const config = await loadConfig(projectPath);
  const topK = Math.floor(clampNumber(config.api.topK || 20, 1, MAX_RETRIEVAL_TOP_K, 20));
  const search = await searchRelevantChunks(projectPath, query, topK);
  const retrieved = search.chunks.map((item, index) => `【检索片段${index + 1}｜${item.title}】\n${item.text}`).join("\n\n");
  const corpus = await collectOutlineCorpus(projectPath);
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
    const card = {
      id: previous?.id || makeId("character"),
      name: item.name,
      category: normalizeCategory(item.category || previous?.category),
      appearance: item.appearance || previous?.appearance || "",
      personality: item.personality || previous?.personality || "",
      background: item.background || previous?.background || "",
      relationships: item.relationships || previous?.relationships || "",
      notes: item.notes || previous?.notes || "",
      updatedAt: nowIso(),
    };
    if (previous?.fileName) card.fileName = previous.fileName;
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
    const doc = {
      id: previous?.id || sanitizeFileName(item.title),
      title: item.title,
      category: normalizeCategory(item.category || previous?.category),
      fileName: previous?.fileName || `${sanitizeFileName(item.title)}.md`,
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

async function buildTimelineEvents(projectPath) {
  const { chapters, characters } = await loadProjectSources(projectPath);
  const characterNames = characters.map((item) => item.name).filter(Boolean);
  const events = [];
  let order = 0;

  for (const chapter of chapters) {
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

  return { events: events.slice(0, 300) };
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

async function buildRelationshipGraph(projectPath) {
  const { chapters, characters } = await loadProjectSources(projectPath);
  const names = characters.map((item) => item.name).filter(Boolean);
  const mentionCounts = new Map(names.map((name) => [name, 0]));
  const edgeMap = new Map();

  for (const card of characters) {
    const relationshipText = String(card.relationships || "");
    for (const target of names) {
      if (target !== card.name && relationshipText.includes(target)) {
        addRelationEdge(edgeMap, card.name, target, 4, "关系设定", relationshipText.slice(0, 120));
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
          addRelationEdge(edgeMap, present[i], present[j], 1, "同场", `《${chapter.title}》：${paragraph.slice(0, 120)}`);
        }
      }
    }
  }

  const nodes = characters.map((card) => ({
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
  return { nodes, edges };
}

function normalizeConsistencyIssues(payload) {
  const items = Array.isArray(payload?.issues) ? payload.issues : [];
  return items
    .map((item, index) => ({
      id: String(item.id || `ai_issue_${index}`),
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

async function buildLocalConsistencyIssues(projectPath) {
  const { chapters, characters, worldDocs } = await loadProjectSources(projectPath);
  const issues = [];
  const titleMap = new Map();
  for (const chapter of chapters) {
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
  for (const card of characters) {
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
  for (const doc of worldDocs) {
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

async function analyzeConsistency(projectPath) {
  const localIssues = await buildLocalConsistencyIssues(projectPath);
  const materials = await buildStructuringMaterials(projectPath, "设定矛盾 时间线 冲突 角色 动机 世界规则 前后不一致");
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
    return { issues, contextCount: materials.search.chunks.length, apiError: "" };
  } catch (error) {
    return { issues: localIssues, contextCount: materials.search.chunks.length, apiError: error.message || String(error) };
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

async function extractWorldCardsFromOutline(projectPath) {
  const materials = await buildStructuringMaterials(projectPath, "地点 城市 国家 大陆 势力 组织 家族 教会 物品 神器 道具 材料");
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
  if (!generated.length) throw new Error("AI 没有生成可写入的地点、势力或物品条目。");

  let created = 0;
  let updated = 0;
  const indexedSources = [];
  const existingByTitle = new Map(existing.map((item) => [item.title, item]));
  for (const item of generated) {
    const previous = existingByTitle.get(item.title);
    const fileName = previous?.fileName || (await uniqueFileName(path.join(projectPath, "worldbuilding"), item.title, ".md"));
    const doc = {
      id: previous?.id || fileName.replace(/\.md$/i, ""),
      title: item.title,
      category: normalizeCategory(item.category || previous?.category),
      fileName,
      content: item.content,
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
    count: generated.length,
    titles: generated.map((item) => item.title),
    contextCount: materials.search.chunks.length,
  };
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

async function exportBookToDocx(projectPath, targetFile) {
  const config = await loadConfig(projectPath);
  const chapters = config.chapters.slice().sort((a, b) => a.order - b.order);
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
  for (const chapter of chapters) {
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
    for (const filePath of result.filePaths) {
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
      await indexSources(
        projectPath,
        imported.map((item) => item.source),
      );
    }
    const state = await buildAppState(projectPath, imported[imported.length - 1]?.chapter.id);
    return {
      ...state,
      importSummary: {
        total: result.filePaths.length,
        imported: imported.length,
        failed: failures.length,
        failures,
      },
    };
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

  ipcMain.handle("project:export-book-docx", async () => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "导出整本小说为 Word 文档",
      defaultPath: path.join(projectPath, `${sanitizeFileName(config.title || "整本小说")}_整书.docx`),
      filters: [{ name: "Word 文档", extensions: ["docx"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const filePath = await exportBookToDocx(projectPath, result.filePath);
    return { filePath };
  });

  ipcMain.handle("global:search", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return globalSearch(projectPath, payload?.query || "");
  });

  ipcMain.handle("analysis:timeline", async () => {
    const projectPath = await ensureCurrentProject();
    return buildTimelineEvents(projectPath);
  });

  ipcMain.handle("analysis:relationships", async () => {
    const projectPath = await ensureCurrentProject();
    return buildRelationshipGraph(projectPath);
  });

  ipcMain.handle("analysis:consistency", async () => {
    const projectPath = await ensureCurrentProject();
    return analyzeConsistency(projectPath);
  });

  ipcMain.handle("chapter:create", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const order = config.chapters.length;
    const title = payload?.title?.trim() || `第${order + 1}章 新章节`;
    const chapter = {
      id: makeId("chapter"),
      title,
      volume: payload?.volume || "卷一",
      order,
      fileName: `chapter_${String(order + 1).padStart(3, "0")}_${sanitizeFileName(title)}.md`,
      wordCount: 0,
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
    const filePath = getChapterPath(projectPath, chapter);
    const previousContent = await fs.readFile(filePath, "utf8").catch(() => "");
    const previousWords = countWords(previousContent);
    const nextContent = String(payload.content ?? "");
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
    await fs.rm(getChapterPath(projectPath, chapter), { force: true });
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
    const card = {
      id: payload.id || makeId("character"),
      name: payload.name || "未命名角色",
      category: normalizeCategory(payload.category),
      appearance: payload.appearance || "",
      personality: payload.personality || "",
      background: payload.background || "",
      relationships: payload.relationships || "",
      notes: payload.notes || "",
      updatedAt: nowIso(),
    };
    const nextPath = getCharacterPath(projectPath, card);
    // 角色改名会改变文件名，保存前清理旧文件，避免同一角色出现重复卡片。
    if (payload.fileName && path.basename(nextPath) !== payload.fileName) {
      await fs.rm(path.join(projectPath, "characters", payload.fileName), { force: true });
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
    if (card) await fs.rm(path.join(projectPath, "characters", card.fileName), { force: true });
    await removeSourceFromIndex(projectPath, characterId);
    return buildAppState(projectPath);
  });

  ipcMain.handle("world:save", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const title = payload.title || "未命名设定";
    const doc = {
      id: payload.id || sanitizeFileName(title),
      title,
      category: normalizeCategory(payload.category),
      fileName: payload.fileName || `${sanitizeFileName(title)}.md`,
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

  ipcMain.handle("ai:extract-world-cards", async () => {
    const projectPath = await ensureCurrentProject();
    return extractWorldCardsFromOutline(projectPath);
  });

  ipcMain.handle("ai:ask", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const question = String(payload.question || "").trim();
    if (!question) throw new Error("请输入要询问 AI 的内容。");
    const topK = Math.floor(clampNumber(config.api.topK || 5, 1, MAX_RETRIEVAL_TOP_K, 5));
    const search = await searchRelevantChunks(projectPath, question, topK);
    const materials = await collectPromptMaterials(projectPath, search.chunks);
    const systemPrompt = buildSystemPrompt({
      ...materials,
      userQuestion: question,
      selectedText: payload.selectedText || "",
    });

    try {
      const answer = await callChatApi(config, systemPrompt, question, payload.history || []);
      return {
        answer,
        context: search.chunks.map((item) => ({
          id: item.id,
          title: item.title,
          sourceType: item.sourceType,
          score: item.score,
          text: item.text,
          metadata: item.metadata,
        })),
        embeddingSource: search.embeddingSource,
        embeddingWarning: search.embeddingWarning,
      };
    } catch (error) {
      return {
        answer: `我已经完成本地检索，但暂时没有成功连接到大模型接口。\n\n${error.message}\n\n你可以先查看下方“引用片段”，确认知识库是否已经索引成功。配置接口后再次提问即可获得模型回答。`,
        context: search.chunks.map((item) => ({
          id: item.id,
          title: item.title,
          sourceType: item.sourceType,
          score: item.score,
          text: item.text,
          metadata: item.metadata,
        })),
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
