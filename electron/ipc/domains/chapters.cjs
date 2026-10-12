"use strict";
const { registerIpcHandler } = require("../register.cjs");
const {
  buildAppState,
  calculateTotalWords,
  compareChapterVersion,
  creativeWorkspace,
  dialog,
  ensureCurrentProject,
  ensureDir,
  existsSync,
  exportChapterToDocx,
  getChapterPath,
  getConfigPath,
  getOriginalDocumentPath,
  listChapterVersions,
  loadChapterContent,
  loadConfig,
  makeId,
  normalizeChapterFileName,
  nowIso,
  path,
  refreshChapterFromOriginalDocument,
  removeSourceFromIndex,
  restoreChapterVersion,
  sanitizeFileName,
  saveChapterContent,
  saveConfig,
  shell,
  state,
  storyState,
  uniqueChapterFileName,
  withJournalOperation,
  withProjectTransaction,
  writeProjectFiles,
} = require("../dependencies.cjs");

function registerDomain() {
  registerIpcHandler("chapter:create", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
      const config = await loadConfig(projectPath);
      const order = config.chapters.length;
      const title = payload?.title?.trim() || `第${order + 1}章 新章节`;
      const chapterDir = path.join(projectPath, "chapters");
      await ensureDir(chapterDir);
      const fileName = await uniqueChapterFileName(
        projectPath,
        config,
        `chapter_${String(order + 1).padStart(3, "0")}_${title}`,
        ".md",
      );
      const chapter = {
        id: makeId("chapter"),
        title,
        volume: payload?.volume || "卷一",
        order,
        fileName,
        wordCount: 0,
        knowledgeRole: "正文",
        outline: [{ id: `0_${title}`, level: 1, title, line: 0 }],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      config.chapters.push(chapter);
      await writeProjectFiles(projectPath, [
        {
          path: getChapterPath(projectPath, chapter),
          content: `# ${title}\n\n`,
        },
        {
          path: getConfigPath(projectPath),
          content: JSON.stringify(config, null, 2),
        },
      ]);
      return buildAppState(projectPath, chapter.id);
    });
  });

  registerIpcHandler("chapter:load", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    return loadChapterContent(projectPath, chapterId);
  });

  registerIpcHandler("chapter:save", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withJournalOperation(
      projectPath,
      {
        type: "chapter-save",
        title: "保存章节",
        targetIds: [payload?.chapterId],
        recoverable: true,
        metadata: {
          expectedRevision: String(payload?.expectedRevision || "").slice(
            0,
            128,
          ),
        },
      },
      () => saveChapterContent(projectPath, payload),
      (result) => ({
        chapterId: result.chapter.id,
        revision: result.revision,
        chunks: result.indexResult.chunks,
      }),
    );
  });

  registerIpcHandler("chapter:delete", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
      const config = await loadConfig(projectPath);
      const chapter = config.chapters.find((item) => item.id === chapterId);
      if (!chapter) throw new Error("章节不存在，无法删除。");
      const deepAnalysisKey = `${projectPath}\u0000${chapterId}`;
      if (state.deepAnalysisTimers.has(deepAnalysisKey)) {
        clearTimeout(state.deepAnalysisTimers.get(deepAnalysisKey));
        state.deepAnalysisTimers.delete(deepAnalysisKey);
      }
      if (config.chapters.length <= 1)
        throw new Error("至少需要保留一个章节。");
      const hasOtherChapterUsingFile = config.chapters.some(
        (item) =>
          item.id !== chapterId &&
          normalizeChapterFileName(item.fileName) ===
            normalizeChapterFileName(chapter.fileName),
      );
      config.chapters = config.chapters
        .filter((item) => item.id !== chapterId)
        .map((item, index) => ({ ...item, order: index }));
      await calculateTotalWords(projectPath, config);
      await writeProjectFiles(projectPath, [
        ...(!hasOtherChapterUsingFile
          ? [{ path: getChapterPath(projectPath, chapter), content: null }]
          : []),
        {
          path: getConfigPath(projectPath),
          content: JSON.stringify(config, null, 2),
        },
      ]);
      await removeSourceFromIndex(projectPath, chapterId).catch(() => null);
      await storyState
        .removeChapterLedger(projectPath, chapterId)
        .catch(() => null);
      await creativeWorkspace
        .removeChapterReferences(projectPath, chapterId)
        .catch(() => null);
      return buildAppState(projectPath, config.chapters[0]?.id);
    });
  });

  registerIpcHandler("chapter:export-docx", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const chapter = config.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("章节不存在，无法导出。");
    const result = await dialog.showSaveDialog(state.mainWindow, {
      title: "导出当前章节为 Word 文档",
      defaultPath: path.join(
        projectPath,
        `${sanitizeFileName(chapter.title)}.docx`,
      ),
      filters: [{ name: "Word 文档", extensions: ["docx"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const filePath = await exportChapterToDocx(
      projectPath,
      chapter,
      result.filePath,
    );
    return { filePath };
  });

  registerIpcHandler("chapter:open-original", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const chapter = config.chapters.find((item) => item.id === chapterId);
    const originalPath = getOriginalDocumentPath(projectPath, chapter);
    if (!originalPath || !existsSync(originalPath)) {
      return { error: "这个条目没有保留的 Word 原文档。" };
    }
    const error = await shell.openPath(originalPath);
    return error
      ? { filePath: originalPath, error }
      : { filePath: originalPath };
  });

  registerIpcHandler("chapter:refresh-original", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return refreshChapterFromOriginalDocument(
      projectPath,
      typeof payload === "string" ? payload : String(payload?.chapterId || ""),
      String(payload?.expectedRevision || ""),
    );
  });

  registerIpcHandler("chapter:list-versions", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    return { versions: await listChapterVersions(projectPath, chapterId) };
  });

  registerIpcHandler("chapter:compare-version", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return compareChapterVersion(
      projectPath,
      String(payload?.chapterId || ""),
      String(payload?.versionId || ""),
    );
  });

  registerIpcHandler("chapter:restore-version", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return restoreChapterVersion(
      projectPath,
      String(payload?.chapterId || ""),
      String(payload?.versionId || ""),
      String(payload?.expectedRevision || ""),
    );
  });

  registerIpcHandler("chapter:reorder", async (_event, chapterIds) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
      return withJournalOperation(
        projectPath,
        {
          type: "chapter-reorder",
          title: "调整目录顺序",
          targetIds: chapterIds,
          recoverable: true,
        },
        async () => {
          const config = await loadConfig(projectPath);
          const idOrder = new Map(chapterIds.map((id, index) => [id, index]));
          config.chapters = config.chapters
            .slice()
            .sort(
              (a, b) =>
                (idOrder.get(a.id) ?? a.order) - (idOrder.get(b.id) ?? b.order),
            )
            .map((item, index) => ({ ...item, order: index }));
          await saveConfig(projectPath, config);
          return { chapters: config.chapters };
        },
        (result) => ({ count: result.chapters.length }),
      );
    });
  });

  registerIpcHandler("chapter:move-to-volume", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
      return withJournalOperation(
        projectPath,
        {
          type: "chapter-move",
          title: "移动目录文档",
          targetIds: [payload?.chapterId],
          recoverable: true,
          metadata: { volume: String(payload?.volume || "") },
        },
        async () => {
          const config = await loadConfig(projectPath);
          const chapterId = String(payload?.chapterId || "");
          const targetVolume =
            String(payload?.volume || "未分卷").trim() || "未分卷";
          const beforeChapterId = String(payload?.beforeChapterId || "");
          const chapter = config.chapters.find((item) => item.id === chapterId);
          if (!chapter) throw new Error("文档不存在，无法移动。");

          const ordered = config.chapters
            .slice()
            .sort((a, b) => a.order - b.order);
          const moving = {
            ...chapter,
            volume: targetVolume,
            updatedAt: nowIso(),
          };
          const rest = ordered.filter((item) => item.id !== chapterId);
          let insertIndex = -1;
          if (beforeChapterId && beforeChapterId !== chapterId) {
            insertIndex = rest.findIndex((item) => item.id === beforeChapterId);
          }
          if (insertIndex < 0) {
            const lastInVolume = rest.reduce(
              (last, item, index) =>
                (item.volume || "未分卷") === targetVolume ? index : last,
              -1,
            );
            insertIndex = lastInVolume >= 0 ? lastInVolume + 1 : rest.length;
          }
          rest.splice(insertIndex, 0, moving);
          config.chapters = rest.map((item, index) => ({
            ...item,
            order: index,
          }));
          await saveConfig(projectPath, config);
          return buildAppState(projectPath, chapterId);
        },
        (result) => ({ chapterId: result.selectedChapter?.id || "" }),
      );
    });
  });

  registerIpcHandler("chapter:set-progress", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
      return withJournalOperation(
        projectPath,
        {
          type: "chapter-progress",
          title: "更新章节进度",
          recoverable: false,
          metadata: {
            count: Array.isArray(payload?.updates) ? payload.updates.length : 0,
          },
        },
        async () => {
          const config = await loadConfig(projectPath);
          const allowed = ["计划中", "写作中", "已完成", "暂缓"];
          const updates = Array.isArray(payload?.updates)
            ? payload.updates
            : [];
          const touched = [];
          for (const update of updates) {
            const chapter = config.chapters.find(
              (item) => item.id === String(update?.chapterId || ""),
            );
            if (!chapter) continue;
            if (update.status === null || update.status === "") {
              delete chapter.progressStatus;
            } else if (allowed.includes(update.status)) {
              chapter.progressStatus = update.status;
            }
            if (typeof update.note === "string") {
              const note = update.note.trim();
              if (note) chapter.progressNote = note;
              else delete chapter.progressNote;
            }
            if (update.hidden === true) chapter.progressHidden = true;
            else if (update.hidden === false) delete chapter.progressHidden;
            chapter.updatedAt = nowIso();
            touched.push(chapter.id);
          }
          if (!touched.length) throw new Error("没有找到要更新的文档。");
          await saveConfig(projectPath, config);
          return buildAppState(
            projectPath,
            String(payload?.selectedChapterId || touched[0] || ""),
          );
        },
      );
    });
  });
}
module.exports = { registerDomain };
