// 本文件由 P2 重构自 electron/main.cjs 机械搬迁（scripts/refactor-split.cjs），逻辑未改动。
"use strict";

const { fileURLToPath, pathToFileURL } = require("node:url");
const { parse: parseHtml } = require("node-html-parser");
const { writeFileAtomic, writeJsonAtomic, withProjectTransaction, writeProjectFiles } = require("./project-storage.cjs");
const creativeWorkspace = require("./creative-workspace.cjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  AlignmentType, CommentRangeEnd, CommentRangeStart, CommentReference, DeletedTextRun, Document, HeadingLevel,
  ImageRun, InsertedTextRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} = require("docx");
const __dep0 = require("./project-files.cjs");
const __dep1 = require("./project-ops.cjs");

function nowIso(...args) { return __dep0.nowIso.apply(null, args); }
function exportCategorySegments(...args) { return __dep0.exportCategorySegments(...args); }
function exportTimestamp(...args) { return __dep0.exportTimestamp(...args); }
function createUniqueDirectory(...args) { return __dep0.createUniqueDirectory(...args); }
function uniqueExportFileName(...args) { return __dep0.uniqueExportFileName(...args); }
function sanitizeDocxText(...args) { return __dep0.sanitizeDocxText(...args); }
function normalizeExportedDocxBuffer(...args) { return __dep0.normalizeExportedDocxBuffer(...args); }
function getChapterPath(...args) { return __dep0.getChapterPath(...args); }
function isHtmlContent(...args) { return __dep0.isHtmlContent(...args); }
function decodeBasicEntities(...args) { return __dep0.decodeBasicEntities(...args); }
function contentToPlainText(...args) { return __dep0.contentToPlainText(...args); }
function promoteMarkdownHeadingsInHtml(...args) { return __dep0.promoteMarkdownHeadingsInHtml(...args); }
function loadCharacters(...args) { return __dep0.loadCharacters(...args); }
function loadWorldDocs(...args) { return __dep0.loadWorldDocs(...args); }
function getKnowledgeRole(...args) { return __dep0.getKnowledgeRole(...args); }
function characterToMarkdown(...args) { return __dep0.characterToMarkdown(...args); }
function loadConfig(...args) { return __dep1.loadConfig(...args); }

function stripMarkdown(text) {
  return contentToPlainText(text);
}


function createDocxReviewContext(annotations = [], revisions = []) {
  const comments = annotations
    .filter((item) => item?.quote && item?.comment)
    .map((item, index) => ({ ...item, commentId: index }));
  const tracked = revisions
    .filter((item) => item && ["待确认", "部分采纳", "已采纳"].includes(item.status) && (item.original || item.replacement))
    .map((item, index) => ({ ...item, revisionId: index * 2 + 1 }));
  return { comments, revisions: tracked };
}


