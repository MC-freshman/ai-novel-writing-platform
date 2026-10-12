import type { CreativeAdviceMode, CreativeAdviceResult } from "./workspace";
import type { AgentScopeType } from "./config";
import type { ChatSession } from "./chat";
import type { RetrievalMode } from "./retrieval";

export interface GlobalSearchResult {
  id: string;
  sourceId: string;
  sourceType: "chapter" | "character" | "world";
  title: string;
  volume?: string;
  category?: string;
  updatedAt?: string;
  score: number;
  snippet: string;
}

export interface TimelineEvent {
  id: string;
  order: number;
  chapterId: string;
  chapterTitle: string;
  volume: string;
  title: string;
  timeHint: string;
  summary: string;
  characters: string[];
}

export interface RelationshipNode {
  id: string;
  name: string;
  category: string;
  size: number;
  notes?: string;
  x?: number;
  y?: number;
  color?: string;
}

export interface RelationshipEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  weight: number;
  evidence: string[];
  labelX?: number;
  labelY?: number;
  color?: string;
  direction?: "forward" | "backward" | "both" | "none";
}

export interface ConsistencyIssue {
  id: string;
  severity: "高" | "中" | "低";
  category: string;
  title: string;
  detail: string;
  suggestion: string;
  evidence: string[];
  status?: "待处理" | "已确认" | "已忽略" | "已修复";
  statusUpdatedAt?: string;
}

export interface ChapterVersion {
  id: string;
  chapterId: string;
  title: string;
  createdAt: string;
  wordCount: number;
  fileName: string;
  reason: string;
}

export interface VersionDiffLine {
  type: "same" | "added" | "removed";
  text: string;
}

export interface ChapterVersionCompare {
  version: ChapterVersion;
  currentTitle: string;
  currentUpdatedAt: string;
  added: number;
  removed: number;
  diff: VersionDiffLine[];
  truncated?: boolean;
}

export interface ExtractedWorldCandidate {
  id: string;
  title: string;
  category: string;
  content: string;
  selected: boolean;
  action: "create" | "merge";
  matchedDocId?: string;
  matchedTitle?: string;
}

export interface AppearanceStat {
  id: string;
  name: string;
  category: string;
  total: number;
  chapters: Array<{
    chapterId: string;
    chapterTitle: string;
    volume: string;
    count: number;
  }>;
}

export interface WorldMapNode {
  id: string;
  title: string;
  category: string;
  type: "地点" | "势力" | "物品" | "设定";
  summary: string;
}

export interface WorldMapEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface MaterialItem {
  id: string;
  title: string;
  category: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisSnapshot {
  updatedAt?: string;
  tab?: string;
  query?: string;
  searchResults?: GlobalSearchResult[];
  timeline?: {
    events: TimelineEvent[];
    contextCount?: number;
    apiError?: string;
  };
  timelineOptions?: {
    mode?: "local" | "ai";
    chapterIds?: string[];
    knowledgeSourceIds?: string[];
  };
  relationships?: { nodes: RelationshipNode[]; edges: RelationshipEdge[] };
  relationshipOptions?: {
    characterNames?: string[];
    categoryFilter?: string;
    relationTypes?: string[];
  };
  consistency?: {
    issues: ConsistencyIssue[];
    contextCount?: number;
    apiError?: string;
    notice?: string;
  };
  consistencyOptions?: { chapterIds?: string[]; knowledgeSourceIds?: string[] };
  exportOptions?: {
    includeOutline?: boolean;
    includeMaterials?: boolean;
    includeCharacters?: boolean;
    includeWorld?: boolean;
  };
  extractScope?: "book" | "chapter";
  worldCandidates?: ExtractedWorldCandidate[];
  appearanceStats?: AppearanceStat[];
  worldMapNodes?: WorldMapNode[];
  worldMapEdges?: WorldMapEdge[];
  materials?: MaterialItem[];
  materialDraft?: Partial<MaterialItem>;
  creativeAdvice?: CreativeAdviceResult;
  creativeOptions?: {
    mode?: CreativeAdviceMode;
    chapterId?: string;
    focus?: string;
    contextIds?: string[];
    includeSourceIds?: string[];
    excludeSourceIds?: string[];
    scopeType?: AgentScopeType | "auto";
  };
  chatSessions?: ChatSession[];
  activeChatSessionId?: string;
  aiProjectMemory?: string;
  chatRetrievalMode?: RetrievalMode;
  aiStreamRecovery?: {
    requestId: string;
    question: string;
    answer: string;
    status: "streaming" | "completed" | "interrupted";
    updatedAt: string;
  };
}

export type AnalysisTab =
  | "progress"
  | "search"
  | "timeline"
  | "relations"
  | "consistency"
  | "versions"
  | "export";
