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
