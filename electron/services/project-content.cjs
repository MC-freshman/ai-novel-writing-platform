// 本文件由 P2 重构自 electron/main.cjs 机械搬迁（scripts/refactor-split.cjs），逻辑未改动。
"use strict";

const { fileURLToPath, pathToFileURL } = require("node:url");
const { createWriteStream, existsSync } = require("node:fs");
const mammoth = require("./word-import.cjs");
const { writeFileAtomic, writeJsonAtomic, withProjectTransaction, writeProjectFiles } = require("./project-storage.cjs");
const vectorShards = require("./vector-shards.cjs");
const creativeWorkspace = require("./creative-workspace.cjs");
const operationJournal = require("./operation-journal.cjs");
const docxFidelity = require("./docx-fidelity.cjs");
const __dep0 = require("./project-files.cjs");
const __dep1 = require("./project-config.cjs");
const __dep2 = require("./knowledge-index.cjs");
const __dep3 = require("./analysis-tools.cjs");
const __dep4 = require("./task-runtime.cjs");
const __dep5 = require("./project-ops.cjs");
const path = require("node:path");
const fs = require("node:fs/promises");

function nowIso(...args) { return __dep0.nowIso.apply(null, args); }
function todayKey(...args) { return __dep0.todayKey.apply(null, args); }
function makeId(...args) { return __dep0.makeId(...args); }
function sanitizeFileName(...args) { return __dep0.sanitizeFileName(...args); }
function countWords(...args) { return __dep0.countWords(...args); }
function ensureDir(...args) { return __dep0.ensureDir(...args); }
function getConfigPath(...args) { return __dep0.getConfigPath(...args); }
function getChapterPath(...args) { return __dep0.getChapterPath(...args); }
function contentRevision(...args) { return __dep0.contentRevision(...args); }
function getOriginalDocumentPath(...args) { return __dep0.getOriginalDocumentPath(...args); }
function uniqueFileName(...args) { return __dep0.uniqueFileName(...args); }
function uniqueChapterFileName(...args) { return __dep0.uniqueChapterFileName(...args); }
function ensureExclusiveChapterFile(...args) { return __dep0.ensureExclusiveChapterFile(...args); }
function extensionFromContentType(...args) { return __dep0.extensionFromContentType(...args); }
function contentToPlainText(...args) { return __dep0.contentToPlainText(...args); }
function promoteMarkdownHeadingsInHtml(...args) { return __dep0.promoteMarkdownHeadingsInHtml(...args); }
function getChapterVersionContentPath(...args) { return __dep0.getChapterVersionContentPath(...args); }
function snapshotChapterVersion(...args) { return __dep0.snapshotChapterVersion(...args); }
function listChapterVersions(...args) { return __dep0.listChapterVersions(...args); }
function loadCharacters(...args) { return __dep0.loadCharacters(...args); }
function loadWorldDocs(...args) { return __dep0.loadWorldDocs(...args); }
function loadChapterContent(...args) { return __dep0.loadChapterContent(...args); }
function extractOutline(...args) { return __dep0.extractOutline(...args); }
function getKnowledgeRole(...args) { return __dep0.getKnowledgeRole(...args); }
function configForRenderer(...args) { return __dep1.configForRenderer(...args); }
function assertExpectedChapterRevision(...args) { return __dep1.assertExpectedChapterRevision(...args); }
// embeddingFallback is shared mutable STATE (an object) in knowledge-index, not a
// function. Resolve it at use time so cyclic load order cannot capture a partial
// module: see the `{ ...__dep2.embeddingFallback }` spreads below.
function indexSource(...args) { return __dep2.indexSource(...args); }
function refreshLocalStoryState(...args) { return __dep3.refreshLocalStoryState(...args); }
function scheduleIdleDeepAnalysis(...args) { return __dep4.scheduleIdleDeepAnalysis(...args); }
function ensureProjectStructure(...args) { return __dep5.ensureProjectStructure(...args); }
function loadConfig(...args) { return __dep5.loadConfig(...args); }
function saveConfig(...args) { return __dep5.saveConfig(...args); }
function buildAppState(...args) { return __dep5.buildAppState(...args); }
function createBackup(...args) { return __dep5.createBackup(...args); }

