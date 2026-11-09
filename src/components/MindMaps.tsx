import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from "react";
import type {
  CreativeWorkspaceState, MindMap, MindMapNode, MindMapRelation,
  MindMapRelationArrow, MindMapRelationFontStyle, MindMapRelationLinePattern,
  MindMapRelationShape, MindMapSide, XMindImportSheet,
} from "../types";
import type { LaidMindRelation, MindMapLayout } from "../lib/mind-map";
import type { PageSaveHandle, PageSaveKind } from "../hooks/useEntityDraft";
import { useWorkspaceDraft } from "../hooks/useWorkspaceDraft";
import {
  applyPositions, createMindMap, createMindMapNode, layoutMindMap, layoutRelations,
  MIND_NODE_HEIGHT, MIND_NODE_WIDTH, mindMapCanvasBounds, newId,
} from "../lib/mind-map";
import { mergePositions, nodesInRect, removeMindMapNodes, subtreeIds } from "../lib/mind-map-commands";
import { useMindMapCommands } from "./mind-map/useMindMapCommands";

/** 关系线默认色：绿色虚线，与父子树边的实线形成视觉区分。 */
const RELATION_DEFAULT_COLOR = "#2f8f6b";
/** 关系线标签默认色：深灰蓝，保证在连线上清晰可读。 */
const RELATION_DEFAULT_LABEL_COLOR = "#243447";
/** 关系线数量上限，与 creative-workspace.cjs 的白名单保持一致。 */
const RELATION_LIMIT = 2000;
/** positions 偏移上限，与 creative-workspace.cjs 白名单一致。 */
const POSITION_LIMIT = 10000;

type ContextMenuState = {
  x: number;
  y: number;
  kind: "node" | "relation" | "canvas";
  targetId: string;
};
type SelectionRect = { x1: number; y1: number; x2: number; y2: number };

/** loadWorkspace 不经 normalizeItem，外部 / MCP 写入的脏字段也按空集合安全降级。 */
function relationsOf(value: MindMap | null): MindMapRelation[] {
  return Array.isArray(value?.relations) ? (value?.relations ?? []) : [];
}

function relationDashArray(pattern: MindMapRelationLinePattern | undefined): string | undefined {
  if (pattern === "dash") return "8 5";
  if (pattern === "dot") return "2 4";
  return undefined;
}

/** 估算 SVG 文本宽度：CJK/全角按 1em、其余按 0.55em，用于关系线标签底板。 */
function relationTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of Array.from(text)) units += /[\u2e80-\uffef]/.test(char) ? 1 : 0.55;
  return units * fontSize;
}

