// 本文件由 P2 重构自 electron/main.cjs 机械搬迁（scripts/refactor-split.cjs），逻辑未改动。
"use strict";

const storyState = require("./story-state.cjs");
const { PersistentTaskCenter } = require("./task-center.cjs");
const projectSnapshots = require("./project-snapshots.cjs");
const vectorShards = require("./vector-shards.cjs");
const creativeWorkspace = require("./creative-workspace.cjs");
const creativeStatistics = require("./creative-statistics.cjs");
const { state, sendRendererEvent } = require("./runtime-state.cjs");
const __dep0 = require("./project-files.cjs");
const __dep1 = require("./knowledge-index.cjs");
const __dep2 = require("./ai-generate.cjs");
const __dep3 = require("./analysis-tools.cjs");
const __dep4 = require("./creative-agent.cjs");
const __dep5 = require("./project-ops.cjs");
const fs = require("node:fs/promises");

function nowIso(...args) { return __dep0.nowIso.apply(null, args); }
function normalizeCategory(...args) { return __dep0.normalizeCategory(...args); }
function writeJson(...args) { return __dep0.writeJson(...args); }
function getKnowledgeSummariesPath(...args) { return __dep0.getKnowledgeSummariesPath(...args); }
function getChapterPath(...args) { return __dep0.getChapterPath(...args); }
function contentToPlainText(...args) { return __dep0.contentToPlainText(...args); }
function loadProjectSources(...args) { return __dep0.loadProjectSources(...args); }
function stableHash(...args) { return __dep0.stableHash(...args); }
function loadCharacters(...args) { return __dep0.loadCharacters(...args); }
function loadWorldDocs(...args) { return __dep0.loadWorldDocs(...args); }
function rebuildIndex(...args) { return __dep1.rebuildIndex(...args); }
function buildCreativeAdvice(...args) { return __dep2.buildCreativeAdvice(...args); }
function saveAnalysisState(...args) { return __dep3.saveAnalysisState(...args); }
function buildTimelineEvents(...args) { return __dep3.buildTimelineEvents(...args); }
function buildAiTimelineEvents(...args) { return __dep3.buildAiTimelineEvents(...args); }
function analyzeConsistency(...args) { return __dep3.analyzeConsistency(...args); }
function refreshLocalStoryState(...args) { return __dep3.refreshLocalStoryState(...args); }
function analyzeStoryStateWithAI(...args) { return __dep3.analyzeStoryStateWithAI(...args); }
function getCreativeWorkspaceView(...args) { return __dep4.getCreativeWorkspaceView(...args); }
function executeCreativeAgentRun(...args) { return __dep4.executeCreativeAgentRun(...args); }
function loadConfig(...args) { return __dep5.loadConfig(...args); }

async function buildCreativeStatistics(projectPath, label = "", control = null) {
  const config = await loadConfig(projectPath);
  const workspace = await creativeWorkspace.loadWorkspace(projectPath);
  const overview = await storyState.getStoryOverview(projectPath, { projectChapters: config.chapters, factLimit: 2000, characterLimit: 1000, foreshadowLimit: 2000 });
  const characters = await loadCharacters(projectPath);
  const contents = /** @type {Record<string, string>} */ ({});
  const chapters = config.chapters.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  for (let index = 0; index < chapters.length; index += 1) {
    control?.throwIfCanceled?.();
    const chapter = chapters[index];
    contents[chapter.id] = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
    if (control?.update && (index % 10 === 0 || index === chapters.length - 1)) await control.update({ phase: "正在统计章节", current: index + 1, total: chapters.length, detail: chapter.title });
  }
  const snapshot = creativeStatistics.analyzeProjectStatistics({ chapters, contents, characters, workspace, storyOverview: /** @type {any} */ (overview), label });
  await creativeWorkspace.upsertItem(projectPath, "statisticsHistory", snapshot);
  return { snapshot, workspace: await getCreativeWorkspaceView(projectPath) };
}


