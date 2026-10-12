import type { AppState, RelationshipEdge } from "../../types";
import { getErrorMessage } from "../../lib/text-utils";
import type { AnalysisContext } from "./context";

export function useAnalysisRelations(
  context: Pick<
    AnalysisContext,
    | "newRelationType"
    | "onApplyState"
    | "onStatus"
    | "relationCategoryFilter"
    | "relationTypes"
    | "relationVisibleCards"
    | "relationshipEdges"
    | "relationshipNodes"
    | "saveAnalysisDraft"
    | "selectedRelationNames"
    | "setBusy"
    | "setEditingRelationEdgeId"
    | "setNewRelationType"
    | "setRelationTypes"
    | "setRelationshipEdges"
    | "setRelationshipNodes"
    | "setSelectedRelationNames"
    | "state"
  >,
) {
  const {
    newRelationType,
    onApplyState,
    onStatus,
    relationCategoryFilter,
    relationTypes,
    relationVisibleCards,
    relationshipEdges,
    relationshipNodes,
    saveAnalysisDraft,
    selectedRelationNames,
    setBusy,
    setEditingRelationEdgeId,
    setNewRelationType,
    setRelationTypes,
    setRelationshipEdges,
    setRelationshipNodes,
    setSelectedRelationNames,
    state,
  } = context;
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
        return saved
          ? { ...node, x: saved.x, y: saved.y, color: saved.color }
          : node;
      });
      const mergedEdges = result.edges.map((edge) => {
        const saved = relationshipEdges.find((item) => item.id === edge.id);
        return saved
          ? {
              ...edge,
              label: saved.label || edge.label,
              labelX: saved.labelX,
              labelY: saved.labelY,
              color: saved.color,
              direction: saved.direction,
            }
          : edge;
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
      onStatus(
        `关系网已生成：${result.nodes.length} 个角色，${result.edges.length} 条关系`,
      );
    } catch (error) {
      onStatus(
        `生成关系网失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy("");
    }
  }

  function toggleRelationName(name: string) {
    setSelectedRelationNames((items) =>
      items.includes(name)
        ? items.filter((item) => item !== name)
        : [...items, name],
    );
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

  async function saveRelationshipEdge(edge: RelationshipEdge) {
    const label = String(edge.label || "关系").trim() || "关系";
    setRelationshipEdges((items) =>
      items.map((item) => (item.id === edge.id ? { ...edge, label } : item)),
    );
    const source = state.characters.find((card) => card.name === edge.source);
    const target = state.characters.find((card) => card.name === edge.target);
    try {
      let nextState: AppState | null = null;
      if (source) {
        const line = `${target?.name || edge.target}：${label}`;
        nextState = await window.novelAPI.saveCharacter({
          ...source,
          relationships: source.relationships.includes(line)
            ? source.relationships
            : [source.relationships.trim(), line].filter(Boolean).join("\n"),
        });
      }
      if (target) {
        const line = `${source?.name || edge.source}：${label}`;
        nextState = await window.novelAPI.saveCharacter({
          ...target,
          relationships: target.relationships.includes(line)
            ? target.relationships
            : [target.relationships.trim(), line].filter(Boolean).join("\n"),
        });
      }
      if (nextState) onApplyState(nextState);
      setEditingRelationEdgeId("");
      onStatus(`关系“${label}”已同步到角色卡`);
    } catch (error) {
      onStatus(`保存关系失败：${getErrorMessage(error)}`);
    }
  }

  function selectVisibleRelationCards() {
    const names = relationVisibleCards.map((card) => card.name).filter(Boolean);
    setSelectedRelationNames((items) => [...new Set([...items, ...names])]);
  }
  return {
    loadRelationships,
    toggleRelationName,
    addRelationType,
    saveRelationshipEdge,
    selectVisibleRelationCards,
  };
}
