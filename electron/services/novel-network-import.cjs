const fs = require("node:fs/promises");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { parse } = require("node-html-parser");
const wordImport = require("./word-import.cjs");
const { makeId, normalizeNetwork, parseDocuments } = require("./novel-network.cjs");

function htmlToPlanningText(html) {
  const root = parse(html);
  const lines = [];
  for (const node of root.childNodes) {
    const heading = node.tagName?.match(/^H([1-6])$/);
    if (heading) lines.push(`${"#".repeat(Number(heading[1]))} ${node.textContent.trim()}`, "");
    else if (node.tagName === "TABLE") {
      const rows = node.querySelectorAll("tr").map((row) => row.childNodes.filter((cell) => ["TD", "TH"].includes(cell.tagName)).map((cell) => cell.textContent.trim().replaceAll("|", "\\|").replace(/\r?\n/g, " / ")));
      rows.forEach((cells, index) => { lines.push(`| ${cells.join(" | ")} |`); if (index === 0) lines.push(`| ${cells.map(() => "---").join(" | ")} |`); });
      lines.push("");
    } else if (["UL", "OL"].includes(node.tagName)) {
      lines.push(...node.querySelectorAll("li").map((item) => `- ${item.textContent.trim()}`), "");
    } else {
      const text = node.textContent.trim();
      if (text) lines.push(text);
    }
  }
  return lines.join("\n");
}

function parseNetworkJson(text) {
  const data = JSON.parse(text.replace(/^\uFEFF/, ""), (key, value) => {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("小说网JSON包含不安全字段。");
    return value;
  });
  if (data.schema !== "novel-network/v1" || !data.network) throw new Error("请选择由小说网导出的JSON，或改用Markdown、Word资料。");
  return normalizeNetwork(data.network);
}

async function readImportFiles(filePaths) {
  if (!Array.isArray(filePaths) || !filePaths.length || filePaths.length > 16) throw new Error("每次请选择1至16份资料。");
  const documents = [];
  const warnings = [];
  const networks = [];
  for (const filePath of filePaths) {
    const name = path.basename(filePath);
    const extension = path.extname(filePath).toLowerCase();
    if (![".md", ".markdown", ".docx", ".json"].includes(extension)) throw new Error(`${name}不是支持的资料格式。`);
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error(`${name}不是普通文件或超过8MB，请拆分资料。`);
    const buffer = await fs.readFile(filePath);
    if (extension === ".docx") {
      const entries = new AdmZip(buffer).getEntries();
      const expanded = entries.reduce((total, entry) => total + Number(entry.header.size), 0);
      if (entries.length > 5000 || !Number.isSafeInteger(expanded) || expanded > 32 * 1024 * 1024 || entries.some((entry) => Number(entry.header.size) > 16 * 1024 * 1024)) throw new Error(`${name}的Word展开体积超过安全上限。`);
      if (entries.some((entry) => /^word\/media\//.test(entry.entryName))) warnings.push(`${name}包含图片；图片保留在原始Word中，本次导入提取可编辑文字与表格。`);
      const result = await wordImport.convertToHtml({ buffer }, { convertImage: wordImport.images.imgElement(async () => ({ src: "novel-image://original-word" })) });
      warnings.push(...result.messages.map((message) => `${name}：${message.message}`));
      documents.push({ name, text: htmlToPlanningText(result.value) });
    } else {
      let text;
      try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer); }
      catch { throw new Error(`${name}需要保存为UTF-8编码。`); }
      if (extension === ".json") networks.push(parseNetworkJson(text));
      else documents.push({ name, text });
    }
  }
  if (documents.length) networks.unshift(parseDocuments(documents));
  let network = networks[0];
  if (!network) throw new Error("没有找到可以导入的资料。");
  let duplicates = 0;
  for (const extra of networks.slice(1)) {
    const merged = mergeNetworks(network, extra);
    network = merged.network;
    duplicates += merged.duplicates;
  }
  const deduplicated = mergeNetworks({ ...network, tables: [], documents: [] }, network);
  network = { ...deduplicated.network, id: "", revision: "", createdAt: "", updatedAt: "" };
  duplicates += deduplicated.duplicates;
  if (duplicates) warnings.push(`发现并跳过${duplicates}条内容完全相同的表格记录，原始说明仍保留。`);
  if (!network.tables.length) warnings.push("未识别出表格；原始文字已保留，可在导入后添加自定义表。");
  return { network, warnings, duplicates, fileNames: filePaths.map((file) => path.basename(file)) };
}

function mergeNetworks(existing, imported) {
  const base = normalizeNetwork(existing);
  const incoming = normalizeNetwork(imported);
  const tables = structuredClone(base.tables);
  let duplicates = 0;
  for (const table of incoming.tables) {
    let target = tables.find((item) => item.kind === table.kind && item.title === table.title && JSON.stringify(item.columns) === JSON.stringify(table.columns));
    if (!target) { target = { ...table, id: makeId("table"), rows: [] }; tables.push(target); }
    const signatures = new Set(target.rows.map((row) => JSON.stringify([row.cells, row.chapterId])));
    for (const row of table.rows) {
      const signature = JSON.stringify([row.cells, row.chapterId]);
      if (signatures.has(signature)) { duplicates += 1; continue; }
      target.rows.push({ ...row, id: makeId("row") });
      signatures.add(signature);
    }
  }
  const documents = [...base.documents];
  for (const document of incoming.documents) if (!documents.some((item) => item.name === document.name && item.text === document.text)) documents.push(document);
  return { network: normalizeNetwork({ ...base, tables, documents }), duplicates };
}

module.exports = { htmlToPlanningText, mergeNetworks, parseNetworkJson, readImportFiles };
