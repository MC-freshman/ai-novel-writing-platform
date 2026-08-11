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
  getAppState: () => ipcRenderer.invoke("app:get-state"),
  createProject: (payload) => ipcRenderer.invoke("project:create", payload),
  openProject: () => ipcRenderer.invoke("project:open"),
  importDocument: (payload) => ipcRenderer.invoke("document:import", payload),
  cancelImport: () => ipcRenderer.invoke("document:cancel-import"),
  exportChapterDocx: (chapterId) => ipcRenderer.invoke("chapter:export-docx", chapterId),
  openOriginalDocument: (chapterId) => ipcRenderer.invoke("chapter:open-original", chapterId),
  refreshChapterFromOriginal: (chapterId) => ipcRenderer.invoke("chapter:refresh-original", chapterId),
  saveProjectSettings: (payload) => ipcRenderer.invoke("project:save-settings", payload),
  exportBackup: () => ipcRenderer.invoke("project:export-backup"),
  exportBookDocx: (payload) => ipcRenderer.invoke("project:export-book-docx", payload),
  globalSearch: (payload) => ipcRenderer.invoke("global:search", payload),
  buildTimeline: (payload) => ipcRenderer.invoke("analysis:timeline", payload),
  buildRelationshipGraph: (payload) => ipcRenderer.invoke("analysis:relationships", payload),
  analyzeConsistency: () => ipcRenderer.invoke("analysis:consistency"),
  updateIssueStatus: (payload) => ipcRenderer.invoke("analysis:update-issue-status", payload),
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

  saveCharacter: (payload) => ipcRenderer.invoke("character:save", payload),
  deleteCharacter: (characterId) => ipcRenderer.invoke("character:delete", characterId),

  saveWorldDoc: (payload) => ipcRenderer.invoke("world:save", payload),
  deleteWorldDoc: (docId) => ipcRenderer.invoke("world:delete", docId),

  askAI: (payload) => ipcRenderer.invoke("ai:ask", payload),
  editSelection: (payload) => ipcRenderer.invoke("ai:edit-selection", payload),
  generateCharactersFromOutline: () => ipcRenderer.invoke("ai:generate-characters"),
  generateWorldFromOutline: () => ipcRenderer.invoke("ai:generate-world"),
  extractWorldCardsFromOutline: (payload) => ipcRenderer.invoke("ai:extract-world-cards", payload),
  saveWorldCardCandidates: (payload) => ipcRenderer.invoke("ai:save-world-card-candidates", payload),
  rebuildIndex: () => ipcRenderer.invoke("index:rebuild"),
});
