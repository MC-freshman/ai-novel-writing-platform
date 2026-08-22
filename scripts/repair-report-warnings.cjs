const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

process.env.NOVEL_PLATFORM_TEST = "1";

const app = require("../electron/main.cjs");

const WORKSPACE = path.resolve(__dirname, "..");
const DEFAULT_PROJECT = path.join(process.env.USERPROFILE || "C:\\Users\\wk", "OneDrive", "文档", "AI小说创作平台", "默认小说项目");
const MATERIAL_DIR = path.join(WORKSPACE, "小说1材料");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const PROJECT_BACKUP_DIR = path.join(DEFAULT_PROJECT, "backups", "report_fix", STAMP);
const EXPORT_BACKUP_DIR = path.join(MATERIAL_DIR, "backups_report_fix", STAMP);

function sanitizeFileName(name) {
  return String(name || "未命名")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function normalizeRole(chapter) {
  return app.getKnowledgeRole(chapter);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyIfExists(source, target) {
  if (!fsSync.existsSync(source)) return false;
  await ensureDir(path.dirname(target));
  await fs.copyFile(source, target);
  return true;
}

function titleLooksSpecific(title) {
  return /第.+章|序章|大纲|地图|灵感|AI输出|武器库|图鉴|札记/.test(String(title || ""));
}

function filenameMatchesTitle(fileName, title) {
  const cleanFile = sanitizeFileName(path.basename(String(fileName || ""), path.extname(String(fileName || ""))));
  const cleanTitle = sanitizeFileName(title);
  if (!cleanTitle) return true;
  const sample = cleanTitle.slice(0, Math.min(4, cleanTitle.length));
  return cleanFile.includes(sample) || cleanFile.includes(cleanTitle);
}

function extensionForChapter(chapter, content) {
  const currentExt = path.extname(String(chapter.fileName || "")).toLowerCase();
  if (chapter.contentFormat === "html" || /<(p|h1|h2|h3|table|div|article)[\s>]/i.test(content)) return ".html";
  return currentExt || ".md";
}

async function uniqueChapterFileName(chapterDir, order, title, extension, reserved) {
  const prefix = normalizeRole({ title, knowledgeRole: "", volume: "" }) === "正文" ? "chapter" : "material";
  const base = `${prefix}_${String(order + 1).padStart(3, "0")}_${sanitizeFileName(title)}`;
  let fileName = `${base}${extension}`;
  let index = 2;
  while (reserved.has(fileName) || fsSync.existsSync(path.join(chapterDir, fileName))) {
    fileName = `${base}_${index}${extension}`;
    index += 1;
  }
  reserved.add(fileName);
  return fileName;
}

async function readIdsFromDir(dir, extension, readId) {
  if (!fsSync.existsSync(dir)) return [];
  const files = await fs.readdir(dir);
  const ids = [];
  for (const file of files.filter((item) => item.toLowerCase().endsWith(extension))) {
    try {
      ids.push(await readId(path.join(dir, file), file));
    } catch {
      ids.push(path.basename(file, extension));
    }
  }
  return ids.filter(Boolean);
}

async function repairProjectFileNames(config) {
  const chapterDir = path.join(DEFAULT_PROJECT, "chapters");
  const used = new Set(config.chapters.map((chapter) => chapter.fileName).filter(Boolean));
  const changes = [];
  for (const chapter of config.chapters.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    if (!titleLooksSpecific(chapter.title) || filenameMatchesTitle(chapter.fileName, chapter.title)) continue;
    const oldFileName = path.basename(String(chapter.fileName || ""));
    const oldPath = path.join(chapterDir, oldFileName);
    if (!oldFileName || !fsSync.existsSync(oldPath)) continue;
    const content = await fs.readFile(oldPath, "utf8");
    const extension = extensionForChapter(chapter, content);
    used.delete(oldFileName);
    const newFileName = await uniqueChapterFileName(chapterDir, chapter.order ?? 0, chapter.title, extension, used);
    const newPath = path.join(chapterDir, newFileName);
    await copyIfExists(oldPath, path.join(PROJECT_BACKUP_DIR, "chapters", oldFileName));
    await fs.rename(oldPath, newPath);
    chapter.fileName = newFileName;
    if (extension === ".html") chapter.contentFormat = "html";
    chapter.updatedAt = new Date().toISOString();
    changes.push({ title: chapter.title, from: oldFileName, to: newFileName });
  }
  return changes;
}

async function removeOrphanVectors(config) {
  const vectorPath = path.join(DEFAULT_PROJECT, "vector_db", "vectors.json");
  if (!fsSync.existsSync(vectorPath)) return { removed: 0, before: 0, after: 0 };
  const store = JSON.parse(await fs.readFile(vectorPath, "utf8"));
  const knownIds = new Set(config.chapters.map((chapter) => chapter.id).filter(Boolean));
  const characterIds = await readIdsFromDir(path.join(DEFAULT_PROJECT, "characters"), ".json", async (filePath, file) => {
    const item = JSON.parse(await fs.readFile(filePath, "utf8"));
    return item.id || path.basename(file, ".json");
  });
  const worldIds = await readIdsFromDir(path.join(DEFAULT_PROJECT, "worldbuilding"), ".md", async (_filePath, file) => path.basename(file, ".md"));
  for (const id of [...characterIds, ...worldIds]) knownIds.add(id);
  const vectors = Array.isArray(store.vectors) ? store.vectors : [];
  const nextVectors = vectors.filter((entry) => knownIds.has(entry.sourceId));
  if (nextVectors.length !== vectors.length) {
    await copyIfExists(vectorPath, path.join(PROJECT_BACKUP_DIR, "vector_db", "vectors.json"));
    store.vectors = nextVectors;
    store.updatedAt = new Date().toISOString();
    await fs.writeFile(vectorPath, JSON.stringify(store, null, 2), "utf8");
  }
  return { removed: vectors.length - nextVectors.length, before: vectors.length, after: nextVectors.length };
}

async function refreshExports() {
  await ensureDir(MATERIAL_DIR);
  await ensureDir(EXPORT_BACKUP_DIR);
  const bodyPath = path.join(MATERIAL_DIR, "正文.docx");
  const fullPath = path.join(MATERIAL_DIR, "长夜_整书.docx");
  await copyIfExists(bodyPath, path.join(EXPORT_BACKUP_DIR, "正文.docx"));
  await copyIfExists(fullPath, path.join(EXPORT_BACKUP_DIR, "长夜_整书.docx"));
  await app.exportBookToDocx(DEFAULT_PROJECT, bodyPath, { includeOutline: false, includeCharacters: false, includeWorld: false });
  await app.exportBookToDocx(DEFAULT_PROJECT, fullPath, { includeOutline: true, includeCharacters: true, includeWorld: true });
  return { bodyPath, fullPath, backupDir: EXPORT_BACKUP_DIR };
}

async function main() {
  if (!fsSync.existsSync(path.join(DEFAULT_PROJECT, "novel.config.json"))) {
    throw new Error(`未找到默认小说项目：${DEFAULT_PROJECT}`);
  }
  await ensureDir(PROJECT_BACKUP_DIR);
  await copyIfExists(path.join(DEFAULT_PROJECT, "novel.config.json"), path.join(PROJECT_BACKUP_DIR, "novel.config.json"));

  const config = await app.loadConfig(DEFAULT_PROJECT);
  const renamed = await repairProjectFileNames(config);
  if (renamed.length) {
    config.updatedAt = new Date().toISOString();
    await app.saveConfig(DEFAULT_PROJECT, config);
  }
  const vectors = await removeOrphanVectors(config);
  const exports = await refreshExports();

  console.log(JSON.stringify({
    project: DEFAULT_PROJECT,
    projectBackupDir: PROJECT_BACKUP_DIR,
    renamed,
    vectors,
    exports,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
