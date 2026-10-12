import type { AnalysisContext } from "./context";

export function useAnalysisSearch(
  context: Pick<
    AnalysisContext,
    "onStatus" | "query" | "saveAnalysisDraft" | "setBusy" | "setSearchResults"
  >,
) {
  const { onStatus, query, saveAnalysisDraft, setBusy, setSearchResults } =
    context;
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
      onStatus(
        `搜索失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy("");
    }
  }
  return { runSearch };
}