async function convertDocumentToRichContent(projectPath, filePath, importId) {
  const ext = path.extname(filePath).toLowerCase();
  const fallbackTitle = path.basename(filePath, ext);
  if (ext === ".docx") {
    const assetDir = path.join(projectPath, "assets", "imports", importId);
    const originalDir = path.join(projectPath, "documents", "imports", importId);
    await ensureDir(assetDir);
    await ensureDir(originalDir);
    const originalFileName = await uniqueFileName(originalDir, fallbackTitle, ".docx");
    const originalDocxPath = path.join(originalDir, originalFileName);
    await fs.copyFile(filePath, originalDocxPath);
    let imageIndex = 0;
    const result = await mammoth.convertToHtml(
      { path: filePath },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          imageIndex += 1;
          const extension = extensionFromContentType(image.contentType);
          const imageFile = await uniqueFileName(assetDir, `image_${String(imageIndex).padStart(3, "0")}`, extension);
          const imagePath = path.join(assetDir, imageFile);
          const buffer = image.readAsBuffer ? await image.readAsBuffer() : Buffer.from(await image.read("base64"), "base64");
          await writeFileAtomic(imagePath, buffer);
          return { src: pathToFileURL(imagePath).href };
        }),
      },
    );
    const fidelity = docxFidelity.readDocxFidelity(filePath);
    const body = promoteMarkdownHeadingsInHtml(docxFidelity.applyLayoutMetadata((result.value || "").trim(), fidelity));
    const startsWithHeading = /^<h[1-6]\b/i.test(body);
    return {
      title: fallbackTitle,
      content: body ? `${startsWithHeading ? "" : `<h1>${fallbackTitle}</h1>\n`}${body}\n` : "",
      contentFormat: "html",
      imageCount: imageIndex,
      originalDocxFile: path.relative(projectPath, originalDocxPath),
      comments: fidelity.comments,
      revisions: fidelity.revisions,
      warnings: (result.messages || []).map((item) => item.message || String(item)),
    };
  }
  if (ext === ".md") {
    const content = await fs.readFile(filePath, "utf8");
    return {
      title: fallbackTitle,
      content: content.trimStart().startsWith("#") ? content : `# ${fallbackTitle}\n\n${content}`,
      contentFormat: "markdown",
      imageCount: 0,
      originalDocxFile: "",
      comments: [],
      revisions: [],
      warnings: [],
    };
  }
  if (ext === ".txt") {
    const content = await fs.readFile(filePath, "utf8");
    return {
      title: fallbackTitle,
      content: `# ${fallbackTitle}\n\n${content}`,
      contentFormat: "markdown",
      imageCount: 0,
      originalDocxFile: "",
      comments: [],
      revisions: [],
      warnings: [],
    };
  }
  throw new Error("暂时只支持导入 .docx、.txt、.md 文件。");
}


