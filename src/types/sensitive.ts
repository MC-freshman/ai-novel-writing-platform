// 敏感词自查（P77）渲染层契约类型。
export interface SensitiveDictionaryInfo {
  id: string;
  name: string;
  enabled: boolean;
  builtin: boolean;
  wordCount: number;
  updatedAt: string;
}

export interface SensitiveHit {
  word: string;
  start: number;
  end: number;
  context: string;
}

export interface SensitiveChapterResult {
  chapterId: string;
  title: string;
  fileName: string;
  hitCount: number;
  hits: SensitiveHit[];
  truncated: boolean;
}

export interface SensitiveReport {
  version: number;
  updatedAt: string;
  activeWordCount: number;
  scannedChapters: number;
  totalHits: number;
  results: SensitiveChapterResult[];
  note: string;
}

export interface SensitiveState {
  dictionaries: SensitiveDictionaryInfo[];
  ignoreList: string[];
  limits: { maxDictionaries: number; maxWordsPerDictionary: number; maxWordLength: number };
  report: SensitiveReport | null;
}