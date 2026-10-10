// Extracted from src/App.tsx by the P3 refactor (cut-paste, no logic changes).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDown, FileText, ListTree, LayoutGrid, RefreshCcw, Search, UserRound, Wand2, X } from "lucide-react";
import type { AppState, AnalysisSnapshot, AnalysisTab, ChapterVersion, ChapterVersionCompare, CharacterCard, ConsistencyIssue, ExtractedWorldCandidate, GlobalSearchResult, AppearanceStat, MaterialItem, RelationshipEdge, RelationshipNode, TimelineEvent, WorldMapEdge, WorldMapNode } from "../types";
import { contentToPlainText, sourceLabel, formatDateTime, getErrorMessage } from "../lib/text-utils";
import { ExperimentalTools } from "./ExperimentalTools";
import { ProgressWorkspace } from "../components/ProgressWorkspace";
import { groupByCategory, normalizeCategoryLabel } from "../lib/categories";
import type { PageSaveHandle, PageSaveKind } from "../hooks/useEntityDraft";
import type { CategoryGroup } from "../lib/categories";

export function AnalysisPanel({
  state,
  onRegisterSave,
  networkOpenRequest,
  selectedChapterId,
  onSelectChapter,
  onOpenSource,
  onExportBook,
  onExportBookWithOptions,
  onApplyState,
  onStatus,
}: {
  state: AppState;
  onRegisterSave: (kind: PageSaveKind, handle: PageSaveHandle | null) => void;
  networkOpenRequest: number;
  selectedChapterId: string;
  onSelectChapter: (chapterId: string) => void;
  onOpenSource: (result: GlobalSearchResult) => void;
  onExportBook: () => void;
  onExportBookWithOptions: (options: {
    includeOutline?: boolean;
    includeMaterials?: boolean;
    includeCharacters?: boolean;
    includeWorld?: boolean;
  }) => void;
  onApplyState: (state: AppState) => void;
  onStatus: (message: string) => void;
}) {
  const [tab, setTab] = useState<AnalysisTab>(networkOpenRequest ? "progress" : "search");
  const userSelectedTab = useRef(false);
  const networkSaver = useRef<PageSaveHandle | null>(null);
  const registerNetworkSave = useCallback((kind: PageSaveKind, handle: PageSaveHandle | null) => {
    networkSaver.current = handle; onRegisterSave(kind, handle);
  }, [onRegisterSave]);
  useEffect(() => { if (networkOpenRequest) setTab("progress"); }, [networkOpenRequest]);
  async function changeAnalysisTab(next: AnalysisTab) {
    if (next === tab) return;
    if (networkSaver.current && !(await networkSaver.current.protect())) { onStatus("小说网草稿保护失败，请先保存后再切换。"); return; }
    userSelectedTab.current = true;
    setTab(next);
  }
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GlobalSearchResult[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [relationshipNodes, setRelationshipNodes] = useState<RelationshipNode[]>([]);
  const [relationshipEdges, setRelationshipEdges] = useState<RelationshipEdge[]>([]);
  const [issues, setIssues] = useState<ConsistencyIssue[]>([]);
  const [consistencyNotice, setConsistencyNotice] = useState("");
  const [versions, setVersions] = useState<ChapterVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [versionCompare, setVersionCompare] = useState<ChapterVersionCompare | null>(null);
  const [timelineMode, setTimelineMode] = useState<"local" | "ai">("ai");
  const [draggingEventId, setDraggingEventId] = useState("");
  const [selectedRelationNames, setSelectedRelationNames] = useState<string[]>([]);
  const [relationTypes, setRelationTypes] = useState<string[]>(["同盟", "敌对", "师徒", "亲属", "感情", "交易", "背叛"]);
  const [newRelationType, setNewRelationType] = useState("");
  const [exportOptions, setExportOptions] = useState({ includeOutline: true, includeMaterials: true, includeCharacters: false, includeWorld: false });
  const [extractScope, setExtractScope] = useState<"book" | "chapter">("book");
  const [worldCandidates, setWorldCandidates] = useState<ExtractedWorldCandidate[]>([]);
  const [appearanceStats, setAppearanceStats] = useState<AppearanceStat[]>([]);
  const [worldMapNodes, setWorldMapNodes] = useState<WorldMapNode[]>([]);
  const [worldMapEdges, setWorldMapEdges] = useState<WorldMapEdge[]>([]);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [materialDraft, setMaterialDraft] = useState<Partial<MaterialItem>>({ title: "", category: "灵感", content: "" });
  const [busy, setBusy] = useState("");
  const [analysisLoaded, setAnalysisLoaded] = useState(false);
  const [relationSearch, setRelationSearch] = useState("");
  const [relationCategoryFilter, setRelationCategoryFilter] = useState("");
  const [graphScale, setGraphScale] = useState(1);
  const [graphOffset, setGraphOffset] = useState({ x: 0, y: 0 });
  const [graphDragStart, setGraphDragStart] = useState<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [graphNodeDrag, setGraphNodeDrag] = useState<{ startX: number; startY: number; positions: Record<string, { x: number; y: number }> } | null>(null);
  const [graphSelection, setGraphSelection] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const [selectedGraphNodeIds, setSelectedGraphNodeIds] = useState<string[]>([]);
  const [editingRelationEdgeId, setEditingRelationEdgeId] = useState("");
  const graphShellRef = useRef<HTMLDivElement | null>(null);
  const [consistencyChapterIds, setConsistencyChapterIds] = useState<string[]>([]);
  const [consistencySourceIds, setConsistencySourceIds] = useState<string[]>([]);
  const [scopeOpen, setScopeOpen] = useState(false);
  const selectedChapter = state.chapters.find((chapter) => chapter.id === selectedChapterId) || state.selectedChapter;
  const relationCategories = useMemo(() => [...new Set(state.characters.map((card) => normalizeCategoryLabel(card.category)))].sort((a, b) => a.localeCompare(b, "zh-CN")), [state.characters]);
  const relationVisibleCards = useMemo(() => {
    const keyword = relationSearch.trim().toLowerCase();
    return state.characters.filter((card) => {
      const category = normalizeCategoryLabel(card.category);
      const categoryMatched = !relationCategoryFilter || category === relationCategoryFilter || category.startsWith(`${relationCategoryFilter}/`);
      const keywordMatched =
        !keyword ||
        card.name.toLowerCase().includes(keyword) ||
        category.toLowerCase().includes(keyword) ||
        String(card.relationships || "").toLowerCase().includes(keyword);
      return categoryMatched && keywordMatched;
    });
  }, [relationCategoryFilter, relationSearch, state.characters]);
  const relationGroupedCards = useMemo(() => groupByCategory(relationVisibleCards), [relationVisibleCards]);
  const knowledgeSources = useMemo(
    () => [
      ...state.chapters.map((chapter) => ({
        id: chapter.id,
        sourceType: "chapter" as const,
        title: chapter.title,
        group: chapter.volume || "未分卷",
        role: chapter.knowledgeRole || "正文",
      })),
      ...state.characters.map((card) => ({
        id: card.id,
        sourceType: "character" as const,
        title: card.name,
        group: normalizeCategoryLabel(card.category),
        role: "角色卡",
      })),
      ...state.worldDocs.map((doc) => ({
        id: doc.id,
        sourceType: "world" as const,
        title: doc.title,
        group: normalizeCategoryLabel(doc.category),
        role: "世界观",
      })),
    ],
    [state.chapters, state.characters, state.worldDocs],
  );

  function saveAnalysisDraft(patch: Partial<AnalysisSnapshot>) {
    void window.novelAPI.saveAnalysisState(patch).catch(() => null);
  }

  function restoreAnalysisSnapshot(snapshot: AnalysisSnapshot) {
    if (!userSelectedTab.current && !networkOpenRequest && snapshot.tab && ["progress", "search", "timeline", "relations", "consistency", "versions", "export"].includes(snapshot.tab)) {
      setTab(snapshot.tab as AnalysisTab);
    }
    if (typeof snapshot.query === "string") setQuery(snapshot.query);
    if (Array.isArray(snapshot.searchResults)) setSearchResults(snapshot.searchResults);
    if (snapshot.timeline?.events) setTimelineEvents(snapshot.timeline.events);
    if (snapshot.timelineOptions?.mode === "local" || snapshot.timelineOptions?.mode === "ai") setTimelineMode(snapshot.timelineOptions.mode);
    if (snapshot.relationships?.nodes) setRelationshipNodes(snapshot.relationships.nodes);
    if (snapshot.relationships?.edges) setRelationshipEdges(snapshot.relationships.edges);
    if (Array.isArray(snapshot.relationshipOptions?.characterNames)) setSelectedRelationNames(snapshot.relationshipOptions.characterNames);
    if (typeof snapshot.relationshipOptions?.categoryFilter === "string") setRelationCategoryFilter(snapshot.relationshipOptions.categoryFilter);
    if (Array.isArray(snapshot.relationshipOptions?.relationTypes) && snapshot.relationshipOptions.relationTypes.length) setRelationTypes(snapshot.relationshipOptions.relationTypes);
    if (snapshot.consistency?.issues) setIssues(snapshot.consistency.issues);
    if (snapshot.consistency?.notice || snapshot.consistency?.apiError) setConsistencyNotice(snapshot.consistency.notice || `AI 暂时不可用，已显示本地检查结果：${snapshot.consistency.apiError}`);
    if (Array.isArray(snapshot.consistencyOptions?.chapterIds)) setConsistencyChapterIds(snapshot.consistencyOptions.chapterIds);
    if (Array.isArray(snapshot.consistencyOptions?.knowledgeSourceIds)) setConsistencySourceIds(snapshot.consistencyOptions.knowledgeSourceIds);
    if (snapshot.exportOptions) {
      const legacyOptions = snapshot.exportOptions.includeMaterials === undefined;
      setExportOptions({
        includeOutline: legacyOptions ? true : false,
        includeMaterials: true,
        includeCharacters: false,
        includeWorld: false,
        ...snapshot.exportOptions,
        ...(legacyOptions ? { includeOutline: true, includeMaterials: true } : {}),
      });
    }
    if (snapshot.extractScope === "book" || snapshot.extractScope === "chapter") setExtractScope(snapshot.extractScope);
    if (Array.isArray(snapshot.worldCandidates)) setWorldCandidates(snapshot.worldCandidates);
    if (Array.isArray(snapshot.appearanceStats)) setAppearanceStats(snapshot.appearanceStats);
    if (Array.isArray(snapshot.worldMapNodes)) setWorldMapNodes(snapshot.worldMapNodes);
    if (Array.isArray(snapshot.worldMapEdges)) setWorldMapEdges(snapshot.worldMapEdges);
    if (Array.isArray(snapshot.materials)) setMaterials(snapshot.materials);
    if (snapshot.materialDraft) setMaterialDraft(snapshot.materialDraft);
  }

  useEffect(() => {
    setAnalysisLoaded(false);
    window.novelAPI
      .getAnalysisState()
      .then((snapshot) => restoreAnalysisSnapshot(snapshot || {}))
      .catch(() => null)
      .finally(() => setAnalysisLoaded(true));
  }, [state.projectPath]);

  useEffect(() => {
    if (!analysisLoaded) return;
    const timer = window.setTimeout(() => {
      saveAnalysisDraft({
        tab,
        query,
        searchResults,
        timeline: { events: timelineEvents },
        timelineOptions: { mode: timelineMode },
        relationships: { nodes: relationshipNodes, edges: relationshipEdges },
        relationshipOptions: {
          characterNames: selectedRelationNames,
          categoryFilter: relationCategoryFilter,
          relationTypes,
        },
        consistency: { issues, notice: consistencyNotice },
        consistencyOptions: {
          chapterIds: consistencyChapterIds,
          knowledgeSourceIds: consistencySourceIds,
        },
        exportOptions,
        extractScope,
        worldCandidates,
        appearanceStats,
        worldMapNodes,
        worldMapEdges,
        materials,
        materialDraft,
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    analysisLoaded,
    tab,
    query,
    searchResults,
    timelineEvents,
    timelineMode,
    relationshipNodes,
    relationshipEdges,
    selectedRelationNames,
    relationCategoryFilter,
    relationTypes,
    issues,
    consistencyNotice,
    consistencyChapterIds,
    consistencySourceIds,
    exportOptions,
    extractScope,
    worldCandidates,
    appearanceStats,
    worldMapNodes,
    worldMapEdges,
    materials,
    materialDraft,
    selectedChapterId,
  ]);

  async function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) {
      onStatus("请先输入要搜索的关键词。");
      return;
    }
    setBusy("search");
    onStatus("正在全局搜索...");
    try {
      const result = await window.novelAPI.globalSearch({ query: trimmed });
      setSearchResults(result.results);
      saveAnalysisDraft({ query: trimmed, searchResults: result.results });
      onStatus(`搜索完成：找到 ${result.results.length} 条结果`);
    } catch (error) {
      onStatus(`搜索失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function loadTimeline() {
    setBusy("timeline");
    onStatus(timelineMode === "ai" ? "正在让 AI 识别真实剧情事件..." : "正在整理时间线...");
    try {
      const result = await window.novelAPI.buildTimeline({ mode: timelineMode, refresh: true });
      setTimelineEvents(result.events);
      saveAnalysisDraft({ timeline: result, timelineOptions: { mode: timelineMode } });
      onStatus(result.apiError ? `AI 时间线失败，已使用本地结果：${result.apiError}` : `时间线已整理：${result.events.length} 个事件`);
    } catch (error) {
      onStatus(`整理时间线失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  function moveTimelineEvent(targetId: string) {
    if (!draggingEventId || draggingEventId === targetId) return;
    setTimelineEvents((items) => {
      const moving = items.find((item) => item.id === draggingEventId);
      if (!moving) return items;
      const rest = items.filter((item) => item.id !== draggingEventId);
      const targetIndex = rest.findIndex((item) => item.id === targetId);
      rest.splice(targetIndex < 0 ? rest.length : targetIndex, 0, moving);
      const next = rest.map((item, index) => ({ ...item, order: index }));
      saveAnalysisDraft({ timeline: { events: next }, timelineOptions: { mode: timelineMode } });
      return next;
    });
    setDraggingEventId("");
    onStatus("已手动调整时间线顺序");
  }

  async function loadRelationships() {
    setBusy("relations");
    onStatus("正在生成角色关系网...");
    try {
      const result = await window.novelAPI.buildRelationshipGraph({
        characterNames: selectedRelationNames,
        categoryFilter: relationCategoryFilter,
        relationTypes,
        refresh: true,
      });
      const mergedNodes = result.nodes.map((node) => {
        const saved = relationshipNodes.find((item) => item.id === node.id);
        return saved ? { ...node, x: saved.x, y: saved.y, color: saved.color } : node;
      });
      const mergedEdges = result.edges.map((edge) => {
        const saved = relationshipEdges.find((item) => item.id === edge.id);
        return saved ? { ...edge, label: saved.label || edge.label, labelX: saved.labelX, labelY: saved.labelY, color: saved.color, direction: saved.direction } : edge;
      });
      setRelationshipNodes(mergedNodes);
      setRelationshipEdges(mergedEdges);
      saveAnalysisDraft({
        relationships: { ...result, nodes: mergedNodes, edges: mergedEdges },
        relationshipOptions: {
          characterNames: selectedRelationNames,
          categoryFilter: relationCategoryFilter,
          relationTypes,
        },
      });
      onStatus(`关系网已生成：${result.nodes.length} 个角色，${result.edges.length} 条关系`);
    } catch (error) {
      onStatus(`生成关系网失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  function toggleRelationName(name: string) {
    setSelectedRelationNames((items) => (items.includes(name) ? items.filter((item) => item !== name) : [...items, name]));
  }

  function addRelationType() {
    const value = newRelationType.trim();
    if (!value) {
      onStatus("请先输入新的关系类型。");
      return;
    }
    if (relationTypes.includes(value)) {
      onStatus(`关系类型已存在：${value}`);
      return;
    }
    setRelationTypes((items) => [...items, value]);
    setNewRelationType("");
    onStatus(`已添加关系类型：${value}`);
  }

  async function runConsistencyCheck() {
    setBusy("consistency");
    setConsistencyNotice("");
    onStatus("正在检查设定一致性...");
    try {
      const result = await window.novelAPI.analyzeConsistency({
        refresh: true,
        chapterIds: consistencyChapterIds,
        knowledgeSourceIds: consistencySourceIds,
      });
      setIssues(result.issues);
      const notice = result.apiError ? `AI 暂时不可用，已显示本地检查结果：${result.apiError}` : `AI 检查完成，引用检索片段 ${result.contextCount} 条`;
      setConsistencyNotice(notice);
      saveAnalysisDraft({
        consistency: { ...result, notice },
        consistencyOptions: {
          chapterIds: consistencyChapterIds,
          knowledgeSourceIds: consistencySourceIds,
        },
      });
      onStatus(`设定检查完成：发现 ${result.issues.length} 条待确认问题`);
    } catch (error) {
      onStatus(`设定检查失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function updateIssueStatus(issueId: string, status: ConsistencyIssue["status"]) {
    if (!status) return;
    try {
      await window.novelAPI.updateIssueStatus({ issueId, status });
      setIssues((items) => {
        const next = items.map((item) => (item.id === issueId ? { ...item, status } : item));
        saveAnalysisDraft({ consistency: { issues: next, notice: consistencyNotice } });
        return next;
      });
      onStatus(`问题已标记为：${status}`);
    } catch (error) {
      onStatus(`更新问题状态失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const loadVersions = useCallback(async () => {
    if (!selectedChapterId) return;
    setBusy("versions");
    setVersionCompare(null);
    onStatus("正在读取章节历史版本...");
    try {
      const result = await window.novelAPI.listChapterVersions(selectedChapterId);
      setVersions(result.versions);
      setSelectedVersionId(result.versions[0]?.id || "");
      onStatus(result.versions.length ? `已读取 ${result.versions.length} 个历史版本` : "当前章节还没有历史版本；保存修改后会开始记录");
    } catch (error) {
      onStatus(`读取历史版本失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }, [onStatus, selectedChapterId]);

  async function compareVersion() {
    if (!selectedChapterId || !selectedVersionId) return;
    setBusy("compare");
    onStatus("正在对比版本...");
    try {
      const result = await window.novelAPI.compareChapterVersion({ chapterId: selectedChapterId, versionId: selectedVersionId });
      setVersionCompare(result);
      onStatus(`版本对比完成：新增 ${result.added} 行，删除 ${result.removed} 行`);
    } catch (error) {
      onStatus(`版本对比失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function restoreVersion() {
    if (!selectedChapterId || !selectedVersionId) return;
    if (!window.confirm("恢复后，当前内容会先自动保存为一个历史版本。确认恢复所选版本吗？")) return;
    setBusy("restore-version");
    try {
      const result = await window.novelAPI.restoreChapterVersion({ chapterId: selectedChapterId, versionId: selectedVersionId, expectedRevision: state.chapterRevision });
      onApplyState(result.state);
      setVersionCompare(null);
      onStatus(`已恢复 ${formatDateTime(result.restoredVersion.createdAt)} 的版本，恢复前内容也已备份`);
    } catch (error) {
      onStatus(`恢复版本失败：${getErrorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function prepareWorldCandidates() {
    setBusy("extract");
    onStatus(extractScope === "chapter" ? "正在从当前文档提取候选..." : "正在从全书提取候选...");
    try {
      const result = await window.novelAPI.extractWorldCardsFromOutline({ scope: extractScope, chapterId: selectedChapterId });
      setWorldCandidates(result.candidates);
      saveAnalysisDraft({ extractScope, worldCandidates: result.candidates });
      onStatus(`已提取 ${result.candidates.length} 个候选；请勾选后写入世界观`);
    } catch (error) {
      onStatus(`提取候选失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function saveSelectedCandidates() {
    setBusy("save-candidates");
    onStatus("正在写入选中的资料条目...");
    try {
      const result = await window.novelAPI.saveWorldCardCandidates({ candidates: worldCandidates });
      onApplyState(result.state);
      setWorldCandidates([]);
      saveAnalysisDraft({ worldCandidates: [] });
      onStatus(`已写入资料条目：新增 ${result.created} 条，合并 ${result.updated} 条`);
    } catch (error) {
      onStatus(`写入资料失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function loadAppearanceStats() {
    setBusy("appearance");
    try {
      const result = await window.novelAPI.getAppearanceStats();
      setAppearanceStats(result.stats);
      saveAnalysisDraft({ appearanceStats: result.stats });
      onStatus(`人物出场统计完成：${result.stats.length} 个角色`);
    } catch (error) {
      onStatus(`人物出场统计失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function loadWorldMap() {
    setBusy("world-map");
    try {
      const result = await window.novelAPI.getWorldMap();
      setWorldMapNodes(result.nodes);
      setWorldMapEdges(result.edges);
      saveAnalysisDraft({ worldMapNodes: result.nodes, worldMapEdges: result.edges });
      onStatus(`地点/势力版图已整理：${result.nodes.length} 个节点，${result.edges.length} 条关联`);
    } catch (error) {
      onStatus(`整理版图失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function loadMaterials() {
    setBusy("materials");
    try {
      const result = await window.novelAPI.listMaterials();
      setMaterials(result.materials);
      saveAnalysisDraft({ materials: result.materials });
      onStatus(`素材已刷新：${result.materials.length} 条`);
    } catch (error) {
      onStatus(`刷新素材失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function saveMaterialDraft() {
    setBusy("save-material");
    try {
      const result = await window.novelAPI.saveMaterial(materialDraft);
      setMaterials(result.materials);
      setMaterialDraft({ title: "", category: "灵感", content: "" });
      saveAnalysisDraft({ materials: result.materials, materialDraft: { title: "", category: "灵感", content: "" } });
      onStatus(`素材已保存：${result.material.title}`);
    } catch (error) {
      onStatus(`保存素材失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function deleteMaterialItem(materialId: string) {
    setBusy("delete-material");
    try {
      const result = await window.novelAPI.deleteMaterial(materialId);
      setMaterials(result.materials);
      saveAnalysisDraft({ materials: result.materials });
      onStatus("素材已删除");
    } catch (error) {
      onStatus(`删除素材失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    if (tab === "versions" && selectedChapterId) void loadVersions();
  }, [loadVersions, selectedChapterId, tab]);

  const graph = useMemo(() => {
    const width = 1240;
    const degree = new Map<string, number>();
    relationshipEdges.forEach((edge) => {
      degree.set(edge.source, (degree.get(edge.source) || 0) + edge.weight);
      degree.set(edge.target, (degree.get(edge.target) || 0) + edge.weight);
    });
    const nodes = relationshipNodes
      .slice()
      .sort((a, b) => (degree.get(b.id) || 0) + b.size - ((degree.get(a.id) || 0) + a.size));
    const center = nodes[0];
    const others = nodes.slice(1);
    const left: RelationshipNode[] = [];
    const right: RelationshipNode[] = [];
    others.forEach((node, index) => {
      const target = index % 2 === 0 ? right : left;
      target.push(node);
    });
    const rowGap = 82;
    const height = Math.max(520, (Math.max(left.length, right.length, 1) - 1) * rowGap + 220);
    const centerX = width / 2;
    const centerY = height / 2;
    const positions = new Map<string, { x: number; y: number; width: number; height: number; side: "center" | "left" | "right" }>();
    const measure = (name: string) => Math.max(108, Math.min(190, name.length * 15 + 46));
    if (center) {
      positions.set(center.id, { x: centerX, y: centerY, width: measure(center.name) + 24, height: 48, side: "center" });
    }
    const placeSide = (items: RelationshipNode[], side: "left" | "right") => {
      const x = centerX + (side === "right" ? 330 : -330);
      const startY = centerY - ((items.length - 1) * rowGap) / 2;
      items.forEach((node, index) => {
        positions.set(node.id, { x, y: startY + index * rowGap, width: measure(node.name), height: 42, side });
      });
    };
    placeSide(left, "left");
    placeSide(right, "right");
    nodes.forEach((node) => {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
      const current = positions.get(node.id);
      if (current) positions.set(node.id, { ...current, x: Number(node.x), y: Number(node.y) });
    });
    return { width, height, positions };
  }, [relationshipNodes, relationshipEdges]);

  function resetGraphView() {
    setGraphScale(1);
    setGraphOffset({ x: 0, y: 0 });
  }

  function autoLayoutGraph() {
    setRelationshipNodes((items) => items.map(({ x: _x, y: _y, ...item }) => item));
    setSelectedGraphNodeIds([]);
    resetGraphView();
    onStatus("关系图已重新自动布局");
  }

  function zoomGraphByWheel(deltaY: number) {
    const factor = deltaY < 0 ? 1.12 : 0.88;
    setGraphScale((value) => Math.min(3.2, Math.max(0.35, Number((value * factor).toFixed(3)))));
  }

  function zoomGraph(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    zoomGraphByWheel(event.deltaY);
  }

  useEffect(() => {
    const shell = graphShellRef.current;
    if (!shell) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      zoomGraphByWheel(event.deltaY);
    };
    shell.addEventListener("wheel", handleWheel, { passive: false });
    return () => shell.removeEventListener("wheel", handleWheel);
  }, [relationshipNodes.length, tab]);

  function startGraphPan(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.shiftKey) {
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      setGraphSelection({ startX: x, startY: y, currentX: x, currentY: y });
      return;
    }
    setGraphDragStart({ x: event.clientX, y: event.clientY, offsetX: graphOffset.x, offsetY: graphOffset.y });
  }

  function moveGraphPan(event: React.MouseEvent<HTMLDivElement>) {
    if (graphNodeDrag) {
      event.preventDefault();
      event.stopPropagation();
      const svg = graphShellRef.current?.querySelector("svg");
      const ratio = svg ? graph.width / Math.max(1, svg.getBoundingClientRect().width) : 1;
      const dx = ((event.clientX - graphNodeDrag.startX) * ratio) / graphScale;
      const dy = ((event.clientY - graphNodeDrag.startY) * ratio) / graphScale;
      setRelationshipNodes((items) => items.map((item) => {
        const start = graphNodeDrag.positions[item.id];
        return start ? { ...item, x: start.x + dx, y: start.y + dy } : item;
      }));
      return;
    }
    if (graphSelection) {
      const rect = event.currentTarget.getBoundingClientRect();
      setGraphSelection({ ...graphSelection, currentX: event.clientX - rect.left, currentY: event.clientY - rect.top });
      return;
    }
    if (!graphDragStart) return;
    event.preventDefault();
    event.stopPropagation();
    setGraphOffset({
      x: graphDragStart.offsetX + event.clientX - graphDragStart.x,
      y: graphDragStart.offsetY + event.clientY - graphDragStart.y,
    });
  }

  function stopGraphPan() {
    if (graphSelection) {
      const svg = graphShellRef.current?.querySelector("svg");
      if (svg) {
        const rect = svg.getBoundingClientRect();
        const ratioX = graph.width / Math.max(1, rect.width);
        const ratioY = graph.height / Math.max(1, rect.height);
        const left = (Math.min(graphSelection.startX, graphSelection.currentX) * ratioX - graphOffset.x) / graphScale;
        const right = (Math.max(graphSelection.startX, graphSelection.currentX) * ratioX - graphOffset.x) / graphScale;
        const top = (Math.min(graphSelection.startY, graphSelection.currentY) * ratioY - graphOffset.y) / graphScale;
        const bottom = (Math.max(graphSelection.startY, graphSelection.currentY) * ratioY - graphOffset.y) / graphScale;
        setSelectedGraphNodeIds(relationshipNodes.filter((node) => { const position = graph.positions.get(node.id); return position && position.x >= left && position.x <= right && position.y >= top && position.y <= bottom; }).map((node) => node.id));
      }
    }
    setGraphDragStart(null);
    setGraphNodeDrag(null);
    setGraphSelection(null);
  }

  function startGraphNodeDrag(event: React.MouseEvent<SVGGElement>, nodeId: string) {
    event.preventDefault();
    event.stopPropagation();
    const nextSelected = selectedGraphNodeIds.includes(nodeId) ? selectedGraphNodeIds : event.ctrlKey ? [...selectedGraphNodeIds, nodeId] : [nodeId];
    setSelectedGraphNodeIds(nextSelected);
    const positions = Object.fromEntries(nextSelected.map((id) => { const position = graph.positions.get(id); return [id, { x: position?.x || 0, y: position?.y || 0 }]; }));
    setGraphNodeDrag({ startX: event.clientX, startY: event.clientY, positions });
  }

  async function saveRelationshipEdge(edge: RelationshipEdge) {
    const label = String(edge.label || "关系").trim() || "关系";
    setRelationshipEdges((items) => items.map((item) => item.id === edge.id ? { ...edge, label } : item));
    const source = state.characters.find((card) => card.name === edge.source);
    const target = state.characters.find((card) => card.name === edge.target);
    try {
      let nextState: AppState | null = null;
      if (source) {
        const line = `${target?.name || edge.target}：${label}`;
        nextState = await window.novelAPI.saveCharacter({ ...source, relationships: source.relationships.includes(line) ? source.relationships : [source.relationships.trim(), line].filter(Boolean).join("\n") });
      }
      if (target) {
        const line = `${source?.name || edge.source}：${label}`;
        nextState = await window.novelAPI.saveCharacter({ ...target, relationships: target.relationships.includes(line) ? target.relationships : [target.relationships.trim(), line].filter(Boolean).join("\n") });
      }
      if (nextState) onApplyState(nextState);
      setEditingRelationEdgeId("");
      onStatus(`关系“${label}”已同步到角色卡`);
    } catch (error) {
      onStatus(`保存关系失败：${getErrorMessage(error)}`);
    }
  }

  function toggleConsistencyChapter(chapterId: string) {
    setConsistencyChapterIds((items) => (items.includes(chapterId) ? items.filter((id) => id !== chapterId) : [...items, chapterId]));
  }

  function toggleConsistencySource(sourceId: string) {
    setConsistencySourceIds((items) => (items.includes(sourceId) ? items.filter((id) => id !== sourceId) : [...items, sourceId]));
  }

  function selectVisibleRelationCards() {
    const names = relationVisibleCards.map((card) => card.name).filter(Boolean);
    setSelectedRelationNames((items) => [...new Set([...items, ...names])]);
  }

  function renderRelationGroup(group: CategoryGroup<CharacterCard>, depth = 0) {
    return (
      <div className="relation-category-group" key={group.key}>
        <div className="relation-category-title" style={{ paddingLeft: 8 + depth * 14 }}>
          <span>{group.category}</span>
          <small>{group.count}</small>
        </div>
        {group.children.map((child) => renderRelationGroup(child, depth + 1))}
        {group.items.map((card) => (
          <label key={card.id} style={{ paddingLeft: 24 + depth * 14 }}>
            <input type="checkbox" checked={selectedRelationNames.includes(card.name)} onChange={() => toggleRelationName(card.name)} />
            <span>{card.name}</span>
          </label>
        ))}
      </div>
    );
  }

  return (
    <section className={`analysis-panel ${tab === "progress" ? "progress-active" : ""}`}>
      <div className="analysis-tabs">
        <button className={tab === "progress" ? "active" : ""} onClick={() => void changeAnalysisTab("progress")}>
          <LayoutGrid size={16} />
          进度
        </button>
        <button className={tab === "search" ? "active" : ""} onClick={() => void changeAnalysisTab("search")}>
          <Search size={16} />
          全局搜索
        </button>
        <button className={tab === "timeline" ? "active" : ""} onClick={() => void changeAnalysisTab("timeline")}>
          <ListTree size={16} />
          时间线
        </button>
        <button className={tab === "relations" ? "active" : ""} onClick={() => void changeAnalysisTab("relations")}>
          <UserRound size={16} />
          关系网
        </button>
        <button className={tab === "consistency" ? "active" : ""} onClick={() => void changeAnalysisTab("consistency")}>
          <RefreshCcw size={16} />
          一致性
        </button>
        <button className={tab === "versions" ? "active" : ""} onClick={() => void changeAnalysisTab("versions")}>
          <FileText size={16} />
          版本对比
        </button>
        <button className={tab === "export" ? "active" : ""} onClick={() => void changeAnalysisTab("export")}>
          <FileDown size={16} />
          导出/提取
        </button>
      </div>

      {tab === "progress" && (
        <ProgressWorkspace
          state={state}
          onRegisterSave={registerNetworkSave}
          networkOpenRequest={networkOpenRequest}
          selectedChapterId={selectedChapter?.id || ""}
          onSelectChapter={onSelectChapter}
          onApplyState={onApplyState}
          onStatus={onStatus}
        />
      )}

      {tab === "search" && (
        <div className="analysis-section">
          <form
            className="analysis-search"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索章节、角色、世界观" />
            <button disabled={busy === "search"}>
              <Search size={16} />
              搜索
            </button>
          </form>
          <div className="search-results">
            {searchResults.map((result) => (
              <button key={result.id} className="search-result" onClick={() => onOpenSource(result)}>
                <strong>{result.title}</strong>
                <span>{sourceLabel(result.sourceType)}{result.volume ? ` / ${result.volume}` : result.category ? ` / ${result.category}` : ""}</span>
                <p>{result.snippet || "匹配标题或分类"}</p>
              </button>
            ))}
            {!searchResults.length && <div className="analysis-empty">输入关键词后可搜索章节正文、角色卡片和世界观条目。</div>}
          </div>
        </div>
      )}

      {tab === "timeline" && (
        <div className="analysis-section">
          <div className="analysis-actions">
            <select value={timelineMode} onChange={(event) => setTimelineMode(event.target.value as "local" | "ai")}>
              <option value="ai">AI 识别真实事件</option>
              <option value="local">本地规则整理</option>
            </select>
            <button onClick={() => void loadTimeline()} disabled={busy === "timeline"}>
              <RefreshCcw size={16} />
              刷新时间线
            </button>
          </div>
          <div className="timeline-list">
            {timelineEvents.map((event) => (
              <button
                key={event.id}
                className="timeline-item"
                draggable
                onDragStart={() => setDraggingEventId(event.id)}
                onDragOver={(dragEvent) => {
                  dragEvent.preventDefault();
                  dragEvent.dataTransfer.dropEffect = "move";
                }}
                onDrop={(dragEvent) => {
                  dragEvent.preventDefault();
                  moveTimelineEvent(event.id);
                }}
                onDragEnd={() => setDraggingEventId("")}
                onClick={() => onSelectChapter(event.chapterId)}
              >
                <span className="timeline-dot" />
                <div>
                  <strong>{event.timeHint || event.title}</strong>
                  <small>{event.volume} / {event.chapterTitle}</small>
                  <p>{event.summary}</p>
                  {!!event.characters.length && <em>{event.characters.join("、")}</em>}
                </div>
              </button>
            ))}
            {!timelineEvents.length && <div className="analysis-empty">时间线会从章节顺序、时间词和小标题中整理事件。</div>}
          </div>
        </div>
      )}

      {tab === "relations" && (
        <div className="analysis-section">
          <div className="relation-controls">
            <details>
              <summary>选择角色卡</summary>
              <div className="relation-filter-row">
                <input value={relationSearch} onChange={(event) => setRelationSearch(event.target.value)} placeholder="搜索角色、分类或关系" />
                <select value={relationCategoryFilter} onChange={(event) => setRelationCategoryFilter(event.target.value)}>
                  <option value="">全部分类</option>
                  {relationCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
              <div className="relation-tree-select">
                {relationGroupedCards.map((group) => renderRelationGroup(group))}
                {!relationGroupedCards.length && <p>没有匹配的角色卡。</p>}
              </div>
              <div className="relation-filter-actions">
                <button onClick={selectVisibleRelationCards}>勾选当前筛选</button>
                <button onClick={() => setSelectedRelationNames([])}>显示全部角色</button>
              </div>
            </details>
            <details>
              <summary>关系类型</summary>
              <div className="chip-list">
                {relationTypes.map((type) => (
                  <button key={type} onClick={() => setRelationTypes((items) => items.filter((item) => item !== type))} title="点击移除">
                    {type}
                  </button>
                ))}
              </div>
              <div className="inline-form">
                <input value={newRelationType} onChange={(event) => setNewRelationType(event.target.value)} placeholder="新增关系类型" />
                <button onClick={addRelationType}>添加</button>
              </div>
            </details>
          </div>
          <div className="analysis-actions">
            <button onClick={() => void loadRelationships()} disabled={busy === "relations"}>
              <RefreshCcw size={16} />
              刷新关系网
            </button>
          </div>
          {relationshipNodes.length ? (
            <>
              <div
                ref={graphShellRef}
                className={`relationship-graph-shell ${graphDragStart || graphNodeDrag ? "dragging" : ""}`}
                onWheel={zoomGraph}
                onMouseDown={startGraphPan}
                onMouseMove={moveGraphPan}
                onMouseUp={stopGraphPan}
                onMouseLeave={stopGraphPan}
              >
                <div className="relationship-graph-tools">
                  <span>{Math.round(graphScale * 100)}%</span>
                  <button onMouseDown={(event) => event.stopPropagation()} onClick={resetGraphView}>重置视图</button>
                  <button onMouseDown={(event) => event.stopPropagation()} onClick={autoLayoutGraph}>自动布局</button>
                </div>
                <svg className="relationship-graph" viewBox={`0 0 ${graph.width} ${graph.height}`} role="img">
                  <defs><marker id="relationship-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
                  <g transform={`translate(${graphOffset.x} ${graphOffset.y}) scale(${graphScale})`}>
                    {relationshipEdges.map((edge) => {
                      const source = graph.positions.get(edge.source);
                      const target = graph.positions.get(edge.target);
                      if (!source || !target) return null;
                      const sourceAnchorX = source.x + (target.x >= source.x ? source.width / 2 : -source.width / 2);
                      const targetAnchorX = target.x + (target.x >= source.x ? -target.width / 2 : target.width / 2);
                      const curve = Math.max(80, Math.abs(targetAnchorX - sourceAnchorX) * 0.42);
                      const labelX = edge.labelX ?? (source.x + target.x) / 2;
                      const labelY = edge.labelY ?? (source.y + target.y) / 2;
                      return (
                        <g key={edge.id}>
                          <path
                            className="relationship-branch"
                            d={`M ${sourceAnchorX} ${source.y} C ${sourceAnchorX + (target.x >= source.x ? curve : -curve)} ${source.y}, ${targetAnchorX + (target.x >= source.x ? -curve : curve)} ${target.y}, ${targetAnchorX} ${target.y}`}
                            strokeWidth={Math.max(1.6, edge.weight / 2)}
                            stroke={edge.color || undefined}
                            markerEnd={["forward", "both"].includes(edge.direction || "none") ? "url(#relationship-arrow)" : undefined}
                            markerStart={["backward", "both"].includes(edge.direction || "none") ? "url(#relationship-arrow)" : undefined}
                          />
                          <text className="relationship-edge-label" x={labelX} y={labelY - 6} textAnchor="middle" onMouseDown={(event) => event.stopPropagation()} onClick={() => setEditingRelationEdgeId(edge.id)}>
                            {edge.label || "关系"}
                          </text>
                          <title>{edge.evidence[0] || "来自角色关系或正文同场统计"}</title>
                        </g>
                      );
                    })}
                    {relationshipNodes.map((node) => {
                      const position = graph.positions.get(node.id);
                      if (!position) return null;
                      return (
                        <g key={node.id} className={`relationship-node ${position.side} ${selectedGraphNodeIds.includes(node.id) ? "selected" : ""}`} onMouseDown={(event) => startGraphNodeDrag(event, node.id)}>
                          <rect x={position.x - position.width / 2} y={position.y - position.height / 2} width={position.width} height={position.height} rx={8} style={node.color ? { fill: node.color } : undefined} />
                          <text x={position.x} y={position.y + 5} textAnchor="middle">
                            {node.name}
                          </text>
                          <title>{node.category}</title>
                        </g>
                      );
                    })}
                  </g>
                </svg>
                {graphSelection && <div className="graph-selection-box" style={{ left: Math.min(graphSelection.startX, graphSelection.currentX), top: Math.min(graphSelection.startY, graphSelection.currentY), width: Math.abs(graphSelection.currentX - graphSelection.startX), height: Math.abs(graphSelection.currentY - graphSelection.startY) }} />}
                {editingRelationEdgeId && (() => { const edge = relationshipEdges.find((item) => item.id === editingRelationEdgeId); if (!edge) return null; return <div className="graph-edge-editor" onMouseDown={(event) => event.stopPropagation()}><strong>{edge.source} / {edge.target}</strong><input value={edge.label} onChange={(event) => setRelationshipEdges((items) => items.map((item) => item.id === edge.id ? { ...item, label: event.target.value } : item))} placeholder="关系类型" /><input type="color" title="连线颜色" value={edge.color || "#64748b"} onChange={(event) => setRelationshipEdges((items) => items.map((item) => item.id === edge.id ? { ...item, color: event.target.value } : item))} /><select value={edge.direction || "none"} onChange={(event) => setRelationshipEdges((items) => items.map((item) => item.id === edge.id ? { ...item, direction: event.target.value as RelationshipEdge["direction"] } : item))}><option value="none">无方向</option><option value="forward">正向</option><option value="backward">反向</option><option value="both">双向</option></select><button onClick={() => void saveRelationshipEdge(relationshipEdges.find((item) => item.id === edge.id) || edge)}>保存并同步</button><button title="关闭" onClick={() => setEditingRelationEdgeId("")}><X size={14} /></button></div>; })()}
              </div>
              <div className="relationship-edges">
                {relationshipEdges.slice(0, 24).map((edge) => (
                  <div key={edge.id}>
                    <strong>{edge.source} - {edge.target}</strong>
                    <span>{edge.label} / 强度 {edge.weight}</span>
                    <p>{edge.evidence[0] || "来自角色关系或正文同场统计"}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="analysis-empty">角色卡片越完整，关系网越清晰。正文中同场出现也会形成关系线。</div>
          )}
        </div>
      )}

      {tab === "consistency" && (
        <div className="analysis-section">
          <details className="scope-panel" open={scopeOpen} onToggle={(event) => setScopeOpen(event.currentTarget.open)}>
            <summary>审查范围</summary>
            <div className="scope-grid">
              <section>
                <header>
                  <strong>审查哪些章节</strong>
                  <div>
                    <button onClick={() => setConsistencyChapterIds(state.chapters.map((chapter) => chapter.id))}>全选</button>
                    <button onClick={() => setConsistencyChapterIds([])}>全书</button>
                  </div>
                </header>
                <div className="scope-check-list">
                  {state.chapters.map((chapter) => (
                    <label key={chapter.id}>
                      <input type="checkbox" checked={consistencyChapterIds.includes(chapter.id)} onChange={() => toggleConsistencyChapter(chapter.id)} />
                      <span>{chapter.volume || "未分卷"} / {chapter.title}</span>
                    </label>
                  ))}
                </div>
              </section>
              <section>
                <header>
                  <strong>依据哪些资料</strong>
                  <div>
                    <button onClick={() => setConsistencySourceIds(knowledgeSources.map((source) => source.id))}>全选</button>
                    <button onClick={() => setConsistencySourceIds([])}>全项目</button>
                  </div>
                </header>
                <div className="scope-check-list">
                  {knowledgeSources.map((source) => (
                    <label key={`${source.sourceType}_${source.id}`}>
                      <input type="checkbox" checked={consistencySourceIds.includes(source.id)} onChange={() => toggleConsistencySource(source.id)} />
                      <span>{source.role} / {source.group} / {source.title}</span>
                    </label>
                  ))}
                </div>
              </section>
            </div>
          </details>
          <div className="analysis-actions">
            <button onClick={() => void runConsistencyCheck()} disabled={busy === "consistency"}>
              <RefreshCcw size={16} />
              开始检查
            </button>
            {consistencyNotice && <span>{consistencyNotice}</span>}
          </div>
          <div className="issue-list">
            {issues.map((issue) => (
              <article key={issue.id} className={`issue-card severity-${issue.severity}`}>
                <header>
                  <strong>{issue.title}</strong>
                  <span>{issue.severity} / {issue.category} / {issue.status || "待处理"}</span>
                </header>
                <p>{issue.detail}</p>
                {issue.suggestion && <em>{issue.suggestion}</em>}
                {!!issue.evidence.length && <small>{issue.evidence.join("；")}</small>}
                <div className="issue-actions">
                  {(["已确认", "已忽略", "已修复", "待处理"] as const).map((status) => (
                    <button key={status} onClick={() => void updateIssueStatus(issue.id, status)}>
                      {status}
                    </button>
                  ))}
                </div>
              </article>
            ))}
            {!issues.length && <div className="analysis-empty">点击“开始检查”后，会结合 AI 和本地规则查找前后矛盾。</div>}
          </div>
        </div>
      )}

      {tab === "versions" && (
        <div className="analysis-section">
          <div className="analysis-actions">
            <button onClick={() => void loadVersions()} disabled={!selectedChapterId || busy === "versions"}>
              <RefreshCcw size={16} />
              读取版本
            </button>
            <span>{selectedChapter ? `当前章节：${selectedChapter.title}` : "请选择一个章节"}</span>
          </div>
          <div className="version-tools">
            <select value={selectedVersionId} onChange={(event) => setSelectedVersionId(event.target.value)} disabled={!versions.length}>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {formatDateTime(version.createdAt)} / {version.wordCount} 字
                </option>
              ))}
            </select>
            <button onClick={() => void compareVersion()} disabled={!selectedVersionId || busy === "compare"}>
              对比当前版本
            </button>
            <button onClick={() => void restoreVersion()} disabled={!selectedVersionId || busy === "restore-version"}>
              恢复此版本
            </button>
          </div>
          {versionCompare ? (
            <div className="diff-view">
              <div className="diff-summary">
                <strong>{formatDateTime(versionCompare.version.createdAt)} 对比当前</strong>
                <span>新增 {versionCompare.added} 行 / 删除 {versionCompare.removed} 行{versionCompare.truncated ? " / 已截断显示" : ""}</span>
              </div>
              {versionCompare.diff.map((line, index) => (
                <p key={`${line.type}_${index}`} className={`diff-line ${line.type}`}>
                  <span>{line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}</span>
                  {line.text}
                </p>
              ))}
            </div>
          ) : (
            <div className="analysis-empty">修改并保存章节后，软件会自动保留保存前版本；这里可以和当前内容对比。</div>
          )}
        </div>
      )}

      {tab === "export" && (
        <div className="analysis-section export-lab">
          <div className="tool-grid">
            <div className="tool-card">
              <FileDown size={22} />
              <strong>按文档批量导出 DOCX</strong>
              <label>
                <input type="checkbox" checked={exportOptions.includeOutline} onChange={(event) => setExportOptions((value) => ({ ...value, includeOutline: event.target.checked }))} />
                带大纲
              </label>
              <label>
                <input type="checkbox" checked={exportOptions.includeMaterials} onChange={(event) => setExportOptions((value) => ({ ...value, includeMaterials: event.target.checked }))} />
                带补充材料
              </label>
              <label>
                <input type="checkbox" checked={exportOptions.includeCharacters} onChange={(event) => setExportOptions((value) => ({ ...value, includeCharacters: event.target.checked }))} />
                带角色卡
              </label>
              <label>
                <input type="checkbox" checked={exportOptions.includeWorld} onChange={(event) => setExportOptions((value) => ({ ...value, includeWorld: event.target.checked }))} />
                带世界观资料
              </label>
              <button onClick={() => onExportBookWithOptions(exportOptions)}>按选项逐篇导出</button>
              <button onClick={() => onExportBook()}>只导出正文</button>
            </div>
            <div className="tool-card">
              <Wand2 size={22} />
              <strong>提取地点/势力/物品候选</strong>
              <select value={extractScope} onChange={(event) => setExtractScope(event.target.value as "book" | "chapter")}>
                <option value="book">从全书提取</option>
                <option value="chapter">仅从当前文档提取</option>
              </select>
              <button onClick={() => void prepareWorldCandidates()} disabled={busy === "extract"}>
                生成候选
              </button>
              <span>候选会先显示在下方，勾选后才写入世界观。</span>
            </div>
          </div>
          {!!worldCandidates.length && (
            <div className="candidate-list">
              <div className="analysis-actions">
                <button onClick={() => setWorldCandidates((items) => items.map((item) => ({ ...item, selected: true })))}>全选</button>
                <button onClick={() => setWorldCandidates((items) => items.map((item) => ({ ...item, selected: false })))}>全不选</button>
                <button onClick={() => void saveSelectedCandidates()} disabled={busy === "save-candidates"}>
                  写入选中条目
                </button>
              </div>
              {worldCandidates.map((candidate) => (
                <article key={candidate.id} className="candidate-card">
                  <label>
                    <input
                      type="checkbox"
                      checked={candidate.selected}
                      onChange={(event) => setWorldCandidates((items) => items.map((item) => (item.id === candidate.id ? { ...item, selected: event.target.checked } : item)))}
                    />
                    <strong>{candidate.title}</strong>
                  </label>
                  <span>
                    {candidate.category} / {candidate.action === "merge" ? `合并到：${candidate.matchedTitle}` : "新建条目"}
                  </span>
                  <p>{contentToPlainText(candidate.content).slice(0, 180)}</p>
                </article>
              ))}
            </div>
          )}
          <details className="experimental-card">
            <summary>试验功能</summary>
            <ExperimentalTools
              appearanceStats={appearanceStats}
              worldMapNodes={worldMapNodes}
              worldMapEdges={worldMapEdges}
              materials={materials}
              materialDraft={materialDraft}
              onLoadAppearance={() => void loadAppearanceStats()}
              onLoadWorldMap={() => void loadWorldMap()}
              onLoadMaterials={() => void loadMaterials()}
              onMaterialDraft={setMaterialDraft}
              onSaveMaterial={() => void saveMaterialDraft()}
              onDeleteMaterial={(id) => void deleteMaterialItem(id)}
            />
          </details>
        </div>
      )}
    </section>
  );
}
