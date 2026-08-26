export type Provider = "openai" | "deepseek" | "qwen" | "kimi" | "claude" | "ollama" | "custom";

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
  scanK: number;
  sendFullText: boolean;
  credentialStorage?: "windows" | "legacy" | "none";
  credentialError?: string;
}

export type RetrievalMode = "auto" | "inventory" | "chapter" | "entity" | "book" | "current" | "normal";

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
  existingButNotReadSources?: Array<{ sourceId: string; title: string; group: string }>;
  categoryCounts: Record<string, number>;
  notes: string[];
  plannedTitles?: string[];
  layersUsed?: string[];
  additionalSourceIds?: string[];
  subQueries?: Array<{ id: string; label: string; query: string; kind: string }>;
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
  skippedSourceReasons?: Array<{ sourceId: string; title: string; group: string; reason: string }>;
  firstPassCount?: number;
  secondPassCount?: number;
  evidenceTargets?: Array<{ id: string; kind: string; label: string; required: boolean; covered: boolean; score: number; sourceId: string; sourceTitle: string }>;
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

export interface UiConfig {
  theme: "light" | "dark";
  fontSize: number;
  lineHeight: number;
  autosaveMs: number;
  backupOnSave: boolean;
  recoveryEnabled: boolean;
}

export interface AgentConfig {
  autoLocalAnalysis: boolean;
  autoDeepAnalysis: boolean;
  evidenceRequired: boolean;
  snapshotBeforeBulkChanges: boolean;
  permissionLevel: AgentPermissionLevel;
}

export type AgentPermissionLevel = "只读分析" | "可创建规划" | "可生成修订候选";
export type AgentScopeType = "chapter" | "volume" | "book";

export interface NovelConfig {
  version: number;
  projectSchemaVersion?: number;
  title: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  api: ApiConfig;
  ui: UiConfig;
  agent: AgentConfig;
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
  contentRevision?: string;
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
  chapterRevision: string;
  characters: CharacterCard[];
  worldDocs: WorldDoc[];
  vectorStats: VectorStats;
}

export interface RecoveryDraft {
  version: number;
  chapterId: string;
  chapterTitle: string;
  volume: string;
  content: string;
  baseRevision: string;
  wordCount: number;
  updatedAt: string;
}