async function executeBackgroundTask(projectPath, task, control) {
  const config = await loadConfig(projectPath);
  if (task.type === "agent-workflow") {
    return executeCreativeAgentRun(projectPath, String(task.options?.runId || ""), control, String(task.options?.onlyTool || ""));
  }
  if (task.type === "story-analysis") {
    const requestedIds = new Set((task.scope?.chapterIds || []).map(String));
    const chapters = config.chapters
      .filter((chapter) => !requestedIds.size || requestedIds.has(chapter.id))
      .sort((a, b) => a.order - b.order);
    let aiCount = 0;
    let localCount = 0;
    const warnings = [];
    const characters = task.options?.useAI ? null : await loadCharacters(projectPath);
    await control.update({ phase: "准备剧情事实分析", current: 0, total: chapters.length, detail: `${chapters.length} 个文档` });
    for (let index = 0; index < chapters.length; index += 1) {
      if (control.isCanceled()) throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
      const chapter = chapters[index];
      await control.update({ phase: task.options?.useAI ? "AI 深度整理" : "本地增量整理", current: index, total: chapters.length, detail: chapter.title });
      if (task.options?.useAI) {
        const result = await analyzeStoryStateWithAI(projectPath, chapter.id, control);
        if (result.apiError) warnings.push(`${chapter.title}：${result.apiError}`);
        if (result.ledger.analysisMode === "ai") aiCount += 1;
        else localCount += 1;
      } else {
        await refreshLocalStoryState(projectPath, chapter.id, null, { config, characters });
        localCount += 1;
      }
      await control.update({ current: index + 1, total: chapters.length, detail: chapter.title });
      await new Promise((resolve) => setImmediate(resolve));
    }
    return { analyzed: chapters.length, aiCount, localCount, warnings: warnings.slice(0, 40) };
  }

  if (task.type === "creative-board") {
    const ordered = config.chapters.slice().sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((chapter) => chapter.id === task.scope?.chapterId);
    const chapter = ordered[index];
    if (!chapter) throw new Error("没有找到筹备板对应的章节。");
    await control.update({ phase: "整理本地创作状态", current: 1, total: task.options?.useAI ? 3 : 2, detail: chapter.title });
    let board = await storyState.generateLocalBoard(projectPath, chapter, ordered[index + 1] || null);
    if (task.options?.useAI && !control.isCanceled()) {
      await control.update({ phase: "创作参谋正在补充筹备项", current: 2, total: 3, detail: chapter.title });
      const advice = await buildCreativeAdvice(projectPath, { mode: "next", chapterId: chapter.id, focus: task.options?.focus || "" }, control);
      const locked = board.items.filter((item) => item.locked);
      const generated = advice.items.map((item, itemIndex) => ({
        id: `beat_${stableHash(`${chapter.id}_${item.id}_${itemIndex}`)}`,
        type: item.type,
        title: item.title,
        detail: `${item.summary}${item.suggestedUse ? `\n使用建议：${item.suggestedUse}` : ""}${item.risks?.length ? `\n注意：${item.risks.join("；")}` : ""}`,
        order: locked.length + itemIndex,
        locked: false,
        completed: false,
        sourceRefs: item.sourceRefs || [],
      }));
      board = await storyState.saveBoard(projectPath, { ...board, items: [...locked, ...generated], generatedAt: nowIso(), apiError: advice.apiError || "" });
    }
    await control.update({ phase: "筹备板已保存", current: task.options?.useAI ? 3 : 2, total: task.options?.useAI ? 3 : 2, detail: `${board.items.length} 项` });
    return { board };
  }

  if (task.type === "consistency-check") {
    await control.update({ phase: "正在执行全书一致性检查", current: 0, total: 1, detail: "可继续编辑正文" });
    const result = await analyzeConsistency(projectPath, { ...(task.options || {}), refresh: true }, control);
    await saveAnalysisState(projectPath, { consistency: result, consistencyOptions: task.options || {} });
    await control.update({ current: 1, total: 1, detail: `${result.issues.length} 个问题` });
    return result;
  }

  if (task.type === "timeline-analysis") {
    await control.update({ phase: "正在识别剧情时间线", current: 0, total: 1, detail: "可继续编辑正文" });
    const result = task.options?.mode === "local" ? await buildTimelineEvents(projectPath, task.options || {}) : await buildAiTimelineEvents(projectPath, task.options || {}, control);
    await saveAnalysisState(projectPath, { timeline: result, timelineOptions: task.options || {} });
    await control.update({ current: 1, total: 1, detail: `${result.events.length} 个事件` });
    return result;
  }

  if (task.type === "knowledge-rebuild") {
    await control.update({ phase: "正在重建长篇知识库", current: 0, total: 1, detail: "索引会增量写入" });
    const result = await rebuildIndex(projectPath, {
      signal: control.signal,
      onProgress: (progress) => control.update({ phase: "正在重建长篇知识库", ...progress }),
    });
    await control.update({ current: 1, total: 1, detail: `${result.chunks} 个片段` });
    return result;
  }

  if (task.type === "snapshot") {
    const manifest = await projectSnapshots.createSnapshot(projectPath, {
      name: task.options?.name || task.title,
      reason: task.options?.reason || "后台创建项目快照",
      onProgress: (progress) => control.update({ phase: "正在创建项目快照", ...progress }),
    });
    return { snapshot: manifest };
  }
  if (task.type === "creative-statistics") {
    return buildCreativeStatistics(projectPath, String(task.options?.label || ""), control);
  }

  throw new Error(`不支持的后台任务类型：${task.type}`);
}


