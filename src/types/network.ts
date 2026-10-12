export type NovelNetworkKind =
  | "threads"
  | "chapters"
  | "clock"
  | "information"
  | "alignment"
  | "custom";

export interface NovelNetworkRow {
  id: string;
  cells: string[];
  chapterId: string;
}

export interface NovelNetworkTable {
  id: string;
  title: string;
  kind: NovelNetworkKind;
  columns: string[];
  rows: NovelNetworkRow[];
}

export interface NovelNetwork {
  id: string;
  title: string;
  notes: string;
  tables: NovelNetworkTable[];
  documents: Array<{ name: string; text: string }>;
  revision: string;
  createdAt: string;
  updatedAt: string;
}

export interface NovelNetworkImportPreview {
  token: string;
  network: NovelNetwork;
  warnings: string[];
  fileNames: string[];
  duplicates: number;
}
