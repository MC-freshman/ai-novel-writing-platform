/// <reference types="vite/client" />

import type {
  AppState,
  AnalysisSnapshot,
  ChapterVersion,
  ChapterVersionCompare,
  ConsistencyIssue,
  ExtractedWorldCandidate,
  GlobalSearchResult,
  AppearanceStat,
  MaterialItem,
  ProgressState,
  KnowledgeItem,
  RelationshipEdge,
  RelationshipNode,
  TimelineEvent,
  WorldMapEdge,
  WorldMapNode,
  CharacterCard,
  WorldDoc,
} from "./types";

declare global {
  interface Window {
    novelAPI: {
      onMenuAction: (callback: (action: string) => void) => () => void;
      onImportProgress: (callback: (progress: ProgressState) => void) => () => void;
      onIndexProgress: (callback: (progress: ProgressState) => void) => () => void;
      getAppState: () => Promise<AppState>;
      createProject: (payload: { title: string }) => Promise<AppState | { canceled: true }>;
      openProject: () => Promise<AppState | { canceled: true }>;
      importDocument: (payload?: { volume?: string }) => Promise<
        | (AppState & {
            importSummary?: {
              total: number;
              imported: number;
              failed: number;
              canceled?: boolean;
              failures: Array<{ filePath: string; message: string }>;
            };
          })
        | { canceled: true; message?: string }
      >;
      cancelImport: () => Promise<{ ok: true }>;
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
      exportBookDocx: (payload?: { includeOutline?: boolean; includeCharacters?: boolean; includeWorld?: boolean }) => Promise<{ filePath?: string; canceled?: true }>;
      globalSearch: (payload: { query: string }) => Promise<{ query: string; results: GlobalSearchResult[] }>;
      getAnalysisState: () => Promise<AnalysisSnapshot>;
      saveAnalysisState: (payload: Partial<AnalysisSnapshot>) => Promise<AnalysisSnapshot>;
      buildTimeline: (payload?: { mode?: "local" | "ai"; refresh?: boolean; chapterIds?: string[]; knowledgeSourceIds?: string[] }) => Promise<{ events: TimelineEvent[]; contextCount?: number; apiError?: string }>;
      buildRelationshipGraph: (payload?: { characterNames?: string[]; categoryFilter?: string; relationTypes?: string[]; refresh?: boolean }) => Promise<{ nodes: RelationshipNode[]; edges: RelationshipEdge[] }>;
      analyzeConsistency: (payload?: { refresh?: boolean; chapterIds?: string[]; knowledgeSourceIds?: string[] }) => Promise<{ issues: ConsistencyIssue[]; contextCount: number; apiError?: string }>;
      updateIssueStatus: (payload: { issueId: string; status: ConsistencyIssue["status"] }) => Promise<{ issueId: string; status: string; updatedAt: string }>;
      listKnowledgeItems: () => Promise<{ items: KnowledgeItem[] }>;
      updateKnowledgeItems: (payload: { items: KnowledgeItem[] }) => Promise<{ items: KnowledgeItem[]; state: AppState }>;
      getAppearanceStats: () => Promise<{ stats: AppearanceStat[] }>;
      getWorldMap: () => Promise<{ nodes: WorldMapNode[]; edges: WorldMapEdge[] }>;
      listMaterials: () => Promise<{ materials: MaterialItem[] }>;
      saveMaterial: (payload: Partial<MaterialItem>) => Promise<{ material: MaterialItem; materials: MaterialItem[] }>;
      deleteMaterial: (materialId: string) => Promise<{ materials: MaterialItem[] }>;
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
      editSelection: (payload: { action: "改写" | "润色" | "扩写" | "总结"; text: string }) => Promise<{ answer: string }>;
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
      extractWorldCardsFromOutline: (payload?: { scope?: "book" | "chapter"; chapterId?: string }) => Promise<{
        candidates: ExtractedWorldCandidate[];
        contextCount: number;
        scope: "book" | "chapter";
      }>;
      saveWorldCardCandidates: (payload: { candidates: ExtractedWorldCandidate[] }) => Promise<{
        state: AppState;
        created: number;
        updated: number;
        count: number;
        titles: string[];
      }>;
      rebuildIndex: () => Promise<{ chunks: number; state: AppState }>;
    };
  }
}
