"use strict";
const { registerIpcHandler } = require("../register.cjs");
const {
  buildCreativeStatistics,
  creativeWorkspace,
  crypto,
  dialog,
  ensureCurrentProject,
  fs,
  getCreativeWorkspaceView,
  loadConfig,
  normalizeNetwork,
  novelNetworkImport,
  nowIso,
  path,
  state,
  storyState,
  withProjectTransaction,
  writeFileAtomic,
} = require("../dependencies.cjs");

function registerDomain() {
  registerIpcHandler("workspace:get", async () => {
    const projectPath = await ensureCurrentProject();
    return getCreativeWorkspaceView(projectPath);
  });

  registerIpcHandler(
    "novel-network:preview-import",
    async (_event, payload) => {
      const projectPath = await ensureCurrentProject();
      const folder = payload?.mode === "folder";
      const selected = await dialog.showOpenDialog(state.mainWindow, {
        title: folder ? "选择小说网资料目录" : "选择小说网资料（可多选分册）",
        properties: folder
          ? ["openDirectory"]
          : ["openFile", "multiSelections"],
        filters: folder
          ? undefined
          : [
              {
                name: "小说统筹资料",
                extensions: ["md", "markdown", "docx", "json"],
              },
            ],
      });
      if (selected.canceled || !selected.filePaths.length)
        return { canceled: true };
      const files = folder
        ? (await fs.readdir(selected.filePaths[0], { withFileTypes: true }))
            .filter(
              (entry) =>
                entry.isFile() &&
                /\.(md|markdown|docx|json)$/i.test(entry.name),
            )
            .map((entry) => path.join(selected.filePaths[0], entry.name))
            .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }))
        : selected.filePaths;
      const preview = await novelNetworkImport.readImportFiles(files);
      const token = crypto.randomUUID();
      state.pendingNovelNetworkImports.clear();
      state.pendingNovelNetworkImports.set(token, {
        projectPath,
        network: preview.network,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      return { ...preview, token };
    },
  );

  registerIpcHandler("novel-network:import", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const preview = state.pendingNovelNetworkImports.get(
      String(payload?.token || ""),
    );
    if (
      !preview ||
      preview.projectPath !== projectPath ||
      preview.expiresAt < Date.now()
    )
      throw new Error("小说网导入预览已失效，请重新选择资料。");
    const result = await withProjectTransaction(projectPath, async () => {
      let network = preview.network;
      let duplicates = 0;
      if (payload?.targetId) {
        const workspace = await creativeWorkspace.loadWorkspace(projectPath);
        const current = workspace.novelNetworks.find(
          (item) => item.id === payload.targetId,
        );
        if (!current || current.revision !== payload.expectedRevision)
          throw new Error("当前小说网版本已变化，请重新读取后追加。");
        const merged = novelNetworkImport.mergeNetworks(current, network);
        network = merged.network;
        duplicates = merged.duplicates;
      } else
        network = {
          ...network,
          title: String(payload?.title || network.title),
        };
      const item = await creativeWorkspace.upsertItem(
        projectPath,
        "novelNetworks",
        network,
      );
      return {
        network: item,
        duplicates,
        workspace: await getCreativeWorkspaceView(projectPath),
      };
    });
    state.pendingNovelNetworkImports.delete(String(payload.token));
    return result;
  });

  registerIpcHandler("novel-network:save", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const network = await creativeWorkspace.upsertItem(
      projectPath,
      "novelNetworks",
      payload?.network || {},
    );
    return { network, workspace: await getCreativeWorkspaceView(projectPath) };
  });

  registerIpcHandler("novel-network:delete", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
      const workspace = await creativeWorkspace.loadWorkspace(projectPath);
      const network = workspace.novelNetworks.find(
        (item) => item.id === payload?.id,
      );
      if (!network || network.revision !== payload?.expectedRevision)
        throw new Error("小说网版本已变化，请重新读取后删除。");
      await creativeWorkspace.deleteItem(
        projectPath,
        "novelNetworks",
        network.id,
      );
      return { workspace: await getCreativeWorkspaceView(projectPath) };
    });
  });

  registerIpcHandler("novel-network:export", async (_event, payload) => {
    await ensureCurrentProject();
    const network = normalizeNetwork(payload?.network);
    const exportName =
      network.title
        .replace(/[\\/:*?"<>|]/g, "_")
        .trim()
        .slice(0, 100) || "未命名";
    const selected = await dialog.showSaveDialog(state.mainWindow, {
      title: "导出小说网",
      defaultPath: `小说网_${exportName}.json`,
      filters: [{ name: "小说网JSON", extensions: ["json"] }],
    });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    await writeFileAtomic(
      selected.filePath,
      JSON.stringify({ schema: "novel-network/v1", network }, null, 2),
    );
    return { filePath: selected.filePath };
  });

  registerIpcHandler("workspace:upsert", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const item = await creativeWorkspace.upsertItem(
      projectPath,
      String(payload?.collection || ""),
      payload?.item || {},
    );
    return { item, workspace: await getCreativeWorkspaceView(projectPath) };
  });

  registerIpcHandler("workspace:delete", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    await creativeWorkspace.deleteItem(
      projectPath,
      String(payload?.collection || ""),
      String(payload?.itemId || ""),
    );
    return { workspace: await getCreativeWorkspaceView(projectPath) };
  });

  registerIpcHandler("workspace:reorder-scenes", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const scenes = await creativeWorkspace.reorderScenes(
      projectPath,
      String(payload?.chapterId || ""),
      payload?.sceneIds || [],
    );
    return { scenes, workspace: await getCreativeWorkspaceView(projectPath) };
  });

  registerIpcHandler("workspace:rebuild-causality", async () => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const overview = await storyState.getStoryOverview(projectPath, {
      projectChapters: config.chapters,
      factLimit: 2000,
      characterLimit: 500,
      foreshadowLimit: 1000,
    });
    const chapterOrder = Object.fromEntries(
      config.chapters.map((chapter) => [chapter.id, chapter.order]),
    );
    const result = await creativeWorkspace.rebuildCausality(projectPath, {
      facts: overview.facts,
      foreshadows: overview.foreshadows,
      chapterOrder,
    });
    return {
      ...result,
      workspace: await getCreativeWorkspaceView(projectPath),
    };
  });

  registerIpcHandler("workspace:generate-arcs", async () => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const overview = await storyState.getStoryOverview(projectPath, {
      projectChapters: config.chapters,
      characterLimit: 500,
    });
    const arcs = await creativeWorkspace.generateArcs(
      projectPath,
      overview.characterStates,
    );
    return { arcs, workspace: await getCreativeWorkspaceView(projectPath) };
  });

  registerIpcHandler("workspace:quality", async () => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const overview = await storyState.getStoryOverview(projectPath, {
      projectChapters: config.chapters,
      factLimit: 2000,
      characterLimit: 500,
      foreshadowLimit: 1000,
    });
    const workspace = await creativeWorkspace.loadWorkspace(projectPath);
    return {
      reports: creativeWorkspace.qualityReport(
        workspace,
        config.chapters,
        overview,
      ),
      generatedAt: nowIso(),
    };
  });

  registerIpcHandler("workspace:statistics", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return buildCreativeStatistics(projectPath, String(payload?.label || ""));
  });
}
module.exports = { registerDomain };
