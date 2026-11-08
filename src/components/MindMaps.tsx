import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from "react";
import type { CreativeWorkspaceState, MindMap, MindMapNode, MindMapSide, XMindImportSheet } from "../types";
import type { PageSaveHandle, PageSaveKind } from "../hooks/useEntityDraft";
import { useWorkspaceDraft } from "../hooks/useWorkspaceDraft";
import {
  createMindMap, createMindMapNode, descendants, layoutMindMap,
  MIND_NODE_HEIGHT, MIND_NODE_WIDTH,
} from "../lib/mind-map";

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function MindMaps({ workspace, onWorkspace, onRegisterSave, onStatus, fullscreen = false }: {
  workspace: CreativeWorkspaceState;
  onWorkspace: (value: CreativeWorkspaceState) => void;
  onRegisterSave: (kind: PageSaveKind, handle: PageSaveHandle | null) => void;
  onStatus: (message: string) => void;
  fullscreen?: boolean;
}) {
  const board = useWorkspaceDraft<MindMap>("mind-map", "mindMaps", workspace, onWorkspace, onRegisterSave, createMindMap);
  const map = board.draft;
  const [selectedId, setSelectedId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 24, y: 24 });
  const [xmindPreview, setXmindPreview] = useState<{ fileName: string; sheets: XMindImportSheet[] } | null>(null);
  const [sheetChoice, setSheetChoice] = useState("all");
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const pan = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const layout = useMemo(() => map ? layoutMindMap(map) : { nodes: [], edges: [], width: 900, height: 520 }, [map]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const selectedNode = map?.nodes.find((node) => node.id === selectedId) || null;

  const fitView = useCallback(() => {
    const element = canvasRef.current;
    const current = layoutRef.current;
    if (!element || !current.width) return;
    const next = Math.min(1, Math.max(0.35, Math.min((element.clientWidth - 32) / current.width, (element.clientHeight - 32) / current.height)));
    setScale(next);
    setOffset({ x: (element.clientWidth - current.width * next) / 2, y: (element.clientHeight - current.height * next) / 2 });
  }, []);

  useEffect(() => {
    setSelectedId(map?.rootId || "");
    setEditingId("");
    // 等布局稳定后再测量画布，避免属性区撑开时按旧高度计算居中偏移。
    const frame = window.requestAnimationFrame(fitView);
    return () => window.cancelAnimationFrame(frame);
  }, [board.activeId, map?.rootId, fitView]);

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

  const mutateNodes = useCallback((change: (nodes: MindMapNode[]) => MindMapNode[]) => {
    board.update((previous) => ({ ...previous, updatedAt: new Date().toISOString(), nodes: change(previous.nodes) }));
  }, [board]);

  const patchNode = useCallback((id: string, patch: Partial<MindMapNode>) => {
    mutateNodes((nodes) => nodes.map((node) => node.id === id ? { ...node, ...patch } : node));
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
    mutateNodes((nodes) => [...nodes, { ...node, parentId: parent.id, collapsed: false }]);
    if (parent.collapsed) patchNode(parent.id, { collapsed: false });
    setSelectedId(node.id);
    setEditingId(node.id);
  }, [map, selectedId, mutateNodes, patchNode]);

  const addSibling = useCallback(() => {
    if (!map || !selectedNode || selectedNode.id === map.rootId) return;
    addChild(selectedNode.parentId);
  }, [map, selectedNode, addChild]);

  const removeNode = useCallback(() => {
    if (!map || !selectedNode || selectedNode.id === map.rootId) return;
    const removed = new Set([selectedNode.id, ...descendants(map, selectedNode.id)]);
    mutateNodes((nodes) => nodes.filter((node) => !removed.has(node.id)));
    setSelectedId(map.rootId);
    setEditingId("");
  }, [map, selectedNode, mutateNodes]);

  const toggleCollapse = useCallback((id: string) => {
    const node = map?.nodes.find((item) => item.id === id);
    if (node) patchNode(id, { collapsed: !node.collapsed });
  }, [map, patchNode]);

  const setAllCollapsed = useCallback((collapsed: boolean) => {
    if (!map) return;
    mutateNodes((nodes) => nodes.map((node) => node.id === map.rootId || node.parentId === map.rootId ? node : { ...node, collapsed }));
  }, [map, mutateNodes]);

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

  function onCanvasKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement).tagName)) return;
    if (event.key === "Tab") { event.preventDefault(); addChild(); }
    else if (event.key === "Enter") { event.preventDefault(); addSibling(); }
    else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeNode(); }
    else if (event.key === "F2") { event.preventDefault(); if (selectedId) setEditingId(selectedId); }
  }

  function onCanvasMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(".mind-map-node") || target.closest("button") || target.closest("input")) return;
    pan.current = { x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y };
  }
  function onCanvasMouseMove(event: ReactMouseEvent<HTMLDivElement>) {
    if (!pan.current) return;
    setOffset({ x: pan.current.originX + event.clientX - pan.current.x, y: pan.current.originY + event.clientY - pan.current.y });
  }
  function onCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    setScale((value) => Math.max(0.3, Math.min(2.2, value * (event.deltaY < 0 ? 1.1 : 0.9))));
  }

  const childCount = map && selectedNode ? map.nodes.filter((node) => node.parentId === selectedNode.id).length : 0;

  return <section className={`mind-map-panel ${fullscreen ? "fullscreen" : ""} ${showInspector ? "" : "inspector-compact"}`} aria-label="思维导图">
    <header className="mind-map-toolbar">
      <select aria-label="选择思维导图" value={board.activeId} onChange={(event) => { if (event.target.value) void board.select(event.target.value); }}>
        <option value="">选择已创建的导图</option>
        {board.items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
      <button onClick={() => void board.create()}>新建思维导图</button>
      <button onClick={() => void chooseXMind()}>导入 XMind</button>
      <button disabled={importing} onClick={() => void generateFromRelations()}>从角色关系生成</button>
      <button disabled={!map} onClick={() => void removeBoard()}>删除此导图</button>
      <label>名称<input aria-label="思维导图名称" maxLength={160} value={map?.title || ""} onChange={(event) => board.update((previous) => ({ ...previous, title: event.target.value, updatedAt: new Date().toISOString() }))} /></label>
      <span role="status" aria-live="polite">{board.saveState}</span>
      <button onClick={fitView}>适应画布</button>
      <button onClick={() => setShowInspector((value) => !value)}>{showInspector ? "精简属性区" : "展开属性区"}</button>
      <button onClick={() => setAllCollapsed(false)}>展开全部</button>
      <button onClick={() => setAllCollapsed(true)}>折叠全部</button>
    </header>

    {importError && <p className="mind-map-import-error" role="alert">{importError}</p>}
    {xmindPreview && <section className="mind-map-import-preview" aria-label="XMind 导入预览">
      <header><strong>导入预览：{xmindPreview.fileName}</strong><span>共 {xmindPreview.sheets.length} 个画布</span></header>
      <label>导入范围<select aria-label="导入画布范围" value={sheetChoice} onChange={(event) => setSheetChoice(event.target.value)}>
        <option value="all">全部导入（{xmindPreview.sheets.length} 张）</option>
        {xmindPreview.sheets.map((sheet, index) => <option key={`${sheet.title}-${index}`} value={String(index)}>{sheet.title}</option>)}
      </select></label>
      <ul>{xmindPreview.sheets.map((sheet, index) => <li key={`${sheet.title}-${index}`}>
        <strong>{sheet.title}</strong><span>中心：{sheet.rootText} · {sheet.nodeCount} 个主题{sheet.truncated ? " · 已按上限截断" : ""}</span>
      </li>)}</ul>
      <div className="mind-map-import-actions">
        <button onClick={() => setXmindPreview(null)}>放弃 XMind 导入</button>
        <button className="primary" disabled={importing} onClick={() => void confirmXMind()}>确认导入 XMind</button>
      </div>
    </section>}

    {!map ? <div className="mind-map-empty"><p>还没有思维导图。</p><button onClick={() => void board.create()}>创建第一张思维导图</button></div> :
      <div className="mind-map-body">
        <aside className="mind-map-list" aria-label="已创建的思维导图">
          <header><strong>我的思维导图</strong><span>{board.items.length} 张</span></header>
          {board.items.map((item) => <button key={item.id} className={item.id === board.activeId ? "active" : ""} onClick={() => void board.select(item.id)}>
            <strong>{item.title}</strong>
            <span>{item.nodes.length} 个主题 · {formatTime(item.updatedAt)}</span>
          </button>)}
          {!board.items.length && <p>点击上方「新建思维导图」创建第一张。</p>}
        </aside>

        <div className="mind-map-main">
          <div ref={canvasRef} className="mind-map-canvas" tabIndex={0} role="application" aria-label="思维导图画布"
            onKeyDown={onCanvasKeyDown} onMouseDown={onCanvasMouseDown} onMouseMove={onCanvasMouseMove}
            onMouseUp={() => { pan.current = null; }} onMouseLeave={() => { pan.current = null; }} onWheel={onCanvasWheel}>
            <div className="mind-map-world" style={{ width: layout.width, height: layout.height, transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}>
              <svg className="mind-map-links" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
                {layout.edges.map((edge) => <path key={edge.id} fill="none" strokeWidth={2}
                  stroke={edge.color || "var(--line)"}
                  d={`M ${edge.x1} ${edge.y1} C ${(edge.x1 + edge.x2) / 2} ${edge.y1}, ${(edge.x1 + edge.x2) / 2} ${edge.y2}, ${edge.x2} ${edge.y2}`} />)}
              </svg>
              {layout.nodes.map((item) => <div key={item.id}
                className={`mind-map-node ${item.side === "center" ? "root" : ""} ${item.id === selectedId ? "selected" : ""}`}
                style={{ left: item.x - MIND_NODE_WIDTH / 2, top: item.y - MIND_NODE_HEIGHT / 2, width: MIND_NODE_WIDTH, height: MIND_NODE_HEIGHT, ...(item.node.color ? { backgroundColor: item.node.color } : {}) }}
                onClick={() => setSelectedId(item.id)} onDoubleClick={() => setEditingId(item.id)}>
                {editingId === item.id ? <input autoFocus aria-label="编辑主题文字" value={item.node.text}
                  onChange={(event) => patchNode(item.id, { text: event.target.value })}
                  onBlur={() => setEditingId("")}
                  onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter" || event.key === "Escape") setEditingId(""); }} /> :
                  <span title={item.node.note || item.node.text}>{item.node.text}</span>}
                {item.childCount > 0 && <button className="mind-node-fold" aria-label={`${item.node.collapsed ? "展开" : "折叠"}主题：${item.node.text}`}
                  onClick={(event) => { event.stopPropagation(); toggleCollapse(item.id); }}>{item.node.collapsed ? "+" : "−"}</button>}
              </div>)}
            </div>
          </div>

          {selectedNode && <div className="mind-map-inspector">
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
            <p>快捷键：Tab 子主题 · Enter 同级 · F2 改名 · Delete 删除；双击节点改名，滚轮缩放，拖动空白处移动画布。改动会自动保存。</p>
          </div>}
        </div>
      </div>}
  </section>;
}
