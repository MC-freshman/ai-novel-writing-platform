// 本文件由 P2 重构自 electron/main.cjs 机械搬迁（scripts/refactor-split.cjs），逻辑未改动。
"use strict";

const storyState = require("./story-state.cjs");
const creativeWorkspace = require("./creative-workspace.cjs");
const retrievalPlanner = require("./retrieval-planner.cjs");
const novelAgent = require("./novel-agent.cjs");
const { MAX_RETRIEVAL_TOP_K, STRUCTURING_CONTEXT_CHAR_BUDGET } = require("./constants.cjs");
const { state, sendRendererEvent } = require("./runtime-state.cjs");
const __dep0 = require("./project-files.cjs");
const __dep1 = require("./project-config.cjs");
const __dep2 = require("./knowledge-index.cjs");
const __dep3 = require("./retrieval-pipeline.cjs");
const __dep4 = require("./ai-generate.cjs");
const __dep5 = require("./analysis-tools.cjs");
const __dep6 = require("./project-content.cjs");
const __dep7 = require("./task-runtime.cjs");
const __dep8 = require("./project-ops.cjs");
const fs = require("node:fs/promises");

function nowIso(...args) { return __dep0.nowIso.apply(null, args); }
function clampNumber(...args) { return __dep0.clampNumber(...args); }
function mapWithConcurrency(...args) { return __dep0.mapWithConcurrency(...args); }
function countWords(...args) { return __dep0.countWords(...args); }
function getChapterPath(...args) { return __dep0.getChapterPath(...args); }
function contentRevision(...args) { return __dep0.contentRevision(...args); }
function cachedChapterRevision(...args) { return __dep0.cachedChapterRevision(...args); }
function isHtmlContent(...args) { return __dep0.isHtmlContent(...args); }
function contentToPlainText(...args) { return __dep0.contentToPlainText(...args); }
function escapeHtml(...args) { return __dep0.escapeHtml(...args); }
function stableHash(...args) { return __dep0.stableHash(...args); }
function loadCharacters(...args) { return __dep0.loadCharacters(...args); }
function loadWorldDocs(...args) { return __dep0.loadWorldDocs(...args); }
function getKnowledgeRole(...args) { return __dep0.getKnowledgeRole(...args); }
function inspectProjectHealth(...args) { return __dep1.inspectProjectHealth(...args); }
function loadKnowledgeSummaries(...args) { return __dep2.loadKnowledgeSummaries(...args); }
function searchRelevantChunks(...args) { return __dep2.searchRelevantChunks(...args); }
function forceIncludeSourceChunks(...args) { return __dep3.forceIncludeSourceChunks(...args); }
function callChatApi(...args) { return __dep4.callChatApi(...args); }
function estimateTokenCount(...args) { return __dep4.estimateTokenCount(...args); }
function callStructuredChatWithProgress(...args) { return __dep4.callStructuredChatWithProgress(...args); }
function normalizeCreativeAdviceMode(...args) { return __dep4.normalizeCreativeAdviceMode(...args); }
function buildCreativeAdvice(...args) { return __dep4.buildCreativeAdvice(...args); }
function loadAnalysisState(...args) { return __dep5.loadAnalysisState(...args); }
function saveChapterContent(...args) { return __dep6.saveChapterContent(...args); }
function getProjectTaskCenter(...args) { return __dep7.getProjectTaskCenter(...args); }
function loadConfig(...args) { return __dep8.loadConfig(...args); }
function buildAppState(...args) { return __dep8.buildAppState(...args); }

async function collectCreativeAgentToolReport(projectPath, ordered, selectedIndex, currentText, contextIds = []) {
  const characters = await loadCharacters(projectPath);
  const worldDocs = await loadWorldDocs(projectPath);
  const matchedCharacters = characters.filter((card) => card.name && currentText.includes(card.name)).slice(0, 20);
  const matchedWorld = worldDocs.filter((doc) => doc.title && currentText.includes(doc.title)).slice(0, 20);
  const earlierChapters = ordered.slice(0, selectedIndex + 1);
  const earlierTexts = await mapWithConcurrency(earlierChapters, 6, async (chapter) => ({
    chapter,
    text: contentToPlainText(await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "")),
  }));
  const lastAppearances = [];
  for (const card of matchedCharacters) {
    for (let index = earlierTexts.length - 1; index >= 0; index -= 1) {
      if (!earlierTexts[index].text.includes(card.name)) continue;
      lastAppearances.push(`${card.name}：${earlierTexts[index].chapter.title}`);
      break;
    }
  }
  const analysis = await loadAnalysisState(projectPath);
  const unresolvedIssues = (analysis.consistency?.issues || []).filter((item) => !["已修复", "忽略"].includes(item.status)).slice(0, 12);
  const timelineCount = Array.isArray(analysis.timeline?.events) ? analysis.timeline.events.length : 0;
  const summaries = await loadKnowledgeSummaries(projectPath);
  const health = await inspectProjectHealth(projectPath);
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
    loadCharacters(projectPath),
    loadWorldDocs(projectPath),
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


