"use strict";
const { registerIpcHandler } = require("../register.cjs");
const {
  ensureCurrentProject,
  getStoryOverviewForProject,
  loadConfig,
  refreshLocalStoryState,
  storyState,
} = require("../dependencies.cjs");

function registerDomain() {
  registerIpcHandler("story:get-overview", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return getStoryOverviewForProject(projectPath, payload || {});
  });

  registerIpcHandler("story:analyze-local", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const requestedIds = new Set((payload?.chapterIds || []).map(String));
    const chapters = config.chapters.filter(
      (chapter) => !requestedIds.size || requestedIds.has(chapter.id),
    );
    for (const chapter of chapters)
      await refreshLocalStoryState(projectPath, chapter.id);
    return getStoryOverviewForProject(projectPath, payload || {});
  });

  registerIpcHandler("story:update-fact", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return storyState.updateFact(
      projectPath,
      String(payload?.factId || ""),
      payload?.patch || {},
    );
  });

  registerIpcHandler("story:create-fact", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const chapter = config.chapters.find(
      (item) => item.id === payload?.chapterId,
    );
    if (!chapter) throw new Error("请选择要关联的章节或大纲文档。");
    return storyState.createManualFact(projectPath, {
      ...payload,
      chapterTitle: chapter.title,
      volume: chapter.volume || "未分卷",
    });
  });

  registerIpcHandler("story:delete-fact", async (_event, factId) => {
    const projectPath = await ensureCurrentProject();
    return storyState.deleteFact(projectPath, String(factId || ""));
  });

  registerIpcHandler("story:update-foreshadow", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return storyState.updateForeshadow(
      projectPath,
      String(payload?.foreshadowId || ""),
      payload?.patch || {},
    );
  });

  registerIpcHandler("story:create-foreshadow", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const chapter = config.chapters.find(
      (item) => item.id === payload?.chapterId,
    );
    if (!chapter) throw new Error("请选择伏笔首次埋下的章节或大纲文档。");
    return storyState.createManualForeshadow(projectPath, {
      ...payload,
      chapterTitle: chapter.title,
      volume: chapter.volume || "未分卷",
    });
  });

  registerIpcHandler(
    "story:delete-foreshadow",
    async (_event, foreshadowId) => {
      const projectPath = await ensureCurrentProject();
      return storyState.deleteForeshadow(
        projectPath,
        String(foreshadowId || ""),
      );
    },
  );

  registerIpcHandler("story:get-board", async (_event, chapterId) => {
    const projectPath = await ensureCurrentProject();
    return {
      board: await storyState.getBoard(projectPath, String(chapterId || "")),
    };
  });

  registerIpcHandler("story:list-boards", async () => {
    const projectPath = await ensureCurrentProject();
    return { boards: await storyState.listBoards(projectPath) };
  });

  registerIpcHandler("story:generate-board", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const ordered = config.chapters.slice().sort((a, b) => a.order - b.order);
    const index = ordered.findIndex(
      (chapter) => chapter.id === payload?.chapterId,
    );
    const chapter = ordered[index];
    if (!chapter) throw new Error("没有找到要生成筹备板的章节。");
    return {
      board: await storyState.generateLocalBoard(
        projectPath,
        chapter,
        ordered[index + 1] || null,
      ),
    };
  });

  registerIpcHandler("story:save-board", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return {
      board: await storyState.saveBoard(projectPath, payload?.board || {}),
    };
  });
}
module.exports = { registerDomain };