function reviewRunsForText(text, options = {}, reviewContext = null) {
  const clean = sanitizeDocxText(String(text || ""));
  if (!clean || !reviewContext) return clean ? [new TextRun({ text: clean, ...options })] : [];
  const commentCandidates = [];
  for (const item of reviewContext.comments || []) {
    const quote = sanitizeDocxText(String(item.quote || "")).replace(/\s+/g, " ").trim();
    const start = quote ? clean.indexOf(quote) : -1;
    if (start >= 0) commentCandidates.push({ kind: "comment", start, end: start + quote.length, item });
  }
  const revisionCandidates = [];
  for (const item of reviewContext.revisions || []) {
    const anchorText = item.status === "已采纳" ? item.replacement : item.original;
    const anchor = sanitizeDocxText(String(anchorText || "")).replace(/\s+/g, " ").trim();
    const start = anchor ? clean.indexOf(anchor) : -1;
    if (start >= 0) revisionCandidates.push({ kind: "revision", start, end: start + anchor.length, item });
  }
  revisionCandidates.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const selectedRevisions = [];
  for (const candidate of revisionCandidates) {
    if (selectedRevisions.some((item) => candidate.start < item.end && candidate.end > item.start)) continue;
    selectedRevisions.push(candidate);
  }
  commentCandidates.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const selectedComments = [];
  for (const candidate of commentCandidates) {
    const revision = /** @type {any} */ (selectedRevisions.find((item) => candidate.start < item.end && candidate.end > item.start));
    if (revision) {
      revision.comments = [...(revision.comments || []), candidate.item];
      continue;
    }
    if (selectedComments.some((item) => candidate.start < item.end && candidate.end > item.start)) continue;
    selectedComments.push(candidate);
  }
  const selected = [...selectedRevisions, ...selectedComments];
  selected.sort((a, b) => a.start - b.start);
  if (!selected.length) return [new TextRun({ text: clean, ...options })];
  const runs = [];
  let cursor = 0;
  for (const match of /** @type {any} */ (selected)) {
    if (match.start > cursor) runs.push(new TextRun({ text: clean.slice(cursor, match.start), ...options }));
    if (match.kind === "comment") {
      runs.push(new CommentRangeStart(match.item.commentId));
      runs.push(new TextRun({ text: clean.slice(match.start, match.end), ...options }));
      runs.push(new CommentRangeEnd(match.item.commentId));
      runs.push(new CommentReference(match.item.commentId));
    } else {
      for (const comment of match.comments || []) runs.push(new CommentRangeStart(comment.commentId));
      const author = sanitizeDocxText(match.item.instruction || "AI小说创作平台").slice(0, 80) || "AI小说创作平台";
      const date = match.item.updatedAt || nowIso();
      if (match.item.original) runs.push(new DeletedTextRun({ id: match.item.revisionId, author, date, text: sanitizeDocxText(match.item.original), ...options }));
      if (match.item.replacement) runs.push(new InsertedTextRun({ id: match.item.revisionId + 1, author, date, text: sanitizeDocxText(match.item.replacement), ...options }));
      for (const comment of [...(match.comments || [])].reverse()) {
        runs.push(new CommentRangeEnd(comment.commentId));
        runs.push(new CommentReference(comment.commentId));
      }
    }
    cursor = match.end;
  }
  if (cursor < clean.length) runs.push(new TextRun({ text: clean.slice(cursor), ...options }));
  return runs;
}


function textRunsFromMarkdown(text, options = {}, reviewContext = null) {
  const clean = sanitizeDocxText(stripMarkdown(text));
  if (!clean) return [new TextRun({ text: "" })];
  return reviewRunsForText(clean, { bold: Boolean(options.bold), italics: Boolean(options.italics), size: options.size }, reviewContext);
}


function parseMarkdownTable(lines, startIndex) {
  const tableLines = [];
  let index = startIndex;
  while (index < lines.length && /^\s*\|.+\|\s*$/.test(lines[index])) {
    tableLines.push(lines[index]);
    index += 1;
  }
  if (tableLines.length < 2 || !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(tableLines[1])) {
    return null;
  }
  const rows = [tableLines[0], ...tableLines.slice(2)].map((line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => sanitizeDocxText(stripMarkdown(cell))),
  );
  return { rows, nextIndex: index };
}


/** @returns {any[]} mixed Paragraph/Table runs produced from markdown. */
function markdownToDocxChildren(markdown, reviewContext = null) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const children = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      children.push(new Paragraph({ text: "" }));
      continue;
    }

    const table = parseMarkdownTable(lines, index);
    if (table) {
      const columnCount = Math.max(...table.rows.map((row) => row.length));
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: table.rows.map(
            (row, rowIndex) =>
              new TableRow({
                children: Array.from({ length: columnCount }).map((_, cellIndex) =>
                  new TableCell({
                    width: { size: Math.floor(100 / columnCount), type: WidthType.PERCENTAGE },
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: sanitizeDocxText(row[cellIndex] || ""),
                            bold: rowIndex === 0,
                          }),
                        ],
                      }),
                    ],
                  }),
                ),
              }),
          ),
        }),
      );
      index = table.nextIndex - 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const headingMap = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6,
      };
      children.push(
        new Paragraph({
          heading: headingMap[level],
          children: textRunsFromMarkdown(heading[2], { bold: true }, reviewContext),
        }),
      );
      continue;
    }

    const quote = trimmed.match(/^>\s*(.+)$/);
    if (quote) {
      children.push(
        new Paragraph({
          indent: { left: 420 },
          children: textRunsFromMarkdown(quote[1], { italics: true }, reviewContext),
        }),
      );
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: textRunsFromMarkdown(bullet[1], {}, reviewContext),
        }),
      );
      continue;
    }

    const image = trimmed.match(/^!\[([^\]]*)]\(([^)]+)\)$/);
    if (image) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: image[1] || "图片", italics: true })],
        }),
      );
      continue;
    }

    children.push(
      new Paragraph({
        spacing: { after: 160 },
        children: textRunsFromMarkdown(trimmed, {}, reviewContext),
      }),
    );
  }

  return children.length ? children : [new Paragraph({ text: "" })];
}