async function importDocumentIntoProjectUnlocked(projectPath, filePath, options = {}) {
  const config = options.config || (await loadConfig(projectPath));
  const importId = makeId("import");
  const converted = await convertDocumentToRichContent(projectPath, filePath, importId);
  if (!converted.content.trim()) throw new Error("文档中没有可导入的正文内容。");
  const order = config.chapters.length;
  const fileName = await uniqueChapterFileName(projectPath, config, `document_${String(order + 1).padStart(3, "0")}_${converted.title}`, ".html");
  const volume = String(options.volume || "").trim() || "导入文档";
  const chapter = {
    id: makeId("chapter"),
    title: converted.title,
    volume,
    order,
    fileName,
    wordCount: countWords(converted.content),
    knowledgeRole: "正文",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    importedFrom: filePath,
    importId,
    imageCount: converted.imageCount,
    originalDocxFile: converted.originalDocxFile,
    contentFormat: converted.contentFormat,
    outline: extractOutline(converted.content),
  };
  chapter.contentRevision = contentRevision(converted.content);
  const previousTotalWords = config.stats.totalWords;
  config.chapters.push(chapter);
  config.stats.totalWords = config.chapters.reduce((sum, item) => sum + Number(item.wordCount || 0), 0);
  try {
    await writeProjectFiles(projectPath, [{ path: getChapterPath(projectPath, chapter), content: converted.content }, { path: getConfigPath(projectPath), content: JSON.stringify(config, null, 2) }]);
  } catch (error) {
    config.chapters.splice(config.chapters.indexOf(chapter), 1);
    config.stats.totalWords = previousTotalWords;
    throw error;
  }
  for (const [index, comment] of (converted.comments || []).entries()) {
    await creativeWorkspace.upsertItem(projectPath, "annotations", {
      id: `docx_comment_${chapter.id}_${comment.id || index}`,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      quote: comment.quote || chapter.title,
      comment: `${comment.author || "Word 批注"}${comment.date ? `（${comment.date}）` : ""}：${comment.comment}`,
      type: "作者批注",
      status: "待处理",
      sourceRevision: contentRevision(converted.content),
      origin: "manual",
    });
  }
  for (const [index, revision] of (converted.revisions || []).entries()) {
    const currentViewContainsReplacement = Boolean(revision.replacement && contentToPlainText(converted.content).includes(revision.replacement));
    await creativeWorkspace.upsertItem(projectPath, "revisions", {
      id: `docx_revision_${chapter.id}_${revision.id || index}`,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      action: "Word 修订",
      instruction: `${revision.author || "Word"}${revision.date ? `（${revision.date}）` : ""}导入的修订记录`,
      original: revision.original || "",
      replacement: revision.replacement || "",
      sourceRevision: contentRevision(converted.content),
      status: currentViewContainsReplacement ? "已采纳" : "待确认",
      error: "",
      appliedAt: currentViewContainsReplacement ? nowIso() : "",
      acceptedParts: currentViewContainsReplacement ? [{ original: revision.original || "", replacement: revision.replacement || "", appliedAt: nowIso() }] : [],
    });
  }

  const imported = {
    chapter,
    content: converted.content,
    imageCount: converted.imageCount,
    warnings: converted.warnings,
    commentCount: converted.comments?.length || 0,
    revisionCount: converted.revisions?.length || 0,
    source: {
      id: chapter.id,
      type: "chapter",
      title: chapter.title,
      volume: chapter.volume || "未分卷",
      category: chapter.volume || "未分卷",
      knowledgeRole: getKnowledgeRole(chapter),
      content: converted.content,
    },
  };

  if (options.skipFinalize) return [imported];

  await calculateTotalWords(projectPath, config);
  await saveConfig(projectPath, config);

  await indexSource(projectPath, imported.source);

  return [imported];
}


async function refreshChapterFromOriginalDocumentUnlocked(projectPath, chapterId, expectedRevision = "" ) {
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error("文档不存在，无法恢复 Word 格式。");

  const sourcePath = getOriginalDocumentPath(projectPath, chapter);
  if (!sourcePath || !existsSync(sourcePath)) {
    throw new Error("找不到导入时的原始 Word 文档，请重新导入 docx。");
  }

  const existingContent = await fs.readFile(getChapterPath(projectPath, chapter), "utf8");
  assertExpectedChapterRevision(expectedRevision, existingContent);
  await snapshotChapterVersion(projectPath, chapter, existingContent, "刷新 Word 原文前版本");
  await ensureExclusiveChapterFile(projectPath, config, chapter, existingContent, {
    reason: "恢复 Word 原文前自动拆分共享章节文件",
  });

  const oldPath = getChapterPath(projectPath, chapter);
  const backupDir = path.join(projectPath, "backups", "docx_refresh");
  await ensureDir(backupDir);
  let backupPath = "";
  if (existsSync(oldPath)) {
    const oldExt = path.extname(chapter.fileName) || ".txt";
    const backupName = await uniqueFileName(backupDir, `${sanitizeFileName(chapter.title)}_${Date.now()}_恢复前编辑副本`, oldExt);
    backupPath = path.join(backupDir, backupName);
    await fs.copyFile(oldPath, backupPath);
  }

  const importId = chapter.importId || makeId("import");
  const converted = await convertDocumentToRichContent(projectPath, sourcePath, importId);
  const currentExt = path.extname(chapter.fileName).toLowerCase();
  if (currentExt !== ".html") {
    const baseName = path.basename(chapter.fileName, path.extname(chapter.fileName)) || `document_${String(chapter.order + 1).padStart(3, "0")}_${chapter.title}`;
    chapter.fileName = await uniqueChapterFileName(projectPath, config, baseName, ".html", chapter.id);
  }

  chapter.wordCount = countWords(converted.content);
  chapter.outline = extractOutline(converted.content);
  chapter.updatedAt = nowIso();
  chapter.importId = importId;
  chapter.importedFrom = chapter.importedFrom || sourcePath;
  chapter.imageCount = converted.imageCount;
  chapter.originalDocxFile = converted.originalDocxFile || chapter.originalDocxFile;
  chapter.contentFormat = "html";

  chapter.contentRevision = contentRevision(converted.content);
  config.stats.totalWords = config.chapters.reduce((sum, item) => sum + Number(item.wordCount || 0), 0);
  await writeProjectFiles(projectPath, [{ path: getChapterPath(projectPath, chapter), content: converted.content }, { path: getConfigPath(projectPath), content: JSON.stringify(config, null, 2) }]);

  const indexResult = await indexSource(projectPath, {
    id: chapter.id,
    type: "chapter",
    title: chapter.title,
    volume: chapter.volume || "未分卷",
    category: chapter.volume || "未分卷",
    knowledgeRole: getKnowledgeRole(chapter),
    content: converted.content,
  });
  if (config.agent?.autoLocalAnalysis !== false) {
    await refreshLocalStoryState(projectPath, chapter.id, converted.content).catch(() => null);
  }

  return {
    state: await buildAppState(projectPath, chapter.id),
    chapter,
    backupPath,
    tableCount: (converted.content.match(/<table\b/gi) || []).length,
    imageCount: converted.imageCount,
    warnings: converted.warnings,
    indexResult,
  };
}


