/// <reference types="vite/client" />

import type {
  AppState,
  ChapterVersion,
  ChapterVersionCompare,
  ConsistencyIssue,
  GlobalSearchResult,
  RelationshipEdge,
  RelationshipNode,
  TimelineEvent,
  CharacterCard,
  WorldDoc,
} from "./types";

declare global {
  interface Window {
    novelAPI: {
      onMenuAction: (callback: (action: string) => void) => () => void;
      getAppState: () => Promise<AppState>;
      createProject: (payload: { title: string }) => Promise<AppState | { canceled: true }>;
      openProject: () => Promise<AppState | { canceled: true }>;
      importDocument: (payload?: { volume?: string }) => Promise<
        | (AppState & {
            importSummary?: {
              total: number;
              imported: number;
              failed: number;
              failures: Array<{ filePath: string; message: string }>;
            };
          })
        | { canceled: true; message?: string }
      >;
      exportChapterDocx: (chapterId: string) => Promise<{ filePath?: string; canceled?: true }>;
      openOriginalDocument: (chapterId: string) => Promise<{ filePath?: string; error?: string }>;
      refreshChapterFromOriginal: (chapterId: string) => Promise<{
        state: AppState;
        backupPath?: string;
        tableCount: number;
        imageCount: number;
        warnings: string[];
      }>;
      saveProjectSettings: (payload: Partial<AppState["config"]> & { selectedChapterId?: string }) => Promise<AppState>;
      exportBackup: () => Promise<{ filePath?: string; canceled?: true }>;
      exportBookDocx: () => Promise<{ filePath?: string; canceled?: true }>;
      globalSearch: (payload: { query: string }) => Promise<{ query: string; results: GlobalSearchResult[] }>;
      buildTimeline: () => Promise<{ events: TimelineEvent[] }>;
      buildRelationshipGraph: () => Promise<{ nodes: RelationshipNode[]; edges: RelationshipEdge[] }>;
      analyzeConsistency: () => Promise<{ issues: ConsistencyIssue[]; contextCount: number; apiError?: string }>;
      createChapter: (payload: { title: string; volume?: string }) => Promise<AppState>;
      loadChapter: (chapterId: string) => Promise<{ chapter: AppState["selectedChapter"]; content: string }>;
      saveChapter: (payload: { chapterId: string; title: string; volume: string; content: string }) => Promise<{
        chapter: NonNullable<AppState["selectedChapter"]>;
        config: AppState["config"];
        indexResult: { chunks: number; totalChunks: number };
        vectorStats: AppState["vectorStats"];
      }>;
      deleteChapter: (chapterId: string) => Promise<AppState>;
      reorderChapters: (chapterIds: string[]) => Promise<{ chapters: AppState["chapters"] }>;
      moveChapterToVolume: (payload: { chapterId: string; volume: string; beforeChapterId?: string }) => Promise<AppState>;
      listChapterVersions: (chapterId: string) => Promise<{ versions: ChapterVersion[] }>;
      compareChapterVersion: (payload: { chapterId: string; versionId: string }) => Promise<ChapterVersionCompare>;
      saveCharacter: (payload: Partial<CharacterCard>) => Promise<AppState>;
      deleteCharacter: (characterId: string) => Promise<AppState>;
      saveWorldDoc: (payload: Partial<WorldDoc>) => Promise<AppState>;
      deleteWorldDoc: (docId: string) => Promise<AppState>;
      askAI: (payload: { question: string; selectedText?: string; history: Array<{ role: "user" | "assistant"; content: string }> }) => Promise<{
        answer: string;
        context: AppState extends never ? never : import("./types").RetrievedChunk[];
        embeddingSource: string;
        embeddingWarning?: string;
        apiError?: string;
      }>;
      generateCharactersFromOutline: () => Promise<{
        state: AppState;
        created: number;
        updated: number;
        count: number;
        names: string[];
        contextCount: number;
      }>;
      generateWorldFromOutline: () => Promise<{
        state: AppState;
        created: number;
        updated: number;
        count: number;
        titles: string[];
        contextCount: number;
      }>;
      extractWorldCardsFromOutline: () => Promise<{
        state: AppState;
        created: number;
        updated: number;
        count: number;
        titles: string[];
        contextCount: number;
      }>;
      rebuildIndex: () => Promise<{ chunks: number; state: AppState }>;
    };
  }
}
