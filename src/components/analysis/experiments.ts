import type { AnalysisContext } from "./context";

export function useAnalysisExperiments(
  context: Pick<
    AnalysisContext,
    | "materialDraft"
    | "onStatus"
    | "saveAnalysisDraft"
    | "setAppearanceStats"
    | "setBusy"
    | "setMaterialDraft"
    | "setMaterials"
    | "setWorldMapEdges"
    | "setWorldMapNodes"
  >,
) {
  const {
    materialDraft,
    onStatus,
    saveAnalysisDraft,
    setAppearanceStats,
    setBusy,
    setMaterialDraft,
    setMaterials,
    setWorldMapEdges,
    setWorldMapNodes,
  } = context;
  async function loadAppearanceStats() {
    setBusy("appearance");
    try {
      const result = await window.novelAPI.getAppearanceStats();
      setAppearanceStats(result.stats);
      saveAnalysisDraft({ appearanceStats: result.stats });
      onStatus(`人物出场统计完成：${result.stats.length} 个角色`);
    } catch (error) {
      onStatus(
        `人物出场统计失败：${error instanceof Error ? error.message : String(error)}`,
      );
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
      saveAnalysisDraft({
        worldMapNodes: result.nodes,
        worldMapEdges: result.edges,
      });
      onStatus(
        `地点/势力版图已整理：${result.nodes.length} 个节点，${result.edges.length} 条关联`,
      );
    } catch (error) {
      onStatus(
        `整理版图失败：${error instanceof Error ? error.message : String(error)}`,
      );
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
      onStatus(
        `刷新素材失败：${error instanceof Error ? error.message : String(error)}`,
      );
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
      saveAnalysisDraft({
        materials: result.materials,
        materialDraft: { title: "", category: "灵感", content: "" },
      });
      onStatus(`素材已保存：${result.material.title}`);
    } catch (error) {
      onStatus(
        `保存素材失败：${error instanceof Error ? error.message : String(error)}`,
      );
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
      onStatus(
        `删除素材失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy("");
    }
  }
  return {
    loadAppearanceStats,
    loadWorldMap,
    loadMaterials,
    saveMaterialDraft,
    deleteMaterialItem,
  };
}
