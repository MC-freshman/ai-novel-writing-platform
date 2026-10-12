import type { ConsistencyIssue } from "../../types";
import type { AnalysisContext } from "./context";

export function useAnalysisConsistency(
  context: Pick<
    AnalysisContext,
    | "consistencyChapterIds"
    | "consistencyNotice"
    | "consistencySourceIds"
    | "onStatus"
    | "saveAnalysisDraft"
    | "setBusy"
    | "setConsistencyChapterIds"
    | "setConsistencyNotice"
    | "setConsistencySourceIds"
    | "setIssues"
  >,
) {
  const {
    consistencyChapterIds,
    consistencyNotice,
    consistencySourceIds,
    onStatus,
    saveAnalysisDraft,
    setBusy,
    setConsistencyChapterIds,
    setConsistencyNotice,
    setConsistencySourceIds,
    setIssues,
  } = context;
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
      const notice = result.apiError
        ? `AI 暂时不可用，已显示本地检查结果：${result.apiError}`
        : `AI 检查完成，引用检索片段 ${result.contextCount} 条`;
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
      onStatus(
        `设定检查失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy("");
    }
  }

  async function updateIssueStatus(
    issueId: string,
    status: ConsistencyIssue["status"],
  ) {
    if (!status) return;
    try {
      await window.novelAPI.updateIssueStatus({ issueId, status });
      setIssues((items) => {
        const next = items.map((item) =>
          item.id === issueId ? { ...item, status } : item,
        );
        saveAnalysisDraft({
          consistency: { issues: next, notice: consistencyNotice },
        });
        return next;
      });
      onStatus(`问题已标记为：${status}`);
    } catch (error) {
      onStatus(
        `更新问题状态失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function toggleConsistencyChapter(chapterId: string) {
    setConsistencyChapterIds((items) =>
      items.includes(chapterId)
        ? items.filter((id) => id !== chapterId)
        : [...items, chapterId],
    );
  }

  function toggleConsistencySource(sourceId: string) {
    setConsistencySourceIds((items) =>
      items.includes(sourceId)
        ? items.filter((id) => id !== sourceId)
        : [...items, sourceId],
    );
  }
  return {
    runConsistencyCheck,
    updateIssueStatus,
    toggleConsistencyChapter,
    toggleConsistencySource,
  };
}