function normalizeHtmlText(text) {
  return sanitizeDocxText(decodeBasicEntities(String(text || "").replace(/\s+/g, " ")).trim());
}


function htmlInlineRuns(node, options = {}, reviewContext = null) {
  const runs = [];
  const children = node.childNodes || [];
  if (!children.length) {
    const text = normalizeHtmlText(node.text || node.rawText || "");
    return text ? reviewRunsForText(text, { bold: options.bold, italics: options.italics, underline: options.underline }, reviewContext) : [];
  }
  for (const child of children) {
    if (child.nodeType === 3) {
      const text = normalizeHtmlText(child.rawText || child.text || "");
      if (text) runs.push(...reviewRunsForText(text, { bold: options.bold, italics: options.italics, underline: options.underline }, reviewContext));
      continue;
    }
    const tag = String(child.rawTagName || child.tagName || "").toLowerCase();
    if (tag === "br") {
      runs.push(new TextRun({ text: "\n" }));
      continue;
    }
    runs.push(
      ...htmlInlineRuns(child, {
        bold: options.bold || tag === "strong" || tag === "b" || tag === "th",
        italics: options.italics || tag === "em" || tag === "i",
        underline: options.underline || tag === "u",
      }, reviewContext),
    );
  }
  return runs;
}


async function imageRunFromHtmlNode(node) {
  const src = node.getAttribute?.("src") || "";
  if (!src || src.startsWith("http")) return null;
  try {
    let buffer;
    if (src.startsWith("data:")) {
      const base64 = src.split(",")[1] || "";
      buffer = Buffer.from(base64, "base64");
    } else if (src.startsWith("file://")) {
      buffer = await fs.readFile(fileURLToPath(src));
    } else {
      buffer = await fs.readFile(src);
    }
    const sourceWidth = Number(node.getAttribute?.("data-docx-width") || node.getAttribute?.("width") || 560);
    const sourceHeight = Number(node.getAttribute?.("data-docx-height") || node.getAttribute?.("height") || 320);
    const width = Math.max(1, Math.min(640, Number.isFinite(sourceWidth) ? sourceWidth : 560));
    const ratio = sourceWidth > 0 && sourceHeight > 0 ? sourceHeight / sourceWidth : 320 / 560;
    const height = Math.max(1, Math.round(width * ratio));
    return new ImageRun(/** @type {any} */ ({ data: buffer, transformation: { width, height } }));
  } catch {
    return null;
  }
}


