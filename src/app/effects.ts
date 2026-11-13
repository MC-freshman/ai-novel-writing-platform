import { useEffect } from "react";
import { readChapterDraft, isCurrentEpoch } from "../stores/app-stores";
import type { ChatMessage } from "../types";
import { countWords, getErrorMessage } from "../lib/text-utils";
import {
  makeChatSession,
  titleFromMessages,
  compactChatMessages,
  keepRecentChatSessions,
} from "../lib/chat-utils";
import type { InlineReviewItem } from "../lib/editor-ops";
import type { AppContext } from "./context";

export function useAppEffects(
  context: Pick<
    AppContext,
    | "applyAppState"
    | "chapterContent"
    | "chapterRevision"
    | "chapterTitle"
    | "chapterVolume"
    | "closingRef"
    | "contextMenu"
    | "createProject"
    | "dirty"
    | "editorRef"
    | "exportBackup"
    | "exportBookDocx"
    | "exportChapterDocx"
    | "focusMode"
    | "focusDialogsOpen"
    | "importDocument"
    | "leftWidth"
    | "openProject"
    | "openSettings"
    | "pageSaversRef"
    | "preview"
    | "previewWidth"
    | "rebuildIndex"
    | "richEditorRef"
    | "rightWidth"
    | "saveChapter"
    | "saveCurrentPage"
    | "selectedChapter"
    | "setActiveChatSessionId"
    | "setAiProgress"
    | "setAiProjectMemory"
    | "setBackgroundTasks"
    | "setChatLoaded"
    | "setChatMessages"
    | "setChatRetrievalMode"
    | "setChatSessions"
    | "setEditorReviews"
    | "setFocusMode"
    | "setImportProgress"
    | "setIndexProgress"
    | "setLeftWidth"
    | "setPreviewWidth"
    | "setRecoveryDrafts"
    | "setRightWidth"
    | "setShowQuickPanel"
    | "setState"
    | "setStatus"
    | "setView"
    | "setViewportWidth"
    | "showQuickPanel"
    | "showSettings"
    | "showStoryCenter"
    | "showTaskCenter"
    | "state"
    | "stores"
    | "toggleTheme"
    | "view"
  >,
) {
  const {
    applyAppState,
    chapterContent,
    chapterRevision,
    chapterTitle,
    chapterVolume,
    closingRef,
    contextMenu,
    createProject,
    dirty,
    editorRef,
    exportBackup,
    exportBookDocx,
    exportChapterDocx,
    focusMode,
    focusDialogsOpen,
    importDocument,
    leftWidth,
    openProject,
    openSettings,
    pageSaversRef,
    preview,
    previewWidth,
    rebuildIndex,
    richEditorRef,
    rightWidth,
    saveChapter,
    saveCurrentPage,
    selectedChapter,
    setActiveChatSessionId,
    setAiProgress,
    setAiProjectMemory,
    setBackgroundTasks,
    setChatLoaded,
    setChatMessages,
    setChatRetrievalMode,
    setChatSessions,
    setEditorReviews,
    setFocusMode,
    setImportProgress,
    setIndexProgress,
    setLeftWidth,
    setPreviewWidth,
    setRecoveryDrafts,
    setRightWidth,
    setShowQuickPanel,
    setState,
    setStatus,
    setView,
    setViewportWidth,
    showQuickPanel,
    showSettings,
    showStoryCenter,
    showTaskCenter,
    state,
    stores,
    toggleTheme,
    view,
  } = context;
  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", updateViewportWidth);
    return () => window.removeEventListener("resize", updateViewportWidth);
  }, [setViewportWidth]);

  useEffect(() => {
    window.novelAPI
      .getAppState()
      .then(applyAppState)
      .catch((error) => setStatus(`打开失败：${error.message}`));
  }, [applyAppState, setStatus]);

  useEffect(() => {
    if (!state?.projectPath) return;
    const epoch = stores.project.store.getState().projectEpoch;
    void window.novelAPI
      .getRecoveryStatus()
      .then((recovery) => {
        if (!isCurrentEpoch(stores, epoch)) return;
        setRecoveryDrafts(recovery.drafts);
        if (recovery.windowState) {
          setView(recovery.windowState.view || "chapters");
          setLeftWidth(
            Math.min(520, Math.max(210, recovery.windowState.leftWidth || 256)),
          );
          setRightWidth(
            Math.min(
              900,
              Math.max(300, recovery.windowState.rightWidth || 360),
            ),
          );
          setPreviewWidth(
            Math.min(68, Math.max(28, recovery.windowState.previewWidth || 46)),
          );
        }
        if (recovery.drafts.length || recovery.interruptedOperations.length) {
          setStatus(
            `发现可恢复内容：${recovery.drafts.length} 份草稿，${recovery.interruptedOperations.length} 项中断操作`,
          );
        }
      })
      .catch(() => null);
  }, [
    setLeftWidth,
    setPreviewWidth,
    setRecoveryDrafts,
    setRightWidth,
    setStatus,
    setView,
    state?.projectPath,
    stores,
  ]);

  useEffect(() => {
    const chapterId = selectedChapter?.id;
    if (!state?.projectPath || !chapterId || showStoryCenter) return;
    const epoch = stores.project.store.getState().projectEpoch;
    void window.novelAPI
      .getCreativeWorkspace()
      .then((workspace) => {
        if (
          !isCurrentEpoch(stores, epoch) ||
          stores.project.store.getState().selectedChapter?.id !== chapterId
        )
          return;
        const annotations: InlineReviewItem[] = workspace.annotations
          .filter((item) => item.chapterId === chapterId)
          .map((item) => ({
            id: item.id,
            kind: "annotation",
            quote: item.quote,
            label: item.comment,
            status: item.status,
          }));
        const revisions: InlineReviewItem[] = workspace.revisions
          .filter(
            (item) =>
              item.chapterId === chapterId &&
              ["待确认", "部分采纳"].includes(item.status) &&
              item.original &&
              item.replacement,
          )
          .map((item) => ({
            id: item.id,
            kind: "revision",
            quote: item.original,
            label: `${item.action}：${item.replacement}`,
            status: item.status,
          }));
        setEditorReviews([...annotations, ...revisions]);
      })
      .catch(() => {
        if (
          isCurrentEpoch(stores, epoch) &&
          stores.project.store.getState().selectedChapter?.id === chapterId
        )
          setEditorReviews([]);
      });
  }, [
    selectedChapter?.id,
    setEditorReviews,
    showStoryCenter,
    state?.projectPath,
    stores,
  ]);

  useEffect(() => {
    if (!state?.projectPath) return;
    const epoch = stores.project.store.getState().projectEpoch;
    setChatLoaded(false);
    window.novelAPI
      .getAnalysisState()
      .then((snapshot) => {
        if (!isCurrentEpoch(stores, epoch)) return;
        const restored = keepRecentChatSessions(
          snapshot.chatSessions || [],
          snapshot.activeChatSessionId || "",
        );
        let initialSessions = restored.length ? restored : [makeChatSession()];
        const activeId = initialSessions.some(
          (session) => session.id === snapshot.activeChatSessionId,
        )
          ? snapshot.activeChatSessionId || initialSessions[0].id
          : initialSessions[0].id;
        let active =
          initialSessions.find((session) => session.id === activeId) ||
          initialSessions[0];
        const recovery = snapshot.aiStreamRecovery;
        if (recovery?.requestId && recovery.answer) {
          const existing = active.messages.find(
            (message) => message.id === recovery.requestId,
          );
          let recoveredMessages: ChatMessage[];
          if (existing) {
            recoveredMessages = active.messages.map((message) =>
              message.id === recovery.requestId &&
              recovery.answer.length > message.content.length
                ? { ...message, content: recovery.answer }
                : message,
            );
          } else {
            const lastUser = [...active.messages]
              .reverse()
              .find((message) => message.role === "user");
            recoveredMessages = [
              ...active.messages,
              ...(lastUser?.content.startsWith(recovery.question)
                ? []
                : [
                    {
                      id: `${recovery.requestId}_question`,
                      role: "user" as const,
                      content: recovery.question,
                      createdAt: recovery.updatedAt,
                    },
                  ]),
              {
                id: recovery.requestId,
                role: "assistant" as const,
                content: recovery.answer,
                createdAt: recovery.updatedAt,
              },
            ];
          }
          active = {
            ...active,
            messages: recoveredMessages,
            updatedAt: recovery.updatedAt,
          };
          initialSessions = initialSessions.map((session) =>
            session.id === active.id ? active : session,
          );
          if (recovery.status !== "completed")
            setStatus("已恢复上次生成中断前收到的 AI 内容");
        }
        setChatSessions(initialSessions);
        setActiveChatSessionId(active.id);
        setChatMessages(active.messages || []);
        setAiProjectMemory(snapshot.aiProjectMemory || "");
        setChatRetrievalMode(snapshot.chatRetrievalMode || "auto");
      })
      .catch(() => {
        if (!isCurrentEpoch(stores, epoch)) return;
        const session = makeChatSession();
        setChatSessions([session]);
        setActiveChatSessionId(session.id);
        setChatMessages([]);
        setAiProjectMemory("");
        setChatRetrievalMode("auto");
      })
      .finally(() => {
        if (isCurrentEpoch(stores, epoch)) setChatLoaded(true);
      });
  }, [
    setActiveChatSessionId,
    setAiProjectMemory,
    setChatLoaded,
    setChatMessages,
    setChatRetrievalMode,
    setChatSessions,
    setStatus,
    state?.projectPath,
    stores,
  ]);

  useEffect(() => {
    if (!state?.projectPath) return undefined;
    const epoch = stores.project.store.getState().projectEpoch;
    void window.novelAPI
      .listTasks()
      .then((result) => {
        if (isCurrentEpoch(stores, epoch)) setBackgroundTasks(result.tasks);
      })
      .catch(() => {
        if (isCurrentEpoch(stores, epoch)) setBackgroundTasks([]);
      });
    const off = window.novelAPI.onTaskProgress((task) => {
      if (
        !isCurrentEpoch(stores, epoch) ||
        (task.projectPath && task.projectPath !== state.projectPath)
      )
        return;
      setBackgroundTasks((current) =>
        [task, ...current.filter((item) => item.id !== task.id)].slice(0, 120),
      );
      if (task.type === "knowledge-rebuild" && task.status === "已完成") {
        void window.novelAPI
          .getAppState()
          .then((nextState) => {
            if (!isCurrentEpoch(stores, epoch)) return;
            setState((current) =>
              current
                ? {
                    ...current,
                    vectorStats: nextState.vectorStats,
                    chapters: nextState.chapters,
                    config: nextState.config,
                  }
                : nextState,
            );
          })
          .catch(() => null);
      }
    });
    return off;
  }, [setBackgroundTasks, setState, state?.projectPath, stores]);

  useEffect(() => {
    const offImport = window.novelAPI.onImportProgress((progress) => {
      setImportProgress(progress.active ? progress : null);
      if (progress.active) {
        setStatus(
          `${progress.phase}${progress.total ? ` ${progress.current}/${progress.total}` : ""}${progress.fileName ? `：${progress.fileName}` : ""}`,
        );
      }
    });
    const offIndex = window.novelAPI.onIndexProgress((progress) => {
      setIndexProgress(progress.active ? progress : null);
      if (progress.active) {
        setStatus(
          `${progress.phase}${progress.total ? ` ${progress.current}/${progress.total}` : ""}${progress.detail ? `：${progress.detail}` : ""}`,
        );
      }
    });
    return () => {
      offImport();
      offIndex();
    };
  }, [setImportProgress, setIndexProgress, setStatus]);

  useEffect(() => {
    const off = window.novelAPI.onAIStream((payload) => {
      if (
        !payload.requestId ||
        payload.requestId !== stores.chat.store.getState().activeAiRequestId
      )
        return;
      if (payload.type === "chunk" && payload.text) {
        setChatMessages((current) =>
          current.map((message) => {
            if (message.id !== payload.requestId) return message;
            const shouldReplace =
              message.content.startsWith("正在检索小说知识库");
            return {
              ...message,
              content: shouldReplace
                ? payload.text || ""
                : `${message.content}${payload.text}`,
            };
          }),
        );
      }
      setAiProgress((current) => ({
        phase:
          payload.phase ||
          (payload.type === "chunk"
            ? "正在生成回答"
            : current?.phase || "处理中"),
        stopped: payload.stopped ?? current?.stopped ?? false,
        streamedChars: payload.streamedChars ?? current?.streamedChars ?? 0,
        retrieval: payload.retrieval || current?.retrieval,
      }));
    });
    return off;
  }, [setAiProgress, setChatMessages, stores.chat.store]);

  useEffect(() => {
    let timer: number | null = null;
    const schedule = () => {
      const chat = stores.chat.store.getState();
      if (!chat.chatLoaded || !chat.activeChatSessionId) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        const current = stores.chat.store.getState();
        if (!current.chatLoaded || !current.activeChatSessionId) return;
        const epoch = stores.project.store.getState().projectEpoch;
        if (!isCurrentEpoch(stores, epoch)) return;
        const active =
          current.chatSessions.find((session) => session.id === current.activeChatSessionId) ||
          current.chatSessions[0];
        if (!active) return;
        const nextSession = {
          ...active,
          title: titleFromMessages(current.chatMessages, active.title || "新会话"),
          messages: compactChatMessages(current.chatMessages),
          updatedAt: new Date().toISOString(),
        };
        const next = keepRecentChatSessions(
          [
            nextSession,
            ...current.chatSessions.filter((session) => session.id !== active.id),
          ],
          active.id,
        );
        stores.chat.setters.chatSessions(next);
        void window.novelAPI
          .saveAnalysisState({
            chatSessions: next,
            activeChatSessionId: active.id,
            aiProjectMemory: current.aiProjectMemory,
            chatRetrievalMode: current.chatRetrievalMode,
          })
          .catch(() => null);
      }, 900);
    };
    const unsubscribe = stores.chat.store.subscribe((current, previous) => {
      if (
        current.chatLoaded !== previous.chatLoaded ||
        current.activeChatSessionId !== previous.activeChatSessionId ||
        current.chatMessages !== previous.chatMessages ||
        current.aiProjectMemory !== previous.aiProjectMemory ||
        current.chatRetrievalMode !== previous.chatRetrievalMode
      ) schedule();
    });
    schedule();
    return () => {
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [stores]);

  useEffect(() => {
    return window.novelAPI.onAppCloseRequested(() => {
      if (closingRef.current) return;
      closingRef.current = true;
      void (async () => {
        try {
          if (
            dirty &&
            selectedChapter?.id &&
            state?.config.ui.recoveryEnabled !== false
          ) {
            const draft = readChapterDraft(stores);
            await window.novelAPI.saveRecoveryDraft({
              chapterId: selectedChapter.id,
              chapterTitle: draft.title,
              volume: draft.volume,
              content: draft.content,
              baseRevision: chapterRevision,
              wordCount: countWords(draft.content),
            });
          }
          if (dirty && !(await saveChapter())) {
            window.novelAPI.cancelAppClose();
            return;
          }
          for (const handle of pageSaversRef.current.values()) {
            if (!(await handle.save())) {
              setStatus("当前页面保存失败或仍有新改动，窗口保持打开。");
              window.novelAPI.cancelAppClose();
              return;
            }
          }
          window.novelAPI.confirmAppClose();
        } catch (error) {
          setStatus(`关闭前保护失败，窗口保持打开：${getErrorMessage(error)}`);
          window.novelAPI.cancelAppClose();
        } finally {
          closingRef.current = false;
        }
      })();
    });
  }, [
    chapterRevision,
    closingRef,
    dirty,
    pageSaversRef,
    saveChapter,
    selectedChapter?.id,
    setStatus,
    state?.config.ui.recoveryEnabled,
    stores,
  ]);

  useEffect(() => {
    if (!dirty || !state?.config.ui.autosaveMs) return;
    const timer = window.setTimeout(() => {
      void saveChapter();
    }, state.config.ui.autosaveMs);
    return () => window.clearTimeout(timer);
  }, [dirty, saveChapter, state?.config.ui.autosaveMs]);

  useEffect(() => {
    if (
      !dirty ||
      !selectedChapter?.id ||
      state?.config.ui.recoveryEnabled === false
    )
      return;
    const timer = window.setTimeout(() => {
      void window.novelAPI
        .saveRecoveryDraft({
          chapterId: selectedChapter.id,
          chapterTitle,
          volume: chapterVolume,
          content: chapterContent,
          baseRevision: chapterRevision,
          wordCount: countWords(chapterContent),
        })
        .catch(() => null);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [
    chapterContent,
    chapterRevision,
    chapterTitle,
    chapterVolume,
    dirty,
    selectedChapter?.id,
    state?.config.ui.recoveryEnabled,
  ]);

  useEffect(() => {
    if (!state?.projectPath) return;
    const timer = window.setTimeout(() => {
      void window.novelAPI
        .saveWindowRecoveryState({
          selectedChapterId: selectedChapter?.id,
          view,
          leftWidth,
          rightWidth,
          previewWidth,
        })
        .catch(() => null);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    leftWidth,
    previewWidth,
    rightWidth,
    selectedChapter?.id,
    state?.projectPath,
    view,
  ]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const dialogOpen =
        showSettings ||
        showQuickPanel ||
        showStoryCenter ||
        showTaskCenter ||
        focusDialogsOpen ||
        Boolean(contextMenu);
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "f" &&
        view === "chapters" &&
        !dialogOpen
      ) {
        event.preventDefault();
        setFocusMode((value) => !value);
      }
      if (event.key === "Escape" && focusMode && !dialogOpen) {
        event.preventDefault();
        setFocusMode(false);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveCurrentPage();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowQuickPanel(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    contextMenu,
    focusDialogsOpen,
    focusMode,
    saveCurrentPage,
    setFocusMode,
    setShowQuickPanel,
    showQuickPanel,
    showSettings,
    showStoryCenter,
    showTaskCenter,
    view,
  ]);

  useEffect(() => {
    if (!focusMode || view !== "chapters") return;
    const frame = window.requestAnimationFrame(() => {
      if (preview) editorRef.current?.focus();
      else richEditorRef.current?.view.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editorRef, focusMode, preview, richEditorRef, view]);

  useEffect(() => {
    if (!state) return undefined;
    return window.novelAPI.onMenuAction((action) => {
      if (action === "newProject") void createProject();
      if (action === "openProject") void openProject();
      if (action === "importDocument") void importDocument();
      if (action === "exportChapterDocx") void exportChapterDocx();
      if (action === "exportBookDocx")
        void exportBookDocx({ includeOutline: true, includeMaterials: true });
      if (action === "exportBackup") void exportBackup();
      if (action === "saveChapter") void saveCurrentPage();
      if (action === "rebuildIndex") void rebuildIndex();
      if (action === "showSettings") void openSettings();
      if (action === "toggleFocus") setFocusMode((value) => !value);
      if (action === "toggleTheme") void toggleTheme();
    });
  });
}
