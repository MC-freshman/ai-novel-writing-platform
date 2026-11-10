import { useCallback, useRef, useState } from "react";
import type { MindMap } from "../../types";
import {
  cloneMindMapSubtree, HISTORY_LIMIT, pasteMindMapClipboard, snapshotMindMap,
} from "../../lib/mind-map-commands";
import type { MindMapClipboard } from "../../lib/mind-map-commands";

export interface MindMapCommands {
  /** 统一写入口：记录快照、清空 redo、再写入；mergeKey 用于合并连续文本编辑。 */
  commit: (next: MindMap | ((previous: MindMap) => MindMap), mergeKey?: string) => void;
  undo: () => void;
  redo: () => void;
  resetHistory: () => void;
  canUndo: boolean;
  canRedo: boolean;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  toggleSelected: (id: string, additive: boolean) => void;
  clipboardCount: number;
  copySelection: (map: MindMap, ids: string[], makeId: () => string) => void;
  pasteInto: (map: MindMap, parentId: string, makeId: () => string) => MindMap | null;
}

/**
 * 思维导图编辑命令层：撤销/重做栈、多选状态与内部剪贴板。
 * 所有会改数据的命令都必须走 commit，避免漏记历史。
 */
export function useMindMapCommands(
  map: MindMap | null,
  update: (value: MindMap | ((previous: MindMap) => MindMap)) => void,
  onAfterChange?: (next: MindMap) => void,
): MindMapCommands {
  const currentRef = useRef<MindMap | null>(map);
  currentRef.current = map;
  const undoRef = useRef<MindMap[]>([]);
  const redoRef = useRef<MindMap[]>([]);
  const lastMergeRef = useRef<{ key: string; at: number } | null>(null);
  const clipboardRef = useRef<MindMapClipboard | null>(null);
  const [, setVersion] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [clipboardCount, setClipboardCount] = useState(0);

  const bump = useCallback(() => setVersion((value) => value + 1), []);

  const commit = useCallback((next: MindMap | ((previous: MindMap) => MindMap), mergeKey?: string) => {
    const previous = currentRef.current;
    if (!previous) return;
    const resolved = typeof next === "function" ? next(previous) : next;
    const now = Date.now();
    const merge = Boolean(mergeKey && lastMergeRef.current
      && lastMergeRef.current.key === mergeKey && now - lastMergeRef.current.at < 600);
    if (!merge) {
      undoRef.current = [...undoRef.current, snapshotMindMap(previous)].slice(-HISTORY_LIMIT);
      redoRef.current = [];
    }
    lastMergeRef.current = mergeKey ? { key: mergeKey, at: now } : null;
    update(resolved);
    // 连续 commit 之间 React 尚未重渲染，必须同步 ref，后续快照才不会记到旧值。
    currentRef.current = resolved;
    bump();
  }, [update, bump]);

  const undo = useCallback(() => {
    const stack = undoRef.current;
    const current = currentRef.current;
    if (!stack.length || !current) return;
    const previous = stack[stack.length - 1];
    undoRef.current = stack.slice(0, -1);
    redoRef.current = [...redoRef.current, snapshotMindMap(current)].slice(-HISTORY_LIMIT);
    lastMergeRef.current = null;
    update(previous);
    currentRef.current = previous;
    setSelectedIds((ids) => ids.filter((id) => previous.nodes.some((node) => node.id === id)));
    onAfterChange?.(previous);
    bump();
  }, [update, onAfterChange, bump]);

  const redo = useCallback(() => {
    const stack = redoRef.current;
    const current = currentRef.current;
    if (!stack.length || !current) return;
    const next = stack[stack.length - 1];
    redoRef.current = stack.slice(0, -1);
    undoRef.current = [...undoRef.current, snapshotMindMap(current)].slice(-HISTORY_LIMIT);
    lastMergeRef.current = null;
    update(next);
    currentRef.current = next;
    setSelectedIds((ids) => ids.filter((id) => next.nodes.some((node) => node.id === id)));
    onAfterChange?.(next);
    bump();
  }, [update, onAfterChange, bump]);

  const resetHistory = useCallback(() => {
    undoRef.current = [];
    redoRef.current = [];
    lastMergeRef.current = null;
    setSelectedIds([]);
    bump();
  }, [bump]);

  const toggleSelected = useCallback((id: string, additive: boolean) => {
    setSelectedIds((previous) => {
      if (!additive) return [id];
      return previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id];
    });
  }, []);

  const copySelection = useCallback((source: MindMap, ids: string[], makeId: () => string) => {
    const copied = cloneMindMapSubtree(source, ids, makeId);
    clipboardRef.current = copied;
    setClipboardCount(copied.nodes.length);
  }, []);

  const pasteInto = useCallback((source: MindMap, parentId: string, makeId: () => string) => {
    const clipboard = clipboardRef.current;
    if (!clipboard || !clipboard.nodes.length) return null;
    return pasteMindMapClipboard(source, clipboard, parentId, makeId);
  }, []);

  return {
    commit, undo, redo, resetHistory,
    canUndo: undoRef.current.length > 0,
    canRedo: redoRef.current.length > 0,
    selectedIds, setSelectedIds, toggleSelected,
    clipboardCount, copySelection, pasteInto,
  };
}