/** 关系标签文案：主行显示连线文字，副行显示备注；都为空时给出占位提示。 */
function relationCaption(relation: MindMapRelation): { primary: string; secondary: string; placeholder: boolean; full: string } {
  const label = String(relation.label ?? "").trim();
  const note = String(relation.note ?? "").trim();
  const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);
  return {
    primary: clip(label || note || "未命名关系", 28),
    secondary: label && note ? clip(note, 36) : "",
    placeholder: !label && !note,
    full: [label, note].filter(Boolean).join("\n"),
  };
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function MindMaps({ workspace, onWorkspace, onRegisterSave, onStatus, fullscreen = false, onRelationModeChange }: {
  workspace: CreativeWorkspaceState;
  onWorkspace: (value: CreativeWorkspaceState) => void;
  onRegisterSave: (kind: PageSaveKind, handle: PageSaveHandle | null) => void;
  onStatus: (message: string) => void;
  fullscreen?: boolean;
  onRelationModeChange?: (active: boolean) => void;
}) {
  const board = useWorkspaceDraft<MindMap>("mind-map", "mindMaps", workspace, onWorkspace, onRegisterSave, createMindMap);
  const map = board.draft;
  const [selectedId, setSelectedId] = useState("");
  const [selectedRelationId, setSelectedRelationId] = useState("");
  const [relationMode, setRelationMode] = useState(false);
  const [relationSourceId, setRelationSourceId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 24, y: 24 });
  const [xmindPreview, setXmindPreview] = useState<{ fileName: string; sheets: XMindImportSheet[] } | null>(null);
  const [sheetChoice, setSheetChoice] = useState("all");
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [listCollapsed, setListCollapsed] = useState(false);
  const [dragOffsets, setDragOffsets] = useState<Record<string, { dx: number; dy: number }> | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionRect | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const pan = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const dragRef = useRef<{
    id: string; startX: number; startY: number; originDx: number; originDy: number;
    scale: number; dx: number; dy: number; moved: boolean;
  } | null>(null);
  const marqueeRef = useRef<SelectionRect | null>(null);
  const relationModeCallback = useRef(onRelationModeChange);
  relationModeCallback.current = onRelationModeChange;

  const commands = useMindMapCommands(map, board.update, (next) => {
    if (selectedId && !next.nodes.some((node) => node.id === selectedId)) setSelectedId(next.rootId);
    if (selectedRelationId && !relationsOf(next).some((item) => item.id === selectedRelationId)) setSelectedRelationId("");
  });
  const {
    commit, undo, redo, resetHistory, canUndo, canRedo,
    selectedIds, setSelectedIds, toggleSelected, clipboardCount, copySelection, pasteInto,
  } = commands;

  // 自由摆放：把已落盘 positions 与拖拽中的临时偏移合并后叠加到布局上，
  // 节点与树边统一用这个 layout 渲染，关系线也用同一个 layout 计算 → 端点自动跟随。
  const effectivePositions = useMemo(() => mergePositions(map?.positions, dragOffsets), [map?.positions, dragOffsets]);
  const layout = useMemo<MindMapLayout>(
    () => map ? applyPositions(layoutMindMap(map), effectivePositions) : { nodes: [], edges: [], width: 900, height: 520 },
    [map, effectivePositions],
  );
  const laidRelations = useMemo<LaidMindRelation[]>(() => map ? layoutRelations(map, layout) : [], [map, layout]);
  // 显示边界由布局引擎统一计算（可单测）：SVG 的 viewBox 与 left/top 取同一组 x/y，
  // 保持 1:1 坐标映射，节点不跳位；渲染范围随自由摆放动态扩展，超界连线不再被裁剪。
  const canvasBounds = useMemo(() => mindMapCanvasBounds(layout, laidRelations), [layout, laidRelations]);
  const worldWidth = Math.max(layout.width, canvasBounds.x + canvasBounds.width);
  const worldHeight = Math.max(layout.height, canvasBounds.y + canvasBounds.height);
  // 每种线色生成一对三角箭头 marker，避免为每条线重复定义且保持箭头与线同色。
  const relationColors = useMemo(
    () => Array.from(new Set(laidRelations.map((item) => item.relation.lineColor || RELATION_DEFAULT_COLOR))),
    [laidRelations],
  );
  const relationMarkerIds = useMemo(
    () => new Map<string, string>(relationColors.map((color, index): [string, string] => [color, `mind-relation-arrow-${index}`])),
    [relationColors],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const selectedNode = map?.nodes.find((node) => node.id === selectedId) || null;
  const selectedRelation = relationsOf(map).find((item) => item.id === selectedRelationId) || null;

  const fitView = useCallback(() => {
    const element = canvasRef.current;
    const current = layoutRef.current;
    if (!element || !current.width) return;
    // 允许放大到 1.6 倍：节点较少的导图也能铺满画布，而不是缩在中间一小块。
    const next = Math.min(1.6, Math.max(0.35, Math.min((element.clientWidth - 32) / current.width, (element.clientHeight - 32) / current.height)));
    setScale(next);
    setOffset({ x: (element.clientWidth - current.width * next) / 2, y: (element.clientHeight - current.height * next) / 2 });
  }, []);

  useEffect(() => {
    setSelectedId(map?.rootId || "");
    setEditingId("");
    setSelectedRelationId("");
    setRelationSourceId("");
    setRelationMode(false);
    setDragOffsets(null);
    setSelectionBox(null);
    setContextMenu(null);
    dragRef.current = null;
    marqueeRef.current = null;
    // 切换 / 新建 / 导入导图后清空撤销与重做栈，避免跨导图回退。
    resetHistory();
    setSelectedIds(map?.rootId ? [map.rootId] : []);
    // 等布局稳定后再测量画布，避免属性区撑开时按旧高度计算居中偏移。
    const frame = window.requestAnimationFrame(fitView);
    return () => window.cancelAnimationFrame(frame);
  }, [board.activeId, map?.rootId, fitView, resetHistory, setSelectedIds]);

  // 把连线模式同步给宿主（弹窗）：宿主的 Esc 在连线模式激活时短路关窗。
  useEffect(() => {
    relationModeCallback.current?.(relationMode);
    return () => relationModeCallback.current?.(false);
  }, [relationMode]);

  // 连线模式用窗口级 Esc 取消：点击节点不一定把焦点留在画布上。
  useEffect(() => {
    if (!relationMode) return;
    const handle = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement)?.tagName || "")) return;
      setRelationMode(false);
      setRelationSourceId("");
      onStatus("已取消添加关系线。");
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [relationMode, onStatus]);

  // 全局编辑快捷键：Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / Ctrl+C / Ctrl+V / Ctrl+A。
  // 输入框聚焦时跳过，交给浏览器原生编辑；不与 Tab/Enter/F2/Delete/Esc 冲突。
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement)?.tagName || "")) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) { event.preventDefault(); undo(); }
      else if ((key === "z" && event.shiftKey) || key === "y") { event.preventDefault(); redo(); }
      else if (key === "c") {
        event.preventDefault();
        if (!map) return;
        const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);
        if (!ids.length) return;
        copySelection(map, ids, () => newId("node"));
        onStatus(`已复制 ${ids.length} 个主题（含子树）到内部剪贴板。`);
      } else if (key === "v") {
        event.preventDefault();
        if (!map) return;
        const next = pasteInto(map, selectedId || map.rootId, () => newId("node"));
        if (!next) { onStatus("内部剪贴板为空，请先复制主题。"); return; }
        commit({ ...next, updatedAt: new Date().toISOString() });
        onStatus("已把剪贴板主题粘贴到当前选中节点下。");
      } else if (key === "a") {
        event.preventDefault();
        if (map) setSelectedIds(map.nodes.map((node) => node.id));
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [undo, redo, copySelection, pasteInto, commit, setSelectedIds, map, selectedIds, selectedId, onStatus]);

  // 右键菜单：点击菜单之外任意位置关闭。
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [contextMenu]);

  // 弹窗打开、属性区精简或窗口缩放后画布尺寸会变，重新适配视图；节点增减不改变容器尺寸，不会打断用户缩放。
  useEffect(() => {
    const element = canvasRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let lastWidth = element.clientWidth;
    let lastHeight = element.clientHeight;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || (Math.abs(rect.width - lastWidth) < 2 && Math.abs(rect.height - lastHeight) < 2)) return;
      lastWidth = rect.width;
      lastHeight = rect.height;
      fitView();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitView, board.activeId]);

  const mutateNodes = useCallback((change: (nodes: MindMapNode[]) => MindMapNode[], mergeKey?: string) => {
    commit((previous) => ({ ...previous, updatedAt: new Date().toISOString(), nodes: change(previous.nodes) }), mergeKey);
  }, [commit]);

  const patchNode = useCallback((id: string, patch: Partial<MindMapNode>) => {
    const keys = Object.keys(patch);
    const mergeKey = keys.length === 1 ? `node:${id}:${keys[0]}` : undefined;
    mutateNodes((nodes) => nodes.map((node) => node.id === id ? { ...node, ...patch } : node), mergeKey);
  }, [mutateNodes]);

  const addChild = useCallback((parentId?: string) => {
    if (!map) return;
    const parent = map.nodes.find((node) => node.id === (parentId || selectedId)) || map.nodes.find((node) => node.id === map.rootId);
    if (!parent) return;
    const siblings = map.nodes.filter((node) => node.parentId === parent.id);
    let side: MindMapSide = parent.side;
    if (parent.id === map.rootId) {
      const leftCount = siblings.filter((node) => node.side === "left").length;
      side = leftCount <= siblings.length - leftCount ? "left" : "right";
    }
    const node = createMindMapNode(parent, side, Math.max(-1, ...siblings.map((item) => item.order)) + 1);
    // 一次提交同时完成新增与展开父节点，历史栈只记录一步。
    commit((previous) => {
      const nodes = [...previous.nodes, { ...node, parentId: parent.id, collapsed: false }];
      return {
        ...previous,
        updatedAt: new Date().toISOString(),
        nodes: parent.collapsed ? nodes.map((item) => item.id === parent.id ? { ...item, collapsed: false } : item) : nodes,
      };
    });
    setSelectedId(node.id);
    setSelectedIds([node.id]);
    setSelectedRelationId("");
    setEditingId(node.id);
  }, [map, selectedId, commit, setSelectedIds]);

  const addSibling = useCallback(() => {
    if (!map || !selectedNode || selectedNode.id === map.rootId) return;
    addChild(selectedNode.parentId);
  }, [map, selectedNode, addChild]);

  const removeNode = useCallback(() => {
    if (!map || !selectedNode || selectedNode.id === map.rootId) return;
    commit((previous) => ({ ...removeMindMapNodes(previous, [selectedNode.id]), updatedAt: new Date().toISOString() }));
    setSelectedId(map.rootId);
    setSelectedIds([]);
    setEditingId("");
    setSelectedRelationId("");
  }, [map, selectedNode, commit, setSelectedIds]);

  const patchRelation = useCallback((id: string, patch: Partial<MindMapRelation>) => {
    const keys = Object.keys(patch);
    const mergeKey = keys.length === 1 ? `relation:${id}:${keys[0]}` : undefined;
    commit((previous) => ({
      ...previous,
      updatedAt: new Date().toISOString(),
      relations: relationsOf(previous).map((item) => item.id === id ? { ...item, ...patch } : item),
    }), mergeKey);
  }, [commit]);

  const removeRelation = useCallback(() => {
    if (!selectedRelationId) return;
    commit((previous) => ({
      ...previous,
      updatedAt: new Date().toISOString(),
      relations: relationsOf(previous).filter((item) => item.id !== selectedRelationId),
    }));
    setSelectedRelationId("");
    onStatus("关系线已删除。");
  }, [commit, selectedRelationId, onStatus]);

  const toggleCollapse = useCallback((id: string) => {
    const node = map?.nodes.find((item) => item.id === id);
    if (node) patchNode(id, { collapsed: !node.collapsed });
  }, [map, patchNode]);

  const setAllCollapsed = useCallback((collapsed: boolean) => {
    if (!map) return;
    mutateNodes((nodes) => nodes.map((node) => node.id === map.rootId || node.parentId === map.rootId ? node : { ...node, collapsed }));
  }, [map, mutateNodes]);

  function toggleRelationMode() {
    setRelationMode((value) => !value);
    setRelationSourceId("");
    setSelectedRelationId("");
    onStatus(relationMode ? "已退出连线模式。" : "连线模式：请依次点击起点与终点节点，按 Esc 取消。");
  }

  /** 连线模式下依次点击两个节点创建关系线；重复点击同一节点不创建。 */
  function handleRelationNodeClick(nodeId: string) {
    if (!map) return;
    if (!relationSourceId) {
      setRelationSourceId(nodeId);
      setSelectedId(nodeId);
      setSelectedRelationId("");
      onStatus("已选择起点，请点击终点节点；按 Esc 可取消。");
      return;
    }
    if (relationSourceId === nodeId) {
      onStatus("起点与终点不能是同一个节点，请另选一个节点。");
      return;
    }
    if (relationsOf(map).length >= RELATION_LIMIT) {
      onStatus(`关系线已达到 ${RELATION_LIMIT} 条上限，请先删除部分关系线。`);
      setRelationMode(false);
      setRelationSourceId("");
      return;
    }
    const item: MindMapRelation = {
      id: newId("relation"),
      sourceId: relationSourceId,
      targetId: nodeId,
      label: "",
      note: "",
      shape: "curved",
      linePattern: "dash",
      lineColor: "",
      lineWidth: 2,
      arrowBegin: "none",
      arrowEnd: "triangle",
      labelFontStyle: "normal",
      labelColor: "",
    };
    commit((previous) => ({
      ...previous,
      updatedAt: new Date().toISOString(),
      relations: [...relationsOf(previous), item],
    }));
    setRelationMode(false);
    setRelationSourceId("");
    setSelectedRelationId(item.id);
    setSelectedId("");
    setSelectedIds([]);
    onStatus("关系线已创建：画布上已显示标签，右侧「连线文字」可直接输入，文字与备注会立刻显示在线上。");
  }

  async function removeBoard() {
    if (!map || !window.confirm(`删除「${map.title}」及其全部主题？此操作不可撤销。`)) return;
    try { await board.remove(); onStatus("思维导图已删除"); }
    catch (error) { onStatus(`删除失败：${error instanceof Error ? error.message : String(error)}`); }
  }

  async function chooseXMind() {
    setImportError("");
    try {
      const result = await window.novelAPI.importXMind();
      if (result.canceled) return;
      if (result.error) { setImportError(result.error); return; }
      if (!result.sheets?.length) { setImportError("这个文件里没有可导入的主题。"); return; }
      setXmindPreview({ fileName: result.fileName || "XMind 文件", sheets: result.sheets });
      setSheetChoice("all");
    } catch (error) {
      setImportError(`读取 XMind 失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function confirmXMind() {
    if (!xmindPreview || importing) return;
    const picked = sheetChoice === "all" ? xmindPreview.sheets : xmindPreview.sheets.filter((_item, index) => String(index) === sheetChoice);
    if (!picked.length) return;
    if (board.items.length + picked.length > 60) {
      setImportError(`导入后会超过每个项目 60 张思维导图的上限（当前 ${board.items.length} 张），请先整理旧导图。`);
      return;
    }
    setImporting(true);
    setImportError("");
    try {
      if (!(await board.flush())) return;
      let latest = workspace;
      for (const sheet of picked) {
        const result = await window.novelAPI.upsertCreativeWorkspaceItem({
          collection: "mindMaps", item: sheet.map as unknown as Record<string, unknown>,
        });
        latest = result.workspace;
      }
      onWorkspace(latest);
      await board.adopt(picked[picked.length - 1].map);
      setXmindPreview(null);
      onStatus(`已从 ${xmindPreview.fileName} 导入 ${picked.length} 张思维导图`);
    } catch (error) {
      setImportError(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setImporting(false);
    }
  }

  async function generateFromRelations() {
    if (importing) return;
    if (board.items.length >= 60) {
      setImportError("思维导图已达到 60 张上限，请先整理旧导图再生成。");
      return;
    }
    setImporting(true);
    setImportError("");
    try {
      if (!(await board.flush())) return;
      const result = await window.novelAPI.buildRelationshipGraph({ refresh: true });
      const characters = result.nodes || [];
      const links = result.edges || [];
      if (!characters.length) {
        setImportError("没有可用的角色关系数据，请先在「角色」中维护人物卡与关系。");
        return;
      }
      const id = `rel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const rootId = `${id}_root`;
      const now = new Date().toISOString();
      const nodes: MindMapNode[] = [{
        id: rootId, parentId: "", text: "角色关系网",
        note: `由 ${characters.length} 个角色、${links.length} 条关系生成；可继续在导图中补充思路。`,
        color: "", collapsed: false, order: 0, side: "right",
      }];
      characters.forEach((character, index) => {
        if (nodes.length >= 1999) return;
        const side: MindMapSide = index % 2 === 0 ? "left" : "right";
        const nodeId = `${id}_c${index}`;
        nodes.push({
          id: nodeId, parentId: rootId, text: character.name,
          note: [character.category, character.notes].filter(Boolean).join(" / "),
          color: "", collapsed: false, order: index, side,
        });
        links.filter((edge) => edge.source === character.id || edge.target === character.id).forEach((edge, position) => {
          if (nodes.length >= 2000) return;
          const outward = edge.source === character.id;
          const other = characters.find((item) => item.id === (outward ? edge.target : edge.source));
          nodes.push({
            id: `${id}_e${index}_${position}`, parentId: nodeId,
            text: `${outward ? "→" : "←"} ${other?.name || "未知角色"}${edge.label ? `（${edge.label}）` : ""}`,
            note: [`强度 ${edge.weight}`, edge.evidence?.length ? `证据 ${edge.evidence.length} 条` : ""].filter(Boolean).join(" · "),
            color: "", collapsed: false, order: position, side,
          });
        });
      });
      const nextMap: MindMap = {
        id, title: `角色关系网 · ${new Date().toLocaleDateString("zh-CN")}`,
        rootId, nodes: nodes.slice(0, 2000), createdAt: now, updatedAt: now,
      };
      const saved = await window.novelAPI.upsertCreativeWorkspaceItem({
        collection: "mindMaps", item: nextMap as unknown as Record<string, unknown>,
      });
      onWorkspace(saved.workspace);
      await board.adopt(nextMap);
      onStatus(`已把角色关系并入思维导图：${characters.length} 个角色、${links.length} 条关系`);
    } catch (error) {
      setImportError(`生成失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setImporting(false);
    }
  }

  function removeSelectedNodes() {
    if (!map || !selectedIds.length) return;
    commit((previous) => ({ ...removeMindMapNodes(previous, selectedIds), updatedAt: new Date().toISOString() }));
    setSelectedIds([]);
    setSelectedId(map.rootId);
    setSelectedRelationId("");
    setContextMenu(null);
    onStatus("已删除选中的主题及其子树，关联关系线已级联删除。");
  }

  function colorSelectedNodes(color: string) {
    if (!selectedIds.length) return;
    const ids = new Set(selectedIds);
    commit((previous) => ({
      ...previous,
      updatedAt: new Date().toISOString(),
      nodes: previous.nodes.map((node) => ids.has(node.id) ? { ...node, color } : node),
    }));
  }

  function resetPositions() {
    commit((previous) => ({ ...previous, updatedAt: new Date().toISOString(), positions: {} }));
    setDragOffsets(null);
    onStatus("已重置所有主题的自由摆放位置。");
  }

  function canvasPoint(event: ReactMouseEvent<HTMLDivElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (event.clientX - rect.left - offset.x) / scale,
      y: (event.clientY - rect.top - offset.y) / scale,
    };
  }

  function onCanvasKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement).tagName)) return;
    if (event.key === "Tab") { event.preventDefault(); addChild(); }
    else if (event.key === "Enter") { event.preventDefault(); addSibling(); }
    else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      if (selectedIds.length > 1) removeSelectedNodes();
      else if (selectedRelationId) removeRelation();
      else if (!relationMode) removeNode();
    }
    else if (event.key === "F2") { event.preventDefault(); if (selectedId) setEditingId(selectedId); }
  }

  function onCanvasMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(".mind-map-node") || target.closest(".mind-map-relation-hit") || target.closest("button") || target.closest("input")) return;
    if (event.shiftKey) {
      // Shift + 拖空白 = 框选；普通拖空白仍然平移画布。
      const point = canvasPoint(event);
      marqueeRef.current = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
      setSelectionBox(marqueeRef.current);
      return;
    }
    pan.current = { x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y };
  }

  function onCanvasMouseMove(event: ReactMouseEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag) {
      const deltaX = (event.clientX - drag.startX) / drag.scale;
      const deltaY = (event.clientY - drag.startY) / drag.scale;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 1) drag.moved = true;
      drag.dx = drag.originDx + deltaX;
      drag.dy = drag.originDy + deltaY;
      // 拖拽中只更新临时偏移，不写草稿、不入历史栈；松手时一次性 commit。
      setDragOffsets({ [drag.id]: { dx: drag.dx, dy: drag.dy } });
      return;
    }
    if (marqueeRef.current) {
      const point = canvasPoint(event);
      marqueeRef.current = { ...marqueeRef.current, x2: point.x, y2: point.y };
      setSelectionBox(marqueeRef.current);
      return;
    }
    if (pan.current) {
      setOffset({ x: pan.current.originX + event.clientX - pan.current.x, y: pan.current.originY + event.clientY - pan.current.y });
    }
  }

  function onCanvasMouseUp() {
    const drag = dragRef.current;
    if (drag) {
      if (drag.moved) {
        const dx = Math.max(-POSITION_LIMIT, Math.min(POSITION_LIMIT, drag.dx));
        const dy = Math.max(-POSITION_LIMIT, Math.min(POSITION_LIMIT, drag.dy));
        commit((previous) => ({
          ...previous,
          updatedAt: new Date().toISOString(),
          positions: { ...(previous.positions || {}), [drag.id]: { dx, dy } },
        }));
      }
      dragRef.current = null;
      setDragOffsets(null);
    }
    const marquee = marqueeRef.current;
    if (marquee) {
      const ids = nodesInRect(layout, marquee, MIND_NODE_WIDTH / 2, MIND_NODE_HEIGHT / 2);
      setSelectedIds(ids);
      if (ids.length) { setSelectedId(ids[ids.length - 1]); setSelectedRelationId(""); }
      marqueeRef.current = null;
      setSelectionBox(null);
    }
    pan.current = null;
  }

  function onCanvasContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const target = event.target as HTMLElement;
    const base = { x: event.clientX, y: event.clientY };
    const relationHit = target.closest(".mind-map-relation-hit");
    if (relationHit) {
      const id = relationHit.getAttribute("data-relation-id") || "";
      setSelectedRelationId(id);
      setSelectedId("");
      setSelectedIds([]);
      setContextMenu({ ...base, kind: "relation", targetId: id });
      return;
    }
    const nodeEl = target.closest(".mind-map-node");
    if (nodeEl) {
      const id = nodeEl.getAttribute("data-node-id") || "";
      if (!selectedIds.includes(id)) setSelectedIds([id]);
      setSelectedId(id);
      setSelectedRelationId("");
      setContextMenu({ ...base, kind: "node", targetId: id });
      return;
    }
    setContextMenu({ ...base, kind: "canvas", targetId: "" });
  }

  function runMenu(action: () => void) {
    action();
    setContextMenu(null);
  }

  function pasteClipboard(parentId: string) {
    if (!map) return;
    const next = pasteInto(map, parentId, () => newId("node"));
    if (!next) { onStatus("内部剪贴板为空，请先复制主题。"); return; }
    commit({ ...next, updatedAt: new Date().toISOString() });
    onStatus("已粘贴剪贴板主题。");
  }

  function copyFromMenu(targetId: string) {
    if (!map) return;
    const ids = selectedIds.length ? selectedIds : [targetId];
    copySelection(map, ids, () => newId("node"));
    onStatus(`已复制 ${ids.length} 个主题（含子树）到内部剪贴板。`);
  }

  /** 新建独立中心主题：parentId 为空，与其它中心之间不生成树边。 */
  function addCenterTopic() {
    if (!map) return;
    const count = map.nodes.filter((node) => !node.parentId).length;
    const node: MindMapNode = {
      id: newId("node"), parentId: "", text: `中心主题 ${count + 1}`, note: "", color: "",
      collapsed: false, order: Math.max(-1, ...map.nodes.map((item) => item.order)) + 1, side: "right",
    };
    commit((previous) => ({ ...previous, updatedAt: new Date().toISOString(), nodes: [...previous.nodes, node] }));
    setSelectedId(node.id);
    setSelectedIds([node.id]);
    setSelectedRelationId("");
    setEditingId(node.id);
    onStatus("已新建独立中心主题：它与其它中心之间不会生成连线。");
  }

  /** 把主题从父主题断开：parentId 置空，并清掉跨越边界的关系线，使它独立成一块。 */
  function detachFromParent(targetId: string) {
    if (!map) return;
    const target = map.nodes.find((node) => node.id === targetId);
    if (!target || !target.parentId || target.id === map.rootId) return;
    const inside = new Set(subtreeIds(map, targetId));
    commit((previous) => ({
      ...previous,
      updatedAt: new Date().toISOString(),
      nodes: previous.nodes.map((node) => node.id === targetId ? { ...node, parentId: "", side: "right" } : node),
      relations: relationsOf(previous).filter((item) => inside.has(item.sourceId) === inside.has(item.targetId)),
    }));
    setSelectedId(targetId);
    setSelectedIds([targetId]);
    setSelectedRelationId("");
    onStatus("已断开：该主题及其子主题独立成块，不再与原来的树连线。");
  }

  function onCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    setScale((value) => Math.max(0.3, Math.min(2.2, value * (event.deltaY < 0 ? 1.1 : 0.9))));
  }

  const childCount = map && selectedNode ? map.nodes.filter((node) => node.parentId === selectedNode.id).length : 0;
  const hasPositions = Object.keys(effectivePositions || {}).length > 0;
  // 列表搜索只过滤卡片，不改 <select> 的 option 数量；默认空串即全量，保证列表断言稳定。
  const visibleMaps = listQuery.trim()
    ? board.items.filter((item) => item.title.toLowerCase().includes(listQuery.trim().toLowerCase()))
    : board.items;

  return <section className={`mind-map-panel ${fullscreen ? "fullscreen" : ""} ${showInspector ? "" : "inspector-compact"}`} aria-label="思维导图">
    <header className="mind-map-toolbar">
      <select aria-label="选择思维导图" value={board.activeId} onChange={(event) => { if (event.target.value) void board.select(event.target.value); }}>
        <option value="">选择已创建的导图</option>
        {board.items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
      <button onClick={() => void board.create()}>新建思维导图</button>
      <button onClick={() => void chooseXMind()}>导入 XMind</button>
      <button disabled={!map} aria-pressed={relationMode} onClick={toggleRelationMode}>添加关系线</button>
      <button disabled={!canUndo} onClick={undo}>撤销</button>
      <button disabled={!canRedo} onClick={redo}>重做</button>
      <button onClick={fitView}>适应画布</button>
      <span role="status" aria-live="polite">{board.saveState}</span>
      {/* 次要操作常驻 DOM，仅用 CSS 折叠；UI 断言按 textContent 查找，隐藏不影响点击。 */}
      <button aria-label="更多操作" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}>更多</button>
      <div className={`mind-map-toolbar-more ${moreOpen ? "open" : ""}`}>
        <button disabled={importing} onClick={() => void generateFromRelations()}>从角色关系生成</button>
        <button disabled={!map} onClick={() => void removeBoard()}>删除此导图</button>
        <button disabled={!map || !hasPositions} onClick={resetPositions}>重置位置</button>
        <label>名称<input aria-label="思维导图名称" maxLength={160} value={map?.title || ""} onChange={(event) => commit((previous) => ({ ...previous, title: event.target.value, updatedAt: new Date().toISOString() }), `title:${map?.id || ""}`)} /></label>
        <button onClick={() => setShowInspector((value) => !value)}>{showInspector ? "精简属性区" : "展开属性区"}</button>
        <button onClick={() => setAllCollapsed(false)}>展开全部</button>
        <button onClick={() => setAllCollapsed(true)}>折叠全部</button>
      </div>
    </header>

    {importError && <p className="mind-map-import-error" role="alert">{importError}</p>}
    {xmindPreview && <section className="mind-map-import-preview" aria-label="XMind 导入预览">
      <header><strong>导入预览：{xmindPreview.fileName}</strong><span>共 {xmindPreview.sheets.length} 个画布</span></header>
      <label>导入范围<select aria-label="导入画布范围" value={sheetChoice} onChange={(event) => setSheetChoice(event.target.value)}>
        <option value="all">全部导入（{xmindPreview.sheets.length} 张）</option>
        {xmindPreview.sheets.map((sheet, index) => <option key={`${sheet.title}-${index}`} value={String(index)}>{sheet.title}</option>)}
      </select></label>
      <ul>{xmindPreview.sheets.map((sheet, index) => <li key={`${sheet.title}-${index}`}>
        <strong>{sheet.title}</strong><span>中心：{sheet.rootText} · {sheet.nodeCount} 个主题{sheet.relationCount ? ` · ${sheet.relationCount} 条关系线` : ""}{sheet.truncated ? " · 已按上限截断" : ""}</span>
        {sheet.relationNote && <span className="mind-map-import-relation-note">{sheet.relationNote}</span>}
      </li>)}</ul>
      <div className="mind-map-import-actions">
        <button onClick={() => setXmindPreview(null)}>放弃 XMind 导入</button>
        <button className="primary" disabled={importing} onClick={() => void confirmXMind()}>确认导入 XMind</button>
      </div>
    </section>}

    {!map ? <div className="mind-map-empty"><p>还没有思维导图。</p><button onClick={() => void board.create()}>创建第一张思维导图</button></div> :
      <div className="mind-map-body">
        <aside className={`mind-map-list ${listCollapsed ? "collapsed" : ""}`} aria-label="已创建的思维导图">
          <div className="mind-map-list-tools">
            <strong>我的思维导图</strong><span>{board.items.length} 张</span>
            <input aria-label="搜索思维导图" placeholder="搜索名称…" value={listQuery} onChange={(event) => setListQuery(event.target.value)} />
            <button aria-label={listCollapsed ? "展开导图列表" : "折叠导图列表"} onClick={() => setListCollapsed((value) => !value)}>{listCollapsed ? "展开" : "折叠"}</button>
          </div>
          <div className="mind-map-list-items">
            {visibleMaps.map((item) => <button key={item.id} className={item.id === board.activeId ? "active" : ""} onClick={() => void board.select(item.id)}>
              <strong>{item.title}</strong>
              <span>{item.nodes.length} 个主题 · {formatTime(item.updatedAt)}</span>
            </button>)}
            {!board.items.length && <p>点击上方「新建思维导图」创建第一张。</p>}
            {board.items.length > 0 && !visibleMaps.length && <p>没有匹配的思维导图。</p>}
          </div>
        </aside>

        <div className="mind-map-main">
          <div ref={canvasRef} className="mind-map-canvas" tabIndex={0} role="application" aria-label="思维导图画布"
            onKeyDown={onCanvasKeyDown} onMouseDown={onCanvasMouseDown} onMouseMove={onCanvasMouseMove}
            onMouseUp={onCanvasMouseUp} onMouseLeave={onCanvasMouseUp} onWheel={onCanvasWheel}
            onContextMenu={onCanvasContextMenu}>
            <div className="mind-map-world" style={{ width: worldWidth, height: worldHeight, transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}>
              {/* viewBox 起点与 SVG 的 left/top 一致：坐标 1:1，节点不跳位；渲染范围随内容动态扩展。 */}
              <svg className="mind-map-links" style={{ left: canvasBounds.x, top: canvasBounds.y }}
                width={canvasBounds.width} height={canvasBounds.height}
                viewBox={`${canvasBounds.x} ${canvasBounds.y} ${canvasBounds.width} ${canvasBounds.height}`} aria-hidden="true">
                <defs>
                  {relationColors.map((color, index) => <marker key={`mind-relation-arrow-${index}`}
                    id={`mind-relation-arrow-${index}`} viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="8" markerHeight="8" orient="auto-start-reverse" fill={color}>
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>)}
                </defs>
                {layout.edges.map((edge) => <path key={edge.id} fill="none" strokeWidth={2}
                  stroke={edge.color || "var(--line)"}
                  d={`M ${edge.x1} ${edge.y1} C ${(edge.x1 + edge.x2) / 2} ${edge.y1}, ${(edge.x1 + edge.x2) / 2} ${edge.y2}, ${edge.x2} ${edge.y2}`} />)}
                <g className="mind-map-relations">
                  {laidRelations.map((item, index) => {
                    const current = item.relation;
                    const color = current.lineColor || RELATION_DEFAULT_COLOR;
                    const markerId = relationMarkerIds.get(color) || "";
                    const selected = current.id === selectedRelationId;
                    const caption = relationCaption(current);
                    const chipWidth = Math.min(280, Math.max(
                      relationTextWidth(caption.primary, 13),
                      caption.secondary ? relationTextWidth(caption.secondary, 11.5) : 0,
                    ) + 20);
                    const chipHeight = caption.secondary ? 34 : 22;
                    // 标签整体移到连线上方：底板不再盖住关系线，避免视觉上「线被截断」。
                    const chipY = item.ly - 10 - chipHeight;
                    const labelY = caption.secondary ? chipY + 14 : chipY + 15;
                    return <g key={`${current.id}-${index}`} className={`mind-map-relation ${selected ? "selected" : ""}`}>
                      <path className="mind-map-relation-line" d={item.d} fill="none" stroke={color}
                        strokeWidth={(current.lineWidth ?? 2) + (selected ? 1 : 0)}
                        strokeDasharray={relationDashArray(current.linePattern)} strokeLinecap="round"
                        markerStart={current.arrowBegin === "triangle" && markerId ? `url(#${markerId})` : undefined}
                        markerEnd={(current.arrowEnd ?? "triangle") === "triangle" && markerId ? `url(#${markerId})` : undefined} />
                      <g className="mind-map-relation-caption-group">
                        <rect className="mind-map-relation-chip" x={item.lx - chipWidth / 2} y={chipY}
                          width={chipWidth} height={chipHeight} rx={6}>
                          {caption.full.length > 28 && <title>{caption.full}</title>}
                        </rect>
                        <text className={caption.placeholder ? "mind-map-relation-placeholder" : "mind-map-relation-label"}
                          x={item.lx} y={labelY} textAnchor="middle"
                          fontStyle={caption.placeholder ? undefined : (current.labelFontStyle === "normal" ? "normal" : "italic")}
                          fill={caption.placeholder ? "var(--muted)" : (current.labelColor || RELATION_DEFAULT_LABEL_COLOR)}
                        >{caption.primary}</text>
                        {caption.secondary && <text className="mind-map-relation-note" x={item.lx} y={chipY + 28}
                          textAnchor="middle">{caption.secondary}</text>}
                      </g>
                      <path className="mind-map-relation-hit" d={item.d} fill="none" stroke="transparent" strokeWidth={16}
                        data-relation-id={current.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedRelationId(current.id);
                          setSelectedId("");
                          setSelectedIds([]);
                        }} />
                    </g>;
                  })}
                </g>
              </svg>
              {selectionBox && <div className="mind-map-selection-box" style={{
                left: Math.min(selectionBox.x1, selectionBox.x2),
                top: Math.min(selectionBox.y1, selectionBox.y2),
                width: Math.abs(selectionBox.x2 - selectionBox.x1),
                height: Math.abs(selectionBox.y2 - selectionBox.y1),
              }} />}
              {layout.nodes.map((item) => <div key={item.id} data-node-id={item.id}
                className={`mind-map-node ${item.side === "center" ? "root" : ""} ${selectedIds.includes(item.id) ? "selected" : ""} ${relationMode && relationSourceId === item.id ? "relation-source" : ""}`}
                style={{ left: item.x - MIND_NODE_WIDTH / 2, top: item.y - MIND_NODE_HEIGHT / 2, width: MIND_NODE_WIDTH, height: MIND_NODE_HEIGHT, ...(item.node.color ? { backgroundColor: item.node.color } : {}) }}
                onMouseDown={(event) => {
                  if (relationMode || editingId === item.id || event.button !== 0) return;
                  const target = event.target as HTMLElement;
                  if (target.closest(".mind-node-fold") || target.closest("input") || target.closest("button")) return;
                  const origin = effectivePositions?.[item.id] || { dx: 0, dy: 0 };
                  dragRef.current = {
                    id: item.id, startX: event.clientX, startY: event.clientY,
                    originDx: origin.dx, originDy: origin.dy, scale,
                    dx: origin.dx, dy: origin.dy, moved: false,
                  };
                }}
                onClick={(event) => {
                  if (relationMode) { handleRelationNodeClick(item.id); return; }
                  toggleSelected(item.id, event.ctrlKey || event.shiftKey || event.metaKey);
                  setSelectedId(item.id);
                  setSelectedRelationId("");
                }}
                onDoubleClick={() => { if (!relationMode) setEditingId(item.id); }}>
                {editingId === item.id ? <input autoFocus aria-label="编辑主题文字" value={item.node.text}
                  onChange={(event) => patchNode(item.id, { text: event.target.value })}
                  onBlur={() => setEditingId("")}
                  onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter" || event.key === "Escape") setEditingId(""); }} /> :
                  <span title={item.node.note || item.node.text}>{item.node.text}</span>}
                {item.childCount > 0 && <button className="mind-node-fold" aria-label={`${item.node.collapsed ? "展开" : "折叠"}主题：${item.node.text}`}
                  onClick={(event) => { event.stopPropagation(); if (relationMode) return; toggleCollapse(item.id); }}>{item.node.collapsed ? "+" : "−"}</button>}
              </div>)}
            </div>
          </div>

          {selectedIds.length > 1 ? <div className="mind-map-inspector mind-map-batch-inspector">
            <p>已选中 {selectedIds.length} 个主题；可批量改色或删除（含子树，关联关系线级联删除）。</p>
            <label>批量颜色<input type="color" aria-label="批量主题颜色" value={selectedNode?.color || "#dce9f5"} onChange={(event) => colorSelectedNodes(event.target.value)} /></label>
            <div className="mind-map-inspector-actions">
              <button onClick={removeSelectedNodes}>删除选中主题</button>
              <button onClick={() => setSelectedIds([])}>取消多选</button>
            </div>
          </div> : selectedRelation ? <div className="mind-map-inspector mind-map-relation-inspector">
            <label>连线文字<input autoFocus aria-label="连线文字" maxLength={500} value={selectedRelation.label || ""} onChange={(event) => patchRelation(selectedRelation.id, { label: event.target.value })} /></label>
            <label>连线备注<textarea aria-label="连线备注" maxLength={2000} value={selectedRelation.note || ""} onChange={(event) => patchRelation(selectedRelation.id, { note: event.target.value })} placeholder="补充这条关系的说明" /></label>
            <label>颜色<input type="color" aria-label="连线颜色" value={selectedRelation.lineColor || RELATION_DEFAULT_COLOR} onChange={(event) => patchRelation(selectedRelation.id, { lineColor: event.target.value })} /></label>
            <label>标签颜色<input type="color" aria-label="连线标签颜色" value={selectedRelation.labelColor || RELATION_DEFAULT_LABEL_COLOR} onChange={(event) => patchRelation(selectedRelation.id, { labelColor: event.target.value })} /></label>
            <label>线型<select aria-label="连线线型" value={selectedRelation.linePattern ?? "dash"} onChange={(event) => patchRelation(selectedRelation.id, { linePattern: event.target.value as MindMapRelationLinePattern })}>
              <option value="solid">实线</option><option value="dash">虚线</option><option value="dot">点线</option>
            </select></label>
            <label>形状<select aria-label="连线形状" value={selectedRelation.shape ?? "curved"} onChange={(event) => patchRelation(selectedRelation.id, { shape: event.target.value as MindMapRelationShape })}>
              <option value="curved">曲线</option><option value="straight">直线</option><option value="elbow">折线</option>
            </select></label>
            <label>箭头<select aria-label="连线箭头" value={`${selectedRelation.arrowBegin ?? "none"}-${selectedRelation.arrowEnd ?? "triangle"}`} onChange={(event) => {
              const value = event.target.value;
              const arrowBegin: MindMapRelationArrow = value === "triangle-none" || value === "triangle-triangle" ? "triangle" : "none";
              const arrowEnd: MindMapRelationArrow = value === "none-triangle" || value === "triangle-triangle" ? "triangle" : "none";
              patchRelation(selectedRelation.id, { arrowBegin, arrowEnd });
            }}>
              <option value="none-none">无箭头</option>
              <option value="none-triangle">终点箭头（单向）</option>
              <option value="triangle-none">起点箭头（单向）</option>
              <option value="triangle-triangle">双向箭头</option>
            </select></label>
            <label>线宽<select aria-label="连线线宽" value={String(selectedRelation.lineWidth ?? 2)} onChange={(event) => patchRelation(selectedRelation.id, { lineWidth: Number(event.target.value) })}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((width) => <option key={width} value={String(width)}>{width} px</option>)}
            </select></label>
            <label>文字样式<select aria-label="连线文字样式" value={selectedRelation.labelFontStyle ?? "italic"} onChange={(event) => patchRelation(selectedRelation.id, { labelFontStyle: event.target.value as MindMapRelationFontStyle })}>
              <option value="normal">常规</option><option value="italic">斜体</option>
            </select></label>
            <div className="mind-map-inspector-actions">
              <button onClick={removeRelation}>删除关系线</button>
              <button onClick={() => setSelectedRelationId("")}>取消选中</button>
            </div>
            <p>当前选中的是「关系线」（任意两节点间的连线），与父子主题之间的实线树边不同；改动会自动保存。</p>
          </div> : relationMode ? <div className="mind-map-inspector">
            <p>连线模式：{relationSourceId ? "已选起点，请点击终点节点；重复点击起点不会创建连线。" : "请点击起点节点，再点击终点节点。"} 按 Esc 取消。</p>
          </div> : selectedNode && <div className="mind-map-inspector">
            <label>主题文字<input aria-label="选中主题文字" value={selectedNode.text} onChange={(event) => patchNode(selectedNode.id, { text: event.target.value })} /></label>
            <label>备注<textarea aria-label="主题备注" value={selectedNode.note} onChange={(event) => patchNode(selectedNode.id, { note: event.target.value })} placeholder="补充设定、线索或待接上的思路" /></label>
            <label>颜色<input type="color" aria-label="主题颜色" value={selectedNode.color || "#dce9f5"} onChange={(event) => patchNode(selectedNode.id, { color: event.target.value })} /></label>
            {selectedNode.parentId === map.rootId && <label>分支方向<select aria-label="分支方向" value={selectedNode.side} onChange={(event) => patchNode(selectedNode.id, { side: event.target.value as MindMapSide })}><option value="left">左侧</option><option value="right">右侧</option></select></label>}
            <div className="mind-map-inspector-actions">
              <button onClick={() => addChild()}>添加子主题</button>
              <button disabled={selectedNode.id === map.rootId} onClick={addSibling}>添加同级</button>
              <button disabled={!childCount} onClick={() => toggleCollapse(selectedNode.id)}>{selectedNode.collapsed ? "展开分支" : "折叠分支"}</button>
              <button disabled={selectedNode.id === map.rootId} onClick={removeNode}>删除主题</button>
            </div>
            <p>快捷键：Tab 子主题 · Enter 同级 · F2 改名 · Delete 删除 · Ctrl+Z/Y 撤销重做 · Ctrl+C/V 复制粘贴 · Ctrl+A 全选；Shift 拖空白框选、右键打开菜单、拖动节点自由摆放。改动会自动保存。</p>
          </div>}
        </div>
      </div>}

    {contextMenu && map && <div className="mind-map-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}
      onMouseDown={(event) => event.stopPropagation()}>
      {contextMenu.kind === "node" && <>
        <button onClick={() => runMenu(() => addChild(contextMenu.targetId))}>在此添加子主题</button>
        <button disabled={contextMenu.targetId === map.rootId} onClick={() => runMenu(() => addSibling())}>在此添加同级</button>
        <button onClick={() => runMenu(() => (selectedIds.length > 1 ? removeSelectedNodes() : removeNode()))}>删除此主题</button>
        <button onClick={() => runMenu(() => copyFromMenu(contextMenu.targetId))}>复制主题及子树</button>
        <button disabled={!clipboardCount} onClick={() => runMenu(() => pasteClipboard(contextMenu.targetId))}>粘贴到此主题</button>
        <button disabled={contextMenu.targetId === map.rootId || !map.nodes.find((node) => node.id === contextMenu.targetId)?.parentId}
          onClick={() => runMenu(() => detachFromParent(contextMenu.targetId))}>从父主题断开，独立成块</button>
        <button onClick={() => runMenu(() => {
          setRelationMode(true);
          setRelationSourceId(contextMenu.targetId);
          setSelectedRelationId("");
          onStatus("已以该主题为起点进入连线模式，请点击终点节点。");
        })}>从此主题连线</button>
      </>}
      {contextMenu.kind === "relation" && <>
        <button onClick={() => runMenu(() => {
          setSelectedRelationId(contextMenu.targetId);
          setSelectedId("");
          window.setTimeout(() => document.querySelector<HTMLInputElement>('input[aria-label="连线文字"]')?.focus(), 0);
        })}>编辑连线文字</button>
        <button onClick={() => runMenu(() => removeRelation())}>删除此连线</button>
      </>}
      {contextMenu.kind === "canvas" && <>
        <button onClick={() => runMenu(() => addCenterTopic())}>新建独立中心主题</button>
        <button disabled={!clipboardCount} onClick={() => runMenu(() => pasteClipboard(map.rootId))}>粘贴到中心主题</button>
        <button onClick={() => runMenu(() => setSelectedIds(map.nodes.map((node) => node.id)))}>全选主题</button>
      </>}
    </div>}
  </section>;
}