export interface OperationJournalItem {
  id: string;
  sessionId: string;
  type: string;
  title: string;
  status: "进行中" | "已完成" | "失败" | "已中断";
  recoverable: boolean;
  targetIds: string[];
  metadata: Record<string, unknown>;
  result: unknown;
  error: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecoveryStatus {
  drafts: RecoveryDraft[];
  interruptedOperations: OperationJournalItem[];
  lastSession: { id: string; appVersion: string; status: string; startedAt: string; endedAt: string } | null;
  windowState: {
    selectedChapterId: string;
    view: "chapters" | "characters" | "world" | "knowledge" | "analysis";
    leftWidth: number;
    rightWidth: number;
    previewWidth: number;
    updatedAt: string;
  } | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  context?: RetrievedChunk[];
  retrieval?: RetrievalDiagnostics;
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

export type CreativeAdviceMode = "next" | "plot" | "foreshadow";

export interface CreativeAdviceItem {
  id: string;
  type: "下一章建议" | "剧情推进" | "伏笔建议";
  title: string;
  priority: "高" | "中" | "低";
  summary: string;
  rationale: string;
  benefits: string[];
  risks: string[];
  relatedCharacters: string[];
  relatedSettings: string[];
  targetChapter: string;
  suggestedUse: string;
  sourceRefs?: StoryEvidence[];
}

export interface CreativeAdviceResult {
  mode: CreativeAdviceMode;
  chapterId: string;
  chapterTitle: string;
  generatedAt: string;
  contextCount: number;
  apiError?: string;
  toolReport?: Array<{ name: string; detail: string }>;
  retrievalAudit?: RetrievalAudit;
  items: CreativeAdviceItem[];
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

export interface WorkspaceSourceRef {
  chapterId: string;
  chapterTitle: string;
  volume: string;
  heading: string;
  quote: string;
  start: number;
  end: number;
}

export interface WorkspaceBaseItem {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScenePlan extends WorkspaceBaseItem {
  chapterId: string;
  chapterTitle: string;
  title: string;
  order: number;
  pov: string;
  location: string;
  time: string;
  goal: string;
  conflict: string;
  turn: string;
  outcome: string;
  status: "计划中" | "写作中" | "已完成" | "暂缓";
  foreshadowIds: string[];
  sourceRefs: WorkspaceSourceRef[];
}

export interface CausalNode extends WorkspaceBaseItem {
  chapterId: string;
  chapterTitle: string;
  volume: string;
  type: "事件" | "伏笔" | "选择" | "结果";
  title: string;
  detail: string;
  order: number;
  origin: "manual" | "generated";
  locked: boolean;
  sourceRefs: WorkspaceSourceRef[];
  x?: number;
  y?: number;
  color?: string;
}

export interface CausalEdge extends WorkspaceBaseItem {
  source: string;
  target: string;
  relation: string;
  detail: string;
  origin: "manual" | "generated";
  locked: boolean;
  color?: string;
  direction?: "forward" | "backward" | "both" | "none";
}

export interface CharacterArcPoint extends WorkspaceBaseItem {
  characterId: string;
  characterName: string;
  chapterId: string;
  chapterTitle: string;
  order: number;
  stage: string;
  desire: string;
  fear: string;
  misbelief: string;
  change: string;
  status: string;
  origin: "manual" | "generated";
  locked: boolean;
  sourceRefs: WorkspaceSourceRef[];
}

export interface DocumentAnnotation extends WorkspaceBaseItem {
  chapterId: string;
  chapterTitle: string;
  quote: string;
  comment: string;
  type: "作者批注" | "待核对" | "AI建议" | "资料提醒";
  status: "待处理" | "已完成" | "暂不处理";
  sourceRevision: string;
  origin: "ai" | "manual";
  stale?: boolean;
}

export interface ProjectMemoryItem extends WorkspaceBaseItem {
  scope: "全书" | "分卷" | "章节" | "会话";
  scopeId: string;
  scopeLabel: string;
  title: string;
  content: string;
  locked: boolean;
  sourceRefs: WorkspaceSourceRef[];
}

export interface SafeRevision extends WorkspaceBaseItem {
  chapterId: string;
  chapterTitle: string;
  action: string;
  instruction: string;
  original: string;
  replacement: string;
  sourceRevision: string;
  status: "生成中" | "待确认" | "部分采纳" | "已采纳" | "已拒绝" | "已失效" | "生成失败";
  error: string;
  appliedAt: string;
  acceptedParts?: Array<{ original: string; replacement: string; appliedAt: string }>;
  stale?: boolean;
}

export interface ChapterCreativeMetrics {
  chapterId: string;
  chapterTitle: string;
  volume: string;
  wordCount: number;
  pacing: number;
  dialogueRatio: number;
  actionRatio: number;
  descriptionRatio: number;
  pov: string;
  characterMentions: Record<string, number>;
  foreshadowsOpen: number;
  foreshadowsClosed: number;
  quality: {
    goal: boolean;
    conflict: boolean;
    turn: boolean;
    information: boolean;
    characterAction: boolean;
    endingHook: boolean;
  };
}

export interface CharacterArcAlert {
  characterId: string;
  characterName: string;
  type: "长期未出场" | "动机中断" | "知情异常" | "规划偏离";
  detail: string;
  chapterId?: string;
}

export interface CreativeStatisticsSnapshot extends WorkspaceBaseItem {
  label: string;
  metrics: ChapterCreativeMetrics[];
  povShares: Array<{ name: string; chapters: number; ratio: number }>;
  characterDensity: Array<{ id: string; name: string; total: number; chapters: number }>;
  foreshadowSummary: { open: number; closed: number; recoveryRate: number };
  arcAlerts: CharacterArcAlert[];
}

export interface CreativeAgentRun extends WorkspaceBaseItem {
  chapterId: string;
  chapterTitle: string;
  scopeType: AgentScopeType;
  scopeIds: string[];
  scopeLabel: string;
  scopeRecommended: boolean;
  mode: CreativeAdviceMode;
  objective: string;
  status: "待确认" | "等待中" | "运行中" | "已完成" | "失败" | "已取消" | "已中断";
  permissionLevel: AgentPermissionLevel;
  selectedText: string;
  selectedTextRevision: string;
  contextIds: string[];
  includeSourceIds: string[];
  excludeSourceIds: string[];
  memoryIds: string[];
  steps: Array<{ tool: string; label: string; reason: string }>;
  toolStates: Array<{
    tool: string;
    label: string;
    status: "等待中" | "运行中" | "已完成" | "已跳过" | "失败";
    detail: string;
    partialOutput: string;
    error: string;
  }>;
  stageCheckpoints: Array<{
    id: string;
    label: string;
    status: "等待中" | "运行中" | "已完成" | "已跳过" | "失败";
    startedAt: string;
    completedAt: string;
    detail: string;
    error: string;
  }>;
  stageSummary: { completed: string[]; failed: string[]; skipped: string[] };
  taskId: string;
  partialOutput: string;
  outputs: { boardId?: string; revisionId?: string };
  retrievalAudit: RetrievalAudit | null;
  result: CreativeAdviceResult | null;
  error: string;
}

export interface CreativeWorkspaceState {
  version: number;
  updatedAt: string;
  scenes: ScenePlan[];
  causalNodes: CausalNode[];
  causalEdges: CausalEdge[];
  arcs: CharacterArcPoint[];
  annotations: DocumentAnnotation[];
  memories: ProjectMemoryItem[];
  revisions: SafeRevision[];
  agentRuns: CreativeAgentRun[];
  statisticsHistory: CreativeStatisticsSnapshot[];
}

export interface ChapterQualityReport {
  chapterId: string;
  chapterTitle: string;
  volume: string;
  wordCount: number;
  signals: {
    scenes: number;
    facts: number;
    characters: number;
    foreshadows: number;
    goal: boolean;
    conflict: boolean;
    turn: boolean;
    information: boolean;
    characterAction: boolean;
    endingHook: boolean;
  };
  adjacentComparison?: string;
  concerns: string[];
}

export interface ProjectExchangePreview {
  token: string;
  filePath: string;
  encrypted?: boolean;
  requiresPassword?: boolean;
  manifest: {
    createdAt: string;
    appVersion: string;
    project: { title: string; author: string };
    counts: { chapters: number; characters: number; worldDocs: number; materials: number };
    workspaceIncluded: boolean;
    security: { apiSettingsIncluded: false; vectorIndexIncluded: false; backupsIncluded: false; passwordProtected?: boolean };
  };
  conflicts: { chapters: string[]; characters: string[]; worldDocs: string[] };
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

export type KnowledgeSyncState = "已同步" | "等待更新" | "摘要待更新" | "未索引" | "文件缺失" | "空文档";

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
  counts: { total: number; synced: number; pending: number; errors: number; orphans: number };
  items: KnowledgeSyncItem[];
  orphanSourceIds: string[];
  hierarchy: { sourceSummaries: number; volumeSummaries: number; hasBookSummary: boolean; updatedAt: string };
  freshness?: { reusedHashes: number; recalculatedHashes: number };
}

export interface ProjectHealthIssue {
  code: string;
  severity: "高" | "中" | "低";
  title: string;
  detail: string;
  chapterId?: string;
  repairable: boolean;
}

export interface ProjectHealthReport {
  checkedAt: string;
  healthy: boolean;
  chapterCount: number;
  schemaVersion?: number;
  recovery?: { drafts: number; interruptedOperations: number };
  issues: ProjectHealthIssue[];
}

export interface MaintenanceDiagnostics {
  checkedAt: string;
  healthy: boolean;
  issues: string[];
  staleSourceCount: number;
  interruptedAgentRuns: Array<{ id: string; title: string; status: string; updatedAt: string }>;
  invalidReferences: Array<{ type: string; id: string; title: string; detail: string }>;
  retrievalCache: { exists: boolean; valid: boolean; version: number; updatedAt: string; groups: number };
  freshnessCache: { version: number; updatedAt: string; entries: number; missingEntries: string[]; orphanEntries: string[] };
  vectorIndex: { sources: number; chunks: number; updatedAt: string };
}

export interface StoryEvidence {
  chapterId: string;
  chapterTitle: string;
  volume: string;
  heading: string;
  quote: string;
  start: number;
  end: number;
}

export type StoryFactStatus = "AI识别" | "已确认" | "已忽略";

export interface StoryFact {
  id: string;
  type: string;
  subject: string;
  predicate: string;
  object: string;
  chapterId: string;
  chapterTitle: string;
  volume: string;
  confidence: number;
  status: StoryFactStatus;
  evidence: StoryEvidence[];
  sourceRevision: string;
  userNote?: string;
  origin?: "ai" | "manual";
  userEditedFields?: string[];
  stale?: boolean;
  updatedAt: string;
}

export interface CharacterStoryState {
  id: string;
  characterId: string;
  characterName: string;
  chapterId: string;
  chapterTitle: string;
  chapterOrder?: number;
  volume: string;
  location: string;
  physical: string[];
  mental: string[];
  abilities: string[];
  route: string[];
  goals: string[];
  obstacles: string[];
  knowledge: string[];
  knowledgeSources: string[];
  possessions: string[];
  relationships: string[];
  relationshipChanges: string[];
  lastAppearance: string;
  lastAppearancePosition?: { start: number; end: number };
  evidence: StoryEvidence[];
  sourceRevision: string;
  confidence: number;
  updatedAt: string;
}

export interface CharacterStateHistory {
  characterId: string;
  characterName: string;
  states: CharacterStoryState[];
  latest: CharacterStoryState | null;
}

export type ForeshadowStatus = "AI候选" | "已确认埋下" | "持续强化" | "等待回收" | "已经回收" | "已废弃";

export interface ForeshadowItem {
  id: string;
  title: string;
  description: string;
  status: ForeshadowStatus;
  plantedAt: StoryEvidence[];
  reinforcedAt: StoryEvidence[];
  payoffAt: StoryEvidence[];
  plannedPayoff: string;
  relatedCharacters: string[];
  sourceRevision: string;
  confidence: number;
  userNote?: string;
  origin?: "ai" | "manual";
  userEditedFields?: string[];
  stale?: boolean;
  updatedAt: string;
}

export interface ChapterBoardItem {
  id: string;
  type: string;
  title: string;
  detail: string;
  order: number;
  locked: boolean;
  completed: boolean;
  sourceRefs: StoryEvidence[];
  implementation?: string;
  risks?: string[];
  alternatives?: string[];
}

export interface ChapterPreparationBoard {
  id: string;
  chapterId: string;
  chapterTitle: string;
  targetChapterId: string;
  targetChapterTitle: string;
  status: string;
  generatedAt: string;
  updatedAt: string;
  apiError?: string;
  items: ChapterBoardItem[];
}

export interface StoryOverview {
  updatedAt: string;
  counts: { chapters: number; facts: number; characterStates: number; foreshadows: number; boards: number };
  coverage: { total: number; analyzed: number; stale: string[]; missing: string[] };
  chapterEntries: Array<{
    chapterId: string;
    chapterTitle: string;
    volume: string;
    sourceRevision: string;
    analysisMode: "local" | "ai";
    analyzedAt: string;
    factCount: number;
    characterStateCount: number;
    foreshadowCount: number;
  }>;
  facts: StoryFact[];
  characterStates: CharacterStateHistory[];
  foreshadows: ForeshadowItem[];
  pageInfo?: {
    facts: { total: number; offset: number; limit: number };
    characters: { total: number; offset: number; limit: number };
    foreshadows: { total: number; offset: number; limit: number };
  };
}

export type BackgroundTaskType = "story-analysis" | "creative-board" | "consistency-check" | "timeline-analysis" | "knowledge-rebuild" | "snapshot" | "agent-workflow" | "creative-statistics";
export type BackgroundTaskStatus = "等待中" | "运行中" | "正在停止" | "已暂停" | "已完成" | "已停止" | "失败" | "已中断";

export interface BackgroundTask {
  id: string;
  projectPath?: string;
  type: BackgroundTaskType;
  title: string;
  status: BackgroundTaskStatus;
  phase: string;
  current: number;
  total: number;
  detail: string;
  scope: { chapterIds?: string[]; chapterId?: string };
  options: Record<string, unknown>;
  partialOutput: string;
  result: unknown;
  error: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
  matchedDocuments?: string[];
  requestBytes?: number;
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  finishedAt: string;
  canRetry: boolean;
  retryOf: string;
  pausedFrom?: "等待中" | "运行中" | "";
}

export interface ProjectSnapshot {
  version: number;
  id: string;
  name: string;
  reason: string;
  createdAt: string;
  fileCount: number;
  totalBytes: number;
  entries: Array<{ path: string; hash: string; size: number }>;
}

export interface ProjectSnapshotComparison {
  snapshot: ProjectSnapshot;
  changed: string[];
  added: string[];
  missing: string[];
}

export interface ProjectBranch {
  id: string;
  name: string;
  snapshotId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectBranches {
  version: number;
  updatedAt: string;
  activeBranchId: string;
  branches: ProjectBranch[];
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
  exportOptions?: { includeOutline?: boolean; includeMaterials?: boolean; includeCharacters?: boolean; includeWorld?: boolean };
  extractScope?: "book" | "chapter";
  worldCandidates?: ExtractedWorldCandidate[];
  appearanceStats?: AppearanceStat[];
  worldMapNodes?: WorldMapNode[];
  worldMapEdges?: WorldMapEdge[];
  materials?: MaterialItem[];
  materialDraft?: Partial<MaterialItem>;
  creativeAdvice?: CreativeAdviceResult;
  creativeOptions?: { mode?: CreativeAdviceMode; chapterId?: string; focus?: string; contextIds?: string[]; includeSourceIds?: string[]; excludeSourceIds?: string[]; scopeType?: AgentScopeType | "auto" };
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
