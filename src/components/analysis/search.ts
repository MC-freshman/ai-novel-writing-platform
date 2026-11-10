import { getErrorMessage } from "../../lib/text-utils";
import type { AnalysisContext } from "./context";

export function useAnalysisSearch(
  context: Pick<
    AnalysisContext,
    | "onStatus"
    | "query"
    | "saveAnalysisDraft"
    | "setBusy"
    | "setSearchResults"
    | "setSearchError"
    | "setSearchedQuery"
  >,
) {
  const {
    onStatus,
    query,
    saveAnalysisDraft,
    setBusy,
    setSearchResults,
    setSearchError,
    setSearchedQuery,
  } = context;
  async function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) {
      onStatus("请先输入要搜索的关键词。");
      return;
    }
    setBusy("search");
    setSearchError("");
    onStatus("正在全局搜索...");
    try {
      const result = await window.novelAPI.globalSearch({ query: trimmed });
      setSearchResults(result.results);
      setSearchedQuery(trimmed);
      saveAnalysisDraft({ query: trimmed, searchResults: result.results });
      onStatus(`搜索完成：找到 ${result.results.length} 条结果`);
    } catch (error) {
      const message = getErrorMessage(error);
      setSearchError(message);
      setSearchedQuery(trimmed);
      onStatus(`搜索失败：${message}`);
    } finally {
      setBusy("");
    }
  }
  return { runSearch };
}
