const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const {
  domainProject,
  replace,
  control,
} = require("../helpers/domain-project.cjs");
const tasks = require("../../../electron/services/task-runtime.cjs");
const analysis = require("../../../electron/services/analysis-tools.cjs");
const ai = require("../../../electron/services/ai-generate.cjs");
const creativeAgent = require("../../../electron/services/creative-agent.cjs");
const workspace = require("../../../electron/services/creative-workspace.cjs");
const story = require("../../../electron/services/story-state.cjs");
const files = require("../../../electron/services/project-files.cjs");
const runtime = require("../../../electron/services/runtime-state.cjs");
const vectorShards = require("../../../electron/services/vector-shards.cjs");

async function waitFor(center, id) {
  for (let i = 0; i < 200; i++) {
    const task = (await center.list()).tasks.find((t) => t.id === id);
    if (!center.running && ["已完成", "已停止", "失败"].includes(task.status)) {
      await center.writeQueue;
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw Error("合成后台任务未完成");
}
test("任务剧情分析按顺序与范围执行，AI降级计数及取消", async (t) => {
  const { root } = await domainProject(t);
  let result = await tasks.executeBackgroundTask(
    root,
    {
      type: "story-analysis",
      scope: { chapterIds: ["c0", "c2"] },
      options: {},
    },
    control(),
  );
  assert.deepEqual(result, {
    analyzed: 2,
    aiCount: 0,
    localCount: 2,
    warnings: [],
  });
  result = await tasks.executeBackgroundTask(
    root,
    { type: "story-analysis", options: { useAI: true } },
    control(),
  );
  assert.equal(result.localCount, 3);
  assert.equal(result.warnings.length, 3);
  replace(t, analysis, "analyzeStoryStateWithAI", async () => ({
    ledger: { analysisMode: "ai" },
    apiError: "",
  }));
  result = await tasks.executeBackgroundTask(
    root,
    { type: "story-analysis", options: { useAI: true } },
    control(),
  );
  assert.equal(result.aiCount, 3);
  const aborted = control();
  aborted.controller.abort();
  await assert.rejects(
    tasks.executeBackgroundTask(root, { type: "story-analysis" }, aborted),
    { name: "AbortError" },
  );
});
test("任务筹备板保留锁定项，AI建议持久化且无章节报错", async (t) => {
  const { root, chapters } = await domainProject(t);
  let result = await tasks.executeBackgroundTask(
    root,
    { type: "creative-board", scope: { chapterId: "c0" }, options: {} },
    control(),
  );
  result.board.items[0] = {
    ...result.board.items[0],
    title: "作者锁定",
    locked: true,
  };
  await story.saveBoard(root, result.board);
  replace(t, ai, "buildCreativeAdvice", async () => ({
    items: [
      {
        id: "a",
        type: "人物",
        title: "合成建议",
        summary: "推进人物",
        suggestedUse: "下一章",
        risks: ["风险"],
        sourceRefs: [],
      },
    ],
    apiError: "",
  }));
  result = await tasks.executeBackgroundTask(
    root,
    {
      type: "creative-board",
      scope: { chapterId: chapters[0].id },
      options: { useAI: true, focus: "人物" },
    },
    control(),
  );
  assert.equal(result.board.items.length, 2);
  assert.equal(result.board.items[0].title, "作者锁定");
  assert.match(result.board.items[1].detail, /使用建议[\s\S]*风险/);
  assert.equal((await story.getBoard(root, "c0")).items[1].title, "合成建议");
  await assert.rejects(
    tasks.executeBackgroundTask(
      root,
      { type: "creative-board", scope: { chapterId: "missing" } },
      control(),
    ),
    /没有找到/,
  );
});
test("时间线与一致性任务保存结果和范围，失败不写快照", async (t) => {
  const { root } = await domainProject(t);
  const options = { mode: "local", chapterIds: ["c0"] };
  await tasks.executeBackgroundTask(
    root,
    { type: "timeline-analysis", options },
    control(),
  );
  assert.equal(
    (await analysis.loadAnalysisState(root)).timelineOptions.mode,
    "local",
  );
  replace(t, analysis, "buildAiTimelineEvents", async () => ({
    events: [{ title: "合成AI事件" }],
    apiError: "",
  }));
  await tasks.executeBackgroundTask(
    root,
    { type: "timeline-analysis", options: { mode: "ai" } },
    control(),
  );
  assert.equal(
    (await analysis.loadAnalysisState(root)).timeline.events[0].title,
    "合成AI事件",
  );
  replace(t, analysis, "analyzeConsistency", async () => ({
    issues: [{ title: "合成冲突" }],
    apiError: "",
  }));
  await tasks.executeBackgroundTask(
    root,
    { type: "consistency-check", options: { chapterIds: ["c0"] } },
    control(),
  );
  const before = await analysis.loadAnalysisState(root);
  assert.equal(before.consistency.issues.length, 1);
  analysis.analyzeConsistency = async () => {
    throw Error("合成检查失败");
  };
  await assert.rejects(
    tasks.executeBackgroundTask(root, { type: "consistency-check" }, control()),
    /合成检查失败/,
  );
  assert.deepEqual(await analysis.loadAnalysisState(root), before);
});
test("索引重建、真实快照及统计任务持久化", async (t) => {
  const { root } = await domainProject(t),
    ctl = control();
  const index = await tasks.executeBackgroundTask(
    root,
    { type: "knowledge-rebuild" },
    ctl,
  );
  assert.ok(index.chunks > 0);
  assert.ok(ctl.updates.some((p) => p.phase.includes("重建")));
  const snapshot = await tasks.executeBackgroundTask(
    root,
    {
      type: "snapshot",
      title: "合成快照",
      options: { reason: "直接服务验收" },
    },
    control(),
  );
  assert.ok(snapshot.snapshot.id);
  const stats = await tasks.executeBackgroundTask(
    root,
    { type: "creative-statistics", options: { label: "合成统计" } },
    control(),
  );
  assert.equal(stats.snapshot.label, "合成统计");
  assert.equal(
    (await workspace.loadWorkspace(root)).statisticsHistory.length,
    1,
  );
  const canceled = control();
  canceled.controller.abort();
  await assert.rejects(tasks.buildCreativeStatistics(root, "", canceled), {
    name: "AbortError",
  });
  assert.equal(
    (await workspace.loadWorkspace(root)).statisticsHistory.length,
    1,
  );
});
test("角色出场与世界图基于真实正文和设定，空文件不崩溃", async (t) => {
  const { root, chapters } = await domainProject(t);
  await files.writeWorldDoc(root, {
    id: "key",
    title: "铜钥匙",
    category: "物品",
    fileName: "key.md",
    content: "# 铜钥匙\n圣城的物品。",
  });
  await files.writeWorldDoc(root, {
    id: "clan",
    title: "守卫团",
    category: "势力",
    fileName: "clan.md",
    content: "# 守卫团\n守卫驻地。",
  });
  await files.writeWorldDoc(root, {
    id: "rule",
    title: "规则",
    category: "设定",
    fileName: "rule.md",
    content: "# 规则\n限制。",
  });
  const stats = (await tasks.buildAppearanceStats(root)).stats;
  assert.equal(stats.find((s) => s.name === "李明").total, 4);
  assert.equal(stats.find((s) => s.name === "配角").total, 0);
  const map = await tasks.buildWorldMap(root);
  assert.ok(map.edges.some((e) => e.source === "city" && e.target === "key"));
  assert.deepEqual(
    [...new Set(map.nodes.map((n) => n.type))].sort(),
    ["势力", "地点", "物品", "设定"].sort(),
  );
  await fs.rm(files.getChapterPath(root, chapters[0]));
  assert.ok((await tasks.buildAppearanceStats(root)).stats.length);
});
test("Agent任务透传runId、tool、控制器，未知任务明确拒绝", async (t) => {
  const { root } = await domainProject(t),
    ctl = control();
  replace(
    t,
    creativeAgent,
    "executeCreativeAgentRun",
    async (project, id, current, tool) => {
      assert.equal(project, root);
      assert.equal(id, "run");
      assert.equal(current, ctl);
      assert.equal(tool, "analyze");
      return { success: true };
    },
  );
  assert.deepEqual(
    await tasks.executeBackgroundTask(
      root,
      {
        type: "agent-workflow",
        options: { runId: "run", onlyTool: "analyze" },
      },
      ctl,
    ),
    { success: true },
  );
  await assert.rejects(
    tasks.executeBackgroundTask(root, { type: "invalid" }, control()),
    /不支持/,
  );
});
test("任务中心并发获取同实例，重启同步中断Agent记录", async (t) => {
  const { root } = await domainProject(t);
  await workspace.upsertItem(root, "agentRuns", {
    id: "run",
    status: "运行中",
    title: "合成Agent",
    chapterId: "c0",
  });
  await files.writeJson(path.join(root, "analysis/tasks.json"), {
    version: 1,
    tasks: [
      {
        id: "interrupted",
        type: "agent-workflow",
        status: "运行中",
        options: { runId: "run" },
      },
    ],
  });
  const centers = await Promise.all(
    Array.from({ length: 8 }, () => tasks.getProjectTaskCenter(root)),
  );
  assert.ok(centers.every((c) => c === centers[0]));
  assert.equal((await centers[0].list()).tasks[0].status, "已中断");
  assert.equal(
    (await workspace.loadWorkspace(root)).agentRuns[0].status,
    "已中断",
  );
  assert.equal(
    (await workspace.loadWorkspace(root)).agentRuns[0].taskId,
    "interrupted",
  );
});
test("真实任务中心记录完成与失败，失败任务重试后恢复", async (t) => {
  const { root } = await domainProject(t),
    center = await tasks.getProjectTaskCenter(root);
  const task = await center.enqueue({
    type: "story-analysis",
    scope: { chapterIds: ["c0"] },
  });
  assert.equal((await waitFor(center, task.id)).status, "已完成");
  const failed = await center.enqueue({ type: "invalid" });
  assert.equal((await waitFor(center, failed.id)).status, "失败");
  const original = await files.readJson(center.filePath);
  assert.ok(
    original.tasks.some((item) => item.id === failed.id && item.canRetry),
  );
  replace(t, analysis, "refreshLocalStoryState", async () => {
    throw Error("一次合成失败");
  });
  const retryable = await center.enqueue({
    type: "story-analysis",
    scope: { chapterIds: ["c1"] },
  });
  await waitFor(center, retryable.id);
  analysis.refreshLocalStoryState = async () => ({});
  const retried = await center.retry(retryable.id);
  assert.equal((await waitFor(center, retried.id)).status, "已完成");
  assert.equal(retried.retryOf, retryable.id);
});
test("恢复后先清空旧向量和摘要，再排队重建", async (t) => {
  const { root } = await domainProject(t);
  await tasks.executeBackgroundTask(
    root,
    { type: "knowledge-rebuild" },
    control(),
  );
  const center = await tasks.getProjectTaskCenter(root);
  replace(t, center, "enqueue", async (payload) => ({
    id: "queued",
    ...payload,
  }));
  const task = await tasks.queueKnowledgeRebuildAfterRestore(root, "合成恢复");
  assert.equal(task.type, "knowledge-rebuild");
  assert.equal(task.options.reason, "合成恢复");
  assert.equal((await vectorShards.loadStore(root)).vectors.length, 0);
  assert.equal(
    (await files.readJson(files.getKnowledgeSummariesPath(root))).sources
      .length,
    0,
  );
});
test("空闲分析重新计时、活动任务去重，自动失败不干扰写作", async (t) => {
  const { root, chapters } = await domainProject(t),
    callbacks = [],
    queued = [];
  const originalTimeout = global.setTimeout,
    originalClear = global.clearTimeout,
    cleared = [];
  replace(t, global, "setTimeout", (fn, delay, ...args) => {
    if (delay === 45000) {
      const timer = { fn };
      callbacks.push(timer);
      return timer;
    }
    return originalTimeout(fn, delay, ...args);
  });
  replace(t, global, "clearTimeout", (timer) => {
    if (callbacks.includes(timer)) cleared.push(timer);
    else originalClear(timer);
  });
  const center = await tasks.getProjectTaskCenter(root);
  replace(t, center, "list", async () => ({
    tasks: [
      {
        type: "story-analysis",
        status: "运行中",
        scope: { chapterIds: ["c0"] },
      },
    ],
  }));
  replace(t, center, "enqueue", async (payload) => {
    queued.push(payload);
  });
  tasks.scheduleIdleDeepAnalysis(root, chapters[0]);
  tasks.scheduleIdleDeepAnalysis(root, chapters[0]);
  assert.equal(cleared.length, 1);
  await callbacks.at(-1).fn();
  assert.equal(queued.length, 0);
  center.list = async () => ({ tasks: [] });
  tasks.scheduleIdleDeepAnalysis(root, chapters[0]);
  await callbacks.at(-1).fn();
  assert.equal(queued[0].options.useAI, true);
  assert.deepEqual(queued[0].scope.chapterIds, ["c0"]);
  center.enqueue = async () => {
    throw Error("合成自动排队失败");
  };
  tasks.scheduleIdleDeepAnalysis(root, chapters[0]);
  await callbacks.at(-1).fn();
  assert.equal(runtime.state.deepAnalysisTimers.size, 0);
});
