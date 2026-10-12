"use strict";
const {
  PersistentTaskCenter,
  creativeWorkspace,
  getKnowledgeSummariesPath,
  sendRendererEvent,
  state,
  vectorShards,
  writeJson,
} = require("./dependencies.cjs");
const { executeBackgroundTask } = require("./execution.cjs");

async function getProjectTaskCenter(projectPath) {
  if (!state.projectTaskCenters.has(projectPath)) {
    state.projectTaskCenters.set(
      projectPath,
      new PersistentTaskCenter({
        projectPath,
        executor: (task, control) =>
          executeBackgroundTask(projectPath, task, control),
        onEvent: (task) =>
          sendRendererEvent("task:progress", { ...task, projectPath }),
      }),
    );
  }
  const center = state.projectTaskCenters.get(projectPath);
  await center.init();
  if (!center.agentRunsReconciled) {
    center.agentRunsReconciled = true;
    const interrupted = (await center.list()).tasks.filter(
      (task) => task.type === "agent-workflow" && task.status === "已中断",
    );
    if (interrupted.length) {
      const workspace = await creativeWorkspace.loadWorkspace(projectPath);
      for (const task of interrupted) {
        const run = workspace.agentRuns.find(
          (item) =>
            item.id === task.options?.runId &&
            ["等待中", "运行中"].includes(item.status),
        );
        if (run)
          await creativeWorkspace.upsertItem(projectPath, "agentRuns", {
            ...run,
            status: "已中断",
            taskId: task.id,
            error: "软件关闭时工作流尚未完成，可在任务中心重试。",
          });
      }
    }
  }
  return center;
}

async function queueKnowledgeRebuildAfterRestore(projectPath, reason) {
  await vectorShards.reset(projectPath);
  await writeJson(getKnowledgeSummariesPath(projectPath), {
    version: 2,
    updatedAt: "",
    sources: [],
    volumes: [],
    book: null,
  });
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
      const duplicate = tasks.some(
        (task) =>
          ["等待中", "运行中", "正在停止", "已暂停"].includes(task.status) &&
          task.type === "story-analysis" &&
          task.scope?.chapterIds?.includes(chapter.id),
      );
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

module.exports = {
  getProjectTaskCenter,
  queueKnowledgeRebuildAfterRestore,
  scheduleIdleDeepAnalysis,
};
