const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("novelAPI", {
  onMenuAction: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on("menu:action", handler);
    return () => ipcRenderer.removeListener("menu:action", handler);
  },
  onImportProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("import:progress", handler);
    return () => ipcRenderer.removeListener("import:progress", handler);
  },
  onIndexProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("index:progress", handler);
    return () => ipcRenderer.removeListener("index:progress", handler);
  },
  onAIStream: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("ai:stream", handler);
    return () => ipcRenderer.removeListener("ai:stream", handler);
  },
  onTaskProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("task:progress", handler);
    return () => ipcRenderer.removeListener("task:progress", handler);
  },
  getAppState: () => ipcRenderer.invoke("app:get-state"),
  checkForUpdate: () => ipcRenderer.invoke("app:check-update"),
  downloadUpdate: (payload) => ipcRenderer.invoke("app:download-update", payload),
  scanReleasePrivacy: () => ipcRenderer.invoke("app:privacy-scan"),
  getRecoveryStatus: () => ipcRenderer.invoke("recovery:get"),
  saveRecoveryDraft: (payload) => ipcRenderer.invoke("recovery:save-draft", payload),
  clearRecoveryDraft: (chapterId) => ipcRenderer.invoke("recovery:clear-draft", chapterId),
  saveWindowRecoveryState: (payload) => ipcRenderer.invoke("recovery:save-window", payload),
  listOperationJournal: () => ipcRenderer.invoke("operations:list"),
  createProject: (payload) => ipcRenderer.invoke("project:create", payload),
  openProject: () => ipcRenderer.invoke("project:open"),
  importDocument: (payload) => ipcRenderer.invoke("document:import", payload),
  cancelImport: () => ipcRenderer.invoke("document:cancel-import"),
  exportChapterDocx: (chapterId) => ipcRenderer.invoke("chapter:export-docx", chapterId),
  openOriginalDocument: (chapterId) => ipcRenderer.invoke("chapter:open-original", chapterId),
  refreshChapterFromOriginal: (chapterId) => ipcRenderer.invoke("chapter:refresh-original", chapterId),
  saveProjectSettings: (payload) => ipcRenderer.invoke("project:save-settings", payload),
  exportBackup: () => ipcRenderer.invoke("project:export-backup"),
  exportProjectExchange: (payload) => ipcRenderer.invoke("project:export-exchange", payload),
  previewProjectExchange: (payload) => ipcRenderer.invoke("project:preview-exchange", payload),
  importProjectExchange: (payload) => ipcRenderer.invoke("project:import-exchange", payload),
  exportBookDocx: (payload) => ipcRenderer.invoke("project:export-book-docx", payload),
  globalSearch: (payload) => ipcRenderer.invoke("global:search", payload),
  getAnalysisState: () => ipcRenderer.invoke("analysis:get-state"),
  saveAnalysisState: (payload) => ipcRenderer.invoke("analysis:save-state", payload),
  buildTimeline: (payload) => ipcRenderer.invoke("analysis:timeline", payload),
  buildRelationshipGraph: (payload) => ipcRenderer.invoke("analysis:relationships", payload),
  analyzeConsistency: (payload) => ipcRenderer.invoke("analysis:consistency", payload),
  updateIssueStatus: (payload) => ipcRenderer.invoke("analysis:update-issue-status", payload),
  listKnowledgeItems: () => ipcRenderer.invoke("knowledge:list"),
  updateKnowledgeItems: (payload) => ipcRenderer.invoke("knowledge:update", payload),
  getKnowledgeStatus: () => ipcRenderer.invoke("knowledge:status"),
  repairKnowledge: () => ipcRenderer.invoke("knowledge:repair"),
  getMaintenanceDiagnostics: () => ipcRenderer.invoke("maintenance:diagnostics"),
  repairMaintenance: () => ipcRenderer.invoke("maintenance:repair"),
  getProjectHealth: () => ipcRenderer.invoke("project:health"),
  repairProjectHealth: () => ipcRenderer.invoke("project:repair-health"),
  getStoryOverview: (payload) => ipcRenderer.invoke("story:get-overview", payload),
  analyzeStoryLocally: (payload) => ipcRenderer.invoke("story:analyze-local", payload),
  updateStoryFact: (payload) => ipcRenderer.invoke("story:update-fact", payload),
  createStoryFact: (payload) => ipcRenderer.invoke("story:create-fact", payload),
  deleteStoryFact: (factId) => ipcRenderer.invoke("story:delete-fact", factId),
  updateForeshadow: (payload) => ipcRenderer.invoke("story:update-foreshadow", payload),
  createForeshadow: (payload) => ipcRenderer.invoke("story:create-foreshadow", payload),
  deleteForeshadow: (foreshadowId) => ipcRenderer.invoke("story:delete-foreshadow", foreshadowId),
  getChapterBoard: (chapterId) => ipcRenderer.invoke("story:get-board", chapterId),
  generateChapterBoard: (payload) => ipcRenderer.invoke("story:generate-board", payload),
  saveChapterBoard: (payload) => ipcRenderer.invoke("story:save-board", payload),
  getCreativeWorkspace: () => ipcRenderer.invoke("workspace:get"),
  upsertCreativeWorkspaceItem: (payload) => ipcRenderer.invoke("workspace:upsert", payload),
  deleteCreativeWorkspaceItem: (payload) => ipcRenderer.invoke("workspace:delete", payload),
  reorderScenes: (payload) => ipcRenderer.invoke("workspace:reorder-scenes", payload),
  rebuildCausality: () => ipcRenderer.invoke("workspace:rebuild-causality"),
  generateCharacterArcs: () => ipcRenderer.invoke("workspace:generate-arcs"),
  getChapterQualityReports: () => ipcRenderer.invoke("workspace:quality"),
  generateCreativeStatistics: (payload) => ipcRenderer.invoke("workspace:statistics", payload),
  prepareCreativeAgent: (payload) => ipcRenderer.invoke("agent:prepare", payload),
  executeCreativeAgent: (runId) => ipcRenderer.invoke("agent:execute", runId),
  retryCreativeAgentTool: (payload) => ipcRenderer.invoke("agent:retry-tool", payload),
  createSafeRevision: (payload) => ipcRenderer.invoke("revision:create", payload),
  applySafeRevision: (revisionId) => ipcRenderer.invoke("revision:apply", revisionId),
  applySafeRevisionPart: (payload) => ipcRenderer.invoke("revision:apply-part", payload),
  updateRevisionStatus: (payload) => ipcRenderer.invoke("revision:update-status", payload),
  listTasks: () => ipcRenderer.invoke("tasks:list"),
  enqueueTask: (payload) => ipcRenderer.invoke("tasks:enqueue", payload),
  cancelTask: (taskId) => ipcRenderer.invoke("tasks:cancel", taskId),
  pauseTask: (taskId) => ipcRenderer.invoke("tasks:pause", taskId),
  resumeTask: (taskId) => ipcRenderer.invoke("tasks:resume", taskId),
  retryTask: (taskId) => ipcRenderer.invoke("tasks:retry", taskId),
  removeTask: (taskId) => ipcRenderer.invoke("tasks:remove", taskId),
  clearTaskHistory: () => ipcRenderer.invoke("tasks:clear-history"),
  listSnapshots: () => ipcRenderer.invoke("snapshots:list"),
  createSnapshot: (payload) => ipcRenderer.invoke("snapshots:create", payload),
  compareSnapshot: (snapshotId) => ipcRenderer.invoke("snapshots:compare", snapshotId),
  restoreSnapshot: (payload) => ipcRenderer.invoke("snapshots:restore", payload),
  renameSnapshot: (payload) => ipcRenderer.invoke("snapshots:rename", payload),
  deleteSnapshot: (snapshotId) => ipcRenderer.invoke("snapshots:delete", snapshotId),
  cleanupSnapshots: () => ipcRenderer.invoke("snapshots:cleanup"),
  createBranch: (payload) => ipcRenderer.invoke("snapshots:create-branch", payload),
  switchBranch: (branchId) => ipcRenderer.invoke("snapshots:switch-branch", branchId),
  deleteBranch: (branchId) => ipcRenderer.invoke("snapshots:delete-branch", branchId),
  getAppearanceStats: () => ipcRenderer.invoke("experiments:appearance-stats"),
  getWorldMap: () => ipcRenderer.invoke("experiments:world-map"),
  listMaterials: () => ipcRenderer.invoke("materials:list"),
  saveMaterial: (payload) => ipcRenderer.invoke("materials:save", payload),
  deleteMaterial: (materialId) => ipcRenderer.invoke("materials:delete", materialId),

  createChapter: (payload) => ipcRenderer.invoke("chapter:create", payload),
  loadChapter: (chapterId) => ipcRenderer.invoke("chapter:load", chapterId),
  saveChapter: (payload) => ipcRenderer.invoke("chapter:save", payload),
  deleteChapter: (chapterId) => ipcRenderer.invoke("chapter:delete", chapterId),
  reorderChapters: (chapterIds) => ipcRenderer.invoke("chapter:reorder", chapterIds),
  moveChapterToVolume: (payload) => ipcRenderer.invoke("chapter:move-to-volume", payload),
  listChapterVersions: (chapterId) => ipcRenderer.invoke("chapter:list-versions", chapterId),
  compareChapterVersion: (payload) => ipcRenderer.invoke("chapter:compare-version", payload),
  restoreChapterVersion: (payload) => ipcRenderer.invoke("chapter:restore-version", payload),

  saveCharacter: (payload) => ipcRenderer.invoke("character:save", payload),
  deleteCharacter: (characterId) => ipcRenderer.invoke("character:delete", characterId),

  saveWorldDoc: (payload) => ipcRenderer.invoke("world:save", payload),
  deleteWorldDoc: (docId) => ipcRenderer.invoke("world:delete", docId),

  getCreativeAdvice: (payload) => ipcRenderer.invoke("ai:creative-advice", payload),
  askAI: (payload) => ipcRenderer.invoke("ai:ask", payload),
  cancelAI: (requestId) => ipcRenderer.invoke("ai:cancel", requestId),
  editSelection: (payload) => ipcRenderer.invoke("ai:edit-selection", payload),
  generateCharactersFromOutline: () => ipcRenderer.invoke("ai:generate-characters"),
  generateWorldFromOutline: () => ipcRenderer.invoke("ai:generate-world"),
  extractWorldCardsFromOutline: (payload) => ipcRenderer.invoke("ai:extract-world-cards", payload),
  saveWorldCardCandidates: (payload) => ipcRenderer.invoke("ai:save-world-card-candidates", payload),
  rebuildIndex: () => ipcRenderer.invoke("index:rebuild"),
});
