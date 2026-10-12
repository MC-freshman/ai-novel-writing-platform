"use strict";
const { registerIpcHandler } = require("../register.cjs");
const {
  buildAppState,
  ensureCurrentProject,
  getProjectTaskCenter,
  projectSnapshots,
  queueKnowledgeRebuildAfterRestore,
} = require("../dependencies.cjs");

function registerDomain() {
  registerIpcHandler("snapshots:list", async () => {
    const projectPath = await ensureCurrentProject();
    return projectSnapshots.listSnapshots(projectPath);
  });

  registerIpcHandler("snapshots:create", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return {
      snapshot: await projectSnapshots.createSnapshot(
        projectPath,
        payload || {},
      ),
    };
  });

  registerIpcHandler("snapshots:compare", async (_event, snapshotId) => {
    const projectPath = await ensureCurrentProject();
    return projectSnapshots.compareSnapshot(
      projectPath,
      String(snapshotId || ""),
    );
  });

  registerIpcHandler("snapshots:restore", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const result = await projectSnapshots.restoreSnapshot(
      projectPath,
      String(payload?.snapshotId || ""),
      { paths: payload?.paths || [] },
    );
    const task = await queueKnowledgeRebuildAfterRestore(
      projectPath,
      `恢复快照：${result.snapshot.name}`,
    );
    return { ...result, task, state: await buildAppState(projectPath) };
  });

  registerIpcHandler("snapshots:rename", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return {
      snapshot: await projectSnapshots.renameSnapshot(
        projectPath,
        String(payload?.snapshotId || ""),
        String(payload?.name || ""),
      ),
    };
  });

  registerIpcHandler("snapshots:delete", async (_event, snapshotId) => {
    const projectPath = await ensureCurrentProject();
    const activeSnapshotTask = (
      await (await getProjectTaskCenter(projectPath)).list()
    ).tasks.some(
      (task) =>
        task.type === "snapshot" &&
        ["等待中", "运行中", "正在停止", "已暂停"].includes(task.status),
    );
    if (activeSnapshotTask)
      throw new Error("项目快照仍在创建中，请等待任务完成后再删除。");
    return projectSnapshots.deleteSnapshot(
      projectPath,
      String(snapshotId || ""),
    );
  });

  registerIpcHandler("snapshots:cleanup", async () => {
    const projectPath = await ensureCurrentProject();
    const activeSnapshotTask = (
      await (await getProjectTaskCenter(projectPath)).list()
    ).tasks.some(
      (task) =>
        task.type === "snapshot" &&
        ["等待中", "运行中", "正在停止", "已暂停"].includes(task.status),
    );
    if (activeSnapshotTask)
      throw new Error("项目快照仍在创建中，请等待任务完成后再清理。");
    return projectSnapshots.garbageCollectObjects(projectPath);
  });

  registerIpcHandler("snapshots:create-branch", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return projectSnapshots.createBranch(
      projectPath,
      String(payload?.name || "实验分支"),
      String(payload?.snapshotId || ""),
    );
  });

  registerIpcHandler("snapshots:switch-branch", async (_event, branchId) => {
    const projectPath = await ensureCurrentProject();
    const result = await projectSnapshots.switchBranch(
      projectPath,
      String(branchId || ""),
    );
    const task = result.restored
      ? await queueKnowledgeRebuildAfterRestore(
          projectPath,
          `切换分支：${result.activeBranch.name}`,
        )
      : null;
    return { ...result, task, state: await buildAppState(projectPath) };
  });

  registerIpcHandler("snapshots:delete-branch", async (_event, branchId) => {
    const projectPath = await ensureCurrentProject();
    return projectSnapshots.deleteBranch(projectPath, String(branchId || ""));
  });
}
module.exports = { registerDomain };
