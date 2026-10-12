"use strict";
const { registerIpcHandler } = require("../register.cjs");
const {
  buildCreativeAdvice,
  callChatApi,
  ensureCurrentProject,
  generateCharactersFromOutline,
  generateWorldDocsFromOutline,
  loadConfig,
  prepareWorldCardCandidates,
  projectSnapshots,
  saveAnalysisState,
  saveWorldCardCandidates,
} = require("../dependencies.cjs");

function registerDomain() {
  registerIpcHandler("ai:creative-advice", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const result = await buildCreativeAdvice(projectPath, payload || {});
    await saveAnalysisState(projectPath, {
      creativeAdvice: result,
      creativeOptions: {
        mode: result.mode,
        chapterId: result.chapterId,
        focus: String(payload?.focus || "").trim(),
        contextIds: Array.isArray(payload?.contextIds)
          ? payload.contextIds.map(String).slice(0, 60)
          : [],
      },
    });
    return result;
  });

  registerIpcHandler("ai:generate-characters", async () => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    if (config.agent?.snapshotBeforeBulkChanges !== false) {
      await projectSnapshots.createSnapshot(projectPath, {
        name: "AI 生成角色卡前",
        reason: "批量更新角色卡前自动保存",
      });
    }
    return generateCharactersFromOutline(projectPath);
  });

  registerIpcHandler("ai:generate-world", async () => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    if (config.agent?.snapshotBeforeBulkChanges !== false) {
      await projectSnapshots.createSnapshot(projectPath, {
        name: "AI 生成世界观前",
        reason: "批量更新世界观前自动保存",
      });
    }
    return generateWorldDocsFromOutline(projectPath);
  });

  registerIpcHandler("ai:extract-world-cards", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return prepareWorldCardCandidates(projectPath, payload || {});
  });

  registerIpcHandler(
    "ai:save-world-card-candidates",
    async (_event, payload) => {
      const projectPath = await ensureCurrentProject();
      const config = await loadConfig(projectPath);
      if (
        config.agent?.snapshotBeforeBulkChanges !== false &&
        (payload?.candidates || []).length > 1
      ) {
        await projectSnapshots.createSnapshot(projectPath, {
          name: "写入设定候选前",
          reason: "批量写入世界观候选前自动保存",
        });
      }
      return saveWorldCardCandidates(projectPath, payload?.candidates || []);
    },
  );

  registerIpcHandler("ai:edit-selection", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    const action = String(payload?.action || "润色");
    const text = String(payload?.text || "").trim();
    if (!text) throw new Error("请先选中一段文字。");
    const actionPrompts = {
      改写: "在不改变核心含义的前提下，改写得更自然、更适合小说正文。",
      润色: "润色语言，使节奏、措辞和画面感更好。",
      扩写: "扩写细节，增加动作、感官和情绪，但不要偏离原意。",
      总结: "总结这段文字的剧情作用、关键信息和可改进点。",
    };
    const systemPrompt = `你是小说写作助手。${actionPrompts[action] || actionPrompts.润色}只输出结果，不要解释。`;
    const answer = await callChatApi(
      config,
      systemPrompt,
      `【原文】\n${text}`,
      [],
    );
    return { answer };
  });
}
module.exports = { registerDomain };
