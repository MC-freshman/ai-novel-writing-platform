import type { ProgressGridBoard, ProgressGridColumn, ProgressGridColumnKind, ProgressGridRow, ProgressGridStatus } from "../types";

export const GRID_STATUSES: ProgressGridStatus[] = ["计划中", "写作中", "已完成", "暂缓"];
export const GRID_COLUMN_KINDS: Array<{ value: ProgressGridColumnKind; label: string }> = [
  { value: "text", label: "文字" },
  { value: "status", label: "状态" },
  { value: "chapter", label: "关联章节" },
];

export function gridId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createGridColumn(kind: ProgressGridColumnKind = "text"): ProgressGridColumn {
  return { id: gridId("column"), title: kind === "chapter" ? "关联章节" : kind === "status" ? "阶段状态" : "自定义列", kind };
}

export function createGridRow(index: number): ProgressGridRow {
  return { id: gridId("row"), title: `第 ${index + 1} 项`, status: "计划中", note: "", chapterId: "", cells: {} };
}

export function createGridBoard(): ProgressGridBoard {
  const now = new Date().toISOString();
  const id = gridId("grid");
  return {
    id,
    title: "未命名进度网格",
    description: "",
    columns: [
      { id: `${id}_target`, title: "本阶段目标", kind: "text" },
      { id: `${id}_check`, title: "检查点", kind: "text" },
    ],
    rows: [0, 1, 2].map(createGridRow),
    createdAt: now,
    updatedAt: now,
  };
}

export function gridCompletion(rows: ProgressGridRow[]) {
  const done = rows.filter((row) => row.status === "已完成").length;
  return { done, total: rows.length, percent: rows.length ? Math.round((done / rows.length) * 100) : 0 };
}
