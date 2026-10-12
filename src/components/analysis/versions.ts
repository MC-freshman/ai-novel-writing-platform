import { useCallback } from "react";
import { formatDateTime, getErrorMessage } from "../../lib/text-utils";
import type { AnalysisContext } from "./context";

export function useAnalysisVersions(
  context: Pick<
    AnalysisContext,
    | "onApplyState"
    | "onStatus"
    | "selectedChapterId"
    | "selectedVersionId"
    | "setBusy"
    | "setSelectedVersionId"
    | "setVersionCompare"
    | "setVersions"
    | "state"
  >,
) {
  const {
    onApplyState,
    onStatus,
    selectedChapterId,
    selectedVersionId,
    setBusy,
    setSelectedVersionId,
    setVersionCompare,
    setVersions,
    state,
  } = context;
  const loadVersions = useCallback(async () => {
    if (!selectedChapterId) return;
    setBusy("versions");
    setVersionCompare(null);
    onStatus("正在读取章节历史版本...");
    try {
      const result =
        await window.novelAPI.listChapterVersions(selectedChapterId);
      setVersions(result.versions);
      setSelectedVersionId(result.versions[0]?.id || "");
      onStatus(
        result.versions.length
          ? `已读取 ${result.versions.length} 个历史版本`
          : "当前章节还没有历史版本；保存修改后会开始记录",
      );
    } catch (error) {
      onStatus(
        `读取历史版本失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy("");
    }
  }, [
    onStatus,
    selectedChapterId,
    setBusy,
    setSelectedVersionId,
    setVersionCompare,
    setVersions,
  ]);

  async function compareVersion() {
    if (!selectedChapterId || !selectedVersionId) return;
    setBusy("compare");
    onStatus("正在对比版本...");
    try {
      const result = await window.novelAPI.compareChapterVersion({
        chapterId: selectedChapterId,
        versionId: selectedVersionId,
      });
      setVersionCompare(result);
      onStatus(
        `版本对比完成：新增 ${result.added} 行，删除 ${result.removed} 行`,
      );
    } catch (error) {
      onStatus(
        `版本对比失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy("");
    }
  }

  async function restoreVersion() {
    if (!selectedChapterId || !selectedVersionId) return;
    if (
      !window.confirm(
        "恢复后，当前内容会先自动保存为一个历史版本。确认恢复所选版本吗？",
      )
    )
      return;
    setBusy("restore-version");
    try {
      const result = await window.novelAPI.restoreChapterVersion({
        chapterId: selectedChapterId,
        versionId: selectedVersionId,
        expectedRevision: state.chapterRevision,
      });
      onApplyState(result.state);
      setVersionCompare(null);
      onStatus(
        `已恢复 ${formatDateTime(result.restoredVersion.createdAt)} 的版本，恢复前内容也已备份`,
      );
    } catch (error) {
      onStatus(`恢复版本失败：${getErrorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }
  return { loadVersions, compareVersion, restoreVersion };
}
