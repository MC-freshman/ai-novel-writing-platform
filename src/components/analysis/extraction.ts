import type { AnalysisContext } from "./context";

export function useAnalysisExtraction(
  context: Pick<
    AnalysisContext,
    | "extractScope"
    | "onApplyState"
    | "onStatus"
    | "saveAnalysisDraft"
    | "selectedChapterId"
    | "setBusy"
    | "setWorldCandidates"
    | "worldCandidates"
  >,
) {
  const {
    extractScope,
    onApplyState,
    onStatus,
    saveAnalysisDraft,
    selectedChapterId,
    setBusy,
    setWorldCandidates,
    worldCandidates,
  } = context;
  async function prepareWorldCandidates() {
    setBusy("extract");
    onStatus(
      extractScope === "chapter"
        ? "正在从当前文档提取候选..."
        : "正在从全书提取候选...",
    );
    try {
      const result = await window.novelAPI.extractWorldCardsFromOutline({
        scope: extractScope,
        chapterId: selectedChapterId,
      });
      setWorldCandidates(result.candidates);
      saveAnalysisDraft({ extractScope, worldCandidates: result.candidates });
      onStatus(`已提取 ${result.candidates.length} 个候选；请勾选后写入世界观`);
    } catch (error) {
      onStatus(
        `提取候选失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy("");
    }
  }

  async function saveSelectedCandidates() {
    setBusy("save-candidates");
    onStatus("正在写入选中的资料条目...");
    try {
      const result = await window.novelAPI.saveWorldCardCandidates({
        candidates: worldCandidates,
      });
      onApplyState(result.state);
      setWorldCandidates([]);
      saveAnalysisDraft({ worldCandidates: [] });
      onStatus(
        `已写入资料条目：新增 ${result.created} 条，合并 ${result.updated} 条`,
      );
    } catch (error) {
      onStatus(
        `写入资料失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy("");
    }
  }
  return { prepareWorldCandidates, saveSelectedCandidates };
}