async function getCreativeWorkspaceView(projectPath) {
  const state = await creativeWorkspace.loadWorkspace(projectPath);
  const config = await loadConfig(projectPath);
  const revisionsByChapter = new Map();
  for (const chapter of config.chapters) revisionsByChapter.set(chapter.id, await cachedChapterRevision(projectPath, chapter));
  return {
    ...state,
    annotations: state.annotations.map((item) => ({
      ...item,
      stale: Boolean(item.sourceRevision && revisionsByChapter.get(item.chapterId) && item.sourceRevision !== revisionsByChapter.get(item.chapterId)),
    })),
    revisions: state.revisions.map((item) => ({
      ...item,
      stale: item.status === "待确认" && Boolean(item.sourceRevision && revisionsByChapter.get(item.chapterId) && item.sourceRevision !== revisionsByChapter.get(item.chapterId)),
    })),
  };
}


async function prepareCreativeAgentRun(projectPath, options = {}) {
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === options.chapterId) || config.chapters[0];
  if (!chapter) throw new Error("当前项目没有可供参谋分析的文档。");
  const mode = normalizeCreativeAdviceMode(options.mode);
  const focus = String(options.focus || "").trim().slice(0, 1200);
  const selectedText = String(options.selectedText || "").trim().slice(0, 20000);
  const includeSourceIds = [...new Set((Array.isArray(options.includeSourceIds) ? options.includeSourceIds : []).map(String).filter(Boolean))].slice(0, 500);
  const excludeSourceIds = [...new Set((Array.isArray(options.excludeSourceIds) ? options.excludeSourceIds : []).map(String).filter(Boolean))].filter((id) => !includeSourceIds.includes(id)).slice(0, 500);
  const permissionLevel = novelAgent.normalizePermission(options.permissionLevel || config.agent.permissionLevel);
  const requestedScope = String(options.scopeType || "auto");
  const scope = novelAgent.resolveScope(config, chapter, requestedScope, focus, mode);
  const workspaceState = await creativeWorkspace.loadWorkspace(projectPath);
  const memories = creativeWorkspace.relevantMemories(workspaceState, chapter);
  const query = [scope.label, chapter.title, focus, mode === "plot" ? "剧情推进 因果 动机" : mode === "foreshadow" ? "伏笔 埋设 回收" : "下一章 节奏 人物"].filter(Boolean).join(" ");
  const topK = Math.floor(clampNumber(config.api.topK || 120, 1, MAX_RETRIEVAL_TOP_K, 120));
  const retrievalContext = await buildAgentRetrievalContext(projectPath, config, query, chapter.id, options.contextIds || []);
  retrievalContext.routedVolumes = [...new Set(config.chapters.filter((item) => scope.ids.includes(item.id)).map((item) => item.volume || "未分卷"))];
  retrievalContext.requiredSourceIds = [...(scope.ids.length <= 60 ? scope.ids.filter((id) => !excludeSourceIds.includes(id)) : []), ...includeSourceIds];
  const search = await searchRelevantChunks(projectPath, query, topK, {
    minKeep: Math.min(24, topK),
    maxChars: STRUCTURING_CONTEXT_CHAR_BUDGET,
    retrievalContext,
    mode: scope.type === "book" ? "book" : "normal",
    additionalLoadSourceIds: includeSourceIds,
    boostSourceIds: includeSourceIds,
    excludeSourceIds,
  });
  if (includeSourceIds.length) search.chunks = forceIncludeSourceChunks(search.chunks, search._store, includeSourceIds, topK);
  const sourceTitles = [...new Set(search.chunks.map((item) => item.title))];
  const warnings = [];
  if (!search.chunks.length) warnings.push("知识库没有命中原文，请先检查同步状态。");
  if (!config.chapters.some((item) => getKnowledgeRole(item) === "大纲")) warnings.push("项目中没有标记为“大纲”的文档，建议可能缺少长期方向依据。");
  if (search.chunks.length >= topK) warnings.push("本次命中达到发送上限，执行后请查看检索审计中的未读资料。");
  if (search.freshness?.repairedSourceCount) warnings.push(`执行前已自动更新 ${search.freshness.repairedSourceCount} 份过期资料。`);
  if (search.coveragePass?.uncoveredTargets?.length) warnings.push(`仍有 ${search.coveragePass.uncoveredTargets.length} 个证据目标未覆盖，执行结果会明确标出证据不足。`);
  if (includeSourceIds.length) warnings.push(`已强制纳入 ${includeSourceIds.length} 份作者指定资料。`);
  if (excludeSourceIds.length) warnings.push(`已排除 ${excludeSourceIds.length} 份作者指定资料。`);
  const plannedTools = novelAgent.selectTools(focus || query, mode, permissionLevel, selectedText);
  const steps = [
    { tool: "scope_checkpoint", label: `分析范围：${scope.label}`, reason: scope.recommended ? "Agent 根据目标自动推荐，可在执行前改为章节、分卷或全书" : "使用作者手动指定的分析范围" },
    ...plannedTools.map((item) => ({ tool: item.tool, label: item.allowed ? item.label : `${item.label}（跳过）`, reason: item.allowed ? item.reason : item.skipReason })),
    { tool: "knowledge_retrieval", label: `长篇检索与证据汇总（最多 ${topK} 个片段）`, reason: "综合分层摘要、角色地点、相邻章节、剧情事实和伏笔证据" },
    { tool: "creative_advisor", label: "汇总为可选择的创作建议", reason: "保存工具阶段结果，不直接覆盖正文" },
  ];
  const retrievalAudit = {
    query,
    requestedTopK: topK,
    selectedChunks: search.chunks.length,
    selectedSources: sourceTitles,
    memoryCount: memories.length,
    estimatedPromptTokens: estimateTokenCount(search.chunks.map((item) => item.text).join("\n")) + 5000,
    warnings,
    firstPassCount: search.coveragePass?.firstPassCount || search.chunks.length,
    secondPassCount: search.coveragePass?.secondPassCount || 0,
    evidenceConfidence: search.coveragePass?.evidenceConfidence || "低",
    uncoveredTargets: search.coveragePass?.uncoveredTargets || [],
  };
  const run = await creativeWorkspace.upsertItem(projectPath, "agentRuns", {
    mode,
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    scopeType: scope.type,
    scopeIds: scope.ids,
    scopeLabel: scope.label,
    scopeRecommended: scope.recommended,
    objective: focus || "根据当前正文和项目资料提供下一步创作建议",
    status: "待确认",
    permissionLevel,
    selectedText,
    selectedTextRevision: String(options.selectedTextRevision || ""),
    contextIds: Array.isArray(options.contextIds) ? options.contextIds : [],
    includeSourceIds,
    excludeSourceIds,
    memoryIds: memories.map((item) => item.id),
    steps,
    toolStates: novelAgent.initialToolStates(plannedTools),
    stageCheckpoints: [
      ...novelAgent.initialToolStates(plannedTools).map((item) => ({ id: item.tool, label: item.label, status: item.status, detail: item.detail, startedAt: "", completedAt: item.status === "已跳过" ? nowIso() : "", error: "" })),
      { id: "creative_advisor", label: "汇总创作建议", status: "等待中", detail: "等待各项检查完成", startedAt: "", completedAt: "", error: "" },
    ],
    stageSummary: { completed: [], failed: [], skipped: plannedTools.filter((item) => !item.allowed).map((item) => item.tool) },
    taskId: "",
    partialOutput: "",
    retrievalAudit,
  });
  return run;
}


