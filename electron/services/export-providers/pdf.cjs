"use strict";
// PDF 导出提供者（P79）：隐藏窗口 + webContents.printToPDF（Electron 内置，零新增依赖）。
// 中文字体/分页/页码为真机验证项（P 表 V2）；失败时明确报错，不产生半截文件。
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { collectBookChapters, contentToHtml, escapeXml } = require("./shared.cjs");
const { loadChapterContent } = require("../project-files.cjs");

const PRINT_CSS = `@page { size: A4; margin: 20mm 18mm; }
body { font-family: "Source Han Serif SC", "Noto Serif CJK SC", "SimSun", serif; font-size: 11pt; line-height: 1.9; color: #111; }
h1.book-title { text-align: center; font-size: 22pt; margin: 0 0 6pt; }
p.book-author { text-align: center; color: #444; margin: 0 0 30pt; }
section.chapter { page-break-before: always; }
section.chapter:first-of-type { page-break-before: auto; }
h2 { font-size: 15pt; margin: 0 0 12pt; }
p { margin: 0 0 8pt; text-indent: 2em; }
img { max-width: 100%; }
table { border-collapse: collapse; } td, th { border: 1px solid #888; padding: 3px 6px; }`;

async function exportPdf(projectPath, targetFile) {
  // 惰性 require：纯 Node 服务测试加载注册表时不触发 electron API。
  const { BrowserWindow } = require("electron");
  const { config, chapters } = await collectBookChapters(projectPath);
  if (!chapters.length) throw new Error("没有可导出的正文章节。");
  const sections = [];
  for (const chapter of chapters) {
    const { content } = await loadChapterContent(projectPath, chapter.id);
    sections.push(`<section class="chapter"><h2>${escapeXml(chapter.title || "")}</h2>${contentToHtml(content)}</section>`);
  }
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/><title>${escapeXml(config.title || "未命名小说")}</title><style>${PRINT_CSS}</style></head>
<body><h1 class="book-title">${escapeXml(config.title || "未命名小说")}</h1><p class="book-author">${escapeXml(config.author || "")}</p>${sections.join("")}</body></html>`;
  const tempHtml = path.join(os.tmpdir(), `novel-pdf-${process.pid}-${Date.now()}.html`);
  await fs.writeFile(tempHtml, html, "utf8");
  let window = null;
  try {
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await window.loadFile(tempHtml);
    const buffer = await window.webContents.printToPDF({
      pageSize: "A4",
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      headerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#666;">${escapeXml(config.title || "")}</div>`,
      footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#666;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
      displayHeaderFooter: true,
    });
    await fs.writeFile(targetFile, buffer);
    return { files: [targetFile], warnings: [] };
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    await fs.rm(tempHtml, { force: true }).catch(() => {});
  }
}

module.exports = { id: "pdf", label: "PDF（印刷/投稿）", extension: ".pdf", mode: "file", export: exportPdf };