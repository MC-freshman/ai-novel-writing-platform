import {
  BarChart3,
  Check,
  Download,
  GitBranch,
  GripVertical,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AppState,
  CausalEdge,
  CausalNode,
  ChapterQualityReport,
  CreativeWorkspaceState,
  ProjectExchangePreview,
  SafeRevision,
  ScenePlan,
} from "../types";

export type CreativeWorkspaceTab = "planning" | "causality" | "revisions" | "annotations" | "memories" | "quality" | "exchange";

const TABS: Array<{ id: CreativeWorkspaceTab; label: string }> = [
  { id: "planning", label: "规划" },
  { id: "causality", label: "脉络" },
  { id: "revisions", label: "修订" },
  { id: "annotations", label: "批注" },
  { id: "memories", label: "记忆" },
  { id: "quality", label: "诊断" },
  { id: "exchange", label: "项目交换" },
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function compactText(value: string, limit = 180) {
  const text = String(value || "").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function revisionParts(item: SafeRevision) {
  const split = (value: string) => (String(value || "").match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || []).map((part) => part.trim()).filter(Boolean);
  const originals = split(item.original);
  const replacements = split(item.replacement);
  const accepted = new Set((item.acceptedParts || []).map((part) => `${part.original}\u0000${part.replacement}`));
  return Array.from({ length: Math.max(originals.length, replacements.length) }, (_, index) => ({ original: originals[index] || "", replacement: replacements[index] || "" }))
    .filter((part) => part.original && !accepted.has(`${part.original}\u0000${part.replacement}`));
}

type StoryNetworkMode = "causality" | "foreshadow" | "character" | "force";
type StoryNetworkNode = { id: string; title: string; detail: string; volume: string; x?: number; y?: number; color?: string; source: "causal" | "derived" };
type StoryNetworkEdge = { id: string; source: string; target: string; label: string; color?: string; direction?: CausalEdge["direction"]; editable: boolean };

function StoryNetworkGraph({ state, workspace, onMoveNode, onResetLayout, onSelectEdge }: {
  state: AppState;
  workspace: CreativeWorkspaceState;
  onMoveNode: (node: CausalNode, x: number, y: number) => void;
  onResetLayout: () => void;
  onSelectEdge: (edge: CausalEdge) => void;
}) {
  const [mode, setMode] = useState<StoryNetworkMode>("causality");
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [query, setQuery] = useState("");
  const [volume, setVolume] = useState("全部");
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [pan, setPan] = useState<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; startX: number; startY: number } | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const volumes = useMemo(() => ["全部", ...new Set(workspace.causalNodes.map((item) => item.volume || "未分卷"))], [workspace.causalNodes]);
  const graph = useMemo(() => {
    let nodes: StoryNetworkNode[] = [];
    let edges: StoryNetworkEdge[] = [];
    if (mode === "causality" || mode === "foreshadow") {
      const baseNodes = workspace.causalNodes.map((item) => ({ id: item.id, title: item.title, detail: item.detail, volume: item.volume || "未分卷", x: item.x, y: item.y, color: item.color, source: "causal" as const }));
      const baseEdges = workspace.causalEdges.map((item) => ({ id: item.id, source: item.source, target: item.target, label: item.relation, color: item.color, direction: item.direction, editable: true }));
      if (mode === "foreshadow") {
        const seeds = new Set(workspace.causalNodes.filter((item) => item.type === "伏笔").map((item) => item.id));
        const visibleEdges = baseEdges.filter((item) => seeds.has(item.source) || seeds.has(item.target));
        const ids = new Set([...seeds, ...visibleEdges.flatMap((item) => [item.source, item.target])]);
        nodes = baseNodes.filter((item) => ids.has(item.id));
        edges = visibleEdges;
      } else {
        nodes = baseNodes;
        edges = baseEdges;
      }
    } else if (mode === "character") {
      const byCharacter = new Map<string, typeof workspace.arcs>();
      workspace.arcs.forEach((item) => byCharacter.set(item.characterName, [...(byCharacter.get(item.characterName) || []), item]));
      for (const [characterName, items] of byCharacter) {
        const ordered = items.slice().sort((a, b) => a.order - b.order);
        ordered.forEach((item, index) => nodes.push({ id: `arc_${item.id}`, title: `${characterName} / ${item.stage}`, detail: item.change || item.desire, volume: item.chapterTitle, x: 130 + index * 190, y: 90 + [...byCharacter.keys()].indexOf(characterName) * 90, color: "#d8efe3", source: "derived" }));
        ordered.slice(1).forEach((item, index) => edges.push({ id: `arc_edge_${item.id}`, source: `arc_${ordered[index].id}`, target: `arc_${item.id}`, label: item.change || "阶段变化", color: "#2e7d5b", direction: "forward", editable: false }));
      }
    } else {
      const categories = [...new Set(state.characters.map((item) => item.category || "未分类"))];
      categories.forEach((category, index) => nodes.push({ id: `force_${category}`, title: category, detail: "角色分类/势力", volume: category, x: 180 + (index % 4) * 250, y: 100 + Math.floor(index / 4) * 180, color: "#f4e4b4", source: "derived" }));
      state.characters.forEach((card, index) => {
        const category = card.category || "未分类";
        nodes.push({ id: `force_character_${card.id}`, title: card.name, detail: card.relationships, volume: category, x: 130 + (index % 6) * 170, y: 210 + Math.floor(index / 6) * 90, color: "#dce9f5", source: "derived" });
        edges.push({ id: `force_edge_${card.id}`, source: `force_${category}`, target: `force_character_${card.id}`, label: "归属", color: "#607d8b", direction: "forward", editable: false });
      });
    }
    const keyword = query.trim().toLowerCase();
    nodes = nodes.filter((item) => (volume === "全部" || item.volume === volume) && (!keyword || `${item.title} ${item.detail}`.toLowerCase().includes(keyword))).slice(0, 500);
    const ids = new Set(nodes.map((item) => item.id));
    edges = edges.filter((item) => ids.has(item.source) && ids.has(item.target)).slice(0, 800);
    const positioned = new Map<string, StoryNetworkNode & { x: number; y: number }>();
    nodes.forEach((item, index) => positioned.set(item.id, { ...item, x: overrides[item.id]?.x ?? item.x ?? 140 + (index % 5) * 200, y: overrides[item.id]?.y ?? item.y ?? 90 + Math.floor(index / 5) * 100 }));
    return { nodes: [...positioned.values()], edges, positions: positioned, width: 1120, height: Math.max(560, 180 + Math.ceil(nodes.length / 5) * 100) };
  }, [mode, overrides, query, state.characters, volume, workspace.arcs, workspace.causalEdges, workspace.causalNodes]);

  function finishPointer() {
    if (drag) {
      const node = workspace.causalNodes.find((item) => item.id === drag.id);
      const position = overrides[drag.id] || graph.positions.get(drag.id);
      if (node && position) onMoveNode(node, position.x, position.y);
    }
    setDrag(null);
    setPan(null);
  }

  return <section className="story-network-panel">
    <header><div className="story-network-modes">{([['causality', '因果图'], ['foreshadow', '伏笔图'], ['character', '人物弧线'], ['force', '势力图']] as Array<[StoryNetworkMode, string]>).map(([id, label]) => <button key={id} className={mode === id ? "active" : ""} onClick={() => { setMode(id); setVolume("全部"); }}>{label}</button>)}</div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选节点" />{(mode === "causality" || mode === "foreshadow") && <select value={volume} onChange={(event) => setVolume(event.target.value)}>{volumes.map((item) => <option key={item}>{item}</option>)}</select>}<span>{graph.nodes.length} 节点 / {graph.edges.length} 连线 / {Math.round(scale * 100)}%</span><button onClick={() => { setOverrides({}); setOffset({ x: 0, y: 0 }); setScale(1); onResetLayout(); }}>自动布局</button></header>
    <div ref={shellRef} className="story-network-canvas" onWheel={(event) => { event.preventDefault(); event.stopPropagation(); setScale((value) => Math.max(0.3, Math.min(2.5, value * (event.deltaY < 0 ? 1.1 : 0.9)))); }} onMouseDown={(event) => { if (event.button === 0) setPan({ x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y }); }} onMouseMove={(event) => { if (drag) { const ratio = graph.width / Math.max(1, shellRef.current?.clientWidth || graph.width); setOverrides((items) => ({ ...items, [drag.id]: { x: drag.x + ((event.clientX - drag.startX) * ratio) / scale, y: drag.y + ((event.clientY - drag.startY) * ratio) / scale } })); return; } if (pan) setOffset({ x: pan.offsetX + event.clientX - pan.x, y: pan.offsetY + event.clientY - pan.y }); }} onMouseUp={finishPointer} onMouseLeave={finishPointer}>
      <svg viewBox={`0 0 ${graph.width} ${graph.height}`}><defs><marker id="story-network-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" /></marker></defs><g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>{graph.edges.map((edge) => { const source = graph.positions.get(edge.source); const target = graph.positions.get(edge.target); if (!source || !target) return null; const centerX = (source.x + target.x) / 2; const centerY = (source.y + target.y) / 2; return <g key={edge.id} className={edge.editable ? "editable" : ""} onClick={() => { const original = workspace.causalEdges.find((item) => item.id === edge.id); if (original) onSelectEdge(original); }}><line x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke={edge.color || "#64748b"} markerEnd={["forward", "both"].includes(edge.direction || "none") ? "url(#story-network-arrow)" : undefined} markerStart={["backward", "both"].includes(edge.direction || "none") ? "url(#story-network-arrow)" : undefined} /><text x={centerX} y={centerY - 6} textAnchor="middle">{edge.label}</text></g>; })}{graph.nodes.map((node) => <g key={node.id} className="story-network-node" onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); setDrag({ id: node.id, x: node.x, y: node.y, startX: event.clientX, startY: event.clientY }); }}><rect x={node.x - 72} y={node.y - 24} width={144} height={48} rx={6} style={{ fill: node.color || "#e5eef4" }} /><text x={node.x} y={node.y + 4} textAnchor="middle">{node.title.slice(0, 16)}</text><title>{node.detail || node.title}</title></g>)}</g></svg>
    </div>
  </section>;
}

