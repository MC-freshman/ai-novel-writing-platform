// 文风自查（P85）渲染层契约类型。
export interface StyleMetrics {
  chars: number;
  sentenceCount: number;
  avgSentenceLen: number;
  sentenceLenCV: number;
  templateHits: number;
  templatePer1000: number;
  connectiveHits: number;
  connectivePer1000: number;
  repeatRate: number;
}

export interface StyleFlag {
  key: string;
  label: string;
  detail: string;
}

export interface StyleChapterReport {
  chapterId: string;
  title: string;
  fileName: string;
  metrics: StyleMetrics;
  flags: StyleFlag[];
  topParagraphs: Array<{ text: string; hits: number }>;
}

export interface StyleReport {
  version: number;
  updatedAt: string;
  thresholds: Record<string, number>;
  scannedChapters: number;
  flaggedChapters: number;
  chapters: StyleChapterReport[];
  note: string;
}