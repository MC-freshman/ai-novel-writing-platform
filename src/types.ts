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
