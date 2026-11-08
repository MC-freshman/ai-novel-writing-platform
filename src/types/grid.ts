export type ProgressGridStatus = "计划中" | "写作中" | "已完成" | "暂缓";

export type ProgressGridColumnKind = "text" | "status" | "chapter";

export interface ProgressGridColumn {
  id: string;
  title: string;
  kind: ProgressGridColumnKind;
}

export interface ProgressGridRow {
  id: string;
  title: string;
  status: ProgressGridStatus;
  note: string;
  chapterId: string;
  cells: Record<string, string>;
}

export interface ProgressGridBoard {
  id: string;
  title: string;
  description: string;
  columns: ProgressGridColumn[];
  rows: ProgressGridRow[];
  createdAt: string;
  updatedAt: string;
}
