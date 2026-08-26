const path = require("node:path");
const { ensureDir, readJson, stableId, writeJsonAtomic } = require("./project-storage.cjs");

const ACTIVE_STATUSES = new Set(["等待中", "运行中", "正在停止", "已暂停"]);

function nowIso() {
  return new Date().toISOString();
}

function compactTask(task) {
  return {
    ...task,
    partialOutput: String(task.partialOutput || "").slice(-240000),
    error: String(task.error || "").slice(0, 4000),
  };
}

class PersistentTaskCenter {
  constructor({ projectPath, executor, onEvent }) {
    this.projectPath = projectPath;
    this.executor = executor;
    this.onEvent = typeof onEvent === "function" ? onEvent : () => {};
    this.filePath = path.join(projectPath, "analysis", "tasks.json");
    this.tasks = [];
    this.controllers = new Map();
    this.pausedTasks = new Set();
    this.running = false;
    this.initialized = false;
    this.writeQueue = Promise.resolve();
  }

  async init() {
    if (this.initialized) return this;
    await ensureDir(path.dirname(this.filePath));
    const data = await readJson(this.filePath, { version: 1, tasks: [] });
    this.tasks = (Array.isArray(data?.tasks) ? data.tasks : []).map((task) => {
      if (!ACTIVE_STATUSES.has(task.status)) return compactTask(task);
      return compactTask({
        ...task,
        status: "已中断",
        phase: "软件关闭时任务尚未完成",
        finishedAt: task.finishedAt || nowIso(),
        canRetry: true,
      });
    }).slice(0, 120);
    this.initialized = true;
    await this.persist();
    return this;
  }

  async persist() {
    const snapshot = { version: 1, updatedAt: nowIso(), tasks: this.tasks.map(compactTask).slice(0, 120) };
    this.writeQueue = this.writeQueue.catch(() => null).then(() => writeJsonAtomic(this.filePath, snapshot));
    return this.writeQueue;
  }

  emit(task) {
    this.onEvent(compactTask(task));
  }

  async list() {
    await this.init();
    return { tasks: this.tasks.map(compactTask) };
  }

  async enqueue(payload = {}) {
    await this.init();
    const createdAt = nowIso();
    const task = {
      id: stableId("task", `${createdAt}|${Math.random()}|${payload.type}|${payload.title}`),
      type: String(payload.type || "story-analysis"),
      title: String(payload.title || "后台任务").slice(0, 120),
      status: "等待中",
      phase: "等待执行",
      current: 0,
      total: Math.max(0, Number(payload.total) || 0),
      detail: "",
      scope: payload.scope && typeof payload.scope === "object" ? payload.scope : {},
      options: payload.options && typeof payload.options === "object" ? payload.options : {},
      partialOutput: "",
      result: null,
      error: "",
      usage: null,
      matchedDocuments: Array.isArray(payload.matchedDocuments) ? payload.matchedDocuments.map(String).slice(0, 1000) : [],
      requestBytes: Math.max(0, Number(payload.requestBytes) || 0),
      durationMs: 0,
      createdAt,
      updatedAt: createdAt,
      startedAt: "",
      finishedAt: "",
      canRetry: false,
      retryOf: String(payload.retryOf || ""),
    };
    this.tasks = [task, ...this.tasks].slice(0, 120);
    await this.persist();
    this.emit(task);
    this.schedule();
    return compactTask(task);
  }

  schedule() {
    if (this.running) return;
    setImmediate(() => void this.runNext());
  }

  async checkpoint(task, patch = {}) {
    Object.assign(task, patch, { updatedAt: nowIso() });
    if (patch.partialOutput !== undefined) task.partialOutput = String(patch.partialOutput || "").slice(-240000);
    this.emit(task);
    await this.persist();
  }

