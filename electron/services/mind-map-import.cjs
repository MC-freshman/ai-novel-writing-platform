"use strict";
// XMind 导入：同时支持新版 content.json 与 XMind 8 的 content.xml。
// 只读取压缩包内已登记的内容文件，不解压到磁盘，也不执行其中任何内容。
// XMind 8 关系线（content.xml 的 <relationship>）与视觉样式（styles.xml 的
// <relationship-properties>）只做只读解析；新版 content.json 的关系线结构未实测，暂不导入。
const fs = require("node:fs");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { parse } = require("node-html-parser");

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_NODES = 2000;
const MAX_SHEETS = 20;
const MAX_RELATIONS = 2000;
const MAX_RELATIVE_CONTROL = 8;

const XML_RELATION_NOTE = "导入的关系线使用默认曲线 + 相对量控制点，绝对像素位置不导入（K4）";
const JSON_RELATION_NOTE = "新版 content.json 格式的关系线暂不导入（结构未实测）";

const DEFAULT_RELATION_STYLE = {
  shape: "curved",
  linePattern: "dash",
  lineColor: "",
  lineWidth: 2,
  arrowBegin: "none",
  arrowEnd: "triangle",
  labelFontStyle: "italic",
  labelColor: "",
};

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

function hexColor(value) {
  const text = clean(value || "", 24);
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : "";
}

function attribute(node, name) {
  return String(node?.getAttribute?.(name) || "");
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
    // 保留 XMind topic id，供 relationships 的 end1/end2 映射到新 node id。
    id: clean(attribute(node, "id"), 120),
    title: decodeEntities(title?.text || ""),
    note: decodeEntities(notes?.structuredText || notes?.text || ""),
    children,
  };
}

/**
 * 只读解析 XMind 8 关系线。
 * K4 硬约束：<control-point><position svg:x/svg:y> 是绝对像素，而本平台
 * controlPoints.x/y 是按连线长度缩放的相对量；导入阶段尚无可用的端点距离，
 * 无法可靠换算，因此只保留本身即为相对量的 amount/angle，绝对像素位置一律丢弃。
 */
function xmlRelationships(sheet) {
  const result = [];
  // 先过滤再截断：悬空边 / 自环在 toMindMap 中丢弃，此处不得预先截断（P7 教训）。
  for (const rel of sheet.querySelectorAll("relationship")) {
    const titleTag = childTags(rel, "title")[0];
    const controlPoints = [];
    for (const cp of rel.querySelectorAll("control-point").slice(0, 2)) {
      const amount = Number(attribute(cp, "amount"));
      const angle = Number(attribute(cp, "angle"));
      if (!Number.isFinite(amount) || !Number.isFinite(angle)) continue;
      if (Math.abs(amount) > MAX_RELATIVE_CONTROL || Math.abs(angle) > MAX_RELATIVE_CONTROL) continue;
      controlPoints.push({ amount, angle });
    }
    result.push({
      end1: clean(attribute(rel, "end1"), 120),
      end2: clean(attribute(rel, "end2"), 120),
      styleId: clean(attribute(rel, "style-id"), 120),
      title: decodeEntities(titleTag?.text || ""),
      controlPoints,
    });
  }
  return result;
}

/**
 * 解析 styles.xml 中 type="relationship" 的 <style>。
 * node-html-parser 会把 <style> 内容当作原始文本，必须对 style.text 二次 parse
 * 才能拿到 <relationship-properties> 的属性（含带冒号的 fo:* 属性）。
 */
function parseRelationshipStyles(text) {
  const byId = new Map();
  let fallback = null;
  if (!text || text.length > MAX_TEXT_BYTES) return { byId, fallback };
  const document = parse(text);
  for (const style of document.querySelectorAll("style")) {
    if (clean(attribute(style, "type"), 40) !== "relationship") continue;
    const inner = parse(style.text || "");
    const propsTag = inner.querySelector("relationship-properties");
    const attr = (name) => propsTag ? attribute(propsTag, name) : "";
    const width = parseFloat(attr("line-width"));
    const pattern = clean(attr("line-pattern"), 20);
    const shapeClass = attr("shape-class");
    const props = {
      arrowBegin: /triangle/i.test(attr("arrow-begin-class")) ? "triangle" : "none",
      arrowEnd: /triangle/i.test(attr("arrow-end-class")) ? "triangle" : "none",
      linePattern: pattern === "dash" ? "dash" : pattern === "dot" ? "dot" : "solid",
      shape: /straight/i.test(shapeClass) ? "straight" : /elbow/i.test(shapeClass) ? "elbow" : "curved",
      lineColor: hexColor(attr("line-color")),
      labelColor: hexColor(attr("fo:color")),
      lineWidth: Number.isFinite(width) && width >= 1 && width <= 8 ? Math.round(width) : 2,
      labelFontStyle: clean(attr("fo:font-style"), 20) === "italic" ? "italic" : "normal",
    };
    const styleId = clean(attribute(style, "id"), 120);
    if (styleId) byId.set(styleId, props);
    if (!fallback) fallback = props;
  }
  return { byId, fallback };
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
      relations: xmlRelationships(sheet),
      relationNote: XML_RELATION_NOTE,
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
    id: "",
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
    // 新版 content.json 的关系线字段结构未实测，保持现状，不猜测字段。
    relations: [],
    relationNote: JSON_RELATION_NOTE,
  }));
}

