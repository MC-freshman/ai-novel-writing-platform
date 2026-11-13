import type { Chapter } from "./project";

export type Provider =
  | "openai"
  | "deepseek"
  | "qwen"
  | "kimi"
  | "claude"
  | "ollama"
  | "custom";

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
  apiKeyConfigured?: boolean;
  embeddingApiKeyConfigured?: boolean;
  clearApiKey?: boolean;
  clearEmbeddingApiKey?: boolean;
}

export interface UiConfig {
  theme: "light" | "dark";
  fontSize: number;
  lineHeight: number;
  autosaveMs: number;
  backupOnSave: boolean;
  recoveryEnabled: boolean;
  /** 关闭后只停用导图界面，导图数据保留。 */
  mindMapEnabled?: boolean;
  /** 每日字数目标（P75）；0 或缺省=关闭目标与连续天数。 */
  dailyWordGoal?: number;
  /** 专注锁定（P86）：进入专注时设定目标，退出需确认；默认关闭，紧急退出始终可用。 */
  focusLockEnabled?: boolean;
}

/** 专注锁定会话（P86）：目标字数/分钟（0=不限），起点字数用于计算净增。 */
export interface FocusLockSession {
  goalWords: number;
  goalMinutes: number;
  startedAt: number;
  startWords: number;
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
  /** 模块开关（P73）：缺省=启用；mindmap 槽兼容旧 ui.mindMapEnabled 字段。 */
  modules?: Record<string, { enabled?: boolean }>;
  stats: {
    todayDate: string;
    todayWords: number;
    totalWords: number;
    lastAutoBackupAt: string;
  };
  chapters: Chapter[];
}
