import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CreativeWorkspaceState } from "../types";
import type { PageSaveHandle, PageSaveKind } from "./useEntityDraft";

type BoardKind = "mind-map" | "progress-grid";
type BoardCollection = "mindMaps" | "progressGrids";

export interface WorkspaceDraft<T> {
  items: T[];
  activeId: string;
  draft: T | null;
  saveState: string;
  update: (value: T | ((previous: T) => T)) => void;
  select: (id: string) => Promise<void>;
  create: () => Promise<void>;
  remove: () => Promise<void>;
  adopt: (value: T) => Promise<void>;
  flush: () => Promise<boolean>;
}

/**
 * 规划看板的多实例草稿：本地即时渲染 + 防抖自动写盘，并在页面切换、
 * Ctrl+S 与关闭窗口时通过统一的 PageSaveHandle 把未落盘的改动冲刷出去。
 * workspace 的后续更新只用于刷新列表，不会覆盖正在编辑的草稿。
 */
export function useWorkspaceDraft<T extends { id: string }>(
  kind: BoardKind,
  collection: BoardCollection,
  workspace: CreativeWorkspaceState,
  onWorkspace: (value: CreativeWorkspaceState) => void,
  onRegisterSave: (saveKind: PageSaveKind, handle: PageSaveHandle | null) => void,
  createBlank: () => T,
): WorkspaceDraft<T> {
  const items = useMemo(() => (workspace[collection] as unknown as T[]) || [], [workspace, collection]);
  const first = items[0] || null;
  const [activeId, setActiveId] = useState(first?.id || "");
  const [draft, setDraft] = useState<T | null>(first);
  const [saveState, setSaveState] = useState("已保存");

  const current = useRef<T | null>(first);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const itemsRef = useRef(items);
  const latest = useRef({ onWorkspace, onRegisterSave, createBlank });
  itemsRef.current = items;
  latest.current = { onWorkspace, onRegisterSave, createBlank };

  const replace = useCallback((value: T | null, isDirty = false) => {
    current.current = value;
    dirty.current = isDirty;
    setDraft(value);
    setActiveId(value?.id || "");
  }, []);

  const persist = useCallback(async (value: T) => {
    const result = await window.novelAPI.upsertCreativeWorkspaceItem({
      collection,
      item: value as unknown as Record<string, unknown>,
    });
    latest.current.onWorkspace(result.workspace);
  }, [collection]);

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const value = current.current;
    if (!value || !dirty.current) {
      await queue.current.catch(() => null);
      return true;
    }
    setSaveState("保存中…");
    const task = queue.current.catch(() => null).then(async () => {
      await persist(value);
      if (current.current === value) {
        dirty.current = false;
        setSaveState("已保存");
      }
    });
    queue.current = task;
    try {
      await task;
      return true;
    } catch (error) {
      setSaveState(`保存失败：${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }, [persist]);

  const update = useCallback((value: T | ((previous: T) => T)) => {
    const previous = current.current;
    if (!previous) return;
    const next = typeof value === "function" ? value(previous) : value;
    current.current = next;
    dirty.current = true;
    setDraft(next);
    setSaveState("有未保存修改");
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void flush(); }, 600);
  }, [flush]);

  const select = useCallback(async (id: string) => {
    if (id === current.current?.id) return;
    if (!(await flush())) return;
    replace(itemsRef.current.find((item) => item.id === id) || null);
    setSaveState("已保存");
  }, [flush, replace]);

  const create = useCallback(async () => {
    if (!(await flush())) return;
    replace(latest.current.createBlank(), true);
    await flush();
  }, [flush, replace]);

  const remove = useCallback(async () => {
    const value = current.current;
    if (!value) return;
    if (!(await flush())) return;
    try {
      const result = await window.novelAPI.deleteCreativeWorkspaceItem({ collection, itemId: value.id });
      latest.current.onWorkspace(result.workspace);
      const remaining = (result.workspace[collection] as unknown as T[]) || [];
      replace(remaining[0] || null);
      setSaveState("已保存");
    } catch (error) {
      setSaveState(`删除失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [collection, flush, replace]);

  const adopt = useCallback(async (value: T) => {
    if (!(await flush())) return;
    replace(value, false);
    setSaveState("已保存");
  }, [flush, replace]);

  // 外部（例如 MCP）写入后刷新了 workspace，而当前还没有选中任何条目时，自动打开第一张。
  useEffect(() => {
    if (current.current === null && itemsRef.current.length) replace(itemsRef.current[0], false);
  }, [items, replace]);

  useEffect(() => {
    const handle: PageSaveHandle = { save: flush, protect: flush };
    latest.current.onRegisterSave(kind, handle);
    return () => latest.current.onRegisterSave(kind, null);
  }, [flush, kind]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  return { items, activeId, draft, saveState, update, select, create, remove, adopt, flush };
}
