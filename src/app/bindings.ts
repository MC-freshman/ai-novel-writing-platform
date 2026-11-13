import { useAppStores, useStoreField } from "../stores/use-app-stores";

export function useAppBindings() {
  const stores = useAppStores();

  const [chapterRevision, setChapterRevision] = useStoreField(
    stores.project,
    "chapterRevision",
  );

  const [state, setState] = useStoreField(stores.project, "state");

  const [selectedChapter, setSelectedChapter] = useStoreField(
    stores.project,
    "selectedChapter",
  );

  const [chapterContent, setChapterContent] = useStoreField(
    stores.project,
    "chapterContent",
  );

  const [chapterTitle, setChapterTitle] = useStoreField(
    stores.project,
    "chapterTitle",
  );

  const [chapterVolume, setChapterVolume] = useStoreField(
    stores.project,
    "chapterVolume",
  );

  const [dirty, setDirty] = useStoreField(stores.project, "dirty");

  const [saving, setSaving] = useStoreField(stores.project, "saving");

  const [status, setStatus] = useStoreField(stores.project, "status");

  const [view, setView] = useStoreField(stores.navigation, "view");

  const [networkOpenRequest, setNetworkOpenRequest] = useStoreField(
    stores.navigation,
    "networkOpenRequest",
  );

  const [progressOpenRequest, setProgressOpenRequest] = useStoreField(
    stores.navigation,
    "progressOpenRequest",
  );

  const [progressOpenMode, setProgressOpenMode] = useStoreField(
    stores.navigation,
    "progressOpenMode",
  );

  const [showSettings, setShowSettings] = useStoreField(
    stores.navigation,
    "showSettings",
  );

  const [showQuickPanel, setShowQuickPanel] = useStoreField(
    stores.navigation,
    "showQuickPanel",
  );

  const [showNameGen, setShowNameGen] = useStoreField(
    stores.navigation,
    "showNameGen",
  );

  const [showImportProject, setShowImportProject] = useStoreField(
    stores.navigation,
    "showImportProject",
  );

  const [showFileBridge, setShowFileBridge] = useStoreField(
    stores.navigation,
    "showFileBridge",
  );

  const [showImageGen, setShowImageGen] = useStoreField(
    stores.navigation,
    "showImageGen",
  );

  const [showStoryCenter, setShowStoryCenter] = useStoreField(
    stores.navigation,
    "showStoryCenter",
  );

  const [storyCenterInitialTab, setStoryCenterInitialTab] = useStoreField(
    stores.navigation,
    "storyCenterInitialTab",
  );

  const [workspaceInitialTab, setWorkspaceInitialTab] = useStoreField(
    stores.navigation,
    "workspaceInitialTab",
  );

  const [showTaskCenter, setShowTaskCenter] = useStoreField(
    stores.navigation,
    "showTaskCenter",
  );

  const [backgroundTasks, setBackgroundTasks] = useStoreField(
    stores.tasks,
    "backgroundTasks",
  );

  const [focusMode, setFocusMode] = useStoreField(stores.layout, "focusMode");

  const [preview, setPreview] = useStoreField(stores.layout, "preview");

  const [scrollAnchor, setScrollAnchor] = useStoreField(
    stores.editor,
    "scrollAnchor",
  );

  const [selectedText, setSelectedText] = useStoreField(
    stores.editor,
    "selectedText",
  );

  const [editorReviews, setEditorReviews] = useStoreField(
    stores.editor,
    "editorReviews",
  );

  const [contextMenu, setContextMenu] = useStoreField(
    stores.editor,
    "contextMenu",
  );

  // 聊天状态由 ChatPanel 直接订阅；控制器只保留命令所需的稳定 setter。
  const {
    chatMessages: setChatMessages,
    chatSessions: setChatSessions,
    activeChatSessionId: setActiveChatSessionId,
    aiProjectMemory: setAiProjectMemory,
    chatRetrievalMode: setChatRetrievalMode,
    chatLoaded: setChatLoaded,
    activeAiRequestId: setActiveAiRequestId,
    aiProgress: setAiProgress,
  } = stores.chat.setters;

  const [draggingChapterId, setDraggingChapterId] = useStoreField(
    stores.tasks,
    "draggingChapterId",
  );

  const [importProgress, setImportProgress] = useStoreField(
    stores.tasks,
    "importProgress",
  );

  const [indexProgress, setIndexProgress] = useStoreField(
    stores.tasks,
    "indexProgress",
  );

  const [showFindReplace, setShowFindReplace] = useStoreField(
    stores.editor,
    "showFindReplace",
  );

  const [findText, setFindText] = useStoreField(stores.editor, "findText");

  const [replaceText, setReplaceText] = useStoreField(
    stores.editor,
    "replaceText",
  );

  const [leftWidth, setLeftWidth] = useStoreField(stores.layout, "leftWidth");

  const [rightWidth, setRightWidth] = useStoreField(
    stores.layout,
    "rightWidth",
  );

  const [viewportWidth, setViewportWidth] = useStoreField(
    stores.layout,
    "viewportWidth",
  );

  const [aiExpanded, setAiExpanded] = useStoreField(
    stores.layout,
    "aiExpanded",
  );

  const [aiChatOpenRequest, setAiChatOpenRequest] = useStoreField(
    stores.navigation,
    "aiChatOpenRequest",
  );

  const [promptTemplatesOpenRequest, setPromptTemplatesOpenRequest] = useStoreField(
    stores.navigation,
    "promptTemplatesOpenRequest",
  );

  const [previewWidth, setPreviewWidth] = useStoreField(
    stores.layout,
    "previewWidth",
  );

  const [recoveryDrafts, setRecoveryDrafts] = useStoreField(
    stores.project,
    "recoveryDrafts",
  );

  return {
    stores,
    chapterRevision,
    setChapterRevision,
    state,
    setState,
    selectedChapter,
    setSelectedChapter,
    chapterContent,
    setChapterContent,
    chapterTitle,
    setChapterTitle,
    chapterVolume,
    setChapterVolume,
    dirty,
    setDirty,
    saving,
    setSaving,
    status,
    setStatus,
    view,
    setView,
    networkOpenRequest,
    setNetworkOpenRequest,
    progressOpenRequest,
    setProgressOpenRequest,
    progressOpenMode,
    setProgressOpenMode,
    showSettings,
    setShowSettings,
    showQuickPanel,
    setShowQuickPanel,
    showNameGen,
    setShowNameGen,
    showImportProject,
    setShowImportProject,
    showFileBridge,
    setShowFileBridge,
    showImageGen,
    setShowImageGen,
    showStoryCenter,
    setShowStoryCenter,
    storyCenterInitialTab,
    setStoryCenterInitialTab,
    workspaceInitialTab,
    setWorkspaceInitialTab,
    showTaskCenter,
    setShowTaskCenter,
    backgroundTasks,
    setBackgroundTasks,
    focusMode,
    setFocusMode,
    preview,
    setPreview,
    scrollAnchor,
    setScrollAnchor,
    selectedText,
    setSelectedText,
    editorReviews,
    setEditorReviews,
    contextMenu,
    setContextMenu,
    setChatMessages,
    setChatSessions,
    setActiveChatSessionId,
    setAiProjectMemory,
    setChatRetrievalMode,
    setChatLoaded,
    setActiveAiRequestId,
    setAiProgress,
    draggingChapterId,
    setDraggingChapterId,
    importProgress,
    setImportProgress,
    indexProgress,
    setIndexProgress,
    showFindReplace,
    setShowFindReplace,
    findText,
    setFindText,
    replaceText,
    setReplaceText,
    leftWidth,
    setLeftWidth,
    rightWidth,
    setRightWidth,
    viewportWidth,
    setViewportWidth,
    aiExpanded,
    setAiExpanded,
    aiChatOpenRequest,
    setAiChatOpenRequest,
    promptTemplatesOpenRequest,
    setPromptTemplatesOpenRequest,
    previewWidth,
    setPreviewWidth,
    recoveryDrafts,
    setRecoveryDrafts,
  };
}

export type AppBindings = ReturnType<typeof useAppBindings>;
