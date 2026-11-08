"use strict";
// XMind 导入：同时支持新版 content.json 与 XMind 8 的 content.xml。
// 只读取压缩包内已登记的内容文件，不解压到磁盘，也不执行其中任何内容。
const fs = require("node:fs");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { parse } = require("node-html-parser");

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_NODES = 2000;
const MAX_SHEETS = 20;

function clean(value, limit) {
  const text = Array.from(String(value == null ? "" : value))
    .filter((character) => {
      const code = character.codePointAt(0);
      return code === 10 || code === 9 || code >= 32;
    })
    .join("");
  return text.trim().slice(0, limit);
}

function codePoint(value, radix) {
  const code = parseInt(value, radix);
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_all, hex) => codePoint(hex, 16))
    .replace(/&#(\d+);/g, (_all, dec) => codePoint(dec, 10))
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'").replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

function childTags(node, tag) {
  return (node?.childNodes || []).filter((child) => child.rawTagName === tag);
}

function xmlTopic(node) {
  const title = childTags(node, "title")[0];
  const notes = childTags(node, "notes")[0];
  const children = [];
  for (const holder of childTags(node, "children")) {
    for (const group of childTags(holder, "topics")) {
      for (const child of childTags(group, "topic")) children.push(xmlTopic(child));
    }
  }
  return {
    title: decodeEntities(title?.text || ""),
    note: decodeEntities(notes?.structuredText || notes?.text || ""),
    children,
  };
}

function parseXMindXml(text) {
  if (text.length > MAX_TEXT_BYTES) throw new Error("画布内容过大（超过 8 MB）。");
  const document = parse(text);
  const sheets = document.querySelectorAll("sheet");
  if (!sheets.length) throw new Error("没有找到画布（sheet）。");
  return sheets.slice(0, MAX_SHEETS).map((sheet, index) => {
    const root = childTags(sheet, "topic")[0];
    const label = childTags(sheet, "title")[0];
    return {
      title: decodeEntities(label?.text || "") || `画布 ${index + 1}`,
      root: root ? xmlTopic(root) : null,
    };
  });
}

function jsonTopic(node) {
  const groups = node?.children || {};
  const children = [];
  for (const key of ["attached", "detached", "summary", "callout"]) {
    for (const child of Array.isArray(groups[key]) ? groups[key] : []) children.push(jsonTopic(child));
  }
  return {
    title: String(node?.title || ""),
    note: String(node?.notes?.plain?.content || node?.notes?.realHTML?.content || node?.notes?.content || ""),
    children,
  };
}

function parseXMindJson(text) {
  if (text.length > MAX_TEXT_BYTES) throw new Error("画布内容过大（超过 8 MB）。");
  const data = JSON.parse(text);
  const sheets = Array.isArray(data) ? data : [data];
  return sheets.slice(0, MAX_SHEETS).map((sheet, index) => ({
    title: String(sheet?.title || sheet?.name || `画布 ${index + 1}`),
    root: sheet?.rootTopic ? jsonTopic(sheet.rootTopic) : null,
  }));
}

function toMindMap(sheet, fileName, index, total) {
  const now = new Date().toISOString();
  const id = `xmind_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_${index}`;
  const rootId = `${id}_root`;
  const nodes = [{
    id: rootId, parentId: "",
    text: clean(sheet.root?.title || sheet.title, 500) || "中心主题",
    note: clean(sheet.root?.note, 2000), color: "", collapsed: false, order: 0, side: "right",
  }];
  let counter = 0;
  let truncated = false;
  const visit = (topic, parentId, side, order) => {
    if (nodes.length >= MAX_NODES) { truncated = true; return; }
    const nodeId = `${id}_n${counter++}`;
    nodes.push({
      id: nodeId, parentId,
      text: clean(topic.title, 500) || "未命名主题",
      note: clean(topic.note, 2000), color: "", collapsed: false, order, side,
    });
    (topic.children || []).forEach((child, position) => visit(child, nodeId, side, position));
  };
  (sheet.root?.children || []).forEach((child, position) => visit(child, rootId, position % 2 === 0 ? "left" : "right", position));
  return {
    map: {
      id,
      title: clean(total > 1 ? `${fileName} / ${sheet.title}` : fileName, 160) || "导入的思维导图",
      rootId, nodes, createdAt: now, updatedAt: now,
    },
    truncated,
  };
}

function readXMindFile(filePath) {
  if (!/\.xmind$/i.test(String(filePath || ""))) throw new Error("请选择 .xmind 文件。");
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("无法读取所选文件。");
  if (stat.size > MAX_FILE_BYTES) throw new Error("XMind 文件超过 16 MB，请先精简后再导入。");
  let zip;
  try { zip = new AdmZip(filePath); }
  catch { throw new Error("文件不是有效的 XMind 压缩包。"); }
  const entries = new Set(zip.getEntries().map((entry) => entry.entryName));
  let sheets;
  if (entries.has("content.json")) {
    sheets = parseXMindJson(zip.readFile("content.json").toString("utf8"));
  } else if (entries.has("content.xml")) {
    sheets = parseXMindXml(zip.readFile("content.xml").toString("utf8"));
  } else {
    throw new Error("压缩包里没有 content.json 或 content.xml，可能不是 XMind 文件。");
  }
  const usable = sheets.filter((sheet) => sheet.root);
  if (!usable.length) throw new Error("没有找到可导入的主题。");
  const fileName = clean(path.basename(filePath, path.extname(filePath)), 160) || "导入的思维导图";
  const converted = usable.map((sheet, index) => toMindMap(sheet, fileName, index, usable.length));
  return {
    fileName: path.basename(filePath),
    sheets: converted.map(({ map, truncated }) => ({
      title: map.title,
      rootText: map.nodes[0].text,
      nodeCount: map.nodes.length,
      truncated,
      map,
    })),
  };
}

module.exports = { readXMindFile, parseXMindXml, parseXMindJson, MAX_NODES, MAX_FILE_BYTES, MAX_SHEETS };
