export type BackgroundTaskType =
  | "story-analysis"
  | "creative-board"
  | "consistency-check"
  | "timeline-analysis"
  | "knowledge-rebuild"
  | "snapshot"
  | "agent-workflow"
  | "creative-statistics";

export type BackgroundTaskStatus =
  | "等待中"
  | "运行中"
  | "正在停止"
  | "已暂停"
  | "已完成"
  | "已停止"
  | "失败"
  | "已中断";

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
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null;
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
