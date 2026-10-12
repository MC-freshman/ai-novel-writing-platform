import type { KnowledgeRole, VectorStats } from "./retrieval";
import type { NovelConfig } from "./config";

export type ChapterProgressStatus = "计划中" | "写作中" | "已完成" | "暂缓";

export interface Chapter {
  id: string;
  title: string;
  volume: string;
  order: number;
  fileName: string;
  wordCount: number;
  progressStatus?: ChapterProgressStatus;
  progressNote?: string;
  progressHidden?: boolean;
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
  kind?: "chapter" | "character" | "world" | "novel-network";
  entityId?: string;
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
  lastSession: {
    id: string;
    appVersion: string;
    status: string;
    startedAt: string;
    endedAt: string;
  } | null;
  windowState: {
    selectedChapterId: string;
    view: "chapters" | "characters" | "world" | "knowledge" | "analysis";
    leftWidth: number;
    rightWidth: number;
    previewWidth: number;
    updatedAt: string;
  } | null;
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

export interface ProjectExchangePreview {
  token: string;
  filePath: string;
  encrypted?: boolean;
  requiresPassword?: boolean;
  manifest: {
    createdAt: string;
    appVersion: string;
    project: { title: string; author: string };
    counts: {
      chapters: number;
      characters: number;
      worldDocs: number;
      materials: number;
    };
    workspaceIncluded: boolean;
    security: {
      apiSettingsIncluded: false;
      vectorIndexIncluded: false;
      backupsIncluded: false;
      passwordProtected?: boolean;
    };
  };
  conflicts: { chapters: string[]; characters: string[]; worldDocs: string[] };
}

// P3 refactor: UI-local types previously defined in src/App.tsx.
export interface EditorScrollAnchor {
  key: number;
  headingIndex?: number;
  quote?: string;
}
