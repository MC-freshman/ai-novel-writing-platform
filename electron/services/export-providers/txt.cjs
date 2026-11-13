"use strict";
// 平台 TXT 导出提供者（P79）：逐章 UTF-8 文本，序号-标题命名，可选分卷目录。
const path = require("node:path");
const fs = require("node:fs/promises");
const { collectBookChapters } = require("./shared.cjs");
const { loadChapterContent, contentToPlainText, sanitizeFileName, createUniqueDirectory, exportTimestamp } = require("../project-files.cjs");

async function exportTxt(projectPath, targetDirectory, options = {}) {
  const { config, chapters } = await collectBookChapters(projectPath);
  if (!chapters.length) throw new Error("没有可导出的正文章节。");
  const rootName = `${sanitizeFileName(config.title || "未命名小说")}_TXT_${exportTimestamp()}`;
  const directoryPath = await createUniqueDirectory(targetDirectory, rootName);
  const files = [];
  const warnings = [];
  let imageCount = 0;
  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    const { content } = await loadChapterContent(projectPath, chapter.id);
    const plain = contentToPlainText(content);
    if (/<img\b/i.test(content)) imageCount += 1;
    const segments = options.byVolume ? [sanitizeFileName(chapter.volume || "未分卷")] : [];
    const directory = path.join(directoryPath, ...segments);
    await fs.mkdir(directory, { recursive: true });
    const fileName = `${String(index + 1).padStart(3, "0")}-${sanitizeFileName(chapter.title || `第${index + 1}章`)}.txt`;
    const filePath = path.join(directory, fileName);
    const header = options.titleLine === false ? "" : `${chapter.title || ""}\n\n`;
    await fs.writeFile(filePath, `${header}${plain}\n`, "utf8");
    files.push(filePath);
  }
  if (imageCount) warnings.push(`${imageCount} 章含图片，TXT 格式不携带图片（原文保留在项目中）。`);
  return { files, warnings, directoryPath };
}

module.exports = { id: "txt", label: "平台 TXT（逐章）", extension: ".txt", mode: "directory", export: exportTxt };