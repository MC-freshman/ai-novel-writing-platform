export interface ProjectHealthIssue {
  code: string;
  severity: "高" | "中" | "低";
  title: string;
  detail: string;
  chapterId?: string;
  repairable: boolean;
}

export interface ProjectHealthReport {
  checkedAt: string;
  healthy: boolean;
  chapterCount: number;
  schemaVersion?: number;
  recovery?: { drafts: number; interruptedOperations: number };
  issues: ProjectHealthIssue[];
}

export interface MaintenanceDiagnostics {
  checkedAt: string;
  healthy: boolean;
  issues: string[];
  staleSourceCount: number;
  interruptedAgentRuns: Array<{
    id: string;
    title: string;
    status: string;
    updatedAt: string;
  }>;
  invalidReferences: Array<{
    type: string;
    id: string;
    title: string;
    detail: string;
  }>;
  retrievalCache: {
    exists: boolean;
    valid: boolean;
    version: number;
    updatedAt: string;
    groups: number;
  };
  freshnessCache: {
    version: number;
    updatedAt: string;
    entries: number;
    missingEntries: string[];
    orphanEntries: string[];
  };
  vectorIndex: { sources: number; chunks: number; updatedAt: string };
}

export interface ProjectSnapshot {
  version: number;
  id: string;
  name: string;
  reason: string;
  createdAt: string;
  fileCount: number;
  totalBytes: number;
  entries: Array<{ path: string; hash: string; size: number }>;
}

export interface ProjectSnapshotComparison {
  snapshot: ProjectSnapshot;
  changed: string[];
  added: string[];
  missing: string[];
}

export interface ProjectBranch {
  id: string;
  name: string;
  snapshotId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectBranches {
  version: number;
  updatedAt: string;
  activeBranchId: string;
  branches: ProjectBranch[];
}
