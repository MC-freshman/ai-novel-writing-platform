"use strict";

const fs = require("node:fs/promises");
const storyState = require("./story-state.cjs");
const creativeWorkspace = require("./creative-workspace.cjs");
const retrievalPlanner = require("./retrieval-planner.cjs");
const analysisTools = require("./analysis-tools.cjs");
const knowledgeIndex = require("./knowledge-index.cjs");
const projectConfig = require("./project-config.cjs");
const __dep0 = require("./project-files.cjs");

async function collectCreativeAgentToolReport(projectPath, ordered, selectedIndex, currentText, contextIds = []) {
  const characters = await __dep0.loadCharacters(projectPath);
  const worldDocs = await __dep0.loadWorldDocs(projectPath);
  const matchedCharacters = characters.filter((card) => card.name && currentText.includes(card.name)).slice(0, 20);
  const matchedWorld = worldDocs.filter((doc) => doc.title && currentText.includes(doc.title)).slice(0, 20);
  const earlierChapters = ordered.slice(0, selectedIndex + 1);
  const earlierTexts = await __dep0.mapWithConcurrency(earlierChapters, 6, async (chapter) => ({
    chapter,
    text: __dep0.contentToPlainText(await fs.readFile(__dep0.getChapterPath(projectPath, chapter), "utf8").catch(() => "")),
  }));
  const lastAppearances = [];
  for (const card of matchedCharacters) {
    for (let index = earlierTexts.length - 1; index >= 0; index -= 1) {
      if (!earlierTexts[index].text.includes(card.name)) continue;
      lastAppearances.push(`${card.name}：${earlierTexts[index].chapter.title}`);
      break;
    }
  }
  const analysis = await analysisTools.loadAnalysisState(projectPath);
  const unresolvedIssues = (analysis.consistency?.issues || []).filter((item) => !["已修复", "忽略"].includes(item.status)).slice(0, 12);
  const timelineCount = Array.isArray(analysis.timeline?.events) ? analysis.timeline.events.length : 0;
  const summaries = await knowledgeIndex.loadKnowledgeSummaries(projectPath);
  const health = await projectConfig.inspectProjectHealth(projectPath);
  const storyContext = await storyState.getAgentContext(projectPath, ordered[selectedIndex]?.id || "", matchedCharacters.map((item) => item.name), contextIds);
  const selectedIds = new Set((contextIds || []).map(String));
  const contextRefs = selectedIds.size
    ? [
        ...storyContext.facts.filter((item) => selectedIds.has(item.id)).flatMap((item) => item.evidence || []),
        ...storyContext.characterStates.filter((item) => selectedIds.has(item.id) || selectedIds.has(item.characterId)).flatMap((item) => item.evidence || []),
        ...storyContext.foreshadows.filter((item) => selectedIds.has(item.id)).flatMap((item) => item.plantedAt || []),
      ].filter((item, index, array) => item?.chapterId && array.findIndex((candidate) => candidate.chapterId === item.chapterId && candidate.quote === item.quote) === index).slice(0, 20)
    : [];
  const foreshadowCandidates = [];
  for (const item of earlierTexts) {
    if (/(伏笔|线索|预兆|异常|秘密|谜团)/.test(item.text)) foreshadowCandidates.push(item.chapter.title);
  }
  const tools = [
    { name: "当前与相邻章节", detail: `${ordered[Math.max(0, selectedIndex - 1)]?.title || "无"} / ${ordered[selectedIndex]?.title || "无"} / ${ordered[selectedIndex + 1]?.title || "无"}` },
    { name: "角色最近出场", detail: lastAppearances.join("；") || "当前章节未命中已有角色卡" },
    { name: "关联世界观", detail: matchedWorld.map((item) => item.title).join("；") || "当前章节未直接命名世界观条目" },
    { name: "伏笔候选", detail: foreshadowCandidates.slice(-12).join("；") || "暂未发现显式伏笔词" },
    { name: "时间线与一致性", detail: `时间线 ${timelineCount} 个事件；待处理问题 ${unresolvedIssues.length} 个` },
    { name: "知识库结构", detail: `文档摘要 ${summaries.sources.length}；分卷摘要 ${summaries.volumes.length}；全书摘要 ${summaries.book?.summary ? "可用" : "待建立"}` },
    { name: "章节健康", detail: health.healthy ? "未发现高风险结构问题" : `发现 ${health.issues.filter((item) => item.severity === "高").length} 个高风险问题` },
    { name: "剧情事实账本", detail: `当前章节可用事实 ${storyContext.facts.length} 条；角色状态 ${storyContext.characterStates.length} 条` },
    { name: "待处理伏笔", detail: storyContext.foreshadows.slice(0, 8).map((item) => `${item.title}（${item.status}）`).join("；") || "暂无已记录的待处理伏笔" },
  ];
  const evidencePrompt = [
    storyContext.facts.length ? `【已发生事实】\n${storyContext.facts.slice(0, 24).map((item) => `- ${item.subject}：${item.object}（${item.chapterTitle}）`).join("\n")}` : "",
    storyContext.characterStates.length ? `【角色最新状态】\n${storyContext.characterStates.slice(0, 16).map((item) => `- ${item.characterName}：地点 ${item.location || "未记录"}；目标 ${(item.goals || []).join("、") || "未记录"}；知情 ${(item.knowledge || []).join("、") || "未记录"}`).join("\n")}` : "",
    storyContext.foreshadows.length ? `【未回收伏笔】\n${storyContext.foreshadows.slice(0, 20).map((item) => `- ${item.title}：${item.description}（${item.status}）`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  const prompt = `${tools.map((item) => `- ${item.name}：${item.detail}`).join("\n")}${evidencePrompt ? `\n\n${evidencePrompt}` : ""}`;
  return { tools, prompt, storyContext, contextRefs };
}

async function buildAgentRetrievalContext(projectPath, config, query, chapterId, contextIds = []) {
  const [characters, worldDocs, workspace] = await Promise.all([
    __dep0.loadCharacters(projectPath),
    __dep0.loadWorldDocs(projectPath),
    creativeWorkspace.loadWorkspace(projectPath),
  ]);
  const subQueries = retrievalPlanner.decomposeQuery(query, "normal");
  const signals = retrievalPlanner.extractQuerySignals(query, characters, worldDocs);
  const anchorIds = [chapterId].filter(Boolean);
  const adjacencyScores = retrievalPlanner.buildChapterAdjacency(config.chapters || [], anchorIds);
  const storyContext = chapterId
    ? await storyState.getAgentContext(projectPath, chapterId, signals.characters, contextIds).catch(() => ({}))
    : {};
  const storyScores = retrievalPlanner.buildStoryBoosts(workspace, storyContext, subQueries);
  return { subQueries, signals, adjacencyScores, storyScores };
}

module.exports = { collectCreativeAgentToolReport, buildAgentRetrievalContext };