  async waitIfPaused(task, signal) {
    while (this.pausedTasks.has(task.id) && !signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (signal.aborted) throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
  }

  async runNext() {
    if (this.running) return;
    const task = [...this.tasks].reverse().find((item) => item.status === "等待中");
    if (!task) return;
    this.running = true;
    const controller = new AbortController();
    this.controllers.set(task.id, controller);
    await this.checkpoint(task, { status: "运行中", phase: "正在准备", startedAt: nowIso(), canRetry: false });
    try {
      const result = await this.executor(task, {
        signal: controller.signal,
        update: async (patch) => {
          await this.waitIfPaused(task, controller.signal);
          return this.checkpoint(task, patch);
        },
        appendPartial: async (text) => {
          await this.waitIfPaused(task, controller.signal);
          const next = `${task.partialOutput || ""}${String(text || "")}`.slice(-240000);
          await this.checkpoint(task, { partialOutput: next });
        },
        isCanceled: () => controller.signal.aborted,
        waitIfPaused: () => this.waitIfPaused(task, controller.signal),
      });
      if (controller.signal.aborted) {
        const finishedAt = nowIso();
        await this.checkpoint(task, { status: "已停止", phase: "用户已停止", finishedAt, durationMs: task.startedAt ? Date.parse(finishedAt) - Date.parse(task.startedAt) : 0, canRetry: true, result: result || task.result });
      } else {
        const finishedAt = nowIso();
        await this.checkpoint(task, { status: "已完成", phase: "完成", current: task.total || task.current, result: result || null, finishedAt, durationMs: task.startedAt ? Date.parse(finishedAt) - Date.parse(task.startedAt) : 0, canRetry: false });
      }
    } catch (error) {
      const stopped = controller.signal.aborted || error?.name === "AbortError";
      const finishedAt = nowIso();
      await this.checkpoint(task, {
        status: stopped ? "已停止" : "失败",
        phase: stopped ? "用户已停止" : "执行失败",
        error: String(error?.message || error),
        finishedAt,
        durationMs: task.startedAt ? Date.parse(finishedAt) - Date.parse(task.startedAt) : 0,
        canRetry: true,
      });
    } finally {
      this.controllers.delete(task.id);
      this.pausedTasks.delete(task.id);
      this.running = false;
      this.schedule();
    }
  }

  async cancel(taskId) {
    await this.init();
    const task = this.tasks.find((item) => item.id === taskId);
    if (!task) return { canceled: false };
    if (task.status === "等待中" || (task.status === "已暂停" && !this.controllers.has(taskId))) {
      this.pausedTasks.delete(taskId);
      await this.checkpoint(task, { status: "已停止", phase: "已从队列移除", finishedAt: nowIso(), canRetry: true });
      return { canceled: true, task: compactTask(task) };
    }
    const controller = this.controllers.get(taskId);
    if (!controller) return { canceled: false, task: compactTask(task) };
    controller.abort();
    this.pausedTasks.delete(taskId);
    await this.checkpoint(task, { status: "正在停止", phase: "正在停止，已有结果会保留" });
    return { canceled: true, task: compactTask(task) };
  }

  async pause(taskId) {
    await this.init();
    const task = this.tasks.find((item) => item.id === taskId);
    if (!task || !["等待中", "运行中"].includes(task.status)) return { paused: false, task: task ? compactTask(task) : null };
    this.pausedTasks.add(taskId);
    await this.checkpoint(task, { status: "已暂停", phase: "已暂停，阶段结果已保留", pausedFrom: task.startedAt ? "运行中" : "等待中" });
    return { paused: true, task: compactTask(task) };
  }

  async resume(taskId) {
    await this.init();
    const task = this.tasks.find((item) => item.id === taskId);
    if (!task || task.status !== "已暂停") return { resumed: false, task: task ? compactTask(task) : null };
    const running = this.controllers.has(taskId) || task.pausedFrom === "运行中";
    this.pausedTasks.delete(taskId);
    await this.checkpoint(task, { status: running ? "运行中" : "等待中", phase: running ? "继续执行" : "重新加入队列", pausedFrom: "" });
    if (!running) this.schedule();
    return { resumed: true, task: compactTask(task) };
  }

  async retry(taskId) {
    await this.init();
    const task = this.tasks.find((item) => item.id === taskId);
    if (!task || ACTIVE_STATUSES.has(task.status)) throw new Error("这个任务当前不能重试。");
    return this.enqueue({
      type: task.type,
      title: task.title,
      total: task.total,
      scope: task.scope,
      options: task.options,
      retryOf: task.id,
      matchedDocuments: task.matchedDocuments,
      requestBytes: task.requestBytes,
    });
  }

  async remove(taskId) {
    await this.init();
    const task = this.tasks.find((item) => item.id === taskId);
    if (task && ACTIVE_STATUSES.has(task.status)) throw new Error("请先停止任务，再删除记录。");
    this.tasks = this.tasks.filter((item) => item.id !== taskId);
    await this.persist();
    return { removed: Boolean(task), tasks: this.tasks.map(compactTask) };
  }

  async clearHistory() {
    await this.init();
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((task) => ACTIVE_STATUSES.has(task.status));
    await this.persist();
    return { removed: before - this.tasks.length, tasks: this.tasks.map(compactTask) };
  }
}

module.exports = {
  ACTIVE_STATUSES,
  PersistentTaskCenter,
};
