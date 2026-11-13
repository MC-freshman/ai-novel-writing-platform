// AI 辅助台账（P78）渲染层契约类型。
export interface AiLedgerChapterRow {
  chapterId: string;
  title: string;
  volume: string;
  wordCount: number;
  adoptedWords: number;
  adoptions: number;
  lastAt: string;
  estimatedRatio: number | null;
}

export interface AiLedgerOverview {
  chapters: AiLedgerChapterRow[];
  totalAdoptedWords: number;
  totalAdoptions: number;
  recordedChapters: number;
  updatedAt: string;
  note: string;
}

export interface EvidenceExportResult {
  canceled: boolean;
  filePath?: string;
  sizeBytes?: number;
  counts?: { chapters: number; adoptions: number; versionFiles: number };
  versionTruncated?: boolean;
}