async function buildCreativeAgentExecutionContext(projectPath, run) {
  const config = await loadConfig(projectPath);
  const ordered = config.chapters.slice().sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((item) => item.id === run.chapterId);
  const chapter = ordered[index];
  if (!chapter) throw new Error("Agent 计划对应的章节已不存在，请重新准备计划。");
  const raw = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
  const currentText = contentToPlainText(raw);
  const scopedIds = new Set((run.scopeIds?.length ? run.scopeIds : [chapter.id]).map(String));
  const includeIds = new Set((run.includeSourceIds || []).map(String));
  const excludeIds = new Set((run.excludeSourceIds || []).map(String).filter((id) => !includeIds.has(id)));
  const scopeChapters = ordered.filter((item) => (scopedIds.has(String(item.id)) || includeIds.has(String(item.id))) && !excludeIds.has(String(item.id)));
  const scopeTexts = await mapWithConcurrency(scopeChapters, 8, async (item) => ({
    chapter: item,
    text: contentToPlainText(await fs.readFile(getChapterPath(projectPath, item), "utf8").catch(() => "")),
  }));
  const [characters, worldDocs, workspace, analysis, storyContext, board, summaries] = await Promise.all([
    loadCharacters(projectPath),
    loadWorldDocs(projectPath),
    creativeWorkspace.loadWorkspace(projectPath),
    loadAnalysisState(projectPath),
    storyState.getAgentContext(projectPath, chapter.id, [], run.contextIds || []).catch(() => ({})),
    storyState.getBoard(projectPath, chapter.id).catch(() => null),
    loadKnowledgeSummaries(projectPath),
  ]);
  return { config, ordered, index, chapter, previous: ordered[index - 1] || null, next: ordered[index + 1] || null, currentText, scopeChapters, scopeTexts, characters, worldDocs, workspace, analysis, storyContext, board, summaries };
}


