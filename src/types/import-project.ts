// 外部项目导入（P91）渲染层契约类型。
export interface ImportPreviewFile {
  relPath: string;
  title: string;
  volume: string;
  words: number;
}

export interface ImportPreview {
  canceled: boolean;
  kind?: "vault" | "nwx";
  directory?: string;
  filePath?: string;
  files?: ImportPreviewFile[];
  warnings?: string[];
}

export interface ImportRunResult {
  imported: number;
  skipped: number;
  failures: string[];
  warnings: string[];
}