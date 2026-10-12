import { useMemo } from "react";
import type { RecoveryDraft } from "../types";
import type { AppContext } from "./context";

export function useAppRecovery(
  context: Pick<
    AppContext,
    | "changeView"
    | "chapterContent"
    | "chapterRevision"
    | "chapterTitle"
    | "chapterVolume"
    | "recoveryDrafts"
    | "selectedChapter"
    | "setChapterContent"
    | "setChapterTitle"
    | "setChapterVolume"
    | "setDirty"
    | "setNetworkOpenRequest"
    | "setRecoveryDrafts"
    | "setStatus"
  >,
) {
  const {
    changeView,
    chapterContent,
    chapterRevision,
    chapterTitle,
    chapterVolume,
    recoveryDrafts,
    selectedChapter,
    setChapterContent,
    setChapterTitle,
    setChapterVolume,
    setDirty,
    setNetworkOpenRequest,
    setRecoveryDrafts,
    setStatus,
  } = context;
  const activeRecoveryDraft = useMemo(
    () =>
      recoveryDrafts.find(
        (item) =>
          item.chapterId === selectedChapter?.id &&
          item.content !== chapterContent,
      ) || null,
    [chapterContent, recoveryDrafts, selectedChapter?.id],
  );

  function restoreRecoveryDraft(draft: RecoveryDraft) {
    if (draft.kind === "novel-network") {
      void changeView("analysis").then((changed) => {
        if (changed) setNetworkOpenRequest((value) => value + 1);
      });
      setStatus("请在进度 → 小说统筹网中查看已恢复的草稿");
      return;
    }
    if (draft.kind === "character" || draft.kind === "world") {
      void changeView(draft.kind === "character" ? "characters" : "world");
      setStatus("请在对应表单中查看已恢复的草稿");
      return;
    }
    setChapterContent(draft.content);
    setChapterTitle(draft.chapterTitle || chapterTitle);
    setChapterVolume(draft.volume || chapterVolume);
    setRecoveryDrafts((current) =>
      current.filter((item) => item.chapterId !== draft.chapterId),
    );
    setDirty(true);
    setStatus(
      draft.baseRevision && draft.baseRevision !== chapterRevision
        ? "已恢复草稿；原章节保存后曾变化，请对照历史版本后再保存"
        : "已恢复未保存草稿",
    );
  }

  async function discardRecoveryDraft(draft: RecoveryDraft) {
    await window.novelAPI.clearRecoveryDraft(draft.chapterId).catch(() => null);
    setRecoveryDrafts((current) =>
      current.filter((item) => item.chapterId !== draft.chapterId),
    );
    setStatus("已放弃这份恢复草稿，当前正文未变化");
  }

  return { activeRecoveryDraft, restoreRecoveryDraft, discardRecoveryDraft };
}