async function htmlNodeToDocxBlocks(node, reviewContext = null) {
  const blocks = [];
  const tag = String(node.rawTagName || node.tagName || "").toLowerCase();
  if (!tag) {
    const text = normalizeHtmlText(node.rawText || node.text || "");
    return text ? [new Paragraph({ children: [new TextRun({ text })] })] : [];
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    const headingMap = {
      1: HeadingLevel.HEADING_1,
      2: HeadingLevel.HEADING_2,
      3: HeadingLevel.HEADING_3,
      4: HeadingLevel.HEADING_4,
      5: HeadingLevel.HEADING_5,
      6: HeadingLevel.HEADING_6,
    };
    return [new Paragraph({ heading: headingMap[level], children: htmlInlineRuns(node, { bold: true }, reviewContext) })];
  }

  if (tag === "table") {
    const tableWidth = Math.max(10, Math.min(100, Number(node.getAttribute?.("data-docx-width") || String(node.getAttribute?.("style") || "").match(/width\s*:\s*(\d+(?:\.\d+)?)%/i)?.[1] || 100)));
    const rows = node.querySelectorAll("tr").map((row) => {
      const cells = row.querySelectorAll("th,td");
      const columnCount = Math.max(1, cells.length);
      return new TableRow({
        children: cells.map(
          (cell) =>
            new TableCell({
              width: { size: Math.max(3, Math.min(100, Number(cell.getAttribute?.("style")?.match(/width\s*:\s*(\d+(?:\.\d+)?)%/i)?.[1] || Math.floor(100 / columnCount)))), type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({
                  children: htmlInlineRuns(cell, { bold: String(cell.rawTagName || cell.tagName).toLowerCase() === "th" }, reviewContext),
                }),
              ],
            }),
        ),
      });
    });
    return rows.length
      ? [
          new Table({
            width: { size: tableWidth, type: WidthType.PERCENTAGE },
            rows,
          }),
        ]
      : [];
  }

  if (tag === "ul" || tag === "ol") {
    for (const li of node.querySelectorAll("li")) {
      blocks.push(
        new Paragraph({
          bullet: tag === "ul" ? { level: 0 } : undefined,
          numbering: tag === "ol" ? { reference: "default-numbering", level: 0 } : undefined,
          children: htmlInlineRuns(li, {}, reviewContext),
        }),
      );
    }
    return blocks;
  }

  if (tag === "blockquote") {
    return [
      new Paragraph({
        indent: { left: 420 },
        children: htmlInlineRuns(node, { italics: true }, reviewContext),
      }),
    ];
  }

  if (tag === "img") {
    const imageRun = await imageRunFromHtmlNode(node);
    const imageAlign = String(node.getAttribute?.("data-docx-align") || "center").toLowerCase();
    return [
      new Paragraph({
        alignment: imageAlign === "left" ? AlignmentType.LEFT : imageAlign === "right" ? AlignmentType.RIGHT : AlignmentType.CENTER,
        children: imageRun ? [imageRun] : [new TextRun({ text: sanitizeDocxText(node.getAttribute?.("alt") || "图片"), italics: true })],
      }),
    ];
  }

  if (tag === "p" || tag === "div") {
    const images = node.querySelectorAll("img");
    if (images.length === 1 && normalizeHtmlText(node.text || "") === "") {
      const imageRun = await imageRunFromHtmlNode(images[0]);
      const imageAlign = String(images[0].getAttribute?.("data-docx-align") || "center").toLowerCase();
      return [new Paragraph({ alignment: imageAlign === "left" ? AlignmentType.LEFT : imageAlign === "right" ? AlignmentType.RIGHT : AlignmentType.CENTER, children: imageRun ? [imageRun] : [new TextRun({ text: sanitizeDocxText("图片") })] })];
    }
    const runs = htmlInlineRuns(node, {}, reviewContext);
    return runs.length ? [new Paragraph({ spacing: { after: 160 }, children: runs })] : [new Paragraph({ text: "" })];
  }

  for (const child of node.childNodes || []) {
    blocks.push(...(await htmlNodeToDocxBlocks(child, reviewContext)));
  }
  return blocks;
}


async function htmlToDocxChildren(html, reviewContext = null) {
  const root = parseHtml(promoteMarkdownHeadingsInHtml(String(html || "")));
  const blocks = [];
  for (const child of root.childNodes) {
    blocks.push(...(await htmlNodeToDocxBlocks(child, reviewContext)));
  }
  return blocks.length ? blocks : [new Paragraph({ text: "" })];
}