function pacingReport(text) {
  const body = String(text || "");
  const paragraphs = body.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const sentences = body.split(/[。！？!?]/).map((item) => item.trim()).filter(Boolean);
  const dialogueChars = [...body.matchAll(/“([^”]*)”/g)].reduce((sum, match) => sum + String(match[1] || "").length, 0);
  const headingCount = paragraphs.filter((item) => /^第.+章|^[一二三四五六七八九十\d]+[.、]|^场景/.test(item)).length;
  const dialogueRatio = body.length ? Math.round((dialogueChars / body.length) * 100) : 0;
  const averageSentence = sentences.length ? Math.round(body.length / sentences.length) : 0;
  return `正文 ${countWords(body)} 字；${paragraphs.length} 段；平均句长约 ${averageSentence} 字；对话约 ${dialogueRatio}%；显式场景/小标题 ${headingCount} 个`;
}


async function runCreativeAgentTool(tool, context, run) {
  const { chapter, previous, next, currentText, scopeChapters, scopeTexts, characters, worldDocs, workspace, analysis, storyContext, board, summaries } = context;
  const scopedText = (scopeTexts || []).map((item) => item.text).join("\n");
  if (tool === "read_adjacent_chapters") {
    const previousText = (scopeTexts || []).find((item) => item.chapter.id === previous?.id)?.text || "";
    const nextText = (scopeTexts || []).find((item) => item.chapter.id === next?.id)?.text || "";
    return `前章：${previous?.title || "无"}（末尾：${previousText.slice(-260) || "未纳入本次范围"}）；当前：${chapter.title}；后章：${next?.title || "无"}（开头：${nextText.slice(0, 260) || "未纳入本次范围"}）`;
  }
  if (tool === "character_state_lookup") {
    const states = storyContext.characterStates || [];
    return states.length ? states.slice(0, 20).map((item) => `${item.characterName}：地点 ${item.location || "未知"}；身心 ${[...(item.physical || []), ...(item.mental || [])].join("、") || "未记录"}；能力 ${item.abilities?.join("、") || "未记录"}；目标 ${item.goals?.join("、") || "未记录"}；阻碍 ${item.obstacles?.join("、") || "未记录"}`).join("\n") : "当前范围没有角色状态快照";
  }
  if (tool === "recent_appearance_lookup") {
    const states = storyContext.characterStates || [];
    return states.length ? states.slice(0, 30).map((item) => `${item.characterName}：${item.chapterTitle} / ${item.lastAppearance || "未记录原文位置"}`).join("\n") : "当前范围没有角色最近出场记录";
  }
  if (tool === "knowledge_scope_lookup") {
    const states = storyContext.characterStates || [];
    return states.length ? states.slice(0, 25).map((item) => `${item.characterName}：${item.knowledge?.join("；") || "未记录知情"}${item.knowledgeSources?.length ? `（来源：${item.knowledgeSources.join("；")}）` : "（来源待核对）"}`).join("\n") : "当前范围没有人物知情记录";
  }
  if (tool === "world_rule_lookup") {
    const matched = worldDocs.filter((item) => item.title && (scopedText || currentText).includes(item.title));
    return `直接命中世界观 ${matched.length} 条：${matched.slice(0, 20).map((item) => `${item.category || "未分类"}/${item.title}`).join("、") || "无直接标题命中"}；项目世界观共 ${worldDocs.length} 条`;
  }
  if (tool === "open_foreshadow_lookup") {
    const open = (storyContext.foreshadows || []).filter((item) => !["已经回收", "已废弃"].includes(item.status));
    return open.length ? open.slice(0, 30).map((item) => `${item.title}（${item.status}）：埋设 ${item.plantedAt?.length || 0} / 强化 ${item.reinforcedAt?.length || 0} / 回收 ${item.payoffAt?.length || 0}`).join("\n") : "没有未回收伏笔";
  }
  if (tool === "timeline_lookup") {
    const events = analysis.timeline?.events || [];
    return events.length ? events.slice(0, 80).map((item) => `${item.order + 1}. ${item.timeHint || item.title} / ${item.chapterTitle}：${item.summary}`).join("\n") : "尚未保存时间线，请先在分析页刷新时间线";
  }
  if (tool === "chapter_transition_check") {
    return `衔接位置：${previous?.title || "开篇"} -> ${chapter.title} -> ${next?.title || "目录末尾"}；当前开头：${currentText.slice(0, 220)}；当前结尾：${currentText.slice(-220)}`;
  }
  if (tool === "setting_conflict_check") {
    const unresolved = (analysis.consistency?.issues || []).filter((item) => !["已修复", "已忽略"].includes(item.status));
    return unresolved.length ? unresolved.slice(0, 40).map((item) => `${item.severity}/${item.category}：${item.title} - ${item.detail}`).join("\n") : "没有已保存的待处理一致性问题";
  }
  if (tool === "outline_goal_lookup") {
    const outlines = (summaries.sources || []).filter((item) => item.knowledgeRole === "大纲");
    return `项目大纲 ${outlines.length} 份：${outlines.slice(0, 30).map((item) => `${item.volume || "未分卷"}/${item.title}`).join("、") || "知识库未标记大纲"}`;
  }
  if (tool === "knowledge_coverage_check") {
    const audit = run.retrievalAudit || {};
    return `本次范围 ${run.scopeLabel}；已选 ${audit.selectedChunks || 0} 个片段 / ${(audit.selectedSources || []).length} 份资料；证据置信度 ${audit.evidenceConfidence || "未评估"}；仍缺证据 ${(audit.uncoveredTargets || []).join("、") || "无"}`;
  }
  if (tool === "chapter_health_check") return `${run.scopeLabel || chapter.title}：${pacingReport(scopedText || currentText)}；场景计划 ${(workspace.scenes || []).filter((item) => item.chapterId === chapter.id).length} 个；筹备项 ${board?.items?.length || 0} 个`;
  if (tool === "chapter_planner") {
    return `范围：${run.scopeLabel || chapter.title}；位置：${previous?.title || "开篇"} → ${chapter.title} → ${next?.title || "目录末尾"}；当前筹备板 ${board?.items?.length || 0} 项；大纲摘要 ${summaries.sources.filter((item) => item.knowledgeRole === "大纲").length} 份`;
  }
  if (tool === "plot_causality_advisor") {
    const nodes = (workspace.causalNodes || []).filter((item) => !item.chapterId || item.chapterId === chapter.id);
    return `当前相关因果节点 ${nodes.length} 个；剧情事实 ${(storyContext.facts || []).length} 条；${nodes.slice(0, 6).map((item) => item.title).join("、") || "尚无人工确认的因果节点"}`;
  }
  if (tool === "character_development_advisor") {
    const matched = characters.filter((item) => item.name && (scopedText || currentText).includes(item.name));
    const scopedIds = new Set((scopeChapters || []).map((item) => item.id));
    const arcs = (workspace.arcs || []).filter((item) => (!item.chapterId || scopedIds.has(item.chapterId)) && matched.some((card) => card.id === item.characterId || card.name === item.characterName));
    return `当前范围命中角色卡 ${matched.length} 张：${matched.slice(0, 12).map((item) => item.name).join("、") || "无"}；相关人物弧节点 ${arcs.length} 个；最新角色状态 ${(storyContext.characterStates || []).length} 条`;
  }
  if (tool === "foreshadow_manager") {
    const open = (storyContext.foreshadows || []).filter((item) => !["已经回收", "已废弃"].includes(item.status));
    return `待处理伏笔 ${open.length} 条：${open.slice(0, 10).map((item) => `${item.title}（${item.status}）`).join("、") || "暂无已记录伏笔"}`;
  }
  if (tool === "pacing_analyzer") return `${run.scopeLabel || chapter.title}：${pacingReport(scopedText || currentText)}；覆盖 ${scopeChapters?.length || 1} 份文档`;
  if (tool === "continuity_checker") {
    const unresolved = (analysis.consistency?.issues || []).filter((item) => !["已修复", "忽略"].includes(item.status));
    const scopedIds = new Set((scopeChapters || []).map((item) => item.id));
    return `现有一致性问题 ${unresolved.length} 个；当前范围相关 ${unresolved.filter((item) => scopedIds.has(item.chapterId) || (scopeChapters || []).some((chapterItem) => chapterItem.title === item.chapterTitle)).length} 个；时间线事件 ${analysis.timeline?.events?.length || 0} 个`;
  }
  if (tool === "setting_verifier") {
    const matched = worldDocs.filter((item) => item.title && (scopedText || currentText).includes(item.title));
    return `当前范围直接命中世界观 ${matched.length} 条：${matched.slice(0, 12).map((item) => item.title).join("、") || "无"}；项目共有 ${worldDocs.length} 条世界观资料`;
  }
  if (tool === "safe_revision_proposer") {
    return run.selectedText ? `已取得作者选中的 ${countWords(run.selectedText)} 字原文，将生成独立的待确认修订，不会覆盖正文` : "没有选中文字，已跳过修订候选";
  }
  throw new Error(`未知的 Agent 工具：${tool}`);
}


