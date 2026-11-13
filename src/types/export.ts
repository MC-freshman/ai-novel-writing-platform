// 多格式导出（P79）渲染层契约类型。
export interface ExportFormatInfo {
  id: string;
  label: string;
  extension: string;
  mode: "file" | "directory";
}

export interface FormatExportResult {
  canceled: boolean;
  format?: string;
  files: string[];
  directoryPath?: string;
  warnings: string[];
}