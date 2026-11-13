"use strict";
// EPUB3 导出提供者（P79）：零新增依赖（adm-zip 既有）。
// mimetype 为首个存储（不压缩）条目；章节转良构 XHTML；data: 图片提取为资源文件。
const path = require("node:path");
const crypto = require("node:crypto");
const AdmZip = require("adm-zip");
const { collectBookChapters, contentToHtml, escapeXml, htmlToXhtml } = require("./shared.cjs");
const { loadChapterContent } = require("../project-files.cjs");

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const STYLE_CSS = `body { font-family: serif; line-height: 1.8; margin: 5%; }
h1, h2, h3 { font-weight: 700; line-height: 1.4; }
p { margin: 0 0 0.8em; text-indent: 2em; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; } td, th { border: 1px solid #999; padding: 4px 8px; }`;

async function exportEpub(projectPath, targetFile) {
  const { config, chapters } = await collectBookChapters(projectPath);
  if (!chapters.length) throw new Error("没有可导出的正文章节。");
  const bookId = `urn:uuid:${crypto.randomUUID()}`;
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const images = { list: [], skipped: 0 };
  const items = [];
  const spine = [];
  const navItems = [];
  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    const { content } = await loadChapterContent(projectPath, chapter.id);
    const href = `chapter-${String(index + 1).padStart(4, "0")}.xhtml`;
    const body = htmlToXhtml(contentToHtml(content), images);
    const title = escapeXml(chapter.title || `第${index + 1}章`);
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">
<head><title>${title}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><h2>${title}</h2>${body}</body>
</html>`;
    items.push({ id: `ch${index + 1}`, href, media: "application/xhtml+xml", content: xhtml });
    spine.push(`ch${index + 1}`);
    navItems.push(`<li><a href="${href}">${title}</a></li>`);
  }
  const imageItems = images.list.map((image, index) => ({
    id: `img${index + 1}`,
    href: image.name,
    media: `image/${path.extname(image.name).slice(1).replace("jpg", "jpeg")}`,
    buffer: image.buffer,
  }));
  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="css" href="style.css" media-type="text/css"/>`,
    ...items.map((item) => `<item id="${item.id}" href="${item.href}" media-type="${item.media}"/>`),
    ...imageItems.map((item) => `<item id="${item.id}" href="${item.href}" media-type="${item.media}"/>`),
  ].join("\n    ");
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${bookId}</dc:identifier>
    <dc:title>${escapeXml(config.title || "未命名小说")}</dc:title>
    <dc:creator>${escapeXml(config.author || "佚名")}</dc:creator>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    ${manifest}
  </manifest>
  <spine>
    ${spine.map((id) => `<itemref idref="${id}"/>`).join("\n    ")}
  </spine>
</package>`;
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><title>目录</title></head>
<body><nav epub:type="toc" id="toc"><h1>目录</h1><ol>${navItems.join("")}</ol></nav></body>
</html>`;

  // noSort 保持 mimetype 为首个条目（EPUB OCF 规范）；method=0 使其不压缩。
  const zip = new AdmZip(null, { noSort: true });
  zip.addFile("mimetype", Buffer.from("application/epub+zip", "utf8"));
  zip.getEntry("mimetype").header.method = 0;
  zip.addFile("META-INF/container.xml", Buffer.from(CONTAINER_XML, "utf8"));
  zip.addFile("OEBPS/content.opf", Buffer.from(opf, "utf8"));
  zip.addFile("OEBPS/nav.xhtml", Buffer.from(nav, "utf8"));
  zip.addFile("OEBPS/style.css", Buffer.from(STYLE_CSS, "utf8"));
  for (const item of items) zip.addFile(`OEBPS/${item.href}`, Buffer.from(item.content, "utf8"));
  for (const image of imageItems) zip.addFile(`OEBPS/${image.href}`, image.buffer);
  zip.writeZip(targetFile);
  const warnings = [];
  if (images.skipped) warnings.push(`${images.skipped} 处非内嵌图片引用未打包（EPUB 仅携带内嵌 data: 图片）。`);
  return { files: [targetFile], warnings };
}

module.exports = { id: "epub", label: "EPUB 电子书", extension: ".epub", mode: "file", export: exportEpub };