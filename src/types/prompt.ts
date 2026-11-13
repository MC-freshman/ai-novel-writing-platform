// 自定义 AI 指令模板（P82）渲染层契约类型。
export interface PromptTemplate {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptTemplateList {
  version: number;
  templates: PromptTemplate[];
  updatedAt: string;
}

export interface PromptTemplateImportResult {
  canceled: boolean;
  added?: number;
  skipped?: number;
  total?: number;
}

export interface PromptTemplateExportResult {
  canceled: boolean;
  filePath?: string;
  count?: number;
}