async function exportContentToDocx(title, content, targetFile, description = "由 AI小说创作平台导出的文档", reviewData = {}) {
  const reviewContext = createDocxReviewContext(reviewData.annotations || [], reviewData.revisions || []);
  let children;
  if (isHtmlContent(content)) {
    children = await htmlToDocxChildren(content, reviewContext);
  } else {
    children = markdownToDocxChildren(content, reviewContext);
  }
  const doc = new Document({
    creator: "AI小说创作平台",
    title: sanitizeDocxText(title),
    description: sanitizeDocxText(description),
    comments: reviewContext.comments.length ? {
      children: reviewContext.comments.map((item) => ({
        id: item.commentId,
        author: sanitizeDocxText(item.origin === "ai" ? "AI小说创作平台" : "作者"),
        initials: item.origin === "ai" ? "AI" : "作者",
        date: new Date(item.updatedAt || nowIso()),
        children: [new Paragraph({ children: [new TextRun({ text: sanitizeDocxText(item.comment) })] })],
      })),
    } : undefined,
    features: { trackRevisions: reviewContext.revisions.length > 0 },
    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });
  const buffer = await normalizeExportedDocxBuffer(await Packer.toBuffer(doc));
  await writeFileAtomic(targetFile, buffer);
  return targetFile;
}


async function exportChapterToDocx(projectPath, chapter, targetFile) {
  const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8");
  const workspace = await creativeWorkspace.loadWorkspace(projectPath);
  return exportContentToDocx(chapter.title, content, targetFile, "由 AI小说创作平台导出的目录树文档", {
    annotations: workspace.annotations.filter((item) => item.chapterId === chapter.id),
    revisions: workspace.revisions.filter((item) => item.chapterId === chapter.id),
  });
}


