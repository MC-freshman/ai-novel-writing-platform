"use strict";

const vectorShards = require("./vector-shards.cjs");
const operationJournal = require("./operation-journal.cjs");
const { withProjectTransaction } = require("./project-storage.cjs");
const { state } = require("./runtime-state.cjs");
const __dep0 = require("./project-files.cjs");
const __dep1 = require("./project-config.cjs");

async function buildAppStateUnlocked(projectPath, preferredChapterId = "") {
  return withProjectTransaction(projectPath, () => buildProjectState(projectPath, preferredChapterId));
}

async function buildProjectState(projectPath, preferredChapterId = "") {
  await __dep1.ensureProjectStructureUnlocked(projectPath);
  const config = await __dep0.loadConfigUnlocked(projectPath);
  await __dep0.calculateTotalWords(projectPath, config);
  await __dep1.saveConfigUnlocked(projectPath, config);
  const savedWindowState = preferredChapterId ? null : await operationJournal.loadWindowState(projectPath).catch(() => null);
  const recoveredChapterId = savedWindowState?.selectedChapterId && config.chapters.some((item) => item.id === savedWindowState.selectedChapterId)
    ? savedWindowState.selectedChapterId
    : "";
  const selectedChapterId = preferredChapterId || recoveredChapterId || config.chapters[0]?.id || "";
  const chapterPayload = await __dep0.loadChapterContent(projectPath, selectedChapterId);
  const characters = await __dep0.loadCharacters(projectPath);
  const worldDocs = await __dep0.loadWorldDocs(projectPath);
  const vectorStats = await vectorShards.stats(projectPath);
  return {
    projectPath,
    config: __dep1.configForRenderer(config),
    chapters: config.chapters,
    selectedChapter: chapterPayload.chapter,
    chapterContent: chapterPayload.content,
    chapterRevision: chapterPayload.revision,
    characters,
    worldDocs,
    vectorStats: {
      chunks: vectorStats.chunks,
      updatedAt: vectorStats.updatedAt,
      embeddingFallback: { ...state.embeddingFallback },
      recovery: vectorStats.recovery,
    },
  };
}

module.exports = { buildAppStateUnlocked };
