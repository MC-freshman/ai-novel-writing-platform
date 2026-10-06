const fs = require("node:fs/promises");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const AdmZip = require("adm-zip");
const { sha256, writeFileAtomic } = require("./project-storage.cjs");
const exchangeSecurity = require("./project-exchange-security.cjs");

const ARCHIVE_LIMITS = { compressed: 100 * 1024 * 1024, expanded: 500 * 1024 * 1024, entry: 64 * 1024 * 1024, entries: 10000, ratio: 1000 };
const DATA_ROOTS = new Set(["chapters", "characters", "worldbuilding", "materials", "assets", "documents", "analysis"]);

function validateExchangeZip(zip) {
  const entries = zip.getEntries();
  if (entries.length > ARCHIVE_LIMITS.entries) throw new Error("交换包文件数量超过 10000 上限。");
  let expanded = 0;
  const names = new Set();
  for (const entry of entries) {
    const name = entry.entryName;
    if (name.includes("\\") || name.includes("\0") || name.startsWith("/") || /^[a-z]:/i.test(name) || name.split("/").some((part) => part === ".." || part === ".")) throw new Error("交换包包含不安全路径。");
    if (names.has(name.toLowerCase())) throw new Error("交换包存在重复文件路径。");
    names.add(name.toLowerCase());
    if (!(name === "manifest.json" || name === "project/novel.config.json" || /^project\/(chapters|characters|worldbuilding|materials|assets|analysis)\//.test(name))) throw new Error("交换包含未知的数据目录。");
    const size = Number(entry.header.size);
    const compressed = Number(entry.header.compressedSize);
    expanded += size;
    if (!Number.isSafeInteger(size) || size < 0 || size > ARCHIVE_LIMITS.entry || expanded > ARCHIVE_LIMITS.expanded || size > Math.max(1, compressed) * ARCHIVE_LIMITS.ratio) throw new Error("交换包展开体积或压缩比超过安全上限。");
    if (((entry.header.attr >>> 16) & 0o170000) === 0o120000) throw new Error("交换包不能包含文件链接。");
  }
  return zip;
}

async function readExchangeArchive(filePath, password = "") {
  const stat = await fs.stat(filePath);
  if (stat.size > ARCHIVE_LIMITS.compressed) throw new Error("交换包超过 100 MB 上限。");
  const raw = await fs.readFile(filePath);
  const archive = await exchangeSecurity.decryptBuffer(raw, password);
  if (archive.length > ARCHIVE_LIMITS.compressed) throw new Error("交换包超过 100 MB 上限。");
  return validateExchangeZip(new AdmZip(archive));
}

async function portableValue(value, projectPath, zip, warnings, label = "项目资料") {
  if (Array.isArray(value)) return Promise.all(value.map((item) => portableValue(item, projectPath, zip, warnings, label)));
  if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await portableValue(item, projectPath, zip, warnings, label)])));
  if (typeof value !== "string") return value;
  let content = value;
  // Local image references may come from HTML, Markdown or imported metadata.
  const references = [...new Set(content.match(/file:\/\/[^\s"'<>)]+/gi) || [])];
  for (const reference of references) {
    let replacement = "novel-missing://image";
    try {
      const file = fileURLToPath(reference.replace(/&amp;/g, "&"));
      const relative = path.relative(path.join(projectPath, "assets"), file);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("资源位于项目资产目录外");
      const extension = path.extname(file).toLowerCase();
      if (!/^\.(png|jpe?g|gif|webp|bmp|tiff?|svg)$/.test(extension)) throw new Error("不是可移植图片格式");
      const body = await fs.readFile(file);
      if (body.length > ARCHIVE_LIMITS.entry) throw new Error("图片超过体积上限");
      const name = `${sha256(body)}${extension}`;
      const archiveName = `project/assets/exchange/${name}`;
      if (!zip.getEntry(archiveName)) zip.addFile(archiveName, body);
      replacement = `novel-asset://${name}`;
    } catch { warnings.push(`${label}：一处本地资源未导出（文件缺失、格式不支持或位于资产目录外）。`); }
    content = content.split(reference).join(replacement);
  }
  return content;
}

async function importExchangeAssets(projectPath, zip, importId) {
  const assetMap = new Map();
  for (const entry of zip.getEntries().filter((entry) => !entry.isDirectory && entry.entryName.startsWith("project/assets/exchange/"))) {
    const name = path.posix.basename(entry.entryName);
    if (!/^[a-f0-9]{64}\.(png|jpe?g|gif|webp|bmp|tiff?|svg)$/.test(name)) throw new Error("交换包图片标识不合法。");
    const body = entry.getData();
    if (sha256(body) !== name.slice(0, 64)) throw new Error("交换包图片校验失败。");
    const file = path.join(projectPath, "assets", "exchange", importId, name);
    await writeFileAtomic(file, body);
    assetMap.set(`novel-asset://${name}`, pathToFileURL(file).href);
  }
  return assetMap;
}

function remapAssetValue(value, assetMap) {
  if (Array.isArray(value)) return value.map((item) => remapAssetValue(item, assetMap));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapAssetValue(item, assetMap)]));
  if (typeof value !== "string") return value;
  return value.replace(/file:\/\/[^\s"'<>)]+/gi, "novel-missing://legacy-image").replace(/novel-asset:\/\/[a-f0-9]{64}\.[a-z]+/g, (reference) => {
    if (!assetMap.has(reference)) throw new Error("交换包缺少被引用的图片。");
    return assetMap.get(reference);
  });
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(apiKey|embeddingApiKey|password|authorization|accessToken|refreshToken|secret|credentialError|__.*Secret)$/i.test(key) ? "" : redactSecrets(item)]));
}

async function buildBackupZip(projectPath, title) {
  const zip = new AdmZip();
  const prefix = String(title || "NovelProject").replace(/[\\/:*?"<>|]/g, "_");
  async function add(relative) {
    const normalized = relative.replaceAll("\\", "/");
    if (normalized.startsWith("backups/") || normalized.startsWith("analysis/system/migration-backups/") || normalized.endsWith(".tmp") || normalized.includes(".novel-write.lock")) return;
    const file = path.join(projectPath, relative);
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error("备份遇到文件链接，已停止以保护项目边界。");
    if (stat.isDirectory()) {
      for (const name of await fs.readdir(file)) await add(path.join(relative, name));
    } else if (stat.isFile()) {
      let body = await fs.readFile(file);
      if (normalized.endsWith(".json")) {
        try { body = Buffer.from(JSON.stringify(redactSecrets(JSON.parse(body.toString("utf8"))), null, 2)); }
        catch { throw new Error(`备份中的 JSON 数据无法校验：${normalized}；已停止导出。`); }
      }
      zip.addFile(`${prefix}/${normalized}`, body);
    }
  }
  for (const entry of await fs.readdir(projectPath)) if (entry === "novel.config.json" || DATA_ROOTS.has(entry)) await add(entry);
  zip.addFile(`${prefix}/backup-info.json`, Buffer.from(JSON.stringify({ version: 1, credentialsIncluded: false, historicalConfigCopiesIncluded: false, createdAt: new Date().toISOString() }, null, 2)));
  return zip;
}

module.exports = { ARCHIVE_LIMITS, buildBackupZip, importExchangeAssets, portableValue, readExchangeArchive, redactSecrets, remapAssetValue, validateExchangeZip };
