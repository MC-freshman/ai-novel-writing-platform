"use strict";
const { registerIpcHandler } = require("../register.cjs");
const {
  buildChatRetrievalPackage,
  buildProjectMemorySummary,
  buildSystemPrompt,
  callChatApi,
  contextFromChunks,
  ensureCurrentProject,
  loadAnalysisState,
  loadConfig,
  makeId,
  nowIso,
  saveAnalysisState,
  sendRendererEvent,
  state,
} = require("../dependencies.cjs");

function registerDomain() {
  registerIpcHandler("ai:ask", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const question = String(payload.question || "").trim();
    if (!question) throw new Error("请输入要询问 AI 的内容。");
    const requestId = String(payload?.requestId || makeId("ai_stream"));
    state.activeAiRequests.get(requestId)?.abort();
    const requestController = new AbortController();
    state.activeAiRequests.set(requestId, requestController);
    sendRendererEvent("ai:stream", {
      requestId,
      type: "phase",
      phase: "正在规划检索范围",
    });
    let retrievalPackage;
    try {
      retrievalPackage = await buildChatRetrievalPackage(
        projectPath,
        config,
        payload || {},
        question,
      );
    } catch (error) {
      state.activeAiRequests.delete(requestId);
      throw error;
    }
    const { search, materials, retrieval, inventorySummary } = retrievalPackage;
    sendRendererEvent("ai:stream", {
      requestId,
      type: "retrieval",
      phase: "检索完成，正在生成",
      retrieval,
    });
    const analysisState = await loadAnalysisState(projectPath);
    const projectMemory = buildProjectMemorySummary(
      analysisState,
      payload.projectMemory || "",
    );
    const systemPrompt = buildSystemPrompt({
      ...materials,
      projectMemory,
      userQuestion: question,
      selectedText: payload.selectedText || "",
      retrieval,
      inventorySummary,
    });

    let streamedChars = 0;
    let partialAnswer = "";
    let lastCheckpointAt = 0;
    let lastCheckpointChars = 0;
    const saveStreamCheckpoint = (status = "streaming") =>
      saveAnalysisState(projectPath, {
        aiStreamRecovery: {
          requestId,
          question,
          answer: partialAnswer,
          status,
          updatedAt: nowIso(),
        },
      });
    try {
      const answer = await callChatApi(
        config,
        systemPrompt,
        question,
        payload.history || [],
        {
          stream: true,
          signal: requestController.signal,
          onToken: (token) => {
            const text = String(token || "");
            streamedChars += text.length;
            partialAnswer += text;
            sendRendererEvent("ai:stream", {
              requestId,
              type: "chunk",
              text: token,
              streamedChars,
            });
            const now = Date.now();
            if (
              now - lastCheckpointAt >= 1800 ||
              partialAnswer.length - lastCheckpointChars >= 2400
            ) {
              lastCheckpointAt = now;
              lastCheckpointChars = partialAnswer.length;
              void saveStreamCheckpoint("streaming").catch(() => null);
            }
          },
        },
      );
      partialAnswer = answer;
      await saveStreamCheckpoint(
        requestController.signal.aborted ? "interrupted" : "completed",
      ).catch(() => null);
      sendRendererEvent("ai:stream", {
        requestId,
        type: "done",
        phase: requestController.signal.aborted
          ? "已停止，内容已保留"
          : "生成完成",
        stopped: Boolean(requestController.signal.aborted),
        streamedChars,
      });
      return {
        answer,
        context: contextFromChunks(search.chunks),
        retrieval,
        contextCount: search.chunks.length,
        candidateCount: search.candidateCount || search.chunks.length,
        scannedCount:
          search.scannedCount || search.candidateCount || search.chunks.length,
        embeddingSource: search.embeddingSource,
        embeddingWarning: search.embeddingWarning,
        streamedChars,
      };
    } catch (error) {
      if (partialAnswer)
        await saveStreamCheckpoint("interrupted").catch(() => null);
      sendRendererEvent("ai:stream", {
        requestId,
        type: "error",
        phase: "生成中断，已保留收到的内容",
        error: error.message || String(error),
      });
      return {
        answer: `我已经完成本地检索，但暂时没有成功连接到大模型接口。\n\n${error.message}\n\n你可以先查看下方“引用片段”，确认知识库是否已经索引成功。配置接口后再次提问即可获得模型回答。`,
        context: contextFromChunks(search.chunks),
        retrieval,
        contextCount: search.chunks.length,
        candidateCount: search.candidateCount || search.chunks.length,
        scannedCount:
          search.scannedCount || search.candidateCount || search.chunks.length,
        embeddingSource: search.embeddingSource,
        embeddingWarning: search.embeddingWarning,
        apiError: error.message,
      };
    } finally {
      state.activeAiRequests.delete(requestId);
    }
  });

  registerIpcHandler("ai:cancel", async (_event, requestId) => {
    const id = String(requestId || "");
    const controller = state.activeAiRequests.get(id);
    if (!controller) return { canceled: false };
    controller.abort(new Error("user-canceled"));
    return { canceled: true };
  });
}
module.exports = { registerDomain };
