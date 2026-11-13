// 全书搜索替换（P76）渲染层契约类型。
export interface BookSearchMatch {
  index: number;
  start: number;
  end: number;
  context: string;
}

export interface BookSearchChapter {
  chapterId: string;
  title: string;
  fileName: string;
  matchCount: number;
  matches: BookSearchMatch[];
}

export interface BookSearchResult {
  query: string;
  options: { caseSensitive: boolean; wholeWord: boolean; useRegex?: boolean; scope?: string };
  scannedChapters: number;
  totalMatches: number;
  truncated: boolean;
  chapters: BookSearchChapter[];
  cards?: BookSearchCard[];
}

export interface BookSearchCard {
  cardType: "character" | "world";
  cardId: string;
  title: string;
  matchCount: number;
  hits: Array<{ field: string; index: number; start: number; end: number; context: string }>;
}

export interface ReplacePlanChapter {
  chapterId: string;
  title: string;
  fileName: string;
  revision: string;
  count: number;
  occurrences: BookSearchMatch[];
}

export interface ReplacePlan {
  query: string;
  replacement: string;
  options: { caseSensitive: boolean; wholeWord: boolean; useRegex?: boolean; scope?: string };
  totalOccurrences: number;
  chapters: ReplacePlanChapter[];
  cards?: ReplacePlanCard[];
}

export interface ReplacePlanCard {
  cardType: "character" | "world";
  cardId: string;
  title: string;
  count: number;
  fields: Array<{ field: string; count: number; occurrences: BookSearchMatch[] }>;
}

export interface ReplaceExecutionResult {
  snapshotId: string;
  totalReplaced: number;
  results: Array<{ chapterId: string; title: string; replaced: number }>;
  cardResults?: Array<{ cardType: string; cardId: string; title: string; replaced: number }>;
}