import type { StoryEvidence } from "./story";
import type { RetrievalAudit } from "./retrieval";
import type { AgentPermissionLevel, AgentScopeType } from "./config";
import type { CreativeStatisticsSnapshot } from "./statistics";
import type { NovelNetwork } from "./network";

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
  status:
    | "生成中"
    | "待确认"
    | "部分采纳"
    | "已采纳"
    | "已拒绝"
    | "已失效"
    | "生成失败";
  error: string;
  appliedAt: string;
  acceptedParts?: Array<{
    original: string;
    replacement: string;
    appliedAt: string;
  }>;
  stale?: boolean;
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
  status:
    | "待确认"
    | "等待中"
    | "运行中"
    | "已完成"
    | "失败"
    | "已取消"
    | "已中断";
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
  novelNetworks: NovelNetwork[];
}
