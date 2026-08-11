export type Provider = "openai" | "deepseek" | "kimi" | "claude" | "ollama" | "custom";

export interface ApiConfig {
  provider: Provider;
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  embeddingProvider: string;
  embeddingApiKey: string;
  embeddingBaseUrl: string;
  embeddingModel: string;
  temperature: number;
  maxTokens: number;
  topK: number;
  sendFullText: boolean;
}

export interface UiConfig {
  theme: "light" | "dark";
  fontSize: number;
  lineHeight: number;
  autosaveMs: number;
  backupOnSave: boolean;
}

export interface NovelConfig {
  version: number;
  title: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  api: ApiConfig;
  ui: UiConfig;
  stats: {
    todayDate: string;
    todayWords: number;
    totalWords: number;
    lastAutoBackupAt: string;
  };
  chapters: Chapter[];
}

export interface Chapter {
  id: string;
  title: string;
  volume: string;
  order: number;
  fileName: string;
  wordCount: number;
  importedFrom?: string;
  importId?: string;
  imageCount?: number;
  originalDocxFile?: string;
  contentFormat?: "markdown" | "html";
  knowledgeRole?: KnowledgeRole;
  outline?: Array<{
    id: string;
    level: number;
    title: string;
    line: number;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterCard {
  id: string;
  name: string;
  category?: string;
  appearance: string;
  personality: string;
  background: string;
  relationships: string;
  notes: string;
  fileName?: string;
  updatedAt: string;
}

export interface WorldDoc {
  id: string;
  title: string;
  category?: string;
  fileName: string;
  content: string;
  updatedAt: string;
}

export interface VectorStats {
  chunks: number;
  updatedAt: string;
}

export interface AppState {
  projectPath: string;
  config: NovelConfig;
  chapters: Chapter[];
  selectedChapter: Chapter | null;
  chapterContent: string;
  characters: CharacterCard[];
  worldDocs: WorldDoc[];
  vectorStats: VectorStats;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  context?: RetrievedChunk[];
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface RetrievedChunk {
  id: string;
  title: string;
  sourceType: "chapter" | "character" | "world";
  score: number;
  text: string;
  metadata: {
    characters: string[];
    locations: string[];
    timeHints: string[];
  };
}

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

export interface ProgressState {
  active: boolean;
  phase: string;
  current: number;
  total: number;
  fileName?: string;
  detail?: string;
  cancellable?: boolean;
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
  chapters: Array<{ chapterId: string; chapterTitle: string; volume: string; count: number }>;
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

export type KnowledgeRole = "大纲" | "正文" | "补充材料";

export interface KnowledgeItem {
  id: string;
  sourceId: string;
  sourceType: "chapter";
  title: string;
  volume: string;
  knowledgeRole: KnowledgeRole;
  order: number;
  wordCount: number;
  updatedAt: string;
}

export interface AnalysisSnapshot {
  updatedAt?: string;
  tab?: string;
  query?: string;
  searchResults?: GlobalSearchResult[];
  timeline?: { events: TimelineEvent[]; contextCount?: number; apiError?: string };
  timelineOptions?: { mode?: "local" | "ai"; chapterIds?: string[]; knowledgeSourceIds?: string[] };
  relationships?: { nodes: RelationshipNode[]; edges: RelationshipEdge[] };
  relationshipOptions?: { characterNames?: string[]; categoryFilter?: string; relationTypes?: string[] };
  consistency?: { issues: ConsistencyIssue[]; contextCount?: number; apiError?: string; notice?: string };
  consistencyOptions?: { chapterIds?: string[]; knowledgeSourceIds?: string[] };
  exportOptions?: { includeOutline?: boolean; includeCharacters?: boolean; includeWorld?: boolean };
  extractScope?: "book" | "chapter";
  worldCandidates?: ExtractedWorldCandidate[];
  appearanceStats?: AppearanceStat[];
  worldMapNodes?: WorldMapNode[];
  worldMapEdges?: WorldMapEdge[];
  materials?: MaterialItem[];
  materialDraft?: Partial<MaterialItem>;
  chatSessions?: ChatSession[];
  activeChatSessionId?: string;
  aiProjectMemory?: string;
}
