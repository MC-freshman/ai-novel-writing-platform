// 模块启用判定（P73）：新 modules 字段优先，mindmap 槽兼容旧 ui.mindMapEnabled。
import type { NovelConfig } from "../types";

export function isModuleEnabled(config: NovelConfig | null | undefined, slotId: string): boolean {
  const explicit = config?.modules?.[slotId]?.enabled;
  if (typeof explicit === "boolean") return explicit;
  if (slotId === "mindmap") return config?.ui?.mindMapEnabled !== false;
  return true;
}