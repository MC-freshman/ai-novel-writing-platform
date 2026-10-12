export type RetrievalMode =
  | "auto"
  | "inventory"
  | "chapter"
  | "entity"
  | "book"
  | "current"
  | "normal";

export interface RetrievalDiagnostics {
  requestedMode: RetrievalMode;
  mode: RetrievalMode;
  modeLabel: string;
  catalogUsed: boolean;
  inventoryUsed: boolean;
  scanLimit: number;
  sendLimit: number;
  scannedCount: number;
  candidateCount: number;
  contextCount: number;
  documentCount: number;
  includedTitles: string[];
  existingButNotRead: string[];
  existingButNotReadSources?: Array<{
    sourceId: string;
    title: string;
    group: string;
  }>;
  categoryCounts: Record<string, number>;
  notes: string[];
  plannedTitles?: string[];
  layersUsed?: string[];
  additionalSourceIds?: string[];
  subQueries?: Array<{
    id: string;
    label: string;
    query: string;
    kind: string;
  }>;
  routedVolumes?: string[];
  coverageByVolume?: Array<{
    volume: string;
    indexedSources: number;
    selectedSources: number;
    selectedChunks: number;
    summaryAvailable: boolean;
  }>;
  rawChapterCoverage?: { selected: number; total: number };
  coverageWarnings?: string[];
  selectedSourceReasons?: Array<{
    sourceId: string;
    title: string;
    group: string;
    reasons: string[];
    chunks: number;
    score: number;
  }>;
  skippedSourceReasons?: Array<{
    sourceId: string;
    title: string;
    group: string;
    reason: string;
  }>;
  firstPassCount?: number;
  secondPassCount?: number;
  evidenceTargets?: Array<{
    id: string;
    kind: string;
    label: string;
    required: boolean;
    covered: boolean;
    score: number;
    sourceId: string;
    sourceTitle: string;
  }>;
  uncoveredTargets?: string[];
  addedSources?: string[];
  evidenceConfidence?: "高" | "中" | "低";
  evidenceCoverageRatio?: number;
  freshness?: {
    checked: boolean;
    checkedAt: string;
    staleSourceCount: number;
    repairedSourceCount: number;
    deferredSourceCount: number;
    repairedSourceIds: string[];
    deferredSources: Array<{ sourceId: string; title: string; status: string }>;
    reusedHashes: number;
    recalculatedHashes: number;
  } | null;
}

export interface VectorStats {
  chunks: number;
  updatedAt: string;
  embeddingFallback?: { active: boolean; message: string; at: string };
  recovery?: {
    status: "recovered" | "degraded";
    message: string;
    backupPath: string;
  } | null;
}

export interface RetrievedChunk {
  id: string;
  title: string;
  sourceType: "chapter" | "character" | "world";
  score: number;
  vectorScore?: number;
  keywordScore?: number;
  entityScore?: number;
  adjacencyScore?: number;
  storyScore?: number;
  subQueryScore?: number;
  matchedSubQuery?: string;
  knowledgeRole?: KnowledgeRole;
  volume?: string;
  category?: string;
  text: string;
  metadata: {
    characters: string[];
    locations: string[];
    timeHints: string[];
  };
}

export interface RetrievalAudit {
  query: string;
  requestedTopK: number;
  selectedChunks: number;
  selectedSources: string[];
  knowledgeRoles?: Record<string, number>;
  memoryCount: number;
  estimatedPromptTokens: number;
  warnings: string[];
  firstPassCount?: number;
  secondPassCount?: number;
  evidenceConfidence?: "高" | "中" | "低";
  uncoveredTargets?: string[];
}

export type KnowledgeRole = "大纲" | "正文" | "补充材料";

export interface KnowledgeItem {
  id: string;
  sourceId: string;
  sourceType: "chapter";
  title: string;
  volume: string;
  knowledgeRole: KnowledgeRole;
  alwaysReference?: boolean;
  order: number;
  wordCount: number;
  updatedAt: string;
}

export type KnowledgeSyncState =
  | "已同步"
  | "等待更新"
  | "摘要待更新"
  | "未索引"
  | "文件缺失"
  | "空文档";

export interface KnowledgeSyncItem {
  sourceId: string;
  sourceType: "chapter" | "character" | "world";
  title: string;
  group: string;
  status: KnowledgeSyncState;
  detail: string;
  chunkCount: number;
}

export interface KnowledgeSyncStatus {
  updatedAt: string;
  counts: {
    total: number;
    synced: number;
    pending: number;
    errors: number;
    orphans: number;
  };
  items: KnowledgeSyncItem[];
  orphanSourceIds: string[];
  hierarchy: {
    sourceSummaries: number;
    volumeSummaries: number;
    hasBookSummary: boolean;
    updatedAt: string;
  };
  freshness?: { reusedHashes: number; recalculatedHashes: number };
}
