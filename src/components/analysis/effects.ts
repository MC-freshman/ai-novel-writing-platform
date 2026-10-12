import { useEffect } from "react";
import type { AnalysisSnapshot, AnalysisTab } from "../../types";
import type { AnalysisContext } from "./context";

export function useAnalysisEffects(
  context: Pick<
    AnalysisContext,
    | "analysisLoaded"
    | "appearanceStats"
    | "consistencyChapterIds"
    | "consistencyNotice"
    | "consistencySourceIds"
    | "exportOptions"
    | "extractScope"
    | "issues"
    | "loadVersions"
    | "materialDraft"
    | "materials"
    | "networkOpenRequest"
    | "networkOpenRequestRef"
    | "query"
    | "relationCategoryFilter"
    | "relationTypes"
    | "relationshipEdges"
    | "relationshipNodes"
    | "saveAnalysisDraft"
    | "searchResults"
    | "selectedChapterId"
    | "selectedRelationNames"
    | "setAnalysisLoaded"
    | "setAppearanceStats"
    | "setConsistencyChapterIds"
    | "setConsistencyNotice"
    | "setConsistencySourceIds"
    | "setExportOptions"
    | "setExtractScope"
    | "setIssues"
    | "setMaterialDraft"
    | "setMaterials"
    | "setQuery"
    | "setRelationCategoryFilter"
    | "setRelationTypes"
    | "setRelationshipEdges"
    | "setRelationshipNodes"
    | "setSearchResults"
    | "setSelectedRelationNames"
    | "setTab"
    | "setTimelineEvents"
    | "setTimelineMode"
    | "setWorldCandidates"
    | "setWorldMapEdges"
    | "setWorldMapNodes"
    | "state"
    | "tab"
    | "timelineEvents"
    | "timelineMode"
    | "userSelectedTab"
    | "worldCandidates"
    | "worldMapEdges"
    | "worldMapNodes"
  >,
) {
  const {
    analysisLoaded,
    appearanceStats,
    consistencyChapterIds,
    consistencyNotice,
    consistencySourceIds,
    exportOptions,
    extractScope,
    issues,
    loadVersions,
    materialDraft,
    materials,
    networkOpenRequest,
    networkOpenRequestRef,
    query,
    relationCategoryFilter,
    relationTypes,
    relationshipEdges,
    relationshipNodes,
    saveAnalysisDraft,
    searchResults,
    selectedChapterId,
    selectedRelationNames,
    setAnalysisLoaded,
    setAppearanceStats,
    setConsistencyChapterIds,
    setConsistencyNotice,
    setConsistencySourceIds,
    setExportOptions,
    setExtractScope,
    setIssues,
    setMaterialDraft,
    setMaterials,
    setQuery,
    setRelationCategoryFilter,
    setRelationTypes,
    setRelationshipEdges,
    setRelationshipNodes,
    setSearchResults,
    setSelectedRelationNames,
    setTab,
    setTimelineEvents,
    setTimelineMode,
    setWorldCandidates,
    setWorldMapEdges,
    setWorldMapNodes,
    state,
    tab,
    timelineEvents,
    timelineMode,
    userSelectedTab,
    worldCandidates,
    worldMapEdges,
    worldMapNodes,
  } = context;
  useEffect(() => {
    if (networkOpenRequest) setTab("progress");
  }, [networkOpenRequest, setTab]);

  useEffect(() => {
    let cancelled = false;
    function restoreAnalysisSnapshot(snapshot: AnalysisSnapshot) {
      if (
        !userSelectedTab.current &&
        !networkOpenRequestRef.current &&
        snapshot.tab &&
        [
          "progress",
          "search",
          "timeline",
          "relations",
          "consistency",
          "versions",
          "export",
        ].includes(snapshot.tab)
      ) {
        setTab(snapshot.tab as AnalysisTab);
      }
      if (typeof snapshot.query === "string") setQuery(snapshot.query);
      if (Array.isArray(snapshot.searchResults))
        setSearchResults(snapshot.searchResults);
      if (snapshot.timeline?.events)
        setTimelineEvents(snapshot.timeline.events);
      if (
        snapshot.timelineOptions?.mode === "local" ||
        snapshot.timelineOptions?.mode === "ai"
      )
        setTimelineMode(snapshot.timelineOptions.mode);
      if (snapshot.relationships?.nodes)
        setRelationshipNodes(snapshot.relationships.nodes);
      if (snapshot.relationships?.edges)
        setRelationshipEdges(snapshot.relationships.edges);
      if (Array.isArray(snapshot.relationshipOptions?.characterNames))
        setSelectedRelationNames(snapshot.relationshipOptions.characterNames);
      if (typeof snapshot.relationshipOptions?.categoryFilter === "string")
        setRelationCategoryFilter(snapshot.relationshipOptions.categoryFilter);
      if (
        Array.isArray(snapshot.relationshipOptions?.relationTypes) &&
        snapshot.relationshipOptions.relationTypes.length
      )
        setRelationTypes(snapshot.relationshipOptions.relationTypes);
      if (snapshot.consistency?.issues) setIssues(snapshot.consistency.issues);
      if (snapshot.consistency?.notice || snapshot.consistency?.apiError)
        setConsistencyNotice(
          snapshot.consistency.notice ||
            `AI 暂时不可用，已显示本地检查结果：${snapshot.consistency.apiError}`,
        );
      if (Array.isArray(snapshot.consistencyOptions?.chapterIds))
        setConsistencyChapterIds(snapshot.consistencyOptions.chapterIds);
      if (Array.isArray(snapshot.consistencyOptions?.knowledgeSourceIds))
        setConsistencySourceIds(snapshot.consistencyOptions.knowledgeSourceIds);
      if (snapshot.exportOptions) {
        const legacyOptions =
          snapshot.exportOptions.includeMaterials === undefined;
        setExportOptions({
          includeOutline: legacyOptions ? true : false,
          includeMaterials: true,
          includeCharacters: false,
          includeWorld: false,
          ...snapshot.exportOptions,
          ...(legacyOptions
            ? { includeOutline: true, includeMaterials: true }
            : {}),
        });
      }
      if (
        snapshot.extractScope === "book" ||
        snapshot.extractScope === "chapter"
      )
        setExtractScope(snapshot.extractScope);
      if (Array.isArray(snapshot.worldCandidates))
        setWorldCandidates(snapshot.worldCandidates);
      if (Array.isArray(snapshot.appearanceStats))
        setAppearanceStats(snapshot.appearanceStats);
      if (Array.isArray(snapshot.worldMapNodes))
        setWorldMapNodes(snapshot.worldMapNodes);
      if (Array.isArray(snapshot.worldMapEdges))
        setWorldMapEdges(snapshot.worldMapEdges);
      if (Array.isArray(snapshot.materials)) setMaterials(snapshot.materials);
      if (snapshot.materialDraft) setMaterialDraft(snapshot.materialDraft);
    }
    setAnalysisLoaded(false);
    window.novelAPI
      .getAnalysisState()
      .then((snapshot) => {
        if (!cancelled) restoreAnalysisSnapshot(snapshot || {});
      })
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setAnalysisLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [
    networkOpenRequestRef,
    setAnalysisLoaded,
    setAppearanceStats,
    setConsistencyChapterIds,
    setConsistencyNotice,
    setConsistencySourceIds,
    setExportOptions,
    setExtractScope,
    setIssues,
    setMaterialDraft,
    setMaterials,
    setQuery,
    setRelationCategoryFilter,
    setRelationTypes,
    setRelationshipEdges,
    setRelationshipNodes,
    setSearchResults,
    setSelectedRelationNames,
    setTab,
    setTimelineEvents,
    setTimelineMode,
    setWorldCandidates,
    setWorldMapEdges,
    setWorldMapNodes,
    state.projectPath,
    userSelectedTab,
  ]);

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
    saveAnalysisDraft,
  ]);

  useEffect(() => {
    if (tab === "versions" && selectedChapterId) void loadVersions();
  }, [loadVersions, selectedChapterId, tab]);
}
