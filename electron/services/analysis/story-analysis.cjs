"use strict";
const {
  cachedChapterRevision,
  callChatApi,
  contentToPlainText,
  estimateTokenCount,
  extractJsonFromModelText,
  fs,
  getChapterPath,
  loadCharacters,
  loadConfig,
  mapWithConcurrency,
  runtimeSecret,
  storyState,
  truncateForPrompt,
} = require("./dependencies.cjs");

async function refreshLocalStoryState(
  projectPath,
  chapterId,
  contentOverride = null,
  context = {},
) {
  const config = context.config || (await loadConfig(projectPath));
  const chapter = config.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error("章节不存在，无法更新创作状态。");
  const content =
    contentOverride === null
      ? await fs
          .readFile(getChapterPath(projectPath, chapter), "utf8")
          .catch(() => "")
      : String(contentOverride || "");
  const characters = context.characters || (await loadCharacters(projectPath));
  const ledger = storyState.analyzeChapterLocally({
    chapter,
    content,
    characters,
  });
  return storyState.saveChapterLedger(projectPath, ledger);
}

async function getStoryOverviewForProject(projectPath, options = {}) {
  const config = await loadConfig(projectPath);
  const projectChapters = await mapWithConcurrency(
    config.chapters,
    8,
    async (chapter) => {
      return {
        id: chapter.id,
        title: chapter.title,
        volume: chapter.volume || "未分卷",
        revision: await cachedChapterRevision(projectPath, chapter),
      };
    },
  );
  return storyState.getStoryOverview(projectPath, {
    chapterLimit: 500,
    ...options,
    projectChapters,
  });
}

function storyAnalysisSystemPrompt() {
  return `你是小说项目的剧情事实整理工具。只记录输入正文中可以直接找到证据的事实，不要补写、推测或完善设定。
输出 JSON，不要 Markdown，不要解释。格式：
{"facts":[{"type":"剧情事件","subject":"","predicate":"","object":"","confidence":0.8,"evidence":[{"quote":"原文短句"}]}],"characterStates":[{"characterName":"","location":"","route":["行动路线"],"physical":["身体状态"],"mental":["精神状态"],"abilities":["能力变化"],"goals":["当前目标"],"obstacles":["当前阻碍"],"knowledge":["已知信息"],"knowledgeSources":["信息来源"],"possessions":["携带物品"],"relationships":["当前关系"],"relationshipChanges":["关系变化"],"lastAppearance":"最近一次出场原句","confidence":0.8,"evidence":[{"quote":"原文短句"}]}],"foreshadows":[{"title":"","description":"","stage":"埋设|强化|回收","plannedPayoff":"","relatedCharacters":[""],"confidence":0.7,"evidence":[{"quote":"原文短句"}]}]}
事实类型优先使用：剧情事件、地点变化、物品变化、知情变化、关系变化、状态变化。
每一条都必须带正文中的原句证据；没有证据就不要输出。角色“知道什么”必须严格区分叙述者信息与角色知情范围，并在 knowledgeSources 中写清得知渠道。伏笔如果是既有线索的强化或回收，沿用同一简洁标题并准确填写 stage。`;
}

async function analyzeStoryStateWithAI(projectPath, chapterId, control = {}) {
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error("章节不存在，无法执行 AI 剧情分析。");
  const content = await fs
    .readFile(getChapterPath(projectPath, chapter), "utf8")
    .catch(() => "");
  const characters = await loadCharacters(projectPath);
  const localLedger = storyState.analyzeChapterLocally({
    chapter,
    content,
    characters,
  });
  if (!runtimeSecret(config.api, "chat")) {
    const saved = await storyState.saveChapterLedger(projectPath, localLedger);
    return { ledger: saved, apiError: "未配置聊天 API，已完成本地基础分析。" };
  }
  const characterCatalog = characters
    .slice(0, 120)
    .map((item) => `${item.name}${item.category ? `（${item.category}）` : ""}`)
    .join("、");
  const question = `【章节】${chapter.volume || "未分卷"} / ${chapter.title}
【已有角色卡】${characterCatalog || "无"}
【正文】
${truncateForPrompt(contentToPlainText(content), 70000)}`;
  let partialOutput = "";
  let lastCheckpointAt = 0;
  const promptTokens = estimateTokenCount(
    `${storyAnalysisSystemPrompt()}\n${question}`,
  );
  await control.update?.({
    usage: { promptTokens, completionTokens: 0, totalTokens: promptTokens },
  });
  const answer = await callChatApi(
    config,
    storyAnalysisSystemPrompt(),
    question,
    [],
    {
      stream: true,
      signal: control.signal,
      onToken: (token) => {
        partialOutput += token;
        if (Date.now() - lastCheckpointAt < 900) return;
        lastCheckpointAt = Date.now();
        if (typeof control.update === "function") {
          const completionTokens = estimateTokenCount(partialOutput);
          void control.update({
            phase: `正在分析《${chapter.title}》`,
            partialOutput,
            usage: {
              promptTokens,
              completionTokens,
              totalTokens: promptTokens + completionTokens,
            },
          });
        }
      },
    },
  );
  const completionTokens = estimateTokenCount(answer);
  await control.update?.({
    partialOutput: answer,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
  });
  const normalized = storyState.normalizeAiChapterAnalysis(
    extractJsonFromModelText(answer),
    chapter,
    localLedger.sourceRevision,
    characters,
  );
  const usefulLedger =
    normalized.facts.length ||
    normalized.characterStates.length ||
    normalized.foreshadows.length
      ? normalized
      : localLedger;
  const saved = await storyState.saveChapterLedger(projectPath, usefulLedger);
  return {
    ledger: saved,
    partialOutput: answer,
    apiError:
      usefulLedger === localLedger
        ? "AI 返回结构无法识别，已保留本地分析结果。"
        : "",
  };
}

module.exports = {
  refreshLocalStoryState,
  getStoryOverviewForProject,
  storyAnalysisSystemPrompt,
  analyzeStoryStateWithAI,
};
