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
  CreativeAdviceMode,
  CreativeAdviceResult,
  MaterialItem,
  ProgressState,
  KnowledgeItem,
  KnowledgeSyncStatus,
  ProjectHealthReport,
  RelationshipEdge,
  RelationshipNode,
  RetrievalDiagnostics,
  RetrievalMode,
  TimelineEvent,
  WorldMapEdge,
  WorldMapNode,
  CharacterCard,
  WorldDoc,
  BackgroundTask,
  BackgroundTaskType,
  ChapterPreparationBoard,
  ForeshadowItem,
  ProjectBranches,
  ProjectSnapshot,
  ProjectSnapshotComparison,
  StoryFact,
  StoryOverview,
  CreativeWorkspaceState,
  CreativeAgentRun,
  ChapterQualityReport,
  ProjectExchangePreview,
  SafeRevision,
  RecoveryDraft,
  RecoveryStatus,
  OperationJournalItem,
} from "./types";

declare global {
  interface Window {
    novelAPI: {
      onMenuAction: (callback: (action: string) => void) => () => void;
      onImportProgress: (callback: (progress: ProgressState) => void) => () => void;
      onIndexProgress: (callback: (progress: ProgressState) => void) => () => void;
      onAIStream: (callback: (payload: {
        requestId: string;
        type: "phase" | "retrieval" | "chunk" | "done" | "error";
        text?: string;
        phase?: string;
        streamedChars?: number;
        retrieval?: RetrievalDiagnostics;
        error?: string;
      }) => void) => () => void;
      onTaskProgress: (callback: (task: BackgroundTask) => void) => () => void;
      getAppState: () => Promise<AppState>;
      checkForUpdate: () => Promise<{ currentVersion: string; latestVersion: string; updateAvailable: boolean; releaseName: string; notes: string; pageUrl: string; downloadUrl: string; assetName: string }>;
      downloadUpdate: (payload: { url: string; assetName?: string }) => Promise<{ canceled?: true; filePath?: string; opened?: boolean }>;
      scanReleasePrivacy: () => Promise<{ ok: boolean; scannedFiles: number; scannedBytes: number; findings: Array<{ rule: string; label: string; file: string; line: number; preview: string }>; checkedAt: string }>;
      getRecoveryStatus: () => Promise<RecoveryStatus>;
      saveRecoveryDraft: (payload: Omit<RecoveryDraft, "version" | "updatedAt">) => Promise<RecoveryDraft | { disabled: true }>;
      clearRecoveryDraft: (chapterId: string) => Promise<{ removed: boolean }>;
      saveWindowRecoveryState: (payload: { selectedChapterId?: string; view?: "chapters" | "characters" | "world" | "knowledge" | "analysis"; leftWidth?: number; rightWidth?: number; previewWidth?: number }) => Promise<RecoveryStatus["windowState"]>;
      listOperationJournal: () => Promise<{ operations: OperationJournalItem[]; sessions: Array<{ id: string; status: string; startedAt: string; endedAt: string }> }>;
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
      exportProjectExchange: (payload?: { includeWorkspace?: boolean; password?: string }) => Promise<{ filePath?: string; manifest?: ProjectExchangePreview["manifest"]; encrypted?: boolean; canceled?: true }>;
      previewProjectExchange: (payload?: { token?: string; password?: string }) => Promise<ProjectExchangePreview | { canceled: true } | { token: string; filePath: string; encrypted: true; requiresPassword: true }>;
      importProjectExchange: (payload: { token: string; password?: string; includeChapters?: boolean; includeCharacters?: boolean; includeWorld?: boolean; includeMaterials?: boolean; includeWorkspace?: boolean; renameMaterials?: boolean }) => Promise<{ state: AppState; imported: { chapters: number; characters: number; worldDocs: number; materials: number }; renamedConflicts: boolean }>;
      exportBookDocx: (payload?: {
        includeOutline?: boolean;
        includeMaterials?: boolean;
        includeCharacters?: boolean;
        includeWorld?: boolean;
      }) => Promise<{
        directoryPath?: string;
        exportedCount?: number;
        failedCount?: number;
        chapterCount?: number;
        characterCount?: number;
        worldCount?: number;
        failures?: Array<{ sourceType: string; sourceId: string; title: string; message: string }>;
        canceled?: true;
      }>;
      globalSearch: (payload: { query: string }) => Promise<{ query: string; results: GlobalSearchResult[] }>;
      getAnalysisState: () => Promise<AnalysisSnapshot>;
      saveAnalysisState: (payload: Partial<AnalysisSnapshot>) => Promise<AnalysisSnapshot>;
      buildTimeline: (payload?: { mode?: "local" | "ai"; refresh?: boolean; chapterIds?: string[]; knowledgeSourceIds?: string[] }) => Promise<{ events: TimelineEvent[]; contextCount?: number; apiError?: string }>;
      buildRelationshipGraph: (payload?: { characterNames?: string[]; categoryFilter?: string; relationTypes?: string[]; refresh?: boolean }) => Promise<{ nodes: RelationshipNode[]; edges: RelationshipEdge[] }>;
      analyzeConsistency: (payload?: { refresh?: boolean; chapterIds?: string[]; knowledgeSourceIds?: string[] }) => Promise<{ issues: ConsistencyIssue[]; contextCount: number; apiError?: string }>;
      updateIssueStatus: (payload: { issueId: string; status: ConsistencyIssue["status"] }) => Promise<{ issueId: string; status: string; updatedAt: string }>;
      listKnowledgeItems: () => Promise<{ items: KnowledgeItem[] }>;
      updateKnowledgeItems: (payload: { items: KnowledgeItem[] }) => Promise<{ items: KnowledgeItem[]; state: AppState }>;
      getKnowledgeStatus: () => Promise<KnowledgeSyncStatus>;
      repairKnowledge: () => Promise<{ status: KnowledgeSyncStatus; state: AppState }>;
      getMaintenanceDiagnostics: () => Promise<import("./types").MaintenanceDiagnostics>;
      repairMaintenance: () => Promise<{ diagnostics: import("./types").MaintenanceDiagnostics; status: KnowledgeSyncStatus; state: AppState }>;
      getProjectHealth: () => Promise<ProjectHealthReport>;
      repairProjectHealth: () => Promise<{ health: ProjectHealthReport; state: AppState }>;
      getStoryOverview: (payload?: { chapterIds?: string[]; volume?: string; query?: string; factStatus?: string; foreshadowStatus?: string; factOffset?: number; factLimit?: number; characterOffset?: number; characterLimit?: number; foreshadowOffset?: number; foreshadowLimit?: number }) => Promise<StoryOverview>;
      analyzeStoryLocally: (payload?: { chapterIds?: string[] }) => Promise<StoryOverview>;
      updateStoryFact: (payload: { factId: string; patch: Partial<Pick<StoryFact, "type" | "subject" | "predicate" | "object" | "status" | "userNote">> }) => Promise<StoryFact>;
      createStoryFact: (payload: { chapterId: string; subject: string; type?: string; predicate?: string; object: string; userNote?: string }) => Promise<StoryFact>;
      deleteStoryFact: (factId: string) => Promise<{ removed: boolean; factId: string }>;
      updateForeshadow: (payload: { foreshadowId: string; patch: Partial<Pick<ForeshadowItem, "status" | "title" | "description" | "plannedPayoff" | "userNote">> }) => Promise<ForeshadowItem>;
      createForeshadow: (payload: { chapterId: string; title: string; description: string; plannedPayoff?: string; userNote?: string }) => Promise<ForeshadowItem>;
      deleteForeshadow: (foreshadowId: string) => Promise<{ removed: boolean; foreshadowId: string }>;
      getChapterBoard: (chapterId: string) => Promise<{ board: ChapterPreparationBoard | null }>;
      generateChapterBoard: (payload: { chapterId: string }) => Promise<{ board: ChapterPreparationBoard }>;
      saveChapterBoard: (payload: { board: ChapterPreparationBoard }) => Promise<{ board: ChapterPreparationBoard }>;
      getCreativeWorkspace: () => Promise<CreativeWorkspaceState>;
      upsertCreativeWorkspaceItem: (payload: { collection: keyof Pick<CreativeWorkspaceState, "scenes" | "causalNodes" | "causalEdges" | "arcs" | "annotations" | "memories" | "revisions">; item: Record<string, unknown> }) => Promise<{ item: unknown; workspace: CreativeWorkspaceState }>;
      deleteCreativeWorkspaceItem: (payload: { collection: keyof Pick<CreativeWorkspaceState, "scenes" | "causalNodes" | "causalEdges" | "arcs" | "annotations" | "memories" | "revisions">; itemId: string }) => Promise<{ workspace: CreativeWorkspaceState }>;
      reorderScenes: (payload: { chapterId: string; sceneIds: string[] }) => Promise<{ scenes: CreativeWorkspaceState["scenes"]; workspace: CreativeWorkspaceState }>;
      rebuildCausality: () => Promise<{ nodes: CreativeWorkspaceState["causalNodes"]; edges: CreativeWorkspaceState["causalEdges"]; workspace: CreativeWorkspaceState }>;
      generateCharacterArcs: () => Promise<{ arcs: CreativeWorkspaceState["arcs"]; workspace: CreativeWorkspaceState }>;
      getChapterQualityReports: () => Promise<{ reports: ChapterQualityReport[]; generatedAt: string }>;
      generateCreativeStatistics: (payload?: { label?: string }) => Promise<{ snapshot: import("./types").CreativeStatisticsSnapshot; workspace: CreativeWorkspaceState }>;
      prepareCreativeAgent: (payload: { mode: CreativeAdviceMode; chapterId?: string; focus?: string; contextIds?: string[]; includeSourceIds?: string[]; excludeSourceIds?: string[]; permissionLevel?: import("./types").AgentPermissionLevel; scopeType?: import("./types").AgentScopeType | "auto"; selectedText?: string; selectedTextRevision?: string }) => Promise<CreativeAgentRun>;
      executeCreativeAgent: (runId: string) => Promise<{ run: CreativeAgentRun; task: BackgroundTask }>;
      retryCreativeAgentTool: (payload: { runId: string; tool: string }) => Promise<{ run: CreativeAgentRun; task: BackgroundTask }>;
      createSafeRevision: (payload: { chapterId: string; original: string; sourceRevision: string; action: "改写" | "润色" | "扩写" | "精简"; instruction?: string }) => Promise<SafeRevision>;
      applySafeRevision: (revisionId: string) => Promise<{ state: AppState; revision: SafeRevision }>;
      applySafeRevisionPart: (payload: { revisionId: string; original: string; replacement: string }) => Promise<{ state: AppState; revision: SafeRevision; workspace: CreativeWorkspaceState }>;
      updateRevisionStatus: (payload: { revisionId: string; status: "已拒绝" | "已失效" }) => Promise<{ item: SafeRevision; workspace: CreativeWorkspaceState }>;
      listTasks: () => Promise<{ tasks: BackgroundTask[] }>;
      enqueueTask: (payload: { type: BackgroundTaskType; title: string; total?: number; scope?: { chapterIds?: string[]; chapterId?: string }; options?: Record<string, unknown> }) => Promise<{ task: BackgroundTask }>;
      cancelTask: (taskId: string) => Promise<{ canceled: boolean; task?: BackgroundTask }>;
      pauseTask: (taskId: string) => Promise<{ paused: boolean; task?: BackgroundTask }>;
      resumeTask: (taskId: string) => Promise<{ resumed: boolean; task?: BackgroundTask }>;
      retryTask: (taskId: string) => Promise<{ task: BackgroundTask }>;
      removeTask: (taskId: string) => Promise<{ removed: boolean; tasks: BackgroundTask[] }>;
      clearTaskHistory: () => Promise<{ removed: number; tasks: BackgroundTask[] }>;
      listSnapshots: () => Promise<{ snapshots: ProjectSnapshot[]; branches: ProjectBranches }>;
      createSnapshot: (payload?: { name?: string; reason?: string }) => Promise<{ snapshot: ProjectSnapshot }>;
      compareSnapshot: (snapshotId: string) => Promise<ProjectSnapshotComparison>;
      restoreSnapshot: (payload: { snapshotId: string; paths?: string[] }) => Promise<{ restored: number; removed: number; removedPaths: string[]; snapshot: ProjectSnapshot; safetySnapshot: ProjectSnapshot | null; task: BackgroundTask; state: AppState }>;
      renameSnapshot: (payload: { snapshotId: string; name: string }) => Promise<{ snapshot: ProjectSnapshot }>;
      deleteSnapshot: (snapshotId: string) => Promise<{ removed: boolean; snapshotId: string; garbageCollection: { removedObjects: number; removedBytes: number; referencedObjects: number } }>;
      cleanupSnapshots: () => Promise<{ removedObjects: number; removedBytes: number; referencedObjects: number }>;
      createBranch: (payload: { name: string; snapshotId?: string }) => Promise<{ branch: import("./types").ProjectBranch; branches: ProjectBranches }>;
      switchBranch: (branchId: string) => Promise<{ activeBranch: import("./types").ProjectBranch; branches: ProjectBranches; restored: number; task: BackgroundTask | null; state: AppState }>;
      deleteBranch: (branchId: string) => Promise<{ removed: boolean; branch?: import("./types").ProjectBranch; branches: ProjectBranches }>;
      getAppearanceStats: () => Promise<{ stats: AppearanceStat[] }>;
      getWorldMap: () => Promise<{ nodes: WorldMapNode[]; edges: WorldMapEdge[] }>;
      listMaterials: () => Promise<{ materials: MaterialItem[] }>;
      saveMaterial: (payload: Partial<MaterialItem>) => Promise<{ material: MaterialItem; materials: MaterialItem[] }>;
      deleteMaterial: (materialId: string) => Promise<{ materials: MaterialItem[] }>;
      createChapter: (payload: { title: string; volume?: string }) => Promise<AppState>;
      loadChapter: (chapterId: string) => Promise<{ chapter: AppState["selectedChapter"]; content: string; revision: string }>;
      saveChapter: (payload: { chapterId: string; title: string; volume: string; content: string; expectedRevision?: string }) => Promise<{
        chapter: NonNullable<AppState["selectedChapter"]>;
        config: AppState["config"];
        indexResult: { chunks: number; totalChunks: number };
        vectorStats: AppState["vectorStats"];
        revision: string;
        storyStateWarning?: string;
      }>;
      deleteChapter: (chapterId: string) => Promise<AppState>;
      reorderChapters: (chapterIds: string[]) => Promise<{ chapters: AppState["chapters"] }>;
      moveChapterToVolume: (payload: { chapterId: string; volume: string; beforeChapterId?: string }) => Promise<AppState>;
      listChapterVersions: (chapterId: string) => Promise<{ versions: ChapterVersion[] }>;
      compareChapterVersion: (payload: { chapterId: string; versionId: string }) => Promise<ChapterVersionCompare>;
      restoreChapterVersion: (payload: { chapterId: string; versionId: string }) => Promise<{ state: AppState; restoredVersion: ChapterVersion }>;
      saveCharacter: (payload: Partial<CharacterCard>) => Promise<AppState>;
      deleteCharacter: (characterId: string) => Promise<AppState>;
      saveWorldDoc: (payload: Partial<WorldDoc>) => Promise<AppState>;
      deleteWorldDoc: (docId: string) => Promise<AppState>;
      getCreativeAdvice: (payload: { mode: CreativeAdviceMode; chapterId?: string; focus?: string; contextIds?: string[] }) => Promise<CreativeAdviceResult>;
      askAI: (payload: {
        requestId?: string;
        question: string;
        selectedText?: string;
        history: Array<{ role: "user" | "assistant"; content: string }>;
        projectMemory?: string;
        retrievalMode?: RetrievalMode;
        selectedChapterId?: string;
        additionalSourceIds?: string[];
      }) => Promise<{
        answer: string;
        context: AppState extends never ? never : import("./types").RetrievedChunk[];
        retrieval?: RetrievalDiagnostics;
        contextCount?: number;
        candidateCount?: number;
        scannedCount?: number;
        embeddingSource: string;
        embeddingWarning?: string;
        apiError?: string;
        streamedChars?: number;
      }>;
      cancelAI: (requestId: string) => Promise<{ canceled: boolean }>;
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
      extractWorldCardsFromOutline: (payload?: { scope?: "book" | "chapter"; chapterId?: string; text?: string }) => Promise<{
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