function inferRevisionAction(objective) {
  if (/扩写/.test(objective)) return "扩写";
  if (/精简/.test(objective)) return "精简";
  if (/改写/.test(objective)) return "改写";
  return "润色";
}


function updateAgentStage(run, stageId, patch) {
  const checkpoints = (run.stageCheckpoints || []).map((item) => item.id === stageId ? { ...item, ...patch } : item);
  const stageSummary = {
    completed: checkpoints.filter((item) => item.status === "已完成").map((item) => item.id),
    failed: checkpoints.filter((item) => item.status === "失败").map((item) => item.id),
    skipped: checkpoints.filter((item) => item.status === "已跳过").map((item) => item.id),
  };
  return { ...run, stageCheckpoints: checkpoints, stageSummary };
}


async function executeCreativeAgentRun(projectPath, runId, control = {}, onlyTool = "") {
  const workspaceState = await creativeWorkspace.loadWorkspace(projectPath);
  let run = workspaceState.agentRuns.find((item) => item.id === runId);
  if (!run) throw new Error("没有找到待执行的 Agent 计划，请重新准备。");
  run = await creativeWorkspace.upsertItem(projectPath, "agentRuns", { ...run, status: "运行中", error: "" });
  const reports = onlyTool
    ? run.toolStates.filter((item) => item.status === "已完成" && item.tool !== onlyTool).map((item) => ({ name: item.label, detail: item.partialOutput || item.detail }))
    : [];
  const total = Math.max(1, run.toolStates.filter((item) => item.status !== "已跳过" && (!onlyTool || item.tool === onlyTool)).length + 1);
  let current = 0;
  try {
    const context = await buildCreativeAgentExecutionContext(projectPath, run);
    for (const state of run.toolStates) {
      if (state.status === "已跳过" || (onlyTool && state.tool !== onlyTool)) continue;
      if (!onlyTool && state.status === "已完成") {
        reports.push({ name: state.label, detail: state.partialOutput || state.detail });
        current += 1;
        continue;
      }
      if (control.signal?.aborted) throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
      run = await creativeWorkspace.upsertItem(projectPath, "agentRuns", {
        ...updateAgentStage(run, state.tool, { status: "运行中", startedAt: nowIso(), completedAt: "", detail: "正在检查", error: "" }),
        toolStates: run.toolStates.map((item) => item.tool === state.tool ? { ...item, status: "运行中", error: "" } : item),
      });
      await control.update?.({ phase: `${state.label}正在检查`, current, total, detail: run.chapterTitle });
      try {
        const detail = await runCreativeAgentTool(state.tool, context, run);
        reports.push({ name: state.label, detail });
        current += 1;
        const partialLine = `【${state.label}】${detail}`;
        run = await creativeWorkspace.upsertItem(projectPath, "agentRuns", {
          ...updateAgentStage(run, state.tool, { status: "已完成", completedAt: nowIso(), detail, error: "" }),
          partialOutput: `${run.partialOutput || ""}\n${partialLine}`.trim(),
          toolStates: run.toolStates.map((item) => item.tool === state.tool ? { ...item, status: "已完成", detail: "检查完成", partialOutput: detail, error: "" } : item),
        });
        await control.appendPartial?.(`${partialLine}\n`);
        await control.update?.({ current, total, detail });
      } catch (error) {
        current += 1;
        run = await creativeWorkspace.upsertItem(projectPath, "agentRuns", {
          ...updateAgentStage(run, state.tool, { status: "失败", completedAt: nowIso(), error: error?.message || String(error) }),
          toolStates: run.toolStates.map((item) => item.tool === state.tool ? { ...item, status: "失败", error: error?.message || String(error) } : item),
        });
        await control.update?.({ current, total, detail: `${state.label}失败，继续执行其他工具` });
      }
    }

    run = await creativeWorkspace.upsertItem(projectPath, "agentRuns", updateAgentStage(run, "creative_advisor", { status: "运行中", startedAt: nowIso(), completedAt: "", detail: "正在汇总已完成阶段", error: "" }));
    await control.update?.({ phase: "正在汇总创作建议", current, total, detail: "已完成的工具结果会持续保留" });
    const advice = await buildCreativeAdvice(projectPath, {
      mode: run.mode,
      chapterId: run.chapterId,
      focus: run.objective,
      contextIds: run.contextIds,
      includeSourceIds: run.includeSourceIds,
      excludeSourceIds: run.excludeSourceIds,
      scopeType: run.scopeType,
      scopeIds: run.scopeIds,
      scopeLabel: run.scopeLabel,
      workflowToolReports: reports,
    }, control);
    const outputs = { ...(run.outputs || {}) };
    const completedTools = new Set(run.toolStates.filter((item) => item.status === "已完成").map((item) => item.tool));
    if (novelAgent.permissionRank(run.permissionLevel) >= novelAgent.permissionRank("可创建规划") && completedTools.has("chapter_planner")) {
      let board = context.board || await storyState.generateLocalBoard(projectPath, context.chapter, context.next);
      const retained = (board.items || []).filter((item) => item.locked);
      const generated = advice.items.map((item, index) => ({
        id: `beat_agent_${stableHash(`${run.id}_${item.id}`)}`,
        type: item.type,
        title: item.title,
        detail: `${item.summary}${item.suggestedUse ? `\n使用建议：${item.suggestedUse}` : ""}`,
        order: retained.length + index,
        locked: false,
        completed: false,
        sourceRefs: item.sourceRefs || [],
      }));
      board = await storyState.saveBoard(projectPath, { ...board, items: [...retained, ...generated], generatedAt: nowIso() });
      outputs.boardId = board.id;
    }
    if (novelAgent.permissionRank(run.permissionLevel) >= novelAgent.permissionRank("可生成修订候选") && completedTools.has("safe_revision_proposer") && run.selectedText) {
      try {
        const revision = await createSafeRevision(projectPath, {
          chapterId: run.chapterId,
          original: run.selectedText,
          sourceRevision: run.selectedTextRevision,
          action: inferRevisionAction(run.objective),
          instruction: run.objective,
        }, control);
        outputs.revisionId = revision.id;
      } catch (error) {
        run = await creativeWorkspace.upsertItem(projectPath, "agentRuns", {
          ...run,
          toolStates: run.toolStates.map((item) => item.tool === "safe_revision_proposer" ? { ...item, status: "失败", error: error?.message || String(error) } : item),
        });
      }
    }
    const completed = await creativeWorkspace.upsertItem(projectPath, "agentRuns", {
      ...updateAgentStage(run, "creative_advisor", { status: "已完成", completedAt: nowIso(), detail: `${advice.items.length} 条建议`, error: "" }),
      status: "已完成",
      retrievalAudit: advice.retrievalAudit || run.retrievalAudit,
      result: advice,
      outputs,
      error: "",
    });
    await control.update?.({ phase: "创作 Agent 已完成", current: total, total, detail: `${advice.items.length} 条建议` });
    return { run: completed, advice, outputs };
  } catch (error) {
    const interrupted = control.signal?.aborted || error?.name === "AbortError";
    const activeStage = (run.stageCheckpoints || []).find((item) => item.status === "运行中")?.id;
    const failedRun = activeStage ? updateAgentStage(run, activeStage, { status: "失败", completedAt: nowIso(), error: error?.message || String(error) }) : run;
    await creativeWorkspace.upsertItem(projectPath, "agentRuns", { ...failedRun, status: interrupted ? "已中断" : "失败", error: error?.message || String(error) });
    throw error;
  }
}


