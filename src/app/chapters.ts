import { countWords, getErrorMessage } from "../lib/text-utils";
import { changeHeadingLevel } from "../lib/editor-ops";
import type { AppContext } from "./context";

export function useAppChapters(
  context: Pick<
    AppContext,
    | "applyAppState"
    | "chapterLoadRequestRef"
    | "chapterVolume"
    | "draggingChapterId"
    | "editorRef"
    | "saveBeforeLeavingChapter"
    | "saveChapterDraft"
    | "savePromiseRef"
    | "selectedChapter"
    | "setChapterContent"
    | "setChapterRevision"
    | "setChapterTitle"
    | "setChapterVolume"
    | "setDirty"
    | "setDraggingChapterId"
    | "setScrollAnchor"
    | "setSelectedChapter"
    | "setState"
    | "setStatus"
    | "setView"
    | "state"
    | "stores"
  >,
) {
  const {
    applyAppState,
    chapterLoadRequestRef,
    chapterVolume,
    draggingChapterId,
    editorRef,
    saveBeforeLeavingChapter,
    saveChapterDraft,
    savePromiseRef,
    selectedChapter,
    setChapterContent,
    setChapterRevision,
    setChapterTitle,
    setChapterVolume,
    setDirty,
    setDraggingChapterId,
    setScrollAnchor,
    setSelectedChapter,
    setState,
    setStatus,
    setView,
    state,
    stores,
  } = context;
  async function selectChapter(
    chapterId: string,
    line?: number,
    quote?: string,
  ) {
    const requestId = ++chapterLoadRequestRef.current;
    if (!(await saveBeforeLeavingChapter())) return;
    if (requestId !== chapterLoadRequestRef.current) return;
    try {
      const payload = await window.novelAPI.loadChapter(chapterId);
      if (requestId !== chapterLoadRequestRef.current) return;
      if (!payload.chapter || payload.chapter.id !== chapterId)
        throw new Error("章节身份校验失败，已停止切换。");
      setSelectedChapter(payload.chapter);
      setChapterContent(payload.content);
      setChapterTitle(payload.chapter?.title ?? "");
      setChapterVolume(payload.chapter?.volume ?? "卷一");
      setChapterRevision(payload.revision || "");
      setState((current) =>
        current
          ? {
              ...current,
              selectedChapter: payload.chapter,
              chapterContent: payload.content,
              chapterRevision: payload.revision || "",
            }
          : current,
      );
      setDirty(false);
      setView("chapters");
      if (typeof line === "number" || quote) {
        const headingIndex =
          typeof line === "number"
            ? (payload.chapter?.outline || []).findIndex(
                (item) => item.line === line,
              )
            : -1;
        setScrollAnchor({
          key: Date.now(),
          headingIndex: headingIndex >= 0 ? headingIndex : undefined,
          quote: String(quote || "").trim() || undefined,
        });
        window.requestAnimationFrame(() => {
          const editor = editorRef.current;
          if (!editor) return;
          const lines = payload.content.split(/\r?\n/);
          const quoteIndex = quote ? payload.content.indexOf(quote) : -1;
          const targetLine =
            quoteIndex >= 0
              ? payload.content.slice(0, quoteIndex).split(/\r?\n/).length - 1
              : Number(line || 0);
          const position =
            quoteIndex >= 0
              ? quoteIndex
              : lines.slice(0, targetLine).join("\n").length +
                (targetLine > 0 ? 1 : 0);
          editor.focus();
          editor.selectionStart = position;
          editor.selectionEnd =
            position + (quote?.length || lines[targetLine]?.length || 0);
          const ratio = Math.max(0, targetLine / Math.max(1, lines.length));
          editor.scrollTop = ratio * editor.scrollHeight;
        });
      }
    } catch (error) {
      if (requestId === chapterLoadRequestRef.current)
        setStatus(`打开文档失败：${getErrorMessage(error)}`);
    }
  }

  async function createChapter() {
    if (!(await saveBeforeLeavingChapter())) return;
    const title = `第${(state?.chapters.length ?? 0) + 1}章 新章节`;
    try {
      const next = await window.novelAPI.createChapter({
        title,
        volume: chapterVolume || "卷一",
      });
      applyAppState(next);
      setStatus("已创建新章节，可以在中间顶部修改标题");
    } catch (error) {
      setStatus(`新建章节失败：${getErrorMessage(error)}`);
    }
  }

  async function deleteChapter(chapterId: string) {
    if (
      !window.confirm("确定删除这个章节吗？对应的本地文件和向量索引都会删除。")
    )
      return;
    if (!(await saveBeforeLeavingChapter())) return;
    try {
      const next = await window.novelAPI.deleteChapter(chapterId);
      applyAppState(next);
      setStatus("章节已删除");
    } catch (error) {
      setStatus(`删除章节失败：${getErrorMessage(error)}`);
    }
  }

  async function moveDraggingChapter(volume: string, beforeChapterId = "") {
    if (!state || !draggingChapterId) return;
    if (beforeChapterId && draggingChapterId === beforeChapterId) {
      setDraggingChapterId(null);
      return;
    }
    if (!(await saveBeforeLeavingChapter())) return;
    const targetVolume = volume.trim() || "未分卷";
    try {
      const next = await window.novelAPI.moveChapterToVolume({
        chapterId: draggingChapterId,
        volume: targetVolume,
        beforeChapterId,
      });
      applyAppState(next);
      setView("chapters");
      setStatus(`已移动到分组：${targetVolume}`);
    } catch (error) {
      setStatus(
        `移动失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setDraggingChapterId(null);
    }
  }

  async function adjustOutlineLevel(
    chapterId: string,
    lineOrIndex: number,
    currentLevel: number,
    delta: number,
  ) {
    const epoch = stores.project.store.getState().projectEpoch;
    if (!(await saveBeforeLeavingChapter())) return;
    if (epoch !== stores.project.store.getState().projectEpoch) return;
    if (savePromiseRef.current) {
      setStatus("当前文档正在保存，请稍后调整目录等级。");
      return;
    }
    let payload: Awaited<ReturnType<typeof window.novelAPI.loadChapter>>;
    try {
      payload = await window.novelAPI.loadChapter(chapterId);
    } catch (error) {
      setStatus(`读取目录对应文档失败：${getErrorMessage(error)}`);
      return;
    }
    const current = stores.project.store.getState();
    if (epoch !== current.projectEpoch) return;
    if (current.selectedChapter?.id !== chapterId) {
      setStatus("章节已切换，已停止调整目录等级。");
      return;
    }
    if (!payload.chapter) {
      setStatus("没有找到要调整目录等级的文档。");
      return;
    }
    if (
      current.chapterContent !== payload.content ||
      current.chapterTitle !== payload.chapter.title ||
      current.chapterVolume !== payload.chapter.volume
    ) {
      setStatus("正文或标题已有新改动，请先保存后再调整目录等级。");
      return;
    }
    if (savePromiseRef.current) {
      setStatus("当前文档正在保存，请稍后重试调整目录等级。");
      return;
    }
    const nextLevel = Math.min(6, Math.max(1, currentLevel + delta));
    if (nextLevel === currentLevel) {
      setStatus(delta < 0 ? "已经是最高级标题" : "已经是最低级标题");
      return;
    }
    const nextContent = changeHeadingLevel(
      payload.content,
      lineOrIndex,
      nextLevel,
    );
    if (nextContent === payload.content) {
      setStatus("没有找到可调整的标题，请先在正文里保存一次");
      return;
    }
    const optimisticChapter = {
      ...payload.chapter,
      wordCount: countWords(nextContent),
      outline: (payload.chapter.outline || []).map((item) =>
        item.line === lineOrIndex ? { ...item, level: nextLevel } : item,
      ),
    };
    setState((current) => {
      if (!current) return current;
      const chapters = current.chapters.map((chapter) =>
        chapter.id === chapterId
          ? {
              ...chapter,
              outline: optimisticChapter.outline,
              wordCount: optimisticChapter.wordCount,
            }
          : chapter,
      );
      return {
        ...current,
        chapters,
        config: { ...current.config, chapters },
        selectedChapter:
          chapterId === selectedChapter?.id
            ? optimisticChapter
            : current.selectedChapter,
      };
    });
    if (chapterId === selectedChapter?.id) {
      setSelectedChapter(optimisticChapter);
      setChapterContent(nextContent);
      setChapterTitle(optimisticChapter.title);
      setChapterVolume(optimisticChapter.volume);
      setDirty(false);
    }
    setStatus("正在调整目录等级并保存...");
    const saved = await saveChapterDraft(
      {
        chapterId,
        title: payload.chapter.title,
        volume: payload.chapter.volume,
        content: nextContent,
        expectedRevision: payload.revision,
      },
      `已把标题调整为 ${nextLevel} 级，并同步更新知识库`,
    );
    if (
      !saved &&
      stores.project.store.getState().selectedChapter?.id === chapterId
    ) {
      setDirty(true);
    }
  }

  return {
    selectChapter,
    createChapter,
    deleteChapter,
    moveDraggingChapter,
    adjustOutlineLevel,
  };
}