async function calculateTotalWords(projectPath, config) {
  let total = 0;
  for (const chapter of config.chapters) {
    const filePath = getChapterPath(projectPath, chapter);
    try {
      const stat = await fs.stat(filePath);
      const signature = `${stat.size}|${stat.mtimeMs}|${stat.ctimeMs}`;
      if (chapter.contentSignature !== signature || !chapter.contentRevision) {
        const content = await fs.readFile(filePath, "utf8");
        chapter.wordCount = countWords(content);
        chapter.outline = extractOutline(content);
        chapter.contentRevision = contentRevision(content);
        chapter.contentSignature = signature;
      }
      total += chapter.wordCount;
    } catch {
      chapter.wordCount = chapter.wordCount || 0;
      chapter.outline = chapter.outline || [];
      total += chapter.wordCount;
    }
  }
  config.stats.totalWords = total;
}


function enqueueChapterSave(projectPath, action) {
  return withProjectTransaction(projectPath, action);
}


async function assertNoAccidentalChapterClone(projectPath, config, chapter, previousContent, nextContent) {
  if (previousContent === nextContent || contentToPlainText(nextContent).trim().length < 200) return;
  const nextRevision = contentRevision(nextContent);
  const possibleMatches = (config.chapters || []).filter(
    (item) => item.id !== chapter.id && item.contentRevision === nextRevision,
  );
  for (const other of possibleMatches) {
    const otherContent = await fs.readFile(getChapterPath(projectPath, other), "utf8").catch(() => "");
    if (otherContent === nextContent) {
      throw new Error(`检测到本次整章内容与《${other.title}》完全相同，疑似跨章节撤销或误覆盖。保存已停止，原章节和历史版本均未改变。`);
    }
  }
}