export function CreativeWorkspace({
  state,
  selectedChapterId,
  selectedText,
  chapterRevision,
  initialTab = "planning",
  onApplyState,
  onOpenChapter,
  onStatus,
}: {
  state: AppState;
  selectedChapterId: string;
  selectedText: string;
  chapterRevision: string;
  initialTab?: CreativeWorkspaceTab;
  onApplyState: (state: AppState) => void;
  onOpenChapter: (chapterId: string) => void;
  onStatus: (message: string) => void;
}) {
  const [tab, setTab] = useState<CreativeWorkspaceTab>(initialTab);
  const [workspace, setWorkspace] = useState<CreativeWorkspaceState | null>(null);
  const [chapterId, setChapterId] = useState(selectedChapterId || state.chapters[0]?.id || "");
  const [busy, setBusy] = useState("");
  const [dragSceneId, setDragSceneId] = useState("");
  const [dropSceneId, setDropSceneId] = useState("");
  const [sceneDraft, setSceneDraft] = useState({ title: "", pov: "", location: "", goal: "", conflict: "", turn: "", outcome: "" });
  const [nodeDraft, setNodeDraft] = useState({ type: "事件", title: "", detail: "" });
  const [edgeDraft, setEdgeDraft] = useState({ id: "", source: "", target: "", relation: "导致", detail: "", color: "#64748b", direction: "forward" as CausalEdge["direction"] });
  const [arcDraft, setArcDraft] = useState({ characterName: "", stage: "当前阶段", desire: "", change: "" });
  const [revisionDraft, setRevisionDraft] = useState({ action: "润色" as "改写" | "润色" | "扩写" | "精简", instruction: "", original: selectedText });
  const [annotationDraft, setAnnotationDraft] = useState({ quote: selectedText, comment: "", type: "作者批注" });
  const [memoryDraft, setMemoryDraft] = useState({ scope: "全书", title: "", content: "", locked: true });
  const [qualityReports, setQualityReports] = useState<ChapterQualityReport[]>([]);
  const [statisticsCompareId, setStatisticsCompareId] = useState("");
  const [exchangePreview, setExchangePreview] = useState<ProjectExchangePreview | null>(null);
  const [exchangeUnlock, setExchangeUnlock] = useState<{ token: string; filePath: string } | null>(null);
  const [exchangePassword, setExchangePassword] = useState("");
  const [exportPassword, setExportPassword] = useState("");
  const [exchangeSelection, setExchangeSelection] = useState({ chapters: true, characters: true, world: true, materials: true, workspace: true });

  const chapter = state.chapters.find((item) => item.id === chapterId) || state.chapters[0];
  const scenes = useMemo(
    () => (workspace?.scenes || []).filter((item) => item.chapterId === chapter?.id).slice().sort((a, b) => a.order - b.order),
    [chapter?.id, workspace?.scenes],
  );
  const latestStatistics = workspace?.statisticsHistory[0] || null;
  const comparedStatistics = workspace?.statisticsHistory.find((item) => item.id === statisticsCompareId) || null;

  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => {
    setChapterId((current) => state.chapters.some((item) => item.id === current) ? current : selectedChapterId || state.chapters[0]?.id || "");
  }, [selectedChapterId, state.chapters]);
  useEffect(() => {
    if (selectedText) {
      setRevisionDraft((current) => ({ ...current, original: selectedText }));
      setAnnotationDraft((current) => ({ ...current, quote: selectedText }));
    }
  }, [selectedText]);

  async function loadWorkspace() {
    try {
      setWorkspace(await window.novelAPI.getCreativeWorkspace());
    } catch (error) {
      onStatus(`读取创作工作台失败：${errorMessage(error)}`);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, [state.projectPath]);

  async function upsert(collection: "scenes" | "causalNodes" | "causalEdges" | "arcs" | "annotations" | "memories", item: Record<string, unknown>) {
    const result = await window.novelAPI.upsertCreativeWorkspaceItem({ collection, item });
    setWorkspace(result.workspace);
    return result.item;
  }

  async function remove(collection: "scenes" | "causalNodes" | "causalEdges" | "arcs" | "annotations" | "memories" | "revisions", itemId: string) {
    const result = await window.novelAPI.deleteCreativeWorkspaceItem({ collection, itemId });
    setWorkspace(result.workspace);
  }

  async function addScene() {
    if (!chapter || !sceneDraft.title.trim()) return onStatus("请先填写场景名称。");
    setBusy("scene");
    try {
      await upsert("scenes", { ...sceneDraft, chapterId: chapter.id, chapterTitle: chapter.title, order: scenes.length, status: "计划中" });
      setSceneDraft({ title: "", pov: "", location: "", goal: "", conflict: "", turn: "", outcome: "" });
      onStatus("场景计划已保存");
    } catch (error) {
      onStatus(`保存场景失败：${errorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function reorderScene(targetId: string) {
    if (!dragSceneId || !chapter || dragSceneId === targetId) return;
    const ids = scenes.map((item) => item.id);
    const from = ids.indexOf(dragSceneId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setDropSceneId("");
    setDragSceneId("");
    const result = await window.novelAPI.reorderScenes({ chapterId: chapter.id, sceneIds: ids });
    setWorkspace(result.workspace);
    onStatus("场景顺序已调整");
  }

  async function rebuildCausality() {
    setBusy("causality");
    try {
      const result = await window.novelAPI.rebuildCausality();
      setWorkspace(result.workspace);
      onStatus(`已整理 ${result.nodes.length} 个剧情节点和 ${result.edges.length} 条连接`);
    } catch (error) {
      onStatus(`整理剧情脉络失败：${errorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function addEdge() {
    if (!edgeDraft.source || !edgeDraft.target || edgeDraft.source === edgeDraft.target) return onStatus("请选择两个不同的剧情节点。");
    await upsert("causalEdges", { ...edgeDraft, origin: "manual", locked: true });
    setEdgeDraft({ id: "", source: "", target: "", relation: "导致", detail: "", color: "#64748b", direction: "forward" });
    onStatus(edgeDraft.id ? "因果关系已更新" : "因果关系已保存");
  }

  async function moveCausalNode(node: CausalNode, x: number, y: number) {
    try {
      await upsert("causalNodes", { ...node, x, y });
    } catch (error) {
      onStatus(`保存节点位置失败：${errorMessage(error)}`);
    }
  }

  async function resetCausalLayout() {
    if (!workspace) return;
    for (const node of workspace.causalNodes.filter((item) => item.x !== undefined || item.y !== undefined)) {
      await upsert("causalNodes", { ...node, x: undefined, y: undefined });
    }
  }

  async function addCausalNode() {
    if (!nodeDraft.title.trim()) return onStatus("请填写剧情节点名称。");
    await upsert("causalNodes", {
      ...nodeDraft,
      chapterId: chapter?.id || "",
      chapterTitle: chapter?.title || "",
      volume: chapter?.volume || "未分卷",
      order: Number(chapter?.order || 0) * 1000 + (workspace?.causalNodes.length || 0),
      origin: "manual",
      locked: true,
    });
    setNodeDraft({ type: "事件", title: "", detail: "" });
    onStatus("手工剧情节点已保存并锁定");
  }

  async function addArc() {
    if (!arcDraft.characterName.trim()) return onStatus("请填写角色名称。");
    await upsert("arcs", {
      ...arcDraft,
      chapterId: chapter?.id || "",
      chapterTitle: chapter?.title || "",
      order: Number(chapter?.order || 0),
      origin: "manual",
      locked: true,
      status: "进行中",
    });
    setArcDraft({ characterName: "", stage: "当前阶段", desire: "", change: "" });
    onStatus("手工角色弧线节点已保存并锁定");
  }

  async function generateArcs() {
    setBusy("arcs");
    try {
      const result = await window.novelAPI.generateCharacterArcs();
      setWorkspace(result.workspace);
      onStatus(`已按角色状态整理 ${result.arcs.length} 个弧线节点`);
    } catch (error) {
      onStatus(`整理角色弧线失败：${errorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function createRevision() {
    if (!chapter || !revisionDraft.original.trim()) return onStatus("请先选中或填写要修订的原文。");
    setBusy("revision");
    try {
      const result = await window.novelAPI.createSafeRevision({
        chapterId: chapter.id,
        original: revisionDraft.original,
        sourceRevision: chapter.id === selectedChapterId ? chapterRevision : "",
        action: revisionDraft.action,
        instruction: revisionDraft.instruction,
      });
      await loadWorkspace();
      onStatus(`已生成安全修订：${result.action}，请对照后决定是否采纳`);
    } catch (error) {
      await loadWorkspace();
      onStatus(`生成修订失败：${errorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function applyRevision(item: SafeRevision) {
    if (!window.confirm(`确定把这条“${item.action}”结果写入《${item.chapterTitle}》吗？应用前会自动保存历史版本。`)) return;
    setBusy(item.id);
    try {
      const result = await window.novelAPI.applySafeRevision(item.id);
      setWorkspace(await window.novelAPI.getCreativeWorkspace());
      onApplyState(result.state);
      onStatus("安全修订已应用，原章节版本已经保留");
    } catch (error) {
      await loadWorkspace();
      onStatus(`应用修订失败：${errorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function applyRevisionPart(item: SafeRevision, original: string, replacement: string) {
    if (!window.confirm("只把这一部分建议写入正文吗？应用前会自动保存章节版本。")) return;
    setBusy(item.id);
    try {
      const result = await window.novelAPI.applySafeRevisionPart({ revisionId: item.id, original, replacement });
      setWorkspace(result.workspace);
      onApplyState(result.state);
      onStatus("已局部采纳修订，其余建议仍保留待处理");
    } catch (error) {
      await loadWorkspace();
      onStatus(`局部采纳失败：${errorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function rejectRevision(item: SafeRevision) {
    const result = await window.novelAPI.updateRevisionStatus({ revisionId: item.id, status: "已拒绝" });
    setWorkspace(result.workspace);
    onStatus("修订建议已拒绝，正文未变化");
  }

  async function addAnnotation() {
    if (!chapter || !annotationDraft.quote.trim() || !annotationDraft.comment.trim()) return onStatus("批注需要原文和批注内容。");
    await upsert("annotations", {
      ...annotationDraft,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      sourceRevision: chapter.id === selectedChapterId ? chapterRevision : "",
      status: "待处理",
      origin: "manual",
    });
    setAnnotationDraft((current) => ({ ...current, comment: "" }));
    onStatus("批注已保存，不会修改正文");
  }

  async function addMemory() {
    if (!memoryDraft.title.trim() || !memoryDraft.content.trim()) return onStatus("请填写记忆标题和内容。");
    const scopeId = memoryDraft.scope === "章节" ? chapter?.id || "" : memoryDraft.scope === "分卷" ? chapter?.volume || "未分卷" : "";
    const scopeLabel = memoryDraft.scope === "章节" ? chapter?.title || "" : memoryDraft.scope === "分卷" ? chapter?.volume || "未分卷" : "全项目";
    await upsert("memories", { ...memoryDraft, scopeId, scopeLabel });
    setMemoryDraft((current) => ({ ...current, title: "", content: "" }));
    onStatus("分层记忆已保存，创作参谋会按当前章节自动选用");
  }

  async function runQuality() {
    setBusy("quality");
    try {
      const result = await window.novelAPI.getChapterQualityReports();
      setQualityReports(result.reports);
      onStatus(`已完成 ${result.reports.length} 个文档的本地质量诊断`);
    } catch (error) {
      onStatus(`章节诊断失败：${errorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function runStatistics() {
    setBusy("statistics");
    try {
      const result = await window.novelAPI.generateCreativeStatistics();
      setWorkspace(result.workspace);
      onStatus(`创作统计已保存：${result.snapshot.metrics.length} 个文档`);
    } catch (error) {
      onStatus(`创作统计失败：${errorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function exportExchange() {
    setBusy("exchange");
    try {
      const result = await window.novelAPI.exportProjectExchange({ includeWorkspace: true, password: exportPassword.trim() || undefined });
      if (!result.canceled) onStatus(`项目交换包已导出：${result.filePath}`);
    } catch (error) {
      onStatus(`导出交换包失败：${errorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function previewExchange() {
    setBusy("exchange");
    try {
      const result = await window.novelAPI.previewProjectExchange();
      if ("canceled" in result) return;
      if (result.requiresPassword) {
        setExchangePreview(null);
        setExchangeUnlock({ token: result.token, filePath: result.filePath });
        setExchangePassword("");
        return;
      }
      setExchangeUnlock(null);
      setExchangePreview(result);
    } catch (error) {
      onStatus(`读取交换包失败：${errorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function unlockExchange() {
    if (!exchangeUnlock || !exchangePassword) return onStatus("请输入项目交换包密码。");
    setBusy("exchange");
    try {
      const result = await window.novelAPI.previewProjectExchange({ token: exchangeUnlock.token, password: exchangePassword });
      if ("canceled" in result || result.requiresPassword) return;
      setExchangePreview(result);
      setExchangeUnlock(null);
      onStatus("加密项目交换包已解锁，可以选择要导入的内容");
    } catch (error) {
      onStatus(`解锁交换包失败：${errorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function importExchange() {
    if (!exchangePreview) return;
    const counts = exchangePreview.manifest.counts;
    if (!window.confirm(`确定导入“${exchangePreview.manifest.project.title}”吗？包含 ${counts.chapters} 个文档、${counts.characters} 个角色、${counts.worldDocs} 个世界观条目。导入前会自动建立快照，重名内容会作为副本保留。`)) return;
    setBusy("exchange");
    try {
      const result = await window.novelAPI.importProjectExchange({
        token: exchangePreview.token,
        password: exchangePreview.encrypted ? exchangePassword : undefined,
        includeChapters: exchangeSelection.chapters,
        includeCharacters: exchangeSelection.characters,
        includeWorld: exchangeSelection.world,
        includeMaterials: exchangeSelection.materials,
        includeWorkspace: exchangeSelection.workspace && exchangeSelection.chapters,
        renameMaterials: true,
      });
      onApplyState(result.state);
      setExchangePreview(null);
      await loadWorkspace();
      onStatus(`交换包导入完成：文档 ${result.imported.chapters}、角色 ${result.imported.characters}、世界观 ${result.imported.worldDocs}、素材 ${result.imported.materials}`);
    } catch (error) {
      onStatus(`导入交换包失败：${errorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="creative-workspace-view">
      <div className="creative-workspace-tabs">
        {TABS.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}
      </div>
      <div className="creative-workspace-toolbar">
        {tab !== "exchange" && <select value={chapter?.id || ""} onChange={(event) => setChapterId(event.target.value)}>{state.chapters.map((item) => <option key={item.id} value={item.id}>{item.volume || "未分卷"} / {item.title}</option>)}</select>}
        <span>{busy ? "正在处理..." : workspace?.updatedAt ? "已保存" : "正在读取"}</span>
      </div>

      <div className="creative-workspace-content">
        {tab === "planning" && <div className="workspace-two-columns">
          <form className="workspace-editor" onSubmit={(event) => { event.preventDefault(); void addScene(); }}>
            <header><strong>新场景</strong><span>按目标、冲突、转折和结果拆解章节</span></header>
            <input value={sceneDraft.title} onChange={(event) => setSceneDraft({ ...sceneDraft, title: event.target.value })} placeholder="场景名称" />
            <div className="workspace-field-pair"><input value={sceneDraft.pov} onChange={(event) => setSceneDraft({ ...sceneDraft, pov: event.target.value })} placeholder="视角人物" /><input value={sceneDraft.location} onChange={(event) => setSceneDraft({ ...sceneDraft, location: event.target.value })} placeholder="地点" /></div>
            <textarea value={sceneDraft.goal} onChange={(event) => setSceneDraft({ ...sceneDraft, goal: event.target.value })} placeholder="本场目标" />
            <textarea value={sceneDraft.conflict} onChange={(event) => setSceneDraft({ ...sceneDraft, conflict: event.target.value })} placeholder="阻力或冲突" />
            <textarea value={sceneDraft.turn} onChange={(event) => setSceneDraft({ ...sceneDraft, turn: event.target.value })} placeholder="转折" />
            <textarea value={sceneDraft.outcome} onChange={(event) => setSceneDraft({ ...sceneDraft, outcome: event.target.value })} placeholder="结果与下一场承接" />
            <button className="primary" disabled={busy === "scene"}><Plus size={14} />添加场景</button>
          </form>
          <div className="workspace-list scene-plan-list">
            {scenes.map((item) => <article key={item.id} draggable onDragStart={() => setDragSceneId(item.id)} onDragOver={(event) => { event.preventDefault(); setDropSceneId(item.id); }} onDrop={() => void reorderScene(item.id)} className={dropSceneId === item.id ? "drop-target" : ""}>
              <GripVertical size={15} /><div><strong>{item.order + 1}. {item.title}</strong><span>{[item.pov, item.location, item.status].filter(Boolean).join(" / ")}</span><p>{compactText([item.goal, item.conflict, item.turn, item.outcome].filter(Boolean).join(" -> "))}</p></div>
              <select value={item.status} onChange={(event) => void upsert("scenes", { ...item, status: event.target.value })}>{["计划中", "写作中", "已完成", "暂缓"].map((status) => <option key={status}>{status}</option>)}</select>
              <button title="删除场景" onClick={() => void remove("scenes", item.id)}><Trash2 size={14} /></button>
            </article>)}
            {!scenes.length && <div className="workspace-empty">本章还没有场景计划。</div>}
          </div>
        </div>}

        {tab === "causality" && <div className="workspace-stack">
          <div className="workspace-action-row"><button onClick={() => void rebuildCausality()} disabled={busy === "causality"}><RefreshCcw size={14} />从剧情事实重建</button><button onClick={() => void generateArcs()} disabled={busy === "arcs"}><GitBranch size={14} />整理角色弧线</button></div>
          {workspace && <StoryNetworkGraph state={state} workspace={workspace} onMoveNode={(node, x, y) => void moveCausalNode(node, x, y)} onResetLayout={() => void resetCausalLayout()} onSelectEdge={(edge) => setEdgeDraft({ id: edge.id, source: edge.source, target: edge.target, relation: edge.relation, detail: edge.detail, color: edge.color || "#64748b", direction: edge.direction || "forward" })} />}
          <div className="workspace-two-columns causality-columns">
            <div className="workspace-list"><header><strong>剧情节点</strong><span>{workspace?.causalNodes.length || 0}</span></header><form className="workspace-compact-form" onSubmit={(event) => { event.preventDefault(); void addCausalNode(); }}><select value={nodeDraft.type} onChange={(event) => setNodeDraft({ ...nodeDraft, type: event.target.value })}>{["事件", "伏笔", "选择", "结果"].map((type) => <option key={type}>{type}</option>)}</select><input value={nodeDraft.title} onChange={(event) => setNodeDraft({ ...nodeDraft, title: event.target.value })} placeholder="手工节点" /><button><Plus size={14} /></button></form>{(workspace?.causalNodes || []).slice().sort((a, b) => a.order - b.order).map((item) => <article key={item.id}><div><strong>{item.type} / {item.title}</strong><span>{item.chapterTitle || "手工节点"}{item.locked ? " / 已锁定" : ""}</span><p>{compactText(item.detail)}</p></div><div className="workspace-row-actions"><button title={item.locked ? "解除锁定" : "锁定节点"} onClick={() => void upsert("causalNodes", { ...item, locked: !item.locked })}>{item.locked ? "锁" : "开"}</button>{item.origin === "manual" && <button onClick={() => void remove("causalNodes", item.id)}><Trash2 size={14} /></button>}</div></article>)}</div>
            <div className="workspace-list"><header><strong>连接关系</strong><span>{workspace?.causalEdges.length || 0}</span></header><form className="inline-edge-form" onSubmit={(event) => { event.preventDefault(); void addEdge(); }}><select value={edgeDraft.source} onChange={(event) => setEdgeDraft({ ...edgeDraft, source: event.target.value })}><option value="">起点...</option>{(workspace?.causalNodes || []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><input value={edgeDraft.relation} onChange={(event) => setEdgeDraft({ ...edgeDraft, relation: event.target.value })} placeholder="关系" /><select value={edgeDraft.target} onChange={(event) => setEdgeDraft({ ...edgeDraft, target: event.target.value })}><option value="">终点...</option>{(workspace?.causalNodes || []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><input className="edge-color-input" type="color" title="连线颜色" value={edgeDraft.color} onChange={(event) => setEdgeDraft({ ...edgeDraft, color: event.target.value })} /><select title="连线方向" value={edgeDraft.direction} onChange={(event) => setEdgeDraft({ ...edgeDraft, direction: event.target.value as CausalEdge["direction"] })}><option value="forward">正向</option><option value="backward">反向</option><option value="both">双向</option><option value="none">无方向</option></select><button title={edgeDraft.id ? "保存连线修改" : "添加连线"}>{edgeDraft.id ? <Save size={14} /> : <Plus size={14} />}</button></form>{(workspace?.causalEdges || []).map((edge) => { const source = workspace?.causalNodes.find((item) => item.id === edge.source); const target = workspace?.causalNodes.find((item) => item.id === edge.target); return <article key={edge.id} onClick={() => setEdgeDraft({ id: edge.id, source: edge.source, target: edge.target, relation: edge.relation, detail: edge.detail, color: edge.color || "#64748b", direction: edge.direction || "forward" })}><div><strong>{source?.title || "未知"} {edge.relation} {target?.title || "未知"}</strong><span>{edge.origin === "manual" ? "作者关系" : "自动顺序，待确认因果"}</span></div>{edge.origin === "manual" && <button onClick={(event) => { event.stopPropagation(); void remove("causalEdges", edge.id); }}><Trash2 size={14} /></button>}</article>; })}</div>
          </div>
          <details className="workspace-details"><summary>角色弧线（{workspace?.arcs.length || 0}）</summary><form className="workspace-compact-form arc-form" onSubmit={(event) => { event.preventDefault(); void addArc(); }}><input value={arcDraft.characterName} onChange={(event) => setArcDraft({ ...arcDraft, characterName: event.target.value })} placeholder="角色" /><input value={arcDraft.stage} onChange={(event) => setArcDraft({ ...arcDraft, stage: event.target.value })} placeholder="阶段" /><input value={arcDraft.change} onChange={(event) => setArcDraft({ ...arcDraft, change: event.target.value })} placeholder="变化" /><button><Plus size={14} /></button></form><div className="arc-grid">{(workspace?.arcs || []).map((item) => <article key={item.id}><strong>{item.characterName} / {item.chapterTitle}</strong><span>{item.stage}{item.locked ? " / 已锁定" : ""}</span><p>{item.change || item.desire || "暂无变化说明"}</p><footer><button onClick={() => void upsert("arcs", { ...item, locked: !item.locked })}>{item.locked ? "解除锁定" : "锁定"}</button>{item.origin === "manual" && <button onClick={() => void remove("arcs", item.id)}><Trash2 size={13} /></button>}</footer></article>)}</div></details>
        </div>}

        {tab === "revisions" && <div className="workspace-two-columns">
          <form className="workspace-editor" onSubmit={(event) => { event.preventDefault(); void createRevision(); }}><header><strong>生成安全修订</strong><span>只生成候选，不会直接修改正文</span></header><div className="workspace-field-pair"><select value={revisionDraft.action} onChange={(event) => setRevisionDraft({ ...revisionDraft, action: event.target.value as typeof revisionDraft.action })}>{["改写", "润色", "扩写", "精简"].map((action) => <option key={action}>{action}</option>)}</select><input value={revisionDraft.instruction} onChange={(event) => setRevisionDraft({ ...revisionDraft, instruction: event.target.value })} placeholder="额外要求（可选）" /></div><textarea className="workspace-source-text" value={revisionDraft.original} onChange={(event) => setRevisionDraft({ ...revisionDraft, original: event.target.value })} placeholder="先在正文中选中文字，或在这里填写" /><button className="primary" disabled={busy === "revision"}><Save size={14} />生成修订候选</button></form>
          <div className="workspace-list revision-list">{(workspace?.revisions || []).map((item) => { const parts = revisionParts(item); return <article key={item.id} className={item.stale ? "stale" : ""}><header><strong>{item.chapterTitle} / {item.action}</strong><span>{item.status}{item.stale ? " / 正文已变化" : ""}</span></header><div className="revision-compare"><p><b>原文</b>{item.original}</p><p><b>建议</b>{item.replacement || item.error || "正在生成"}</p></div>{["待确认", "部分采纳"].includes(item.status) && parts.length > 1 && <details className="revision-parts"><summary>逐句选择（剩余 {parts.length} 项）</summary>{parts.map((part, index) => <div key={`${part.original}-${index}`}><p><del>{part.original}</del><ins>{part.replacement || "（删除）"}</ins></p><button disabled={Boolean(busy)} onClick={() => void applyRevisionPart(item, part.original, part.replacement)}><Check size={13} />只采纳此句</button></div>)}</details>}{item.status === "待确认" && <footer><button onClick={() => void rejectRevision(item)}><X size={14} />拒绝</button><button className="primary" disabled={Boolean(busy)} onClick={() => void applyRevision(item)}><Check size={14} />整体采纳</button></footer>}{item.status === "部分采纳" && <footer><button onClick={() => void rejectRevision(item)}><X size={14} />结束其余建议</button></footer>}</article>; })}{!workspace?.revisions.length && <div className="workspace-empty">选中正文后可从右键菜单直接进入这里。</div>}</div>
        </div>}

        {tab === "annotations" && <div className="workspace-two-columns"><form className="workspace-editor" onSubmit={(event) => { event.preventDefault(); void addAnnotation(); }}><header><strong>添加批注</strong><span>批注独立保存，不改变文档排版</span></header><select value={annotationDraft.type} onChange={(event) => setAnnotationDraft({ ...annotationDraft, type: event.target.value })}>{["作者批注", "待核对", "AI建议", "资料提醒"].map((type) => <option key={type}>{type}</option>)}</select><textarea value={annotationDraft.quote} onChange={(event) => setAnnotationDraft({ ...annotationDraft, quote: event.target.value })} placeholder="关联原文" /><textarea value={annotationDraft.comment} onChange={(event) => setAnnotationDraft({ ...annotationDraft, comment: event.target.value })} placeholder="批注内容" /><button className="primary"><Plus size={14} />保存批注</button></form><div className="workspace-list">{(workspace?.annotations || []).map((item) => <article key={item.id} className={item.stale ? "stale" : ""}><div><strong>{item.type} / {item.chapterTitle}</strong><span>{item.status}{item.stale ? " / 原文版本已变化" : ""}</span><blockquote>{compactText(item.quote)}</blockquote><p>{item.comment}</p></div><div className="workspace-row-actions"><button onClick={() => onOpenChapter(item.chapterId)}>打开</button><select value={item.status} onChange={(event) => void upsert("annotations", { ...item, status: event.target.value })}>{["待处理", "已完成", "暂不处理"].map((status) => <option key={status}>{status}</option>)}</select><button onClick={() => void remove("annotations", item.id)}><Trash2 size={14} /></button></div></article>)}</div></div>}

        {tab === "memories" && <div className="workspace-two-columns"><form className="workspace-editor" onSubmit={(event) => { event.preventDefault(); void addMemory(); }}><header><strong>分层项目记忆</strong><span>参谋按当前章节自动读取，不必每次重复说明</span></header><select value={memoryDraft.scope} onChange={(event) => setMemoryDraft({ ...memoryDraft, scope: event.target.value })}><option>全书</option><option>分卷</option><option>章节</option></select><input value={memoryDraft.title} onChange={(event) => setMemoryDraft({ ...memoryDraft, title: event.target.value })} placeholder="记忆标题" /><textarea value={memoryDraft.content} onChange={(event) => setMemoryDraft({ ...memoryDraft, content: event.target.value })} placeholder="已确认事实、写作原则或本章约束" /><label className="workspace-checkbox"><input type="checkbox" checked={memoryDraft.locked} onChange={(event) => setMemoryDraft({ ...memoryDraft, locked: event.target.checked })} />锁定为作者确认内容</label><button className="primary"><Plus size={14} />保存记忆</button></form><div className="workspace-list">{(workspace?.memories || []).map((item) => <article key={item.id}><div><strong>{item.scope} / {item.title}</strong><span>{item.scopeLabel}{item.locked ? " / 已锁定" : ""}</span><p>{item.content}</p></div><button onClick={() => void remove("memories", item.id)}><Trash2 size={14} /></button></article>)}</div></div>}

        {tab === "quality" && <div className="workspace-stack"><div className="workspace-action-row"><button onClick={() => void runQuality()} disabled={busy === "quality"}><RefreshCcw size={14} />章节诊断</button><button onClick={() => void runStatistics()} disabled={busy === "statistics"}><BarChart3 size={14} />保存创作统计</button><span>本地分析，不调用 AI，也不会修改正文</span>{(workspace?.statisticsHistory.length || 0) > 1 && <select value={statisticsCompareId} onChange={(event) => setStatisticsCompareId(event.target.value)}><option value="">对比历史...</option>{workspace?.statisticsHistory.slice(1).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>}</div>{latestStatistics && <section className="creative-statistics"><header><strong>{latestStatistics.label}</strong><span>伏笔回收率 {latestStatistics.foreshadowSummary.recoveryRate}% / 待回收 {latestStatistics.foreshadowSummary.open}</span></header><div className="statistics-chart">{latestStatistics.metrics.map((item) => { const previous = comparedStatistics?.metrics.find((metric) => metric.chapterId === item.chapterId); return <button key={item.chapterId} title={`${item.chapterTitle}：节奏 ${item.pacing}，对话 ${item.dialogueRatio}%`} onClick={() => onOpenChapter(item.chapterId)}><span>{item.chapterTitle}</span><i style={{ height: `${Math.max(4, item.pacing)}%` }} /><small>{item.pacing}{previous ? ` (${item.pacing - previous.pacing >= 0 ? "+" : ""}${item.pacing - previous.pacing})` : ""}</small></button>; })}</div><div className="statistics-summary"><span>视角：{latestStatistics.povShares.slice(0, 4).map((item) => `${item.name} ${item.ratio}%`).join(" / ") || "待识别"}</span><span>高频角色：{latestStatistics.characterDensity.slice(0, 6).map((item) => `${item.name} ${item.total}`).join(" / ") || "暂无"}</span><span>人物提醒：{latestStatistics.arcAlerts.length}</span></div></section>}<div className="quality-table">{qualityReports.map((item) => <article key={item.chapterId} className={item.concerns.length ? "has-concerns" : ""}><button onClick={() => onOpenChapter(item.chapterId)}>{item.volume} / {item.chapterTitle}</button><span>{item.wordCount.toLocaleString()} 字</span><span>场景 {item.signals.scenes} / 事实 {item.signals.facts} / 角色 {item.signals.characters} / 伏笔 {item.signals.foreshadows}</span><p>{item.concerns.join("；") || "没有发现明显的结构缺口。"}</p></article>)}{!qualityReports.length && <div className="workspace-empty">点击“章节诊断”检查目标、冲突、转折、角色行动和结尾钩子。</div>}</div></div>}

        {tab === "exchange" && <div className="exchange-view">
          <section><Download size={22} /><div><strong>导出项目交换包</strong><p>包含项目内容，不包含 API 密钥、模型设置、向量库、本机路径与历史备份。</p><details><summary>设置交换包密码（可选）</summary><input type="password" value={exportPassword} onChange={(event) => setExportPassword(event.target.value)} placeholder="留空则导出普通 ZIP" /></details></div><button onClick={() => void exportExchange()} disabled={busy === "exchange"}>导出</button></section>
          <section><Upload size={22} /><div><strong>导入项目交换包</strong><p>先预览内容和重名项；导入前自动建立快照，不覆盖当前同名资料。</p></div><button onClick={() => void previewExchange()} disabled={busy === "exchange"}>选择文件</button></section>
          {exchangeUnlock && <form className="exchange-preview" onSubmit={(event) => { event.preventDefault(); void unlockExchange(); }}><header><strong>交换包已加密</strong><span>{exchangeUnlock.filePath.split(/[\\/]/).pop()}</span></header><input autoFocus type="password" value={exchangePassword} onChange={(event) => setExchangePassword(event.target.value)} placeholder="输入交换包密码" /><div><button type="button" onClick={() => { setExchangeUnlock(null); setExchangePassword(""); }}>取消</button><button className="primary" disabled={!exchangePassword || busy === "exchange"}>解锁预览</button></div></form>}
          {exchangePreview && <div className="exchange-preview"><header><strong>{exchangePreview.manifest.project.title}</strong><span>由 {exchangePreview.manifest.appVersion} 导出{exchangePreview.encrypted ? " / 已加密" : ""}</span></header><p>文档 {exchangePreview.manifest.counts.chapters} / 角色 {exchangePreview.manifest.counts.characters} / 世界观 {exchangePreview.manifest.counts.worldDocs} / 素材 {exchangePreview.manifest.counts.materials}</p><p>重名：文档 {exchangePreview.conflicts.chapters.length}、角色 {exchangePreview.conflicts.characters.length}、世界观 {exchangePreview.conflicts.worldDocs.length}</p><fieldset className="exchange-selection"><legend>选择导入内容</legend><label><input type="checkbox" checked={exchangeSelection.chapters} onChange={(event) => setExchangeSelection({ ...exchangeSelection, chapters: event.target.checked })} />正文与大纲</label><label><input type="checkbox" checked={exchangeSelection.characters} onChange={(event) => setExchangeSelection({ ...exchangeSelection, characters: event.target.checked })} />角色卡</label><label><input type="checkbox" checked={exchangeSelection.world} onChange={(event) => setExchangeSelection({ ...exchangeSelection, world: event.target.checked })} />世界观</label><label><input type="checkbox" checked={exchangeSelection.materials} onChange={(event) => setExchangeSelection({ ...exchangeSelection, materials: event.target.checked })} />素材</label><label title={!exchangeSelection.chapters ? "创作分析依赖章节，需同时导入正文" : ""}><input type="checkbox" disabled={!exchangeSelection.chapters} checked={exchangeSelection.workspace && exchangeSelection.chapters} onChange={(event) => setExchangeSelection({ ...exchangeSelection, workspace: event.target.checked })} />创作分析</label></fieldset><div><button onClick={() => { setExchangePreview(null); setExchangePassword(""); }}>取消</button><button className="primary" disabled={!Object.values(exchangeSelection).some(Boolean)} onClick={() => void importExchange()}><Upload size={14} />确认导入</button></div></div>}
        </div>}
      </div>
    </section>
  );
}