async function getProjectTaskCenter(projectPath) {
  if (!state.projectTaskCenters.has(projectPath)) {
    state.projectTaskCenters.set(projectPath, new PersistentTaskCenter({
      projectPath,
      executor: (task, control) => executeBackgroundTask(projectPath, task, control),
      onEvent: (task) => sendRendererEvent("task:progress", { ...task, projectPath }),
    }));
  }
  const center = state.projectTaskCenters.get(projectPath);
  await center.init();
  if (!center.agentRunsReconciled) {
    center.agentRunsReconciled = true;
    const interrupted = (await center.list()).tasks.filter((task) => task.type === "agent-workflow" && task.status === "已中断");
    if (interrupted.length) {
      const workspace = await creativeWorkspace.loadWorkspace(projectPath);
      for (const task of interrupted) {
        const run = workspace.agentRuns.find((item) => item.id === task.options?.runId && ["等待中", "运行中"].includes(item.status));
        if (run) await creativeWorkspace.upsertItem(projectPath, "agentRuns", { ...run, status: "已中断", taskId: task.id, error: "软件关闭时工作流尚未完成，可在任务中心重试。" });
      }
    }
  }
  return center;
}


async function queueKnowledgeRebuildAfterRestore(projectPath, reason) {
  await vectorShards.reset(projectPath);
  await writeJson(getKnowledgeSummariesPath(projectPath), { version: 2, updatedAt: "", sources: [], volumes: [], book: null });
  return (await getProjectTaskCenter(projectPath)).enqueue({
    type: "knowledge-rebuild",
    title: "恢复后重建知识库",
    total: 1,
    options: { automatic: true, reason },
  });
}


function scheduleIdleDeepAnalysis(projectPath, chapter) {
  const key = `${projectPath}\u0000${chapter.id}`;
  const previous = state.deepAnalysisTimers.get(key);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(async () => {
    state.deepAnalysisTimers.delete(key);
    try {
      const center = await getProjectTaskCenter(projectPath);
      const { tasks } = await center.list();
      const duplicate = tasks.some((task) => ["等待中", "运行中", "正在停止", "已暂停"].includes(task.status) && task.type === "story-analysis" && task.scope?.chapterIds?.includes(chapter.id));
      if (duplicate) return;
      await center.enqueue({
        type: "story-analysis",
        title: `空闲后深度分析：${chapter.title}`,
        total: 1,
        scope: { chapterIds: [chapter.id] },
        options: { useAI: true, automatic: true },
      });
    } catch {
      // Automatic deep analysis must never interfere with editing or saving.
    }
  }, 45000);
  state.deepAnalysisTimers.set(key, timer);
}


async function buildAppearanceStats(projectPath) {
  const { chapters, characters } = await loadProjectSources(projectPath);
  const stats = characters.map((card) => {
    const appearances = [];
    let total = 0;
    return { card, appearances, total };
  });
  for (const stat of stats) {
    for (const chapter of chapters) {
      const rawContent = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
      const content = contentToPlainText(rawContent);
      const count = stat.card.name ? (content.match(new RegExp(stat.card.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length : 0;
      if (count > 0) stat.appearances.push({ chapterId: chapter.id, chapterTitle: chapter.title, volume: chapter.volume || "未分卷", count });
      stat.total += count;
    }
  }
  const result = stats.map(({ card, appearances, total }) => ({
    id: card.id,
    name: card.name,
    category: normalizeCategory(card.category),
    total,
    chapters: appearances,
  }));
  return { stats: result.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "zh-CN")) };
}


async function buildWorldMap(projectPath) {
  const worldDocs = await loadWorldDocs(projectPath);
  const nodes = [];
  const edges = [];
  const byTitle = new Map(worldDocs.map((doc) => [doc.title, doc]));
  for (const doc of worldDocs) {
    const category = normalizeCategory(doc.category);
    const type = category.includes("地点") ? "地点" : category.includes("势力") ? "势力" : category.includes("物品") ? "物品" : "设定";
    nodes.push({ id: doc.id, title: doc.title, category, type, summary: contentToPlainText(doc.content).slice(0, 160) });
  }
  for (const doc of worldDocs) {
    const text = contentToPlainText(doc.content);
    for (const [title, target] of byTitle.entries()) {
      if (target.id !== doc.id && text.includes(title)) {
        edges.push({ id: `${doc.id}_${target.id}`, source: doc.id, target: target.id, label: "提及" });
      }
    }
  }
  return { nodes, edges: edges.slice(0, 200) };
}


const __moduleExports = {
  buildCreativeStatistics,
  executeBackgroundTask,
  getProjectTaskCenter,
  queueKnowledgeRebuildAfterRestore,
  scheduleIdleDeepAnalysis,
  buildAppearanceStats,
  buildWorldMap,
};

// Augment the original exports object so cyclic requires (whose captured
// reference may be a Proxy over the pre-assignment exports) see every key.
Object.assign(module.exports, __moduleExports);
module.exports = __moduleExports;