/** 把 XMind 8 的相对量控制点转成平台结构：x/y 恒为 0（绝对像素已丢弃）。 */
function toControlPoints(points) {
  return (Array.isArray(points) ? points : []).slice(0, 2).map((point) => ({
    amount: point.amount, angle: point.angle, x: 0, y: 0,
  }));
}

function toMindMap(sheet, fileName, index, total, styles) {
  const now = new Date().toISOString();
  const id = `xmind_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_${index}`;
  const rootId = `${id}_root`;
  const nodes = [{
    id: rootId, parentId: "",
    text: clean(sheet.root?.title || sheet.title, 500) || "中心主题",
    note: clean(sheet.root?.note, 2000), color: "", collapsed: false, order: 0, side: "right",
  }];
  // XMind topic id → 平台 node id 的映射，root 也要登记。
  const topicIds = new Map();
  if (sheet.root?.id) topicIds.set(sheet.root.id, rootId);
  let counter = 0;
  let truncated = false;
  const visit = (topic, parentId, side, order) => {
    if (nodes.length >= MAX_NODES) { truncated = true; return; }
    const nodeId = `${id}_n${counter++}`;
    if (topic.id) topicIds.set(topic.id, nodeId);
    nodes.push({
      id: nodeId, parentId,
      text: clean(topic.title, 500) || "未命名主题",
      note: clean(topic.note, 2000), color: "", collapsed: false, order, side,
    });
    (topic.children || []).forEach((child, position) => visit(child, nodeId, side, position));
  };
  (sheet.root?.children || []).forEach((child, position) => visit(child, rootId, position % 2 === 0 ? "left" : "right", position));

  const relations = [];
  const rawRelations = Array.isArray(sheet.relations) ? sheet.relations : [];
  for (const raw of rawRelations) {
    const sourceId = topicIds.get(raw.end1);
    const targetId = topicIds.get(raw.end2);
    // 映射不到（含被 MAX_NODES 截断的主题）或自环的整条丢弃，不写悬空边。
    if (!sourceId || !targetId || sourceId === targetId) continue;
    const style = (raw.styleId && styles?.byId.get(raw.styleId)) || styles?.fallback || DEFAULT_RELATION_STYLE;
    relations.push({
      id: `${id}_r${relations.length}`,
      sourceId, targetId,
      label: clean(raw.title, 500),
      note: "",
      shape: style.shape,
      linePattern: style.linePattern,
      lineColor: style.lineColor,
      lineWidth: style.lineWidth,
      arrowBegin: style.arrowBegin,
      arrowEnd: style.arrowEnd,
      labelFontStyle: style.labelFontStyle,
      labelColor: style.labelColor,
      controlPoints: toControlPoints(raw.controlPoints),
    });
    if (relations.length >= MAX_RELATIONS) break;
  }
  return {
    map: {
      id,
      title: clean(total > 1 ? `${fileName} / ${sheet.title}` : fileName, 160) || "导入的思维导图",
      rootId, nodes, relations, createdAt: now, updatedAt: now,
    },
    truncated,
    relationNote: sheet.relationNote || "",
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
  let styles = { byId: new Map(), fallback: null };
  if (entries.has("styles.xml")) {
    try { styles = parseRelationshipStyles(zip.readFile("styles.xml").toString("utf8")); }
    catch { styles = { byId: new Map(), fallback: null }; }
  }
  const usable = sheets.filter((sheet) => sheet.root);
  if (!usable.length) throw new Error("没有找到可导入的主题。");
  const fileName = clean(path.basename(filePath, path.extname(filePath)), 160) || "导入的思维导图";
  const converted = usable.map((sheet, index) => toMindMap(sheet, fileName, index, usable.length, styles));
  return {
    fileName: path.basename(filePath),
    sheets: converted.map(({ map, truncated, relationNote }) => ({
      title: map.title,
      rootText: map.nodes[0].text,
      nodeCount: map.nodes.length,
      truncated,
      relationCount: map.relations.length,
      relationNote,
      map,
    })),
  };
}

module.exports = {
  readXMindFile, parseXMindXml, parseXMindJson, parseRelationshipStyles,
  MAX_NODES, MAX_FILE_BYTES, MAX_SHEETS,
};