async function queueCreativeAgentRun(projectPath, runId, onlyTool = "") {
  const workspaceState = await creativeWorkspace.loadWorkspace(projectPath);
  let run = workspaceState.agentRuns.find((item) => item.id === runId);
  if (!run) throw new Error("没有找到待执行的 Agent 计划，请重新准备。");
  if (onlyTool && !run.toolStates.some((item) => item.tool === onlyTool && item.status === "失败")) throw new Error("只能单独重试执行失败的工具。");
  const task = await (await getProjectTaskCenter(projectPath)).enqueue({
    type: "agent-workflow",
    title: onlyTool ? `重试 Agent 工具：${run.chapterTitle}` : `创作 Agent：${run.chapterTitle}`,
    total: Math.max(1, run.toolStates.filter((item) => item.status !== "已跳过" && (!onlyTool || item.tool === onlyTool)).length + 1),
    scope: { chapterId: run.chapterId, chapterIds: run.scopeIds?.length ? run.scopeIds : [run.chapterId] },
    options: { runId: run.id, onlyTool },
  });
  run = await creativeWorkspace.upsertItem(projectPath, "agentRuns", { ...run, status: "等待中", taskId: task.id, error: "" });
  return { run, task };
}


async function createSafeRevision(projectPath, payload = {}, control = {}) {
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === payload.chapterId);
  if (!chapter) throw new Error("没有找到选中文字所属的章节。");
  const original = String(payload.original || "").trim();
  if (!original) throw new Error("请先在正文中选中要修订的文字。");
  const action = ["改写", "润色", "扩写", "精简"].includes(payload.action) ? payload.action : "润色";
  let revision = await creativeWorkspace.upsertItem(projectPath, "revisions", {
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    action,
    instruction: String(payload.instruction || "").trim(),
    original,
    replacement: "",
    sourceRevision: String(payload.sourceRevision || await cachedChapterRevision(projectPath, chapter)),
    status: "生成中",
  });
  try {
    const systemPrompt = `你是小说文字修订助手。请按“${action}”处理原文，保留人物、事实、视角和专有名词，不补写未经资料支持的剧情。只输出可直接替换原文的文字，不要解释，不要 Markdown 标记。`;
    const instruction = String(payload.instruction || "").trim();
    const revisionQuestion = `${instruction ? `【作者要求】\n${instruction}\n\n` : ""}【待修订原文】\n${original}`;
    const replacement = typeof control.update === "function" || control.signal
      ? await callStructuredChatWithProgress(config, systemPrompt, revisionQuestion, control, "正在生成安全修订候选")
      : await callChatApi(config, systemPrompt, revisionQuestion, []);
    revision = await creativeWorkspace.upsertItem(projectPath, "revisions", { ...revision, replacement, status: "待确认", error: "" });
    return revision;
  } catch (error) {
    await creativeWorkspace.upsertItem(projectPath, "revisions", { ...revision, status: "生成失败", error: error?.message || String(error) });
    throw error;
  }
}


function countExactOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}


function replaceUniqueSelection(content, original, replacement) {
  const directCount = countExactOccurrences(content, original);
  if (directCount === 1) return content.replace(original, replacement);
  if (directCount > 1) throw new Error("原文在章节中出现多次，无法确定要替换哪一处。修订已保留，请重新选中更长的文字后生成。");
  if (isHtmlContent(content)) {
    const escapedOriginal = escapeHtml(original);
    const escapedCount = countExactOccurrences(content, escapedOriginal);
    if (escapedCount === 1) return content.replace(escapedOriginal, escapeHtml(replacement).replace(/\r?\n/g, "<br>"));
  }
  throw new Error("修订对应的原文已经变化或跨越了复杂格式，无法安全替换。请重新选中文字生成修订。");
}


async function applySafeRevisionUnlocked(projectPath, revisionId) {
  const workspaceState = await creativeWorkspace.loadWorkspace(projectPath);
  const revision = workspaceState.revisions.find((item) => item.id === revisionId);
  if (!revision) throw new Error("没有找到这条修订建议。");
  if (revision.status !== "待确认") throw new Error("只有待确认的修订建议可以采纳。");
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === revision.chapterId);
  if (!chapter) throw new Error("修订对应的章节已不存在。");
  const filePath = getChapterPath(projectPath, chapter);
  const previousContent = await fs.readFile(filePath, "utf8").catch(() => "");
  const currentRevision = contentRevision(previousContent);
  if (revision.sourceRevision && revision.sourceRevision !== currentRevision && countExactOccurrences(previousContent, revision.original) !== 1) {
    await creativeWorkspace.upsertItem(projectPath, "revisions", { ...revision, status: "已失效", error: "正文已变化，无法唯一定位原文。" });
    throw new Error("正文已经变化，并且无法唯一定位原文；修订已标记为失效，没有修改章节。");
  }
  const nextContent = replaceUniqueSelection(previousContent, revision.original, revision.replacement);
  await saveChapterContent(projectPath, { chapterId: chapter.id, content: nextContent, expectedRevision: contentRevision(previousContent) });
  await creativeWorkspace.upsertItem(projectPath, "revisions", { ...revision, status: "已采纳", appliedAt: nowIso(), error: "" });
  return { state: await buildAppState(projectPath, chapter.id), revision: { ...revision, status: "已采纳" } };
}


