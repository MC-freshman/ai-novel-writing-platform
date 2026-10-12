import type { AppBindings } from "./bindings";
import type { AppRefs } from "./refs";
import type {
  RetrievalMode,
  CharacterCard,
  WorldDoc,
  AppState,
  RecoveryDraft,
  ChatMessage,
  ChatSession,
} from "../types";
import type { CreativeWorkspaceTab } from "../components/CreativeWorkspace";
import type { MouseEvent } from "react";

export type AppContext = AppBindings &
  AppRefs & {
    applyAppState: (nextState: AppState) => void;
    saveChapter: () => Promise<boolean>;
    saveChapterIfDirty: () => Promise<boolean>;
    saveBeforeLeavingChapter: () => Promise<boolean>;
    saveCurrentPage: () => Promise<boolean>;
    activeRecoveryDraft: RecoveryDraft | null;
    restoreRecoveryDraft: (draft: RecoveryDraft) => void;
    discardRecoveryDraft: (draft: RecoveryDraft) => Promise<void>;
    selectChapter: (
      chapterId: string,
      line?: number | undefined,
      quote?: string | undefined,
    ) => Promise<void>;
    createChapter: () => Promise<void>;
    deleteChapter: (chapterId: string) => Promise<void>;
    moveDraggingChapter: (
      volume: string,
      beforeChapterId?: string,
    ) => Promise<void>;
    adjustOutlineLevel: (
      chapterId: string,
      lineOrIndex: number,
      currentLevel: number,
      delta: number,
    ) => Promise<void>;
    createProject: () => Promise<void>;
    openProject: () => Promise<void>;
    importDocument: (volume?: string) => Promise<void>;
    exportChapterDocx: () => Promise<void>;
    exportBookDocx: (
      options?:
        | {
            includeOutline?: boolean | undefined;
            includeMaterials?: boolean | undefined;
            includeCharacters?: boolean | undefined;
            includeWorld?: boolean | undefined;
          }
        | undefined,
    ) => Promise<void>;
    openOriginalDocument: () => Promise<void>;
    refreshChapterFromOriginal: () => Promise<void>;
    exportBackup: () => Promise<void>;
    rebuildIndex: () => Promise<void>;
    saveCharacter: (
      card: Partial<CharacterCard>,
    ) => Promise<CharacterCard | null>;
    deleteCharacter: (characterId: string) => Promise<boolean>;
    generateCharactersFromOutline: () => Promise<void>;
    saveWorldDoc: (doc: Partial<WorldDoc>) => Promise<WorldDoc | null>;
    deleteWorldDoc: (docId: string) => Promise<boolean>;
    generateWorldFromOutline: () => Promise<void>;
    saveChatDraft: (
      nextSessions: ChatSession[],
      nextActiveId?: string,
      nextMemory?: string,
    ) => void;
    updateCurrentChat: (nextMessages: ChatMessage[]) => void;
    createChatSession: () => void;
    switchChatSession: (sessionId: string) => void;
    clearCurrentChat: () => void;
    updateProjectMemory: (value: string) => void;
    updateChatRetrievalMode: (mode: RetrievalMode) => void;
    sendChat: (
      question: string,
      selection?: string,
      retrievalMode?: RetrievalMode,
      additionalSourceIds?: string[],
    ) => Promise<void>;
    stopChatGeneration: () => Promise<void>;
    captureSelection: () => void;
    openAskSelectionMenu: (
      event: MouseEvent<HTMLTextAreaElement, MouseEvent>,
    ) => void;
    openRichAskSelectionMenu: (
      event: MouseEvent<HTMLElement, MouseEvent>,
    ) => void;
    findNextInChapter: () => void;
    replaceAllInChapter: () => void;
    askSelectedText: (text: string) => Promise<void>;
    editSelectedText: (
      action: "改写" | "润色" | "扩写" | "总结",
      text: string,
    ) => Promise<void>;
    extractWorldCardsFromSelection: (text: string) => Promise<void>;
    openWorkspaceFromSelection: (
      tab: CreativeWorkspaceTab,
      text: string,
    ) => Promise<void>;
    changeView: (
      nextView: "chapters" | "characters" | "world" | "knowledge" | "analysis",
    ) => Promise<boolean>;
    openSettings: () => Promise<void>;
    openStoryCenter: (
      initialTab?: "facts" | "workspace",
      workspaceTab?: CreativeWorkspaceTab,
    ) => Promise<void>;
    showAiChat: () => void;
    currentWords: number;
    paneWidths: { left: number; right: number; centerMinimum: number };
    toggleTheme: () => Promise<void>;
    startPaneResize: (
      kind: "preview" | "left" | "right",
      event: MouseEvent<HTMLDivElement, MouseEvent>,
    ) => void;
  };
