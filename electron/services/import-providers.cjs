"use strict";
// 外部项目导入（P91/P100）：Obsidian 库（递归 md，目录→分卷）、novelWriter .nwx、Scrivener .scriv（自研 RTF 纯文本提取，有损）。
// 复用既有单文档导入管线（convertDocumentToRichContent/章节事务）；原文件不改写；预览确认后导入。
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const AdmZip = require("adm-zip");
const { dialog } = require("electron");
const { withProjectTransaction } = require("./project-storage.cjs");
const { state } = require("./runtime-state.cjs");
const { importDocumentIntoProjectUnlocked } = require("./project-content.cjs");
const { loadConfig } = require("./project-ops.cjs");
const { sanitizeFileName } = require("./project-files.cjs");

const MAX_FILES = 500;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MD_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

function titleFromMarkdown(content, fallback) {
  const heading = String(content || "").match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim().slice(0, 120);
  return fallback;
}

function stripNwdMeta(content) {
  // novelWriter .nwd：%%~ 开头为元数据行，其余按 markdown 处理。
  return String(content || "").split(/\r?\n/).filter((line) => !line.startsWith("%%~")).join("\n");
}

async function scanVault(directory) {
  const files = [];
  const warnings = [];
  let wikiLinks = 0;
  async function walk(current, relative) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(current, entry.name);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(absolute, rel);
      } else if (MD_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const stat = await fs.stat(absolute);
        if (stat.size > MAX_FILE_BYTES) { warnings.push(`${rel} 超过 8MB，跳过`); continue; }
        const content = await fs.readFile(absolute, "utf8");
        wikiLinks += (content.match(/\[\[[^\]]+\]\]/g) || []).length;
        files.push({
          relPath: rel,
          absolute,
          title: titleFromMarkdown(content, path.basename(entry.name, path.extname(entry.name))),
          volume: relative ? relative.split("/").join(" / ") : "导入文档",
          words: content.replace(/\s+/g, "").length,
        });
        if (files.length >= MAX_FILES) return;
      }
    }
  }
  await walk(directory, "");
  if (wikiLinks) warnings.push(`检测到 ${wikiLinks} 处 wiki 链接（[[...]]），按原文保留，不解析跳转`);
  if (files.length >= MAX_FILES) warnings.push(`文件数达上限 ${MAX_FILES}，仅导入前 ${MAX_FILES} 个`);
  return { files, warnings };
}

async function previewVaultImport() {
  const selected = await dialog.showOpenDialog(state.mainWindow, { title: "选择 Obsidian 库目录（递归导入 markdown）", properties: ["openDirectory"] });
  if (selected.canceled || !selected.filePaths.length) return { canceled: true };
  const directory = selected.filePaths[0];
  const scan = await scanVault(directory);
  if (!scan.files.length) throw new Error("目录中没有可导入的 markdown/txt 文件。");
  return { canceled: false, kind: "vault", directory, files: scan.files.map(({ absolute, ...rest }) => rest), warnings: scan.warnings, token: directory };
}

async function runVaultImport(projectPath, payload) {
  const directory = String(payload?.directory || "");
  if (!directory) throw new Error("缺少导入目录。");
  const scan = await scanVault(directory);
  if (!scan.files.length) throw new Error("目录中没有可导入的 markdown/txt 文件。");
  return withProjectTransaction(projectPath, async () => {
    const config = await loadConfig(projectPath);
    let imported = 0;
    const failures = [];
    for (const file of scan.files) {
      try {
        await importDocumentIntoProjectUnlocked(projectPath, file.absolute, { volume: file.volume, config });
        imported += 1;
      } catch (error) {
        failures.push(`${file.relPath}：${error?.message || error}`);
      }
    }
    return { imported, skipped: failures.length, failures: failures.slice(0, 20), warnings: scan.warnings };
  });
}

async function readNwxEntries(filePath) {
  if (!/\.nwx$/i.test(filePath)) throw new Error("仅支持 .nwx 文件（novelWriter 备份）。");
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) throw new Error("文件不存在。");
  if (stat.size > 64 * 1024 * 1024) throw new Error(".nwx 文件超过 64MB 上限。");
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries()
    .filter((entry) => !entry.isDirectory && (MD_EXTENSIONS.has(path.extname(entry.entryName).toLowerCase()) || /\.nwd$/i.test(entry.entryName)))
    .slice(0, MAX_FILES);
  if (!entries.length) throw new Error(".nwx 中没有可导入的文档（md/nwd/txt）。");
  return entries;
}

