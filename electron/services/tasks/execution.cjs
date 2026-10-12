"use strict";
const {
  analyzeConsistency,
  analyzeStoryStateWithAI,
  buildAiTimelineEvents,
  buildCreativeAdvice,
  buildTimelineEvents,
  executeCreativeAgentRun,
  loadCharacters,
  loadConfig,
  nowIso,
  projectSnapshots,
  rebuildIndex,
  refreshLocalStoryState,
  saveAnalysisState,
  stableHash,
  storyState,
} = require("./dependencies.cjs");
const { buildCreativeStatistics } = require("./statistics.cjs");

async function executeBackgroundTask(projectPath, task, control) {
  const config = await loadConfig(projectPath);
  if (task.type === "agent-workflow") {
    return executeCreativeAgentRun(
      projectPath,
      String(task.options?.runId || ""),
      control,
      String(task.options?.onlyTool || ""),
    );
  }
  if (task.type === "story-analysis") {
    const requestedIds = new Set((task.scope?.chapterIds || []).map(String));
    const chapters = config.chapters
      .filter((chapter) => !requestedIds.size || requestedIds.has(chapter.id))
      .sort((a, b) => a.order - b.order);
    let aiCount = 0;
    let localCount = 0;
    const warnings = [];
    const characters = task.options?.useAI
      ? null
      : await loadCharacters(projectPath);
    await control.update({
      phase: "准备剧情事实分析",
      current: 0,
      total: chapters.length,
      detail: `${chapters.length} 个文档`,
    });
    for (let index = 0; index < chapters.length; index += 1) {
      if (control.isCanceled())
        throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
      const chapter = chapters[index];
      await control.update({
        phase: task.options?.useAI ? "AI 深度整理" : "本地增量整理",
        current: index,
        total: chapters.length,
        detail: chapter.title,
      });
      if (task.options?.useAI) {
        const result = await analyzeStoryStateWithAI(
          projectPath,
          chapter.id,
          control,
        );
        if (result.apiError)
          warnings.push(`${chapter.title}：${result.apiError}`);
        if (result.ledger.analysisMode === "ai") aiCount += 1;
        else localCount += 1;
      } else {
        await refreshLocalStoryState(projectPath, chapter.id, null, {
          config,
          characters,
        });
        localCount += 1;
      }
      await control.update({
        current: index + 1,
        total: chapters.length,
        detail: chapter.title,
      });
      await new Promise((resolve) => setImmediate(resolve));
    }
    return {
      analyzed: chapters.length,
      aiCount,
      localCount,
      warnings: warnings.slice(0, 40),
    };
  }

  if (task.type === "creative-board") {
    const ordered = config.chapters.slice().sort((a, b) => a.order - b.order);
    const index = ordered.findIndex(
      (chapter) => chapter.id === task.scope?.chapterId,
    );
    const chapter = ordered[index];
    if (!chapter) throw new Error("没有找到筹备板对应的章节。");
    await control.update({
      phase: "整理本地创作状态",
      current: 1,
      total: task.options?.useAI ? 3 : 2,
      detail: chapter.title,
    });
    let board = await storyState.generateLocalBoard(
      projectPath,
      chapter,
      ordered[index + 1] || null,
    );
    if (task.options?.useAI && !control.isCanceled()) {
      await control.update({
        phase: "创作参谋正在补充筹备项",
        current: 2,
        total: 3,
        detail: chapter.title,
      });
      const advice = await buildCreativeAdvice(
        projectPath,
        {
          mode: "next",
          chapterId: chapter.id,
          focus: task.options?.focus || "",
        },
        control,
      );
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
      board = await storyState.saveBoard(projectPath, {
        ...board,
        items: [...locked, ...generated],
        generatedAt: nowIso(),
        apiError: advice.apiError || "",
      });
    }
    await control.update({
      phase: "筹备板已保存",
      current: task.options?.useAI ? 3 : 2,
      total: task.options?.useAI ? 3 : 2,
      detail: `${board.items.length} 项`,
    });
    return { board };
  }

  if (task.type === "consistency-check") {
    await control.update({
      phase: "正在执行全书一致性检查",
      current: 0,
      total: 1,
      detail: "可继续编辑正文",
    });
    const result = await analyzeConsistency(
      projectPath,
      { ...(task.options || {}), refresh: true },
      control,
    );
    await saveAnalysisState(projectPath, {
      consistency: result,
      consistencyOptions: task.options || {},
    });
    await control.update({
      current: 1,
      total: 1,
      detail: `${result.issues.length} 个问题`,
    });
    return result;
  }

  if (task.type === "timeline-analysis") {
    await control.update({
      phase: "正在识别剧情时间线",
      current: 0,
      total: 1,
      detail: "可继续编辑正文",
    });
    const result =
      task.options?.mode === "local"
        ? await buildTimelineEvents(projectPath, task.options || {})
        : await buildAiTimelineEvents(projectPath, task.options || {}, control);
    await saveAnalysisState(projectPath, {
      timeline: result,
      timelineOptions: task.options || {},
    });
    await control.update({
      current: 1,
      total: 1,
      detail: `${result.events.length} 个事件`,
    });
    return result;
  }

  if (task.type === "knowledge-rebuild") {
    await control.update({
      phase: "正在重建长篇知识库",
      current: 0,
      total: 1,
      detail: "索引会增量写入",
    });
    const result = await rebuildIndex(projectPath, {
      signal: control.signal,
      onProgress: (progress) =>
        control.update({ phase: "正在重建长篇知识库", ...progress }),
    });
    await control.update({
      current: 1,
      total: 1,
      detail: `${result.chunks} 个片段`,
    });
    return result;
  }

  if (task.type === "snapshot") {
    const manifest = await projectSnapshots.createSnapshot(projectPath, {
      name: task.options?.name || task.title,
      reason: task.options?.reason || "后台创建项目快照",
      onProgress: (progress) =>
        control.update({ phase: "正在创建项目快照", ...progress }),
    });
    return { snapshot: manifest };
  }
  if (task.type === "creative-statistics") {
    return buildCreativeStatistics(
      projectPath,
      String(task.options?.label || ""),
      control,
    );
  }

  throw new Error(`不支持的后台任务类型：${task.type}`);
}

module.exports = { executeBackgroundTask };
