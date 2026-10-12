import { useCallback, useMemo, useRef, useState } from "react";
import type {
  AnalysisTab,
  ChapterVersion,
  ChapterVersionCompare,
  ConsistencyIssue,
  ExtractedWorldCandidate,
  GlobalSearchResult,
  AppearanceStat,
  MaterialItem,
  RelationshipEdge,
  RelationshipNode,
  TimelineEvent,
  WorldMapEdge,
  WorldMapNode,
} from "../../types";
import { groupByCategory, normalizeCategoryLabel } from "../../lib/categories";
import type { PageSaveHandle, PageSaveKind } from "../../hooks/useEntityDraft";
import type { AnalysisPanelProps } from "./props";

export function useAnalysisBindings(
  context: Pick<
    AnalysisPanelProps,
    "networkOpenRequest" | "onRegisterSave" | "selectedChapterId" | "state"
  >,
) {
  const { networkOpenRequest, onRegisterSave, selectedChapterId, state } =
    context;
  const [tab, setTab] = useState<AnalysisTab>(
    networkOpenRequest ? "progress" : "search",
  );

  const userSelectedTab = useRef(false);

  const networkSaver = useRef<PageSaveHandle | null>(null);

  const registerNetworkSave = useCallback(
    (kind: PageSaveKind, handle: PageSaveHandle | null) => {
      networkSaver.current = handle;
      onRegisterSave(kind, handle);
    },
    [onRegisterSave],
  );

  const [query, setQuery] = useState("");

  const [searchResults, setSearchResults] = useState<GlobalSearchResult[]>([]);

  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);

  const [relationshipNodes, setRelationshipNodes] = useState<
    RelationshipNode[]
  >([]);

  const [relationshipEdges, setRelationshipEdges] = useState<
    RelationshipEdge[]
  >([]);

  const [issues, setIssues] = useState<ConsistencyIssue[]>([]);

  const [consistencyNotice, setConsistencyNotice] = useState("");

  const [versions, setVersions] = useState<ChapterVersion[]>([]);

  const [selectedVersionId, setSelectedVersionId] = useState("");

  const [versionCompare, setVersionCompare] =
    useState<ChapterVersionCompare | null>(null);

  const [timelineMode, setTimelineMode] = useState<"local" | "ai">("ai");

  const [draggingEventId, setDraggingEventId] = useState("");

  const [selectedRelationNames, setSelectedRelationNames] = useState<string[]>(
    [],
  );

  const [relationTypes, setRelationTypes] = useState<string[]>([
    "同盟",
    "敌对",
    "师徒",
    "亲属",
    "感情",
    "交易",
    "背叛",
  ]);

  const [newRelationType, setNewRelationType] = useState("");

  const [exportOptions, setExportOptions] = useState({
    includeOutline: true,
    includeMaterials: true,
    includeCharacters: false,
    includeWorld: false,
  });

  const [extractScope, setExtractScope] = useState<"book" | "chapter">("book");

  const [worldCandidates, setWorldCandidates] = useState<
    ExtractedWorldCandidate[]
  >([]);

  const [appearanceStats, setAppearanceStats] = useState<AppearanceStat[]>([]);

  const [worldMapNodes, setWorldMapNodes] = useState<WorldMapNode[]>([]);

  const [worldMapEdges, setWorldMapEdges] = useState<WorldMapEdge[]>([]);

  const [materials, setMaterials] = useState<MaterialItem[]>([]);

  const [materialDraft, setMaterialDraft] = useState<Partial<MaterialItem>>({
    title: "",
    category: "灵感",
    content: "",
  });

  const [busy, setBusy] = useState("");

  const [analysisLoaded, setAnalysisLoaded] = useState(false);

  const [relationSearch, setRelationSearch] = useState("");

  const [relationCategoryFilter, setRelationCategoryFilter] = useState("");

  const [graphScale, setGraphScale] = useState(1);

  const [graphOffset, setGraphOffset] = useState({ x: 0, y: 0 });

  const [graphDragStart, setGraphDragStart] = useState<{
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const [graphNodeDrag, setGraphNodeDrag] = useState<{
    startX: number;
    startY: number;
    positions: Record<string, { x: number; y: number }>;
  } | null>(null);

  const [graphSelection, setGraphSelection] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  const [selectedGraphNodeIds, setSelectedGraphNodeIds] = useState<string[]>(
    [],
  );

  const [editingRelationEdgeId, setEditingRelationEdgeId] = useState("");

  const graphShellRef = useRef<HTMLDivElement | null>(null);

  const [consistencyChapterIds, setConsistencyChapterIds] = useState<string[]>(
    [],
  );

  const [consistencySourceIds, setConsistencySourceIds] = useState<string[]>(
    [],
  );

  const [scopeOpen, setScopeOpen] = useState(false);

  const selectedChapter =
    state.chapters.find((chapter) => chapter.id === selectedChapterId) ||
    state.selectedChapter;

  const relationCategories = useMemo(
    () =>
      [
        ...new Set(
          state.characters.map((card) => normalizeCategoryLabel(card.category)),
        ),
      ].sort((a, b) => a.localeCompare(b, "zh-CN")),
    [state.characters],
  );

  const relationVisibleCards = useMemo(() => {
    const keyword = relationSearch.trim().toLowerCase();
    return state.characters.filter((card) => {
      const category = normalizeCategoryLabel(card.category);
      const categoryMatched =
        !relationCategoryFilter ||
        category === relationCategoryFilter ||
        category.startsWith(`${relationCategoryFilter}/`);
      const keywordMatched =
        !keyword ||
        card.name.toLowerCase().includes(keyword) ||
        category.toLowerCase().includes(keyword) ||
        String(card.relationships || "")
          .toLowerCase()
          .includes(keyword);
      return categoryMatched && keywordMatched;
    });
  }, [relationCategoryFilter, relationSearch, state.characters]);

  const relationGroupedCards = useMemo(
    () => groupByCategory(relationVisibleCards),
    [relationVisibleCards],
  );

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

  const networkOpenRequestRef = useRef(networkOpenRequest);

  networkOpenRequestRef.current = networkOpenRequest;
  return {
    tab,
    setTab,
    userSelectedTab,
    networkSaver,
    registerNetworkSave,
    query,
    setQuery,
    searchResults,
    setSearchResults,
    timelineEvents,
    setTimelineEvents,
    relationshipNodes,
    setRelationshipNodes,
    relationshipEdges,
    setRelationshipEdges,
    issues,
    setIssues,
    consistencyNotice,
    setConsistencyNotice,
    versions,
    setVersions,
    selectedVersionId,
    setSelectedVersionId,
    versionCompare,
    setVersionCompare,
    timelineMode,
    setTimelineMode,
    draggingEventId,
    setDraggingEventId,
    selectedRelationNames,
    setSelectedRelationNames,
    relationTypes,
    setRelationTypes,
    newRelationType,
    setNewRelationType,
    exportOptions,
    setExportOptions,
    extractScope,
    setExtractScope,
    worldCandidates,
    setWorldCandidates,
    appearanceStats,
    setAppearanceStats,
    worldMapNodes,
    setWorldMapNodes,
    worldMapEdges,
    setWorldMapEdges,
    materials,
    setMaterials,
    materialDraft,
    setMaterialDraft,
    busy,
    setBusy,
    analysisLoaded,
    setAnalysisLoaded,
    relationSearch,
    setRelationSearch,
    relationCategoryFilter,
    setRelationCategoryFilter,
    graphScale,
    setGraphScale,
    graphOffset,
    setGraphOffset,
    graphDragStart,
    setGraphDragStart,
    graphNodeDrag,
    setGraphNodeDrag,
    graphSelection,
    setGraphSelection,
    selectedGraphNodeIds,
    setSelectedGraphNodeIds,
    editingRelationEdgeId,
    setEditingRelationEdgeId,
    graphShellRef,
    consistencyChapterIds,
    setConsistencyChapterIds,
    consistencySourceIds,
    setConsistencySourceIds,
    scopeOpen,
    setScopeOpen,
    selectedChapter,
    relationCategories,
    relationVisibleCards,
    relationGroupedCards,
    knowledgeSources,
    networkOpenRequestRef,
  };
}
export type AnalysisBindings = ReturnType<typeof useAnalysisBindings>;
