// 外部 MCP 接入（P81）渲染层契约类型。
export interface McpServerResolution {
  ok: boolean;
  directory?: string;
  serverDir?: string;
  entryPath?: string;
  id?: string;
  version?: string;
  displayName?: string;
  error?: string;
}

export interface McpRuntimeInfo {
  kind: "node" | "electron";
  command: string;
  version?: string;
}

export type McpRuntimeKind = "auto" | "node" | "electron";

export interface McpSettings {
  mcpDirectory: string;
  runtimeKind: McpRuntimeKind;
  xmindImportRoot: string;
}

export interface McpIntegrationStatus {
  packaged: boolean;
  appRoot: string;
  projectPath: string;
  runtime: McpRuntimeInfo;
  settings: McpSettings;
  server: McpServerResolution | null;
}

export interface McpDirectoryPick {
  canceled: boolean;
  directory?: string;
  server?: McpServerResolution;
}

export interface McpClientConfig {
  config: Record<string, unknown>;
  configJson: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  serverDir: string;
  notes: string[];
}

export interface McpSelfTestStep {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface McpSelfTestReport {
  ok: boolean;
  steps: McpSelfTestStep[];
  stderrTail?: string;
}