async function previewNwxImport() {
  const selected = await dialog.showOpenDialog(state.mainWindow, { title: "选择 novelWriter .nwx 备份", properties: ["openFile"], filters: [{ name: "novelWriter", extensions: ["nwx"] }] });
  if (selected.canceled || !selected.filePaths.length) return { canceled: true };
  const filePath = selected.filePaths[0];
  const entries = await readNwxEntries(filePath);
  return {
    canceled: false,
    kind: "nwx",
    filePath,
    files: entries.map((entry) => ({ relPath: entry.entryName, title: path.basename(entry.entryName, path.extname(entry.entryName)), volume: "导入文档", words: entry.header.size })),
    warnings: ["nwd 元数据行（%%~）将被剥离，正文按 markdown 导入"],
    token: filePath,
  };
}

async function runNwxImport(projectPath, payload) {
  const filePath = String(payload?.filePath || "");
  if (!filePath) throw new Error("缺少 .nwx 文件路径。");
  const entries = await readNwxEntries(filePath);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "novel-nwx-"));
  try {
    const extracted = [];
    for (const entry of entries) {
      const originalName = path.basename(entry.entryName);
      let content = entry.getData().toString("utf8");
      let name = originalName;
      if (/\.nwd$/i.test(name)) {
        content = stripNwdMeta(content);
        name = name.replace(/\.nwd$/i, ".md");
      }
      const target = path.join(tempDir, name);
      await fs.writeFile(target, content, "utf8");
      extracted.push(target);
    }
    return await withProjectTransaction(projectPath, async () => {
      const config = await loadConfig(projectPath);
      let imported = 0;
      const failures = [];
      for (const target of extracted) {
        try {
          await importDocumentIntoProjectUnlocked(projectPath, target, { volume: "导入文档", config });
          imported += 1;
        } catch (error) {
          failures.push(`${path.basename(target)}：${error?.message || error}`);
        }
      }
      return { imported, skipped: failures.length, failures: failures.slice(0, 20), warnings: [] };
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { MAX_FILES, scanVault, previewVaultImport, runVaultImport, previewNwxImport, runNwxImport, stripNwdMeta, rtfToText, previewScrivImport, runScrivImport };

// ---- .scriv 导入（P100）：自研 RTF 文本提取（零依赖，有损：仅文本，格式/图片不保留）----
const SKIP_GROUPS = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer",
  "nonshppict", "shppict", "themedata", "colorschememapping", "datastore", "generator",
  "xmlnstbl", "latentstyles", "listtable", "listoverridetable", "revtbl", "rsidtbl",
  "protusertbl", "doccomm", "bkmkstart", "bkmkend", "field", "fldrslt", "nonxml",
  "upr", "annotation", "atrfstart", "atrfend", "do", "shp", "sn", "sv", "wgrffmtfilter",
]);

/** 极简 RTF→纯文本：跳过目标组、\uN  unicode、\'xx 十六进制、\par/\line 换行。 */
function rtfToText(rtf) {
  const sourceText = String(rtf || "");
  let output = "";
  let depth = 0;
  const skipDepth = [];
  let ucSkip = 1;
  let i = 0;
  const isSkipping = () => skipDepth.length > 0;
  while (i < sourceText.length) {
    const ch = sourceText[i];
    if (ch === "{") {
      depth += 1;
      //  lookahead：{\*\keyword 或 {\keyword 判定是否跳过组
      let look = i + 1;
      let star = false;
      if (sourceText[look] === "\\" && sourceText[look + 1] === "*") { star = true; look += 2; }
      if (sourceText[look] === "\\") {
        look += 1;
        let word = "";
        while (look < sourceText.length && /[a-zA-Z]/.test(sourceText[look])) { word += sourceText[look]; look += 1; }
        if (star || SKIP_GROUPS.has(word)) skipDepth.push(depth);
      }
      i += 1;
      continue;
    }
    if (ch === "}") {
      if (skipDepth.length && skipDepth[skipDepth.length - 1] === depth) skipDepth.pop();
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }
    if (isSkipping()) { i += 1; continue; }
    if (ch === "\\") {
      const next = sourceText[i + 1];
      if (next === "\\" || next === "{" || next === "}") { output += next; i += 2; continue; }
      if (next === "'") {
        const hex = sourceText.slice(i + 2, i + 4);
        output += Buffer.from([parseInt(hex, 16) || 0]).toString("latin1");
        i += 4;
        continue;
      }
      if (next === "*") { i += 2; continue; }
      let word = "";
      let j = i + 1;
      while (j < sourceText.length && /[a-zA-Z]/.test(sourceText[j])) { word += sourceText[j]; j += 1; }
      let param = "";
      let negative = false;
      if (sourceText[j] === "-") { negative = true; j += 1; }
      while (j < sourceText.length && /[0-9]/.test(sourceText[j])) { param += sourceText[j]; j += 1; }
      if (sourceText[j] === " ") j += 1;
      if (word === "par" || word === "line" || word === "sect" || word === "page") output += "\n";
      else if (word === "tab") output += "\t";
      else if (word === "u") {
        let code = parseInt(param, 10) || 0;
        if (negative) code = 65536 - code;
        output += String.fromCharCode(code);
        // 跳过 ucSkip 个回退字符
        let skipped = 0;
        while (skipped < ucSkip && j < sourceText.length) {
          if (sourceText[j] === "\\" && sourceText[j + 1] === "'") { j += 4; skipped += 1; }
          else if (sourceText[j] === "\\" ) { j += 2; skipped += 1; }
          else if (sourceText[j] === "{" || sourceText[j] === "}") { break; }
          else { j += 1; skipped += 1; }
        }
      }
      else if (word === "uc") ucSkip = parseInt(param, 10) || 0;
      i = j;
      continue;
    }
    if (ch === "\r" || ch === "\n") { i += 1; continue; }
    output += ch;
    i += 1;
  }
  return output.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function findScrivEntries(zip) {
  return zip.getEntries().filter((entry) => {
    if (entry.isDirectory) return false;
    const name = entry.entryName.replace(/\\/g, "/");
    return /\/Files\/Data\/[^/]+\/content\.rtf$/i.test(name) || /\/Files\/Docs\/[^/]+\.rtf$/i.test(name) || /\.rtf$/i.test(name);
  }).slice(0, MAX_FILES);
}

async function previewScrivImport() {
  const selected = await dialog.showOpenDialog(state.mainWindow, { title: "选择 Scrivener .scriv 项目包", properties: ["openFile"], filters: [{ name: "Scrivener", extensions: ["scriv"] }] });
  if (selected.canceled || !selected.filePaths.length) return { canceled: true };
  const filePath = selected.filePaths[0];
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) throw new Error("文件不存在。");
  if (stat.size > 128 * 1024 * 1024) throw new Error(".scriv 超过 128MB 上限。");
  const zip = new AdmZip(filePath);
  const entries = findScrivEntries(zip);
  if (!entries.length) throw new Error(".scriv 中没有可导入的 RTF 文档。");
  return {
    canceled: false,
    kind: "scriv",
    filePath,
    files: entries.map((entry) => ({ relPath: entry.entryName, title: path.basename(path.dirname(entry.entryName)) || path.basename(entry.entryName, ".rtf"), volume: "导入文档", words: entry.header.size })),
    warnings: ["RTF 仅提取纯文本（有损）：格式、图片、批注不保留；建议导入后核对。"],
  };
}

async function runScrivImport(projectPath, payload) {
  const filePath = String(payload?.filePath || "");
  if (!filePath) throw new Error("缺少 .scriv 文件路径。");
  if (!/\.scriv$/i.test(filePath)) throw new Error("仅支持 .scriv 文件。");
  const zip = new AdmZip(filePath);
  const entries = findScrivEntries(zip);
  if (!entries.length) throw new Error(".scriv 中没有可导入的 RTF 文档。");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "novel-scriv-"));
  try {
    const extracted = [];
    for (const entry of entries) {
      const text = rtfToText(entry.getData().toString("utf8"));
      if (!text.trim()) continue;
      const base = path.basename(path.dirname(entry.entryName)) || path.basename(entry.entryName, ".rtf");
      const target = path.join(tempDir, `${sanitizeFileName(base).slice(0, 60)}_${extracted.length}.md`);
      await fs.writeFile(target, text, "utf8");
      extracted.push(target);
    }
    if (!extracted.length) throw new Error("RTF 提取后没有可导入的正文。");
    return await withProjectTransaction(projectPath, async () => {
      const config = await loadConfig(projectPath);
      let imported = 0;
      const failures = [];
      for (const target of extracted) {
        try {
          await importDocumentIntoProjectUnlocked(projectPath, target, { volume: "导入文档", config });
          imported += 1;
        } catch (error) {
          failures.push(`${path.basename(target)}：${error?.message || error}`);
        }
      }
      return { imported, skipped: failures.length, failures: failures.slice(0, 20), warnings: ["RTF 有损提取：仅纯文本。"] };
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}