async function saveChapterContent(projectPath, payload = {}) {
  return enqueueChapterSave(projectPath, async () => {
    const config = await loadConfig(projectPath);
    const chapterId = String(payload?.chapterId || "");
    const chapter = config.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在，无法保存。");
    let filePath = getChapterPath(projectPath, chapter);
    const previousContent = await fs.readFile(filePath, "utf8");
    assertExpectedChapterRevision(String(payload?.expectedRevision || ""), previousContent);
    const previousWords = countWords(previousContent);
    const nextContent = String(payload.content ?? "");
    await assertNoAccidentalChapterClone(projectPath, config, chapter, previousContent, nextContent);
    const didSplitSharedFile = await ensureExclusiveChapterFile(projectPath, config, chapter, previousContent, {
      snapshot: false,
      reason: "保存前自动拆分共享章节文件",
    });
    if (didSplitSharedFile) filePath = getChapterPath(projectPath, chapter);
    if (previousContent && previousContent !== nextContent) {
      await snapshotChapterVersion(projectPath, chapter, previousContent);
    }

    if (payload.title && payload.title.trim()) chapter.title = payload.title.trim();
    if (payload.volume && payload.volume.trim()) chapter.volume = payload.volume.trim();
    chapter.wordCount = countWords(nextContent);
    chapter.outline = extractOutline(nextContent);
    chapter.contentRevision = contentRevision(nextContent);
    chapter.updatedAt = nowIso();
    if (config.stats.todayDate !== todayKey()) {
      config.stats.todayDate = todayKey();
      config.stats.todayWords = 0;
    }
    config.stats.todayWords += Math.max(0, chapter.wordCount - previousWords);
    config.stats.totalWords = config.chapters.reduce((sum, item) => sum + Number(item.wordCount || 0), 0);
    config.updatedAt = nowIso();
    await writeProjectFiles(projectPath, [
      { path: filePath, content: nextContent },
      { path: getConfigPath(projectPath), content: JSON.stringify(config, null, 2) },
    ]);

    let indexWarning = "";
    const indexResult = await indexSource(projectPath, {
      id: chapter.id,
      type: "chapter",
      title: chapter.title,
      volume: chapter.volume || "未分卷",
      category: chapter.volume || "未分卷",
      knowledgeRole: getKnowledgeRole(chapter),
      content: nextContent,
    }).catch(async (error) => {
      indexWarning = `正文已保存，知识库更新失败：${error?.message || error}。请在知识库中执行增量修复。`;
      const previousStats = await vectorShards.stats(projectPath).catch(() => ({ chunks: 0 }));
      return { chunks: 0, totalChunks: previousStats.chunks, degraded: true };
    });
    let storyStateWarning = "";
    if (config.agent?.autoLocalAnalysis !== false) {
      await refreshLocalStoryState(projectPath, chapter.id, nextContent).catch((error) => {
        storyStateWarning = error?.message || String(error);
      });
    }
    if (config.agent?.autoDeepAnalysis === true) scheduleIdleDeepAnalysis(projectPath, chapter);

    if (config.ui.backupOnSave) {
      await createBackup(projectPath).catch(() => null);
    }

    return {
      chapter,
      config: configForRenderer(config),
      indexResult,
      vectorStats: { chunks: indexResult.totalChunks, updatedAt: nowIso(), embeddingFallback: { ...__dep2.embeddingFallback } },
      revision: contentRevision(nextContent),
      storyStateWarning,
      committed: true,
      indexWarning,
    };
  });
}


async function buildAppStateUnlocked(projectPath, preferredChapterId = "") {
  await ensureProjectStructure(projectPath);
  const config = await loadConfig(projectPath);
  await calculateTotalWords(projectPath, config);
  await saveConfig(projectPath, config);
  const savedWindowState = preferredChapterId ? null : await operationJournal.loadWindowState(projectPath).catch(() => null);
  const recoveredChapterId = savedWindowState?.selectedChapterId && config.chapters.some((item) => item.id === savedWindowState.selectedChapterId)
    ? savedWindowState.selectedChapterId
    : "";
  const selectedChapterId = preferredChapterId || recoveredChapterId || config.chapters[0]?.id || "";
  const chapterPayload = await loadChapterContent(projectPath, selectedChapterId);
  const characters = await loadCharacters(projectPath);
  const worldDocs = await loadWorldDocs(projectPath);
  const vectorStats = await vectorShards.stats(projectPath);
  return {
    projectPath,
    config: configForRenderer(config),
    chapters: config.chapters,
    selectedChapter: chapterPayload.chapter,
    chapterContent: chapterPayload.content,
    chapterRevision: chapterPayload.revision,
    characters,
    worldDocs,
    vectorStats: {
      chunks: vectorStats.chunks,
      updatedAt: vectorStats.updatedAt,
      embeddingFallback: { ...__dep2.embeddingFallback },
      recovery: vectorStats.recovery,
    },
  };
}


