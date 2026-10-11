import { createStore, type StoreApi } from "zustand/vanilla";
import type { SetStateAction } from "react";
import type { AppState, Chapter, BackgroundTask, EditorScrollAnchor, ChatMessage, ChatSession, RetrievalMode, RetrievalDiagnostics, ProgressState, RecoveryDraft } from "../types";
import type { CreativeWorkspaceTab } from "../components/CreativeWorkspace";
import type { InlineReviewItem } from "../lib/editor-ops";

export type Domain<T extends object> = { store: StoreApi<T>; setters: { [K in keyof T]: (next: SetStateAction<T[K]>) => void } };
function createDomain<T extends object>(initial: T): Domain<T> {
  const store = createStore<T>(() => initial);
  const setters = {} as Domain<T>["setters"];
  for (const key of Object.keys(initial) as Array<keyof T>) setters[key] = (next) => {
    store.setState((current) => ({ ...current, [key]: typeof next === "function" ? (next as (value: T[typeof key]) => T[typeof key])(current[key]) : next }));
  };
  return { store, setters };
}

type ProjectState = {
  state: AppState | null;
  selectedChapter: Chapter | null;
  chapterContent: string;
  chapterTitle: string;
  chapterVolume: string;
  dirty: boolean;
  saving: boolean;
  status: string;
  recoveryDrafts: RecoveryDraft[];
  chapterRevision: string;
  projectEpoch: number;
};

type ChatState = {
  chatMessages: ChatMessage[];
  chatSessions: ChatSession[];
  activeChatSessionId: string;
  aiProjectMemory: string;
  chatRetrievalMode: RetrievalMode;
  chatLoaded: boolean;
  activeAiRequestId: string;
  aiProgress: { phase: string; stopped?: boolean; streamedChars: number; retrieval?: RetrievalDiagnostics } | null;
};

type LayoutState = {
  focusMode: boolean;
  preview: boolean;
  leftWidth: number;
  rightWidth: number;
  viewportWidth: number;
  aiExpanded: boolean;
  previewWidth: number;
};

type NavigationState = {
  view: "chapters" | "characters" | "world" | "knowledge" | "analysis";
  networkOpenRequest: number;
  showSettings: boolean;
  showQuickPanel: boolean;
  showStoryCenter: boolean;
  storyCenterInitialTab: "facts" | "workspace";
  workspaceInitialTab: CreativeWorkspaceTab;
  showTaskCenter: boolean;
  aiChatOpenRequest: number;
};

type TasksState = {
  backgroundTasks: BackgroundTask[];
  draggingChapterId: string | null;
  importProgress: ProgressState | null;
  indexProgress: ProgressState | null;
};

type EditorState = {
  scrollAnchor: EditorScrollAnchor | null;
  selectedText: string;
  editorReviews: InlineReviewItem[];
  contextMenu: { x: number; y: number; text: string } | null;
  showFindReplace: boolean;
  findText: string;
  replaceText: string;
};

export function createAppStores(viewportWidth = 1024) {
  return {
    project: createDomain<ProjectState>({
      state: null,
      selectedChapter: null,
      chapterContent: "",
      chapterTitle: "",
      chapterVolume: "卷一",
      dirty: false,
      saving: false,
      status: "正在打开项目...",
      recoveryDrafts: [],
      chapterRevision: "",
      projectEpoch: 0,
    }),
    chat: createDomain<ChatState>({
      chatMessages: [],
      chatSessions: [],
      activeChatSessionId: "",
      aiProjectMemory: "",
      chatRetrievalMode: "auto",
      chatLoaded: false,
      activeAiRequestId: "",
      aiProgress: null,
    }),
    layout: createDomain<LayoutState>({
      focusMode: false,
      preview: false,
      leftWidth: 256,
      rightWidth: 360,
      viewportWidth: viewportWidth,
      aiExpanded: false,
      previewWidth: 46,
    }),
    navigation: createDomain<NavigationState>({
      view: "chapters",
      networkOpenRequest: 0,
      showSettings: false,
      showQuickPanel: false,
      showStoryCenter: false,
      storyCenterInitialTab: "facts",
      workspaceInitialTab: "planning",
      showTaskCenter: false,
      aiChatOpenRequest: 0,
    }),
    tasks: createDomain<TasksState>({
      backgroundTasks: [],
      draggingChapterId: null,
      importProgress: null,
      indexProgress: null,
    }),
    editor: createDomain<EditorState>({
      scrollAnchor: null,
      selectedText: "",
      editorReviews: [],
      contextMenu: null,
      showFindReplace: false,
      findText: "",
      replaceText: "",
    }),
  };
}
export type AppStores = ReturnType<typeof createAppStores>;

export function readChapterDraft(stores: AppStores) {
  const current = stores.project.store.getState();
  return { content: current.chapterContent, title: current.chapterTitle, volume: current.chapterVolume };
}
export function isCurrentEpoch(stores: AppStores, epoch: number) {
  return stores.project.store.getState().projectEpoch === epoch;
}
export function applyProjectState(stores: AppStores, next: AppState) {
  const previous = stores.project.store.getState();
  const changedProject = previous.state?.projectPath !== next.projectPath;
  if (changedProject) {
    const defaults = createAppStores();
    stores.chat.store.setState(defaults.chat.store.getState(), true);
    stores.tasks.store.setState(defaults.tasks.store.getState(), true);
    stores.editor.store.setState(defaults.editor.store.getState(), true);
    stores.navigation.store.setState(defaults.navigation.store.getState(), true);
  }
  stores.project.store.setState({ state: next, selectedChapter: next.selectedChapter, chapterContent: next.chapterContent, chapterTitle: next.selectedChapter?.title || "", chapterVolume: next.selectedChapter?.volume || "卷一", chapterRevision: next.chapterRevision || "", dirty: false, saving: changedProject ? false : previous.saving, recoveryDrafts: changedProject ? [] : previous.recoveryDrafts, projectEpoch: previous.projectEpoch + (changedProject ? 1 : 0) });
}
