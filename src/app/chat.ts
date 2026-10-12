import { isCurrentEpoch } from "../stores/app-stores";
import type { ChatMessage, ChatSession, RetrievalMode } from "../types";
import {
  RETRIEVAL_MODE_OPTIONS,
  makeMessageId,
  makeChatSession,
  titleFromMessages,
  compactChatMessages,
  keepRecentChatSessions,
} from "../lib/chat-utils";
import type { AppContext } from "./context";

export function useAppChat(
  context: Pick<
    AppContext,
    | "activeAiRequestId"
    | "activeChatSessionId"
    | "aiProjectMemory"
    | "chatLoaded"
    | "chatMessages"
    | "chatRetrievalMode"
    | "chatSessions"
    | "selectedChapter"
    | "selectedText"
    | "setActiveAiRequestId"
    | "setActiveChatSessionId"
    | "setAiProgress"
    | "setAiProjectMemory"
    | "setChatMessages"
    | "setChatRetrievalMode"
    | "setChatSessions"
    | "setStatus"
    | "stores"
  >,
) {
  const {
    activeAiRequestId,
    activeChatSessionId,
    aiProjectMemory,
    chatLoaded,
    chatMessages,
    chatRetrievalMode,
    chatSessions,
    selectedChapter,
    selectedText,
    setActiveAiRequestId,
    setActiveChatSessionId,
    setAiProgress,
    setAiProjectMemory,
    setChatMessages,
    setChatRetrievalMode,
    setChatSessions,
    setStatus,
    stores,
  } = context;
  function saveChatDraft(
    nextSessions: ChatSession[],
    nextActiveId = activeChatSessionId,
    nextMemory = aiProjectMemory,
  ) {
    if (!chatLoaded) return;
    const compactSessions = keepRecentChatSessions(nextSessions, nextActiveId);
    void window.novelAPI
      .saveAnalysisState({
        chatSessions: compactSessions,
        activeChatSessionId: nextActiveId,
        aiProjectMemory: nextMemory,
        chatRetrievalMode,
      })
      .catch(() => null);
  }

  function updateCurrentChat(nextMessages: ChatMessage[]) {
    const now = new Date().toISOString();
    const existingSession =
      chatSessions.find((session) => session.id === activeChatSessionId) ||
      chatSessions[0];
    const baseSession = existingSession || makeChatSession();
    const activeId = baseSession.id;
    const nextSession = {
      ...baseSession,
      id: activeId,
      title: titleFromMessages(nextMessages, baseSession.title || "新会话"),
      messages: compactChatMessages(nextMessages),
      updatedAt: now,
    };
    const nextSessions = keepRecentChatSessions(
      [
        nextSession,
        ...chatSessions.filter((session) => session.id !== activeId),
      ],
      activeId,
    );
    setChatSessions(nextSessions);
    setActiveChatSessionId(activeId);
    setChatMessages(nextMessages);
    saveChatDraft(nextSessions, activeId);
  }

  function createChatSession() {
    const session = makeChatSession();
    const nextSessions = keepRecentChatSessions(
      [session, ...chatSessions],
      session.id,
    );
    setChatSessions(nextSessions);
    setActiveChatSessionId(session.id);
    setChatMessages([]);
    saveChatDraft(nextSessions, session.id);
    setStatus("已新建 AI 会话");
  }

  function switchChatSession(sessionId: string) {
    if (activeAiRequestId) {
      setStatus("当前回答仍在生成，请先停止或等待完成。");
      return;
    }
    const session = chatSessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveChatSessionId(session.id);
    setChatMessages(session.messages || []);
    saveChatDraft(chatSessions, session.id);
  }

  function clearCurrentChat() {
    if (activeAiRequestId) {
      setStatus("当前回答仍在生成，请先停止后再清空。");
      return;
    }
    const nextMessages: ChatMessage[] = [];
    updateCurrentChat(nextMessages);
    setStatus("已清空当前 AI 会话");
  }

  function updateProjectMemory(value: string) {
    const next = value.slice(0, 3000);
    setAiProjectMemory(next);
    saveChatDraft(chatSessions, activeChatSessionId, next);
  }

  function updateChatRetrievalMode(mode: RetrievalMode) {
    setChatRetrievalMode(mode);
    if (chatLoaded) {
      void window.novelAPI
        .saveAnalysisState({ chatRetrievalMode: mode })
        .catch(() => null);
    }
  }

  async function sendChat(
    question: string,
    selection = selectedText,
    retrievalMode = chatRetrievalMode,
    additionalSourceIds: string[] = [],
  ) {
    const trimmed = question.trim();
    if (!trimmed) return;
    if (activeAiRequestId) {
      setStatus("AI 正在生成上一条回答，请先停止或等待完成。");
      return;
    }
    const requestEpoch = stores.project.store.getState().projectEpoch;
    const userMessage: ChatMessage = {
      id: makeMessageId(),
      role: "user",
      content: selection ? `${trimmed}\n\n【选中文字】\n${selection}` : trimmed,
      createdAt: new Date().toISOString(),
    };
    const pendingId = makeMessageId();
    const historyMessages = chatMessages;
    const startedMessages: ChatMessage[] = [
      ...historyMessages,
      userMessage,
      {
        id: pendingId,
        role: "assistant",
        content: "正在检索小说知识库并组织回答...",
        createdAt: new Date().toISOString(),
      },
    ];
    setActiveAiRequestId(pendingId);
    setAiProgress({ phase: "正在规划检索范围", streamedChars: 0 });
    updateCurrentChat(startedMessages);
    try {
      const response = await window.novelAPI.askAI({
        requestId: pendingId,
        question: trimmed,
        selectedText: selection,
        history: historyMessages.map((item) => ({
          role: item.role,
          content: item.content,
        })),
        projectMemory: aiProjectMemory,
        retrievalMode,
        selectedChapterId: selectedChapter?.id || "",
        additionalSourceIds,
      });
      if (
        !isCurrentEpoch(stores, requestEpoch) ||
        stores.chat.store.getState().activeAiRequestId !== pendingId
      )
        return;
      updateCurrentChat(
        startedMessages.map((item) =>
          item.id === pendingId
            ? {
                ...item,
                content: response.answer,
                context: response.context,
                retrieval: response.retrieval,
              }
            : item,
        ),
      );
      const contextCount = response.contextCount ?? response.context.length;
      const candidateCount = response.candidateCount ?? contextCount;
      const scannedCount = response.scannedCount ?? candidateCount;
      const modeLabel =
        response.retrieval?.modeLabel ||
        RETRIEVAL_MODE_OPTIONS.find((item) => item.value === retrievalMode)
          ?.label ||
        "自动判断";
      setStatus(
        response.embeddingWarning
          ? `检索已完成：${modeLabel}，扫描 ${scannedCount} 条，候选 ${candidateCount} 条，发送 ${contextCount} 条，流式接收 ${response.streamedChars || 0} 字；本地向量回退：${response.embeddingWarning}`
          : `检索已完成：${modeLabel}，扫描 ${scannedCount} 条，候选 ${candidateCount} 条，发送 ${contextCount} 条，流式接收 ${response.streamedChars || 0} 字`,
      );
    } catch (error) {
      if (!isCurrentEpoch(stores, requestEpoch)) return;
      const currentMessages = stores.chat.store.getState().chatMessages.length
        ? stores.chat.store.getState().chatMessages
        : startedMessages;
      updateCurrentChat(
        currentMessages.map((item) =>
          item.id === pendingId
            ? {
                ...item,
                content: item.content.startsWith("正在检索小说知识库")
                  ? `请求失败：${error instanceof Error ? error.message : String(error)}`
                  : `${item.content}\n\n【生成中断，以上内容已自动保留。】`,
              }
            : item,
        ),
      );
    } finally {
      if (
        isCurrentEpoch(stores, requestEpoch) &&
        stores.chat.store.getState().activeAiRequestId === pendingId
      )
        setActiveAiRequestId("");
    }
  }

  async function stopChatGeneration() {
    if (!activeAiRequestId) return;
    const requestId = activeAiRequestId;
    const epoch = stores.project.store.getState().projectEpoch;
    setAiProgress((current) => ({
      phase: "正在停止，已生成内容会保留",
      streamedChars: current?.streamedChars || 0,
      retrieval: current?.retrieval,
    }));
    const result = await window.novelAPI
      .cancelAI(requestId)
      .catch(() => ({ canceled: false }));
    if (
      !isCurrentEpoch(stores, epoch) ||
      (stores.chat.store.getState().activeAiRequestId &&
        stores.chat.store.getState().activeAiRequestId !== requestId)
    )
      return;
    setStatus(
      result.canceled ? "正在停止生成，已收到的内容会保留" : "这次生成已经结束",
    );
  }

  return {
    saveChatDraft,
    updateCurrentChat,
    createChatSession,
    switchChatSession,
    clearCurrentChat,
    updateProjectMemory,
    updateChatRetrievalMode,
    sendChat,
    stopChatGeneration,
  };
}