function diffLines(oldContent, newContent) {
  const oldLines = contentToPlainText(oldContent).split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const newLines = contentToPlainText(newContent).split(/\n+/).map((item) => item.trim()).filter(Boolean);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let oldSuffix = oldLines.length - 1;
  let newSuffix = newLines.length - 1;
  while (oldSuffix >= prefix && newSuffix >= prefix && oldLines[oldSuffix] === newLines[newSuffix]) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }
  const before = oldLines.slice(0, prefix).map((text) => ({ type: "same", text }));
  const after = oldLines.slice(oldSuffix + 1).map((text) => ({ type: "same", text }));
  const oldMiddle = oldLines.slice(prefix, oldSuffix + 1);
  const newMiddle = newLines.slice(prefix, newSuffix + 1);
  const middle = [];

  if (oldMiddle.length * newMiddle.length <= 360000) {
    const dp = Array.from({ length: oldMiddle.length + 1 }, () => new Array(newMiddle.length + 1).fill(0));
    for (let i = oldMiddle.length - 1; i >= 0; i -= 1) {
      for (let j = newMiddle.length - 1; j >= 0; j -= 1) {
        dp[i][j] = oldMiddle[i] === newMiddle[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < oldMiddle.length && j < newMiddle.length) {
      if (oldMiddle[i] === newMiddle[j]) {
        middle.push({ type: "same", text: oldMiddle[i] });
        i += 1;
        j += 1;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        middle.push({ type: "removed", text: oldMiddle[i] });
        i += 1;
      } else {
        middle.push({ type: "added", text: newMiddle[j] });
        j += 1;
      }
    }
    while (i < oldMiddle.length) {
      middle.push({ type: "removed", text: oldMiddle[i] });
      i += 1;
    }
    while (j < newMiddle.length) {
      middle.push({ type: "added", text: newMiddle[j] });
      j += 1;
    }
  } else {
    oldMiddle.forEach((text) => middle.push({ type: "removed", text }));
    newMiddle.forEach((text) => middle.push({ type: "added", text }));
  }

  const diff = [...before, ...middle, ...after];
  return {
    added: diff.filter((item) => item.type === "added").length,
    removed: diff.filter((item) => item.type === "removed").length,
    diff: diff.slice(0, 900),
    truncated: diff.length > 900,
  };
}


async function compareChapterVersion(projectPath, chapterId, versionId) {
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error("章节不存在，无法对比版本。");
  const versions = await listChapterVersions(projectPath, chapterId);
  const version = versions.find((item) => item.id === versionId);
  if (!version) throw new Error("找不到这个历史版本。");
  const oldContent = await fs.readFile(getChapterVersionContentPath(projectPath, chapterId, version), "utf8");
  const currentContent = await fs.readFile(getChapterPath(projectPath, chapter), "utf8");
  return {
    version,
    currentTitle: chapter.title,
    currentUpdatedAt: chapter.updatedAt,
    ...diffLines(oldContent, currentContent),
  };
}


async function restoreChapterVersionUnlocked(projectPath, chapterId, versionId, expectedRevision = "" ) {
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error("章节不存在，无法恢复版本。");
  const versions = await listChapterVersions(projectPath, chapterId);
  const version = versions.find((item) => item.id === versionId);
  if (!version) throw new Error("找不到要恢复的历史版本。");
  const currentContent = await fs.readFile(getChapterPath(projectPath, chapter), "utf8");
  const restoredContent = await fs.readFile(getChapterVersionContentPath(projectPath, chapterId, version), "utf8");
  assertExpectedChapterRevision(expectedRevision, currentContent);
  await saveChapterContent(projectPath, { chapterId, content: restoredContent, expectedRevision: contentRevision(currentContent) });
  return { state: await buildAppState(projectPath, chapter.id), restoredVersion: version };
}


const __moduleExports = {
  convertDocumentToRichContent,
  importDocumentIntoProjectUnlocked,
  refreshChapterFromOriginalDocumentUnlocked,
  calculateTotalWords,
  enqueueChapterSave,
  assertNoAccidentalChapterClone,
  saveChapterContent,
  buildAppStateUnlocked,
  diffLines,
  compareChapterVersion,
  restoreChapterVersionUnlocked,
};

// Augment the original exports object so cyclic requires (whose captured
// reference may be a Proxy over the pre-assignment exports) see every key.
Object.assign(module.exports, __moduleExports);
module.exports = __moduleExports;
