"use strict";
const { registerIpcHandler } = require("../register.cjs");
const {
  applySafeRevision,
  applySafeRevisionPart,
  createSafeRevision,
  creativeWorkspace,
  ensureCurrentProject,
  getCreativeWorkspaceView,
  getProjectTaskCenter,
  prepareCreativeAgentRun,
  queueCreativeAgentRun,
  withJournalOperation,
} = require("../dependencies.cjs");

function registerDomain() {
  registerIpcHandler("agent:prepare", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return prepareCreativeAgentRun(projectPath, payload || {});
  });

  registerIpcHandler("agent:execute", async (_event, runId) => {
    const projectPath = await ensureCurrentProject();
    return queueCreativeAgentRun(projectPath, String(runId || ""));
  });

  registerIpcHandler("agent:retry-tool", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return queueCreativeAgentRun(
      projectPath,
      String(payload?.runId || ""),
      String(payload?.tool || ""),
    );
  });

  registerIpcHandler("revision:create", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return createSafeRevision(projectPath, payload || {});
  });

  registerIpcHandler("revision:apply", async (_event, revisionId) => {
    const projectPath = await ensureCurrentProject();
    return withJournalOperation(
      projectPath,
      {
        type: "safe-revision-apply",
        title: "应用安全修订",
        targetIds: [revisionId],
        recoverable: true,
      },
      () => applySafeRevision(projectPath, String(revisionId || "")),
      (result) => ({
        chapterId: result.revision.chapterId,
        revisionId: result.revision.id,
      }),
    );
  });

  registerIpcHandler("revision:apply-part", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withJournalOperation(
      projectPath,
      {
        type: "safe-revision-apply-part",
        title: "局部应用安全修订",
        targetIds: [String(payload?.revisionId || "")],
        recoverable: true,
      },
      () => applySafeRevisionPart(projectPath, payload || {}),
      (result) => ({
        chapterId: result.revision.chapterId,
        revisionId: result.revision.id,
      }),
    );
  });

  registerIpcHandler("revision:update-status", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const workspace = await creativeWorkspace.loadWorkspace(projectPath);
    const revision = workspace.revisions.find(
      (item) => item.id === payload?.revisionId,
    );
    if (!revision) throw new Error("没有找到这条修订建议。");
    const status = ["已拒绝", "已失效"].includes(payload?.status)
      ? payload.status
      : "已拒绝";
    const item = await creativeWorkspace.upsertItem(projectPath, "revisions", {
      ...revision,
      status,
    });
    return { item, workspace: await getCreativeWorkspaceView(projectPath) };
  });

  registerIpcHandler("tasks:list", async () => {
    const projectPath = await ensureCurrentProject();
    return (await getProjectTaskCenter(projectPath)).list();
  });

  registerIpcHandler("tasks:enqueue", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const allowedTypes = new Set([
      "story-analysis",
      "creative-board",
      "consistency-check",
      "timeline-analysis",
      "knowledge-rebuild",
      "snapshot",
      "creative-statistics",
    ]);
    if (!allowedTypes.has(payload?.type))
      throw new Error("不支持的后台任务类型。");
    return {
      task: await (
        await getProjectTaskCenter(projectPath)
      ).enqueue(payload || {}),
    };
  });

  registerIpcHandler("tasks:cancel", async (_event, taskId) => {
    const projectPath = await ensureCurrentProject();
    return (await getProjectTaskCenter(projectPath)).cancel(
      String(taskId || ""),
    );
  });

  registerIpcHandler("tasks:pause", async (_event, taskId) => {
    const projectPath = await ensureCurrentProject();
    return (await getProjectTaskCenter(projectPath)).pause(
      String(taskId || ""),
    );
  });

  registerIpcHandler("tasks:resume", async (_event, taskId) => {
    const projectPath = await ensureCurrentProject();
    return (await getProjectTaskCenter(projectPath)).resume(
      String(taskId || ""),
    );
  });

  registerIpcHandler("tasks:retry", async (_event, taskId) => {
    const projectPath = await ensureCurrentProject();
    return {
      task: await (
        await getProjectTaskCenter(projectPath)
      ).retry(String(taskId || "")),
    };
  });

  registerIpcHandler("tasks:remove", async (_event, taskId) => {
    const projectPath = await ensureCurrentProject();
    return (await getProjectTaskCenter(projectPath)).remove(
      String(taskId || ""),
    );
  });

  registerIpcHandler("tasks:clear-history", async () => {
    const projectPath = await ensureCurrentProject();
    return (await getProjectTaskCenter(projectPath)).clearHistory();
  });
}
module.exports = { registerDomain };
