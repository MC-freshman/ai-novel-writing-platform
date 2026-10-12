import { useCallback } from "react";
import { readChapterDraft, isCurrentEpoch } from "../stores/app-stores";
import type { AppContext } from "./context";

export function useAppSaving(
  context: Pick<
    AppContext,
    | "chapterContent"
    | "chapterRevision"
    | "chapterTitle"
    | "chapterVolume"
    | "dirty"
    | "pageSaversRef"
    | "savePromiseRef"
    | "selectedChapter"
    | "setChapterRevision"
    | "setDirty"
    | "setRecoveryDrafts"
    | "setSaving"
    | "setSelectedChapter"
    | "setState"
    | "setStatus"
    | "stores"
    | "view"
  >,
) {
  const {
    chapterContent,
    chapterRevision,
    chapterTitle,
    chapterVolume,
    dirty,
    pageSaversRef,
    savePromiseRef,
    selectedChapter,
    setChapterRevision,
    setDirty,
    setRecoveryDrafts,
    setSaving,
    setSelectedChapter,
    setState,
    setStatus,
    stores,
    view,
  } = context;
  const saveChapter = useCallback((): Promise<boolean> => {
    if (!selectedChapter) {
      setStatus("请先选择一个文档再保存。");
      return Promise.resolve(false);
    }
    if (savePromiseRef.current) {
      setStatus("当前文档正在保存，请稍候。");
      return savePromiseRef.current;
    }
    const saveEpoch = stores.project.store.getState().projectEpoch;
    const draft = {
      chapterId: selectedChapter.id,
      title: chapterTitle,
      volume: chapterVolume,
      content: chapterContent,
      expectedRevision: chapterRevision,
    };
    const operation = (async () => {
      setSaving(true);
      setStatus("正在保存并更新知识库...");
      try {
        const result = await window.novelAPI.saveChapter(draft);
        if (!isCurrentEpoch(stores, saveEpoch)) return false;
        const stillViewingSameChapter =
          (stores.project.store.getState().selectedChapter?.id || "") ===
          draft.chapterId;
        const currentDraft = readChapterDraft(stores);
        const draftUnchanged =
          currentDraft.content === draft.content &&
          currentDraft.title === draft.title &&
          currentDraft.volume === draft.volume;
        if (stillViewingSameChapter) {
          setSelectedChapter(result.chapter);
        }
        setState((current) =>
          current
            ? {
                ...current,
                config: result.config,
                chapters: result.config.chapters,
                selectedChapter:
                  current.selectedChapter?.id === draft.chapterId
                    ? result.chapter
                    : current.selectedChapter,
                vectorStats: result.vectorStats,
                chapterRevision:
                  current.selectedChapter?.id === draft.chapterId
                    ? result.revision
                    : current.chapterRevision,
              }
            : current,
        );
        if (stillViewingSameChapter) {
          setChapterRevision(result.revision);
          if (draftUnchanged) {
            setDirty(false);
            setRecoveryDrafts((current) =>
              current.filter((item) => item.chapterId !== draft.chapterId),
            );
            void window.novelAPI
              .clearRecoveryDraft(draft.chapterId)
              .catch(() => null);
          }
        }
        const mode =
          result.indexResult.chunks > 0
            ? `索引 ${result.indexResult.chunks} 个片段`
            : "暂无可索引内容";
        setStatus(
          [result.indexWarning, result.journalWarning]
            .filter(Boolean)
            .join("；") ||
            (draftUnchanged
              ? `已保存，${mode}`
              : "已保存此前版本，当前还有新改动待保存"),
        );
        return stillViewingSameChapter && draftUnchanged;
      } catch (error) {
        if (isCurrentEpoch(stores, saveEpoch))
          setStatus(
            `保存失败：${error instanceof Error ? error.message : String(error)}`,
          );
        return false;
      }
    })().finally(() => {
      if (savePromiseRef.current === operation) savePromiseRef.current = null;
      if (isCurrentEpoch(stores, saveEpoch)) setSaving(false);
    });
    savePromiseRef.current = operation;
    return operation;
  }, [
    chapterContent,
    chapterRevision,
    chapterTitle,
    chapterVolume,
    savePromiseRef,
    selectedChapter,
    setChapterRevision,
    setDirty,
    setRecoveryDrafts,
    setSaving,
    setSelectedChapter,
    setState,
    setStatus,
    stores,
  ]);

  const saveChapterIfDirty = useCallback(async () => {
    if (!dirty) return true;
    return saveChapter();
  }, [dirty, saveChapter]);

  const saveBeforeLeavingChapter = useCallback(async () => {
    const networkSaver = pageSaversRef.current.get("novel-network");
    if (networkSaver && !(await networkSaver.protect())) return false;
    const kind =
      view === "characters" ? "character" : view === "world" ? "world" : null;
    if (kind && !(await pageSaversRef.current.get(kind)?.protect()))
      return false;
    return saveChapterIfDirty();
  }, [pageSaversRef, saveChapterIfDirty, view]);

  const saveCurrentPage = useCallback(async () => {
    const networkSaver = pageSaversRef.current.get("novel-network");
    if (networkSaver) return networkSaver.save();
    const kind =
      view === "characters" ? "character" : view === "world" ? "world" : null;
    if (kind) return (await pageSaversRef.current.get(kind)?.save()) ?? false;
    if (view === "chapters") return saveChapter();
    setStatus("当前页面的操作会即时保存。");
    return true;
  }, [pageSaversRef, saveChapter, setStatus, view]);

  return {
    saveChapter,
    saveChapterIfDirty,
    saveBeforeLeavingChapter,
    saveCurrentPage,
  };
}
