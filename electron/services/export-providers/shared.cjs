"use strict";
// 多格式导出共享工具（P79）：章节收集、HTML 归一、XHTML 序列化、图片提取。
const { marked } = require("marked");
const { parse } = require("node-html-parser");
const { getKnowledgeRole } = require("../project-files.cjs");
const { loadConfig } = require("../project-ops.cjs");

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

async function collectBookChapters(projectPath) {
  const config = await loadConfig(projectPath);
  const chapters = config.chapters
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter((chapter) => getKnowledgeRole(chapter) === "正文");
  return { config, chapters };
}

function contentToHtml(content) {
  const text = String(content || "");
  if (/<\s*(p|div|h[1-6]|br|table|ul|ol)\b/i.test(text)) return text;
  return marked.parse(text, { async: false });
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 将 HTML 序列化为良构 XHTML（EPUB 要求）；data: 图片提取到 images.list 并改写 src，非内嵌引用计入 images.skipped。 */
function htmlToXhtml(html, images) {
  const root = parse(String(html || ""), { blockTextElements: { script: false, noscript: false, style: false } });
  const serialize = (node) => {
    if (node.nodeType === 3) return escapeXml(node.text);
    if (node.nodeType !== 1) return "";
    const tag = String(node.tagName || "").toLowerCase();
    if (!tag) return node.childNodes.map(serialize).join("");
    if (tag === "script" || tag === "style" || tag === "iframe" || tag === "object") return "";
    let attrs = Object.entries(node.attributes || {})
      .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
      .join("");
    if (tag === "img") {
      const src = String(node.getAttribute("src") || "");
      const match = src.match(/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,(.+)$/i);
      if (match && images) {
        const ext = match[1].toLowerCase().replace("jpeg", "jpg").replace("svg+xml", "svg");
        const name = `images/img-${images.list.length + 1}.${ext}`;
        images.list.push({ name, buffer: Buffer.from(match[2], "base64") });
        attrs = attrs.replace(/src="[^"]*"/, `src="${name}"`);
      } else if (src && !src.startsWith("images/") && images) {
        images.skipped += 1;
      }
    }
    const children = node.childNodes.map(serialize).join("");
    if (VOID_TAGS.has(tag)) return `<${tag}${attrs}/>`;
    return `<${tag}${attrs}>${children}</${tag}>`;
  };
  return root.childNodes.map(serialize).join("");
}

module.exports = { collectBookChapters, contentToHtml, escapeXml, htmlToXhtml };