async function exportBookDocumentsToDirectory(projectPath, parentDirectory, options = {}) {
  const config = await loadConfig(projectPath);
  const includedRoles = new Set(["正文"]);
  if (options.includeOutline) includedRoles.add("大纲");
  if (options.includeMaterials) includedRoles.add("补充材料");

  const chapters = config.chapters
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter((chapter) => includedRoles.has(getKnowledgeRole(chapter)));
  const characters = options.includeCharacters ? await loadCharacters(projectPath) : [];
  const worldDocs = options.includeWorld ? await loadWorldDocs(projectPath) : [];
  if (!chapters.length && !characters.length && !worldDocs.length) {
    throw new Error("当前导出选项下没有可导出的文档。");
  }

  const rootName = `${config.title || "未命名小说"}_逐篇导出_${exportTimestamp()}`;
  const directoryPath = await createUniqueDirectory(parentDirectory, rootName);
  const exportedFiles = [];
  const failures = [];

  async function exportOne({ directorySegments, title, sourceType, sourceId, write }) {
    try {
      const categoryDirectory = path.join(directoryPath, ...directorySegments);
      await fs.mkdir(categoryDirectory, { recursive: true });
      const fileName = await uniqueExportFileName(categoryDirectory, title);
      const filePath = path.join(categoryDirectory, fileName);
      await write(filePath);
      exportedFiles.push({ sourceType, sourceId, title, filePath });
    } catch (error) {
      failures.push({ sourceType, sourceId, title, message: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const chapter of chapters) {
    await exportOne({
      directorySegments: exportCategorySegments(chapter.volume, "未分卷"),
      title: chapter.title,
      sourceType: "chapter",
      sourceId: chapter.id,
      write: (filePath) => exportChapterToDocx(projectPath, chapter, filePath),
    });
  }

  for (const card of characters) {
    await exportOne({
      directorySegments: ["角色卡", ...exportCategorySegments(card.category, "未分类")],
      title: card.name,
      sourceType: "character",
      sourceId: card.id,
      write: (filePath) => exportContentToDocx(card.name, characterToMarkdown(card), filePath, "由 AI小说创作平台导出的角色卡"),
    });
  }

  for (const worldDoc of worldDocs) {
    await exportOne({
      directorySegments: ["世界观", ...exportCategorySegments(worldDoc.category, "未分类")],
      title: worldDoc.title,
      sourceType: "world",
      sourceId: worldDoc.id,
      write: (filePath) => exportContentToDocx(worldDoc.title, worldDoc.content, filePath, "由 AI小说创作平台导出的世界观文档"),
    });
  }

  return {
    directoryPath,
    exportedCount: exportedFiles.length,
    failedCount: failures.length,
    chapterCount: chapters.length,
    characterCount: characters.length,
    worldCount: worldDocs.length,
    files: exportedFiles,
    failures,
  };
}


async function chapterContentToDocxChildren(content) {
  return isHtmlContent(content) ? htmlToDocxChildren(content) : markdownToDocxChildren(content);
}


async function exportBookToDocx(projectPath, targetFile, options = {}) {
  const config = await loadConfig(projectPath);
  const chapters = config.chapters.slice().sort((a, b) => a.order - b.order);
  const bodyChapters = chapters.filter((chapter) => getKnowledgeRole(chapter) === "正文");
  const outlineChapters = chapters.filter((chapter) => getKnowledgeRole(chapter) === "大纲");
  const children = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: sanitizeDocxText(config.title || "未命名小说"), bold: true, size: 36 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: sanitizeDocxText(config.author ? `作者：${config.author}` : "由 AI小说创作平台导出"), size: 22 })],
    }),
    new Paragraph({ text: "" }),
  ];
  let currentVolume = "";
  for (const chapter of bodyChapters) {
    const volume = chapter.volume || "未分卷";
    if (volume !== currentVolume) {
      currentVolume = volume;
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: children.length > 3,
          children: [new TextRun({ text: sanitizeDocxText(volume), bold: true })],
        }),
      );
    }
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: sanitizeDocxText(chapter.title || "未命名章节"), bold: true })],
      }),
    );
    const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
    const blocks = await chapterContentToDocxChildren(content);
    children.push(...blocks, new Paragraph({ text: "" }));
  }
  if (options.includeOutline) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun({ text: "大纲目录", bold: true })] }));
    for (const chapter of outlineChapters) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: sanitizeDocxText(`${chapter.volume || "未分卷"} / ${chapter.title}`), bold: true })] }));
      const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
      const blocks = await chapterContentToDocxChildren(content);
      children.push(...blocks, new Paragraph({ text: "" }));
    }
    if (bodyChapters.some((chapter) => chapter.outline?.length)) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "正文小标题目录", bold: true })] }));
    }
    for (const chapter of bodyChapters) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: sanitizeDocxText(`${chapter.volume || "未分卷"} / ${chapter.title}`), bold: true })] }));
      for (const item of chapter.outline || []) {
        children.push(
          new Paragraph({
            indent: { left: Math.max(0, (Number(item.level || 1) - 1) * 260) },
            children: [new TextRun({ text: sanitizeDocxText(`${"  ".repeat(Math.max(0, Number(item.level || 1) - 1))}${item.title}`) })],
          }),
        );
      }
    }
  }
  if (options.includeCharacters) {
    const characters = await loadCharacters(projectPath);
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun({ text: sanitizeDocxText("角色卡片"), bold: true })] }));
    for (const card of characters) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: sanitizeDocxText(card.name), bold: true })] }));
      children.push(...markdownToDocxChildren(characterToMarkdown(card)));
    }
  }
  if (options.includeWorld) {
    const worldDocs = await loadWorldDocs(projectPath);
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun({ text: sanitizeDocxText("世界观资料"), bold: true })] }));
    for (const doc of worldDocs) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: sanitizeDocxText(`${doc.category || "未分类"} / ${doc.title}`), bold: true })] }));
      children.push(...markdownToDocxChildren(doc.content));
    }
  }
  const doc = new Document({
    creator: "AI小说创作平台",
    title: sanitizeDocxText(config.title),
    description: sanitizeDocxText("由 AI小说创作平台导出的整书 Word 文档"),
    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  await writeFileAtomic(targetFile, buffer);
  return targetFile;
}




const __moduleExports = {
  stripMarkdown,
  createDocxReviewContext,
  reviewRunsForText,
  textRunsFromMarkdown,
  parseMarkdownTable,
  markdownToDocxChildren,
  normalizeHtmlText,
  htmlInlineRuns,
  imageRunFromHtmlNode,
  htmlNodeToDocxBlocks,
  htmlToDocxChildren,
  exportContentToDocx,
  exportChapterToDocx,
  exportBookDocumentsToDirectory,
  chapterContentToDocxChildren,
  exportBookToDocx,
};

// Augment the original exports object so cyclic requires (whose captured
// reference may be a Proxy over the pre-assignment exports) see every key.
Object.assign(module.exports, __moduleExports);
module.exports = __moduleExports;
