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
    "selectedChapter" | "selectedText" | "setStatus" | "stores"
  >,
) {
  const { selectedChapter, selectedText, setStatus, stores } = context;
  const chatState = () => stores.chat.store.getState();
  const {
    activeAiRequestId: setActiveAiRequestId,
    activeChatSessionId: setActiveChatSessionId,
    aiProgress: setAiProgress,
    aiProjectMemory: setAiProjectMemory,
    chatMessages: setChatMessages,
    chatRetrievalMode: setChatRetrievalMode,
    chatSessions: setChatSessions,
  } = stores.chat.setters;
  function saveChatDraft(
    nextSessions: ChatSession[],
    nextActiveId = chatState().activeChatSessionId,
    nextMemory = chatState().aiProjectMemory,
  ) {
    if (!chatState().chatLoaded) return;
    const compactSessions = keepRecentChatSessions(nextSessions, nextActiveId);
    void window.novelAPI
      .saveAnalysisState({
        chatSessions: compactSessions,
        activeChatSessionId: nextActiveId,
        aiProjectMemory: nextMemory,
        chatRetrievalMode: chatState().chatRetrievalMode,
      })
      .catch(() => null);
  }

  function updateCurrentChat(nextMessages: ChatMessage[]) {
    const now = new Date().toISOString();
    const state = chatState();
    const existingSession =
      state.chatSessions.find((session) => session.id === state.activeChatSessionId) ||
      state.chatSessions[0];
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
        ...state.chatSessions.filter((session) => session.id !== activeId),
      ],
      activeId,
    );
    setChatSessions(nextSessions);
    setActiveChatSessionId(activeId);
    setChatMessages(nextMessages);
    saveChatDraft(nextSessions, activeId);
  }

  function createChatSession(persona?: { characterId: string; name: string }) {
    const session = makeChatSession(persona ? `与${persona.name}对话` : "新会话", [], persona);
    const nextSessions = keepRecentChatSessions(
      [session, ...chatState().chatSessions],
      session.id,
    );
    setChatSessions(nextSessions);
    setActiveChatSessionId(session.id);
    setChatMessages([]);
    saveChatDraft(nextSessions, session.id);
    setStatus(persona ? `已新建与「${persona.name}」的角色对话（虚构推演，不写正文）` : "已新建 AI 会话");
  }

  function switchChatSession(sessionId: string) {
    const state = chatState();
    if (state.activeAiRequestId) {
      setStatus("当前回答仍在生成，请先停止或等待完成。");
      return;
    }
    const session = state.chatSessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveChatSessionId(session.id);
    setChatMessages(session.messages || []);
    saveChatDraft(state.chatSessions, session.id);
  }

  function clearCurrentChat() {
    if (chatState().activeAiRequestId) {
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
    saveChatDraft(chatState().chatSessions, chatState().activeChatSessionId, next);
  }

  function updateChatRetrievalMode(mode: RetrievalMode) {
    setChatRetrievalMode(mode);
    if (chatState().chatLoaded) {
      void window.novelAPI
        .saveAnalysisState({ chatRetrievalMode: mode })
        .catch(() => null);
    }
  }

  async function sendChat(
    question: string,
    selection = selectedText,
    retrievalMode = chatState().chatRetrievalMode,
    additionalSourceIds: string[] = [],
  ) {
    const trimmed = question.trim();
    if (!trimmed) return;
    if (chatState().activeAiRequestId) {
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
    const historyMessages = chatState().chatMessages;
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
        projectMemory: chatState().aiProjectMemory,
        retrievalMode,
        selectedChapterId: selectedChapter?.id || "",
        additionalSourceIds,
        persona: chatState().chatSessions.find((session) => session.id === chatState().activeChatSessionId)?.persona,
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
    const requestId = chatState().activeAiRequestId;
    if (!requestId) return;
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
