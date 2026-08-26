const AdmZip = require("adm-zip");
const { parse: parseHtml } = require("node-html-parser");

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attr(tag, name) {
  const match = String(tag || "").match(new RegExp(`${name.replace(":", "\\:")}="([^"]*)"`, "i"));
  return decodeXml(match?.[1] || "");
}

function readEntry(zip, name) {
  const entry = zip.getEntry(name);
  return entry ? entry.getData().toString("utf8") : "";
}

function extractComments(documentXml, commentsXml) {
  if (!documentXml || !commentsXml) return [];
  const definitions = new Map();
  for (const match of commentsXml.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/gi)) {
    const id = attr(match[1], "w:id");
    const text = [...match[2].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gi)].map((item) => decodeXml(item[1])).join("").trim();
    definitions.set(id, { id, author: attr(match[1], "w:author") || "Word 批注", date: attr(match[1], "w:date"), comment: text });
  }
  const active = new Set();
  const quotes = new Map();
  const tokens = documentXml.match(/<w:commentRangeStart\b[^>]*\/?>(?:<\/w:commentRangeStart>)?|<w:commentRangeEnd\b[^>]*\/?>(?:<\/w:commentRangeEnd>)?|<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/gi) || [];
  for (const token of tokens) {
    if (/^<w:commentRangeStart/i.test(token)) {
      active.add(attr(token, "w:id"));
      continue;
    }
    if (/^<w:commentRangeEnd/i.test(token)) {
      active.delete(attr(token, "w:id"));
      continue;
    }
    const text = decodeXml(token.replace(/^<w:t(?:\s[^>]*)?>/i, "").replace(/<\/w:t>$/i, ""));
    for (const id of active) quotes.set(id, `${quotes.get(id) || ""}${text}`);
  }
  return [...definitions.values()].map((item) => ({ ...item, quote: String(quotes.get(item.id) || "").trim() })).filter((item) => item.comment);
}

function extractImageLayouts(documentXml) {
  const layouts = [];
  const drawings = documentXml.match(/<wp:(?:inline|anchor)\b[\s\S]*?<\/wp:(?:inline|anchor)>/gi) || [];
  for (const drawing of drawings) {
    const extent = drawing.match(/<wp:extent\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/i);
    const align = drawing.match(/<wp:align>([^<]+)<\/wp:align>/i)?.[1] || "center";
    layouts.push({
      width: extent ? Math.max(1, Math.round(Number(extent[1]) / 9525)) : 560,
      height: extent ? Math.max(1, Math.round(Number(extent[2]) / 9525)) : 320,
      position: /^<wp:anchor/i.test(drawing) ? "floating" : "inline",
      align: ["left", "right", "center"].includes(align) ? align : "center",
    });
  }
  return layouts;
}

function extractTableLayouts(documentXml) {
  return (documentXml.match(/<w:tbl\b[\s\S]*?<\/w:tbl>/gi) || []).map((table) => {
    const grid = [...table.matchAll(/<w:gridCol\b[^>]*w:w="(\d+)"/gi)].map((item) => Number(item[1]));
    const total = grid.reduce((sum, item) => sum + item, 0) || 1;
    const widthMatch = table.match(/<w:tblW\b[^>]*w:w="(\d+)"[^>]*w:type="([^"]+)"/i);
    return {
      columns: grid.map((item) => Math.max(3, Math.round((item / total) * 100))),
      width: widthMatch && widthMatch[2] === "pct" ? Math.max(10, Math.min(100, Math.round(Number(widthMatch[1]) / 50))) : 100,
    };
  });
}

function revisionText(xml, deleted = false) {
  const pattern = deleted ? /<w:(?:delText|t)(?:\s[^>]*)?>([\s\S]*?)<\/w:(?:delText|t)>/gi : /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gi;
  return [...String(xml || "").matchAll(pattern)].map((item) => decodeXml(item[1])).join("").trim();
}

function extractTrackedChanges(documentXml) {
  const revisions = [];
  for (const paragraph of String(documentXml || "").match(/<w:p\b[\s\S]*?<\/w:p>/gi) || []) {
    const changes = [];
    const pattern = /<w:(del|ins)\b([^>]*)>([\s\S]*?)<\/w:\1>/gi;
    for (const match of paragraph.matchAll(pattern)) {
      const type = match[1].toLowerCase();
      const text = revisionText(match[3], type === "del");
      if (!text) continue;
      changes.push({ type, text, author: attr(match[2], "w:author") || "Word 修订", date: attr(match[2], "w:date"), sourceId: attr(match[2], "w:id") });
    }
    for (let index = 0; index < changes.length; index += 1) {
      const current = changes[index];
      const next = changes[index + 1];
      if (current.type === "del" && next?.type === "ins") {
        revisions.push({ id: current.sourceId || `${revisions.length}`, author: current.author, date: current.date, original: current.text, replacement: next.text });
        index += 1;
      } else if (current.type === "del") {
        revisions.push({ id: current.sourceId || `${revisions.length}`, author: current.author, date: current.date, original: current.text, replacement: "" });
      } else {
        revisions.push({ id: current.sourceId || `${revisions.length}`, author: current.author, date: current.date, original: "", replacement: current.text });
      }
    }
  }
  return revisions;
}

function applyLayoutMetadata(html, metadata) {
  const root = parseHtml(String(html || ""));
  root.querySelectorAll("img").forEach((image, index) => {
    const layout = metadata.images[index];
    if (!layout) return;
    image.setAttribute("data-docx-width", String(layout.width));
    image.setAttribute("data-docx-height", String(layout.height));
    image.setAttribute("data-docx-position", layout.position);
    image.setAttribute("data-docx-align", layout.align);
    image.setAttribute("width", String(layout.width));
    image.setAttribute("height", String(layout.height));
  });
  root.querySelectorAll("table").forEach((table, index) => {
    const layout = metadata.tables[index];
    if (!layout) return;
    table.setAttribute("data-docx-width", String(layout.width));
    table.setAttribute("style", `width:${layout.width}%`);
    for (const row of table.querySelectorAll("tr")) {
      row.querySelectorAll("th,td").forEach((cell, cellIndex) => {
        const width = layout.columns[cellIndex];
        if (!width) return;
        cell.setAttribute("data-colwidth", String(width * 8));
        cell.setAttribute("style", `width:${width}%`);
      });
    }
  });
  return root.toString();
}

function readDocxFidelity(filePath) {
  const zip = new AdmZip(filePath);
  const documentXml = readEntry(zip, "word/document.xml");
  const commentsXml = readEntry(zip, "word/comments.xml");
  const metadata = {
    comments: extractComments(documentXml, commentsXml),
    revisions: extractTrackedChanges(documentXml),
    images: extractImageLayouts(documentXml),
    tables: extractTableLayouts(documentXml),
  };
  return metadata;
}

module.exports = { applyLayoutMetadata, decodeXml, extractComments, extractImageLayouts, extractTableLayouts, extractTrackedChanges, readDocxFidelity };