async function applySafeRevisionPartUnlocked(projectPath, payload = {}) {
  const workspaceState = await creativeWorkspace.loadWorkspace(projectPath);
  const revision = workspaceState.revisions.find((item) => item.id === payload.revisionId);
  if (!revision) throw new Error("没有找到这条修订建议。");
  if (!["待确认", "部分采纳"].includes(revision.status)) throw new Error("这条修订建议当前不能局部采纳。");
  const originalPart = String(payload.original || "").trim();
  const replacementPart = String(payload.replacement || "").trim();
  if (!originalPart) throw new Error("局部采纳必须包含可定位的原文。");
  if (!revision.original.includes(originalPart)) throw new Error("所选原文不属于这条修订建议。");
  if (replacementPart && !revision.replacement.includes(replacementPart)) throw new Error("所选建议文字不属于这条修订建议。");
  if ((revision.acceptedParts || []).some((item) => item.original === originalPart && item.replacement === replacementPart)) throw new Error("这一部分已经采纳过了。");
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === revision.chapterId);
  if (!chapter) throw new Error("修订对应的章节已不存在。");
  const filePath = getChapterPath(projectPath, chapter);
  const previousContent = await fs.readFile(filePath, "utf8").catch(() => "");
  const nextContent = replaceUniqueSelection(previousContent, originalPart, replacementPart);
  await saveChapterContent(projectPath, { chapterId: chapter.id, content: nextContent, expectedRevision: contentRevision(previousContent) });
  const appliedAt = nowIso();
  const updated = await creativeWorkspace.upsertItem(projectPath, "revisions", {
    ...revision,
    status: "部分采纳",
    appliedAt,
    acceptedParts: [...(revision.acceptedParts || []), { original: originalPart, replacement: replacementPart, appliedAt }],
    error: "",
  });
  return { state: await buildAppState(projectPath, chapter.id), revision: updated, workspace: await getCreativeWorkspaceView(projectPath) };
}


const __moduleExports = {
  collectCreativeAgentToolReport,
  buildAgentRetrievalContext,
  getCreativeWorkspaceView,
  prepareCreativeAgentRun,
  buildCreativeAgentExecutionContext,
  pacingReport,
  runCreativeAgentTool,
  inferRevisionAction,
  updateAgentStage,
  executeCreativeAgentRun,
  queueCreativeAgentRun,
  createSafeRevision,
  countExactOccurrences,
  replaceUniqueSelection,
  applySafeRevisionUnlocked,
  applySafeRevisionPartUnlocked,
};

// Augment the original exports object so cyclic requires (whose captured
// reference may be a Proxy over the pre-assignment exports) see every key.
Object.assign(module.exports, __moduleExports);
module.exports = __moduleExports;
