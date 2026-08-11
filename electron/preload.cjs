const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("novelAPI", {
  onMenuAction: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on("menu:action", handler);
    return () => ipcRenderer.removeListener("menu:action", handler);
  },
  getAppState: () => ipcRenderer.invoke("app:get-state"),
  createProject: (payload) => ipcRenderer.invoke("project:create", payload),
  openProject: () => ipcRenderer.invoke("project:open"),
  importDocument: (payload) => ipcRenderer.invoke("document:import", payload),
  exportChapterDocx: (chapterId) => ipcRenderer.invoke("chapter:export-docx", chapterId),
  openOriginalDocument: (chapterId) => ipcRenderer.invoke("chapter:open-original", chapterId),
  refreshChapterFromOriginal: (chapterId) => ipcRenderer.invoke("chapter:refresh-original", chapterId),
  saveProjectSettings: (payload) => ipcRenderer.invoke("project:save-settings", payload),
  exportBackup: () => ipcRenderer.invoke("project:export-backup"),

  createChapter: (payload) => ipcRenderer.invoke("chapter:create", payload),
  loadChapter: (chapterId) => ipcRenderer.invoke("chapter:load", chapterId),
  saveChapter: (payload) => ipcRenderer.invoke("chapter:save", payload),
  deleteChapter: (chapterId) => ipcRenderer.invoke("chapter:delete", chapterId),
  reorderChapters: (chapterIds) => ipcRenderer.invoke("chapter:reorder", chapterIds),
  moveChapterToVolume: (payload) => ipcRenderer.invoke("chapter:move-to-volume", payload),

  saveCharacter: (payload) => ipcRenderer.invoke("character:save", payload),
  deleteCharacter: (characterId) => ipcRenderer.invoke("character:delete", characterId),

  saveWorldDoc: (payload) => ipcRenderer.invoke("world:save", payload),
  deleteWorldDoc: (docId) => ipcRenderer.invoke("world:delete", docId),

  askAI: (payload) => ipcRenderer.invoke("ai:ask", payload),
  generateCharactersFromOutline: () => ipcRenderer.invoke("ai:generate-characters"),
  generateWorldFromOutline: () => ipcRenderer.invoke("ai:generate-world"),
  rebuildIndex: () => ipcRenderer.invoke("index:rebuild"),
});
