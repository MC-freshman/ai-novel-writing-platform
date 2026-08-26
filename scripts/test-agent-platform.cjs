const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const storyState = require("../electron/services/story-state.cjs");
const projectSnapshots = require("../electron/services/project-snapshots.cjs");
const vectorShards = require("../electron/services/vector-shards.cjs");
const creativeWorkspace = require("../electron/services/creative-workspace.cjs");
const operationJournal = require("../electron/services/operation-journal.cjs");
const projectMigrations = require("../electron/services/project-migrations.cjs");
const retrievalPlanner = require("../electron/services/retrieval-planner.cjs");
const novelAgent = require("../electron/services/novel-agent.cjs");
const knowledgeFreshness = require("../electron/services/knowledge-freshness.cjs");
const { PersistentTaskCenter } = require("../electron/services/task-center.cjs");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForTask(center, taskId, statuses, timeoutMs = 5000) {
  const expected = new Set(statuses);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = (await center.list()).tasks.find((item) => item.id === taskId);
    if (task && expected.has(task.status)) return task;
    await delay(20);
  }
  throw new Error(`等待任务状态超时：${[...expected].join("、")}`);
}

async function testStoryState(projectPath) {
  const chapter = { id: "chapter_1", title: "第一章", volume: "卷一", order: 0 };
  const characters = [{ id: "character_li", name: "李明" }];
  const original = "# 第一章\n\n李明来到圣城，发现门边有一道异常刻痕。\n\n那枚徽章似乎隐藏着一个秘密。";
  const first = await storyState.saveChapterLedger(projectPath, storyState.analyzeChapterLocally({ chapter, content: original, characters }));
  assert.ok(first.facts.length, "本地分析应提取有原文证据的剧情事实");
  assert.ok(first.characterStates.some((item) => item.characterName === "李明"), "角色出现后应保存章节状态");
  assert.ok(first.foreshadows.length, "异常或秘密信息应作为伏笔候选");

  const confirmedFact = await storyState.updateFact(projectPath, first.facts[0].id, { status: "已确认", userNote: "作者确认" });
  const confirmedForeshadow = await storyState.updateForeshadow(projectPath, first.foreshadows[0].id, { status: "等待回收", plannedPayoff: "第三章回收" });
  const manualFact = await storyState.createManualFact(projectPath, { chapterId: chapter.id, chapterTitle: chapter.title, volume: chapter.volume, subject: "李明", type: "知情变化", object: "李明知道城门刻痕与徽章有关。", userNote: "作者人工记录", evidence: [{ chapterId: chapter.id, chapterTitle: chapter.title, volume: chapter.volume, heading: "", quote: "李明来到圣城", start: 0, end: 6 }] });
  const manualForeshadow = await storyState.createManualForeshadow(projectPath, { chapterId: chapter.id, chapterTitle: chapter.title, volume: chapter.volume, title: "徽章来源", description: "徽章背后的来源尚未揭示。", plannedPayoff: "第五章回收" });
  const expanded = `${original}\n\n李明决定继续调查。`;
  await storyState.saveChapterLedger(projectPath, storyState.analyzeChapterLocally({ chapter, content: expanded, characters }));
  let overview = await storyState.getStoryOverview(projectPath, { projectChapters: [{ ...chapter, revision: "unused" }] });
  assert.equal(overview.facts.find((item) => item.id === confirmedFact.id)?.status, "已确认", "重新分析不得覆盖作者确认的事实");
  assert.equal(overview.foreshadows.find((item) => item.id === confirmedForeshadow.id)?.status, "等待回收", "重新分析不得覆盖伏笔生命周期");
  assert.equal(overview.facts.find((item) => item.id === manualFact.id)?.userNote, "作者人工记录", "重新分析不得覆盖人工事实");
  assert.equal(overview.facts.find((item) => item.id === manualFact.id)?.evidence?.[0]?.start, 0, "位于正文开头的证据位置 0 必须原样保留");
  assert.equal(overview.foreshadows.find((item) => item.id === manualForeshadow.id)?.stale, false, "人工伏笔不应随正文修订被误标为失效");
  await storyState.updateFact(projectPath, confirmedFact.id, { object: "作者修正后的事实内容" });
  await storyState.updateForeshadow(projectPath, confirmedForeshadow.id, { title: "作者修正后的伏笔标题" });
  await storyState.saveChapterLedger(projectPath, storyState.analyzeChapterLocally({ chapter, content: expanded, characters }));
  overview = await storyState.getStoryOverview(projectPath, { projectChapters: [chapter] });
  assert.equal(overview.facts.find((item) => item.id === confirmedFact.id)?.object, "作者修正后的事实内容", "重新分析不得覆盖作者手工修正的事实内容");
  assert.equal(overview.foreshadows.find((item) => item.id === confirmedForeshadow.id)?.title, "作者修正后的伏笔标题", "重新分析不得覆盖作者手工修正的伏笔标题");
  await assert.rejects(storyState.deleteFact(projectPath, confirmedFact.id), /自动识别的事实不能直接删除/, "自动事实必须通过忽略处理，不能误删");
  await assert.rejects(storyState.deleteForeshadow(projectPath, confirmedForeshadow.id), /自动识别的伏笔不能直接删除/, "自动伏笔必须通过废弃处理，不能误删");
  const updatedManual = await storyState.updateFact(projectPath, manualFact.id, { object: "李明确认城门刻痕与徽章来自同一组织。" });
  assert.match(updatedManual.object, /同一组织/, "人工事实应支持修改内容");

  for (let index = 0; index < 25; index += 1) {
    await storyState.createManualFact(projectPath, { chapterId: chapter.id, chapterTitle: chapter.title, volume: chapter.volume, subject: "分页测试", object: `人工事实 ${index}` });
  }
  const firstPage = await storyState.getStoryOverview(projectPath, { projectChapters: [chapter], factLimit: 20 });
  assert.equal(firstPage.facts.length, 20, "剧情事实应按页读取，避免一次渲染超长列表");
  assert.ok(firstPage.pageInfo.facts.total > firstPage.facts.length, "分页结果应报告筛选后的总数");
  const volumeFiltered = await storyState.getStoryOverview(projectPath, { projectChapters: [chapter], volume: "不存在的分卷" });
  assert.equal(volumeFiltered.facts.length, 0, "按分卷筛选时不得混入其他分卷事实");
  const selectedContext = await storyState.getAgentContext(projectPath, chapter.id, [], [manualFact.id, manualForeshadow.id]);
  assert.equal(selectedContext.facts[0].id, manualFact.id, "作者指定的事实应优先进入创作参谋上下文");
  assert.equal(selectedContext.foreshadows[0].id, manualForeshadow.id, "作者指定的伏笔应优先进入创作参谋上下文");
  const board = await storyState.saveBoard(projectPath, {
    id: "board_chapter_1",
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    targetChapterId: "",
    targetChapterTitle: "下一章",
    status: "筹备中",
    generatedAt: new Date().toISOString(),
    items: [{ id: "advice_item", type: "剧情推进", title: "参谋建议", detail: "让角色作出选择", locked: true, completed: false, sourceRefs: manualFact.evidence }],
  });
  assert.deepEqual(board.items[0].sourceRefs, manualFact.evidence, "参谋建议写入筹备板后必须保留来源证据");

  const replacement = "# 第一章\n\n城门在清晨按时开启，街道十分安静。";
  await storyState.saveChapterLedger(projectPath, storyState.analyzeChapterLocally({ chapter, content: replacement, characters }));
  overview = await storyState.getStoryOverview(projectPath, { projectChapters: [{ ...chapter, revision: "unused" }] });
  const staleFact = overview.facts.find((item) => item.id === confirmedFact.id);
  assert.equal(staleFact?.status, "已确认", "原句删除后仍应保留作者确认项");
  assert.equal(staleFact?.stale, true, "原句删除后应提示作者重新核对");
  assert.equal(overview.characterStates.some((item) => item.characterName === "李明"), false, "角色从章节删除后不得残留旧状态");

  await storyState.removeChapterLedger(projectPath, chapter.id);
  overview = await storyState.getStoryOverview(projectPath, { projectChapters: [] });
  assert.equal(overview.counts.chapters, 0, "删除章节后剧情账本应同步清理");
  assert.equal(overview.characterStates.length, 0, "删除章节后角色状态文件应同步清理");
  assert.equal(overview.foreshadows.length, 0, "删除章节后关联伏笔应同步清理");
}

async function testTaskCenter(projectPath) {
  const center = new PersistentTaskCenter({
    projectPath,
    executor: async (task, control) => {
      if (task.retryOf) {
        await control.update({ current: 1, total: 1, phase: "重试完成" });
        return { retried: true };
      }
      await control.appendPartial("已保留的部分结果");
      while (!control.isCanceled()) {
        await control.waitIfPaused();
        await delay(15);
      }
      return { stopped: true };
    },
  });
  const original = await center.enqueue({ type: "story-analysis", title: "可停止任务", total: 10 });
  await waitForTask(center, original.id, ["运行中"]);
  const pausedResult = await center.pause(original.id);
  assert.equal(pausedResult.task.status, "已暂停", "运行中的任务应能暂停并保留当前状态");
  await delay(40);
  assert.equal((await center.list()).tasks.find((item) => item.id === original.id)?.status, "已暂停", "暂停期间任务不得自行继续");
  const resumedResult = await center.resume(original.id);
  assert.equal(resumedResult.task.status, "运行中", "暂停任务应能从原位置继续");
  await center.cancel(original.id);
  const stopped = await waitForTask(center, original.id, ["已停止"]);
  assert.match(stopped.partialOutput, /已保留的部分结果/, "停止任务后必须保留已有输出");
  assert.equal(stopped.canRetry, true, "停止后的任务应允许重试");

  const retried = await center.retry(original.id);
  const completed = await waitForTask(center, retried.id, ["已完成"]);
  assert.deepEqual(completed.result, { retried: true }, "重试应沿用原任务参数并保存结果");
  const cleared = await center.clearHistory();
  assert.ok(cleared.removed >= 2, "任务中心应能批量清理已结束记录");
  assert.equal(cleared.tasks.length, 0, "批量清理后不得残留已结束任务");

  const interruptedPath = path.join(projectPath, "interrupted", "analysis");
  await fs.mkdir(interruptedPath, { recursive: true });
  await fs.writeFile(path.join(interruptedPath, "tasks.json"), JSON.stringify({ version: 1, tasks: [{ ...original, id: "running_before_restart", status: "运行中" }] }), "utf8");
  const restarted = new PersistentTaskCenter({ projectPath: path.join(projectPath, "interrupted"), executor: async () => null });
  const interrupted = (await restarted.list()).tasks[0];
  assert.equal(interrupted.status, "已中断", "软件异常退出后未完成任务应标为已中断");
  assert.equal(interrupted.canRetry, true, "中断任务应允许重试");
}

async function testSnapshots(projectPath) {
  await fs.mkdir(path.join(projectPath, "chapters"), { recursive: true });
  await fs.mkdir(path.join(projectPath, "analysis"), { recursive: true });
  await fs.writeFile(path.join(projectPath, "novel.config.json"), JSON.stringify({ title: "快照测试" }), "utf8");
  const chapterPath = path.join(projectPath, "chapters", "chapter.md");
  const addedPath = path.join(projectPath, "chapters", "added.md");
  await fs.writeFile(chapterPath, "快照原文", "utf8");
  const snapshot = await projectSnapshots.createSnapshot(projectPath, { name: "起点", reason: "自动测试" });
  await fs.writeFile(chapterPath, "修改后的原文", "utf8");
  await fs.writeFile(addedPath, "快照后新增", "utf8");
  const comparison = await projectSnapshots.compareSnapshot(projectPath, snapshot.id);
  assert.ok(comparison.changed.includes("chapters/chapter.md"), "快照比较应识别修改文件");
  assert.ok(comparison.added.includes("chapters/added.md"), "快照比较应识别新增文件");
  const restored = await projectSnapshots.restoreSnapshot(projectPath, snapshot.id);
  assert.equal(await fs.readFile(chapterPath, "utf8"), "快照原文", "快照恢复应还原文件内容");
  await assert.rejects(fs.access(addedPath), "完整恢复应移除快照之后新增的受管文件");
  assert.equal(restored.removed, 1, "恢复结果应报告清理的新增文件数");
  assert.ok(restored.safetySnapshot, "恢复前应自动创建安全快照");

  const branch = await projectSnapshots.createBranch(projectPath, "实验线");
  const renamed = await projectSnapshots.renameSnapshot(projectPath, branch.branch.snapshotId, "实验线起点");
  assert.equal(renamed.name, "实验线起点", "项目快照应支持重命名");
  await assert.rejects(projectSnapshots.deleteSnapshot(projectPath, branch.branch.snapshotId), /创作分支/, "分支引用的快照不得删除");
  await fs.writeFile(chapterPath, "主线当前内容", "utf8");
  await projectSnapshots.switchBranch(projectPath, branch.branch.id);
  assert.equal(await fs.readFile(chapterPath, "utf8"), "快照原文", "切换到实验分支应恢复分支起点");
  await fs.writeFile(chapterPath, "实验线内容", "utf8");
  await projectSnapshots.switchBranch(projectPath, "main");
  assert.equal(await fs.readFile(chapterPath, "utf8"), "主线当前内容", "切回主线应恢复主线切换前内容");
  await projectSnapshots.switchBranch(projectPath, branch.branch.id);
  assert.equal(await fs.readFile(chapterPath, "utf8"), "实验线内容", "再次进入实验分支应保留该分支的修改");
  await assert.rejects(projectSnapshots.deleteBranch(projectPath, branch.branch.id), /当前正在使用/, "当前分支不得删除");
  await projectSnapshots.switchBranch(projectPath, "main");
  const deletedBranch = await projectSnapshots.deleteBranch(projectPath, branch.branch.id);
  assert.equal(deletedBranch.removed, true, "切走后应允许删除非主线实验分支");
  await assert.rejects(projectSnapshots.deleteBranch(projectPath, "main"), /主线分支不能删除/, "主线分支必须始终保留");
  const deletedSnapshot = await projectSnapshots.deleteSnapshot(projectPath, branch.branch.snapshotId);
  assert.equal(deletedSnapshot.removed, true, "分支删除后应允许删除不再引用的起点快照");
}

function vector(sourceId, index, title) {
  return {
    id: `${sourceId}_${index}`,
    sourceId,
    sourceType: "chapter",
    sourceHash: `hash_${sourceId}`,
    title,
    volume: "卷一",
    category: "卷一",
    knowledgeRole: "正文",
    text: `${title} 内容 ${index}`,
    embedding: [1, 0, index / 10],
  };
}

async function testVectorShards(projectPath) {
  const vectorDir = path.join(projectPath, "vector_db");
  await fs.mkdir(vectorDir, { recursive: true });
  await fs.writeFile(path.join(vectorDir, "vectors.json"), JSON.stringify({ version: 1, vectors: [vector("a", 0, "第一章"), vector("a", 1, "第一章"), vector("b", 0, "第二章")] }), "utf8");
  const manifest = await vectorShards.migrateLegacyIfNeeded(projectPath);
  assert.equal(manifest.sources.length, 2, "旧版单文件向量库应自动迁移成按文档分片");
  const onlyA = await vectorShards.loadStore(projectPath, { sourceIds: ["a"] });
  assert.equal(onlyA.vectors.length, 2, "按来源读取时不得加载无关文档分片");
  assert.ok(onlyA.vectors.every((item) => item.sourceId === "a"), "分片筛选结果不得混入其他来源");

  const sourceB = manifest.sources.find((item) => item.sourceId === "b");
  const sourceBPath = path.join(vectorDir, "shards", sourceB.fileName);
  const sourceBBefore = await fs.readFile(sourceBPath, "utf8");
  await vectorShards.upsertSources(projectPath, new Map([["a", [vector("a", 0, "第一章修订")]]]));
  assert.equal(await fs.readFile(sourceBPath, "utf8"), sourceBBefore, "单章索引更新不得重写其他文档分片");
  const stats = await vectorShards.stats(projectPath);
  assert.deepEqual({ chunks: stats.chunks, sources: stats.sources }, { chunks: 2, sources: 2 }, "分片清单应准确统计总片段和来源数");
}

async function testRetrievalPlanner(projectPath) {
  const chapters = [
    { id: "c1", title: "第一章", volume: "卷一", order: 0, knowledgeRole: "正文" },
    { id: "c2", title: "第二章", volume: "卷一", order: 1, knowledgeRole: "正文" },
    { id: "c3", title: "第三章", volume: "卷二", order: 2, knowledgeRole: "正文" },
  ];
  const subQueries = retrievalPlanner.decomposeQuery("检查李明的动机、圣城伏笔和全书因果是否一致", "book");
  assert.ok(subQueries.some((item) => item.kind === "character"), "人物问题应拆出人物与动机子问题");
  assert.ok(subQueries.some((item) => item.kind === "foreshadow"), "伏笔问题应拆出伏笔与线索子问题");
  assert.ok(subQueries.some((item) => item.kind === "causality"), "全书检查应拆出因果与一致性子问题");

  const signals = retrievalPlanner.extractQuerySignals("李明在圣城次日做了什么", [{ id: "li", name: "李明" }], [{ id: "city", title: "圣城" }]);
  const adjacencyScores = retrievalPlanner.buildChapterAdjacency(chapters, ["c2"]);
  const storyScores = retrievalPlanner.buildStoryBoosts(
    { causalNodes: [{ chapterId: "c1", title: "发现徽章", detail: "李明因此前往圣城", type: "因果" }] },
    { foreshadows: [{ title: "徽章", description: "圣城线索", status: "等待回收", plantedAt: [{ chapterId: "c1" }] }] },
    subQueries,
  );
  const scored = retrievalPlanner.scoreCandidate(
    { sourceId: "c2", metadata: { characters: ["李明"], locations: ["圣城"], timeHints: ["次日"] }, title: "第二章", text: "李明次日进入圣城" },
    { signals, adjacencyScores, storyScores, subQueries, lexicalScore: (item, query) => query.includes("李明") && item.text.includes("李明") ? 0.5 : 0 },
  );
  assert.ok(scored.entityScore > 0.4, "人物、地点和时间命中应形成实体加权");
  assert.ok(scored.adjacencyScore > 0, "点名章节本身应形成章节邻接加权");
  assert.ok(storyScores.c1 > 0, "因果节点与伏笔证据应形成剧情工作区加权");

  const manifest = {
    updatedAt: "2026-08-25T00:00:00.000Z",
    sources: chapters.map((chapter) => ({ sourceId: chapter.id, sourceType: "chapter", title: chapter.title, volume: chapter.volume, chunkCount: 2 })),
  };
  const summaries = {
    updatedAt: "2026-08-25T00:00:00.000Z",
    volumes: [{ title: "卷一", summary: "李明进入圣城", documentCount: 2 }, { title: "卷二", summary: "战争升级", documentCount: 1 }],
  };
  const coverage = retrievalPlanner.buildCoverageAudit([{ sourceId: "c1", title: "第一章" }], { chapters }, summaries, manifest);
  assert.deepEqual(coverage.rawChapterCoverage, { selected: 1, total: 3 }, "覆盖审计应区分原始正文覆盖与总章节数");
  assert.equal(coverage.coverageByVolume.find((item) => item.volume === "卷二")?.summaryAvailable, true, "未选原文的分卷应能报告摘要覆盖");

  const firstCache = await retrievalPlanner.ensureVolumeCache(projectPath, { manifest, summaries, config: { chapters } });
  const secondCache = await retrievalPlanner.ensureVolumeCache(projectPath, { manifest, summaries, config: { chapters } });
  assert.equal(firstCache.reused, false, "首次构建应生成分卷检索缓存");
  assert.equal(secondCache.reused, true, "索引未变化时应复用分卷检索缓存");
  const ranked = retrievalPlanner.rankVolumeCache(secondCache, subQueries, "book", (item, query) => query.includes("圣城") && item.text.includes("圣城") ? 1 : 0);
  assert.equal(ranked[0].title, "卷一", "分卷路由应把命中子问题的分卷排在前面");
  const coverageTargets = [
    { id: "query_character", kind: "query", label: "人物动机", value: "李明 动机", required: true },
    { id: "query_foreshadow", kind: "query", label: "伏笔线索", value: "徽章 伏笔", required: true },
  ];
  const candidates = [
    { id: "chunk_character", sourceId: "c1", title: "第一章", text: "李明决定调查，因此进入圣城。", score: 1 },
    { id: "chunk_foreshadow", sourceId: "c3", title: "第三章", text: "徽章是尚未回收的伏笔线索。", score: 0.5 },
  ];
  const twoPass = retrievalPlanner.addCoverageSecondPass({
    firstPass: [candidates[0]],
    candidates,
    targets: coverageTargets,
    maxChunks: 4,
    maxChars: 5000,
    lexicalScore: (item, query) => query.split(/\s+/).some((term) => item.text.includes(term)) ? 0.5 : 0,
  });
  assert.equal(twoPass.audit.secondPassCount, 1, "首轮遗漏的子问题应触发第二轮补证");
  assert.equal(twoPass.audit.uncoveredTargets.length, 0, "第二轮补证后应重新计算未覆盖目标");
  const cacheHealth = await retrievalPlanner.inspectVolumeCache(projectPath, { manifest, summaries, config: { chapters } });
  assert.equal(cacheHealth.valid, true, "检索缓存指纹与索引一致时应报告为有效");
}

function testNovelAgentPlanning() {
  const readOnly = novelAgent.selectTools("全面检查下一章的人物动机、伏笔、节奏和设定，并润色选中文字", "next", "只读分析", "待润色原文");
  assert.ok(readOnly.some((item) => item.tool === "chapter_planner"), "下一章任务应自动选择章节规划器");
  assert.ok(readOnly.some((item) => item.tool === "character_development_advisor"), "人物问题应自动选择人物发展参谋");
  assert.ok(readOnly.some((item) => item.tool === "foreshadow_manager"), "伏笔问题应自动选择伏笔管理器");
  assert.equal(readOnly.find((item) => item.tool === "safe_revision_proposer")?.allowed, false, "只读权限不得生成修订候选");
  const revisionAllowed = novelAgent.selectTools("润色选中文字", "next", "可生成修订候选", "待润色原文");
  assert.equal(revisionAllowed.find((item) => item.tool === "safe_revision_proposer")?.allowed, true, "最高权限应允许生成独立修订候选");
  const states = novelAgent.initialToolStates(readOnly);
  assert.equal(states.find((item) => item.tool === "safe_revision_proposer")?.status, "已跳过", "权限不足的工具应明确记录为已跳过");
  assert.equal(novelAgent.permissionRank("可生成修订候选") > novelAgent.permissionRank("可创建规划"), true, "Agent 权限等级必须保持单向递增");
  const scopeConfig = { chapters: [{ id: "c1", title: "第一章", volume: "卷一", order: 0 }, { id: "c2", title: "第二章", volume: "卷一", order: 1 }, { id: "c3", title: "第三章", volume: "卷二", order: 2 }] };
  const automatic = novelAgent.resolveScope(scopeConfig, scopeConfig.chapters[0], "auto", "检查本卷人物成长和伏笔", "plot");
  assert.equal(automatic.type, "volume", "涉及本卷的目标应自动推荐当前分卷范围");
  assert.deepEqual(automatic.ids, ["c1", "c2"], "分卷范围只应包含当前卷文档");
  const manual = novelAgent.resolveScope(scopeConfig, scopeConfig.chapters[0], "book", "只看当前章", "next");
  assert.equal(manual.type, "book", "作者手动选择的 Agent 范围必须覆盖自动推荐");
}

async function testKnowledgeFreshness(projectPath) {
  await fs.mkdir(path.join(projectPath, "chapters"), { recursive: true });
  const filePath = path.join(projectPath, "chapters", "chapter.md");
  const original = "第一章原始内容";
  await fs.writeFile(filePath, original, "utf8");
  const originalHash = require("node:crypto").createHash("sha256").update(original).digest("hex");
  const source = { sourceId: "chapter_1", sourceType: "chapter", title: "第一章", group: "卷一", filePath, getContent: () => fs.readFile(filePath, "utf8") };
  const options = {
    vectorManifest: { sources: [{ sourceId: "chapter_1", chunkCount: 1, sourceHash: originalHash }] },
    summaries: { sources: [{ sourceId: "chapter_1", contentHash: originalHash }] },
    normalizeContent: (value) => value,
  };
  const first = await knowledgeFreshness.inspectSources(projectPath, [source], options);
  assert.equal(first.items[0].status, "已同步", "内容哈希与索引一致时应报告已同步");
  const second = await knowledgeFreshness.inspectSources(projectPath, [source], options);
  assert.equal(second.reusedHashes, 1, "文件签名未变化时应复用内容哈希");
  await new Promise((resolve) => setTimeout(resolve, 5));
  await fs.writeFile(filePath, `${original}，后来发生变化`, "utf8");
  const changed = await knowledgeFreshness.inspectSources(projectPath, [source], options);
  assert.equal(changed.items[0].status, "等待更新", "源文档变化后不得继续报告为已同步");
  assert.equal(changed.recalculatedHashes, 1, "文件签名变化后必须重新计算内容哈希");
}

async function testCreativeWorkspace(projectPath) {
  await creativeWorkspace.ensureWorkspace(projectPath);
  const first = await creativeWorkspace.upsertItem(projectPath, "scenes", {
    chapterId: "chapter_1", chapterTitle: "第一章", title: "相遇", order: 0, goal: "找到线索",
  });
  const second = await creativeWorkspace.upsertItem(projectPath, "scenes", {
    chapterId: "chapter_1", chapterTitle: "第一章", title: "追逐", order: 1, conflict: "敌人阻拦",
  });
  await creativeWorkspace.upsertItem(projectPath, "scenes", {
    chapterId: "chapter_2", chapterTitle: "第二章", title: "余波", order: 0,
  });
  const reordered = await creativeWorkspace.reorderScenes(projectPath, "chapter_1", [second.id, first.id]);
  assert.deepEqual(reordered.map((item) => item.id), [second.id, first.id], "场景排序必须只调整当前章节并按拖动顺序保存");

  const manualNode = await creativeWorkspace.upsertItem(projectPath, "causalNodes", {
    id: "manual_cause", type: "选择", title: "主角决定追查", origin: "manual", locked: true,
  });
  await creativeWorkspace.rebuildCausality(projectPath, {
    chapterOrder: { chapter_1: 0 },
    facts: [{ id: "fact_1", chapterId: "chapter_1", chapterTitle: "第一章", subject: "主角", object: "发现密信", status: "已确认", evidence: [] }],
    foreshadows: [],
  });
  let workspace = await creativeWorkspace.loadWorkspace(projectPath);
  assert.ok(workspace.causalNodes.some((item) => item.id === manualNode.id), "重建因果脉络不得覆盖作者锁定的手工节点");

  await creativeWorkspace.upsertItem(projectPath, "memories", { scope: "全书", title: "全局原则", content: "主角不杀无辜" });
  await creativeWorkspace.upsertItem(projectPath, "memories", { scope: "分卷", scopeId: "卷一", title: "卷一目标", content: "找到密信来源" });
  await creativeWorkspace.upsertItem(projectPath, "memories", { scope: "章节", scopeId: "chapter_2", title: "第二章", content: "隐藏身份" });
  const relevant = creativeWorkspace.relevantMemories(await creativeWorkspace.loadWorkspace(projectPath), { id: "chapter_1", volume: "卷一" });
  assert.ok(relevant.some((item) => item.title === "全局原则"), "当前章节必须继承全书记忆");
  assert.ok(relevant.some((item) => item.title === "卷一目标"), "当前章节必须继承所属分卷记忆");
  assert.ok(!relevant.some((item) => item.title === "第二章"), "不得把其他章节的局部记忆混入当前章节");

  await creativeWorkspace.upsertItem(projectPath, "annotations", { chapterId: "chapter_1", quote: "原句", comment: "待修改", sourceRevision: "r1" });
  await creativeWorkspace.removeChapterReferences(projectPath, "chapter_1");
  workspace = await creativeWorkspace.loadWorkspace(projectPath);
  assert.ok(workspace.scenes.every((item) => item.chapterId !== "chapter_1"), "删除章节必须清理关联场景");
  assert.ok(workspace.annotations.every((item) => item.chapterId !== "chapter_1"), "删除章节必须清理关联批注");
  assert.ok(workspace.scenes.some((item) => item.chapterId === "chapter_2"), "删除章节不得误删其他章节场景");

  await creativeWorkspace.mergeImportedWorkspace(projectPath, {
    scenes: [{ id: "import_scene", chapterId: "old_chapter", title: "导入场景" }],
    memories: [{ id: "import_memory", scope: "章节", scopeId: "old_chapter", title: "导入记忆", content: "内容" }],
  }, new Map([["old_chapter", "new_chapter"]]));
  workspace = await creativeWorkspace.loadWorkspace(projectPath);
  assert.equal(workspace.scenes.find((item) => item.id === "import_scene")?.chapterId, "new_chapter", "导入工作区时必须映射章节编号");
  assert.equal(workspace.memories.find((item) => item.id === "import_memory")?.scopeId, "new_chapter", "章节级记忆必须随导入章节一同映射");
}

async function testRecoveryAndMigrations(projectPath) {
  await fs.mkdir(projectPath, { recursive: true });
  const firstSession = await operationJournal.startSession(projectPath, "0.2.0");
  const pending = await operationJournal.beginOperation(projectPath, { type: "chapter-save", title: "保存第一章", targetIds: ["chapter_1"] });
  const secondSession = await operationJournal.startSession(projectPath, "0.2.1");
  const journal = await operationJournal.loadJournal(projectPath);
  assert.equal(journal.operations.find((item) => item.id === pending.id)?.status, "已中断", "异常启动后进行中的高风险操作必须标记为已中断");
  assert.ok(journal.sessions.some((item) => item.id === firstSession.session.id && item.status === "异常中断"), "异常会话必须进入历史记录");

  const draft = await operationJournal.saveDraft(projectPath, { chapterId: "chapter_1", chapterTitle: "第一章", volume: "卷一", content: "未保存正文", baseRevision: "base", wordCount: 5 });
  assert.equal((await operationJournal.listDrafts(projectPath))[0]?.content, "未保存正文", "恢复草稿必须独立持久化");
  await operationJournal.saveWindowState(projectPath, { selectedChapterId: "chapter_1", view: "analysis", leftWidth: 300, rightWidth: 600, previewWidth: 42 });
  assert.equal((await operationJournal.loadWindowState(projectPath))?.view, "analysis", "项目窗口与页面状态必须能够恢复");
  await operationJournal.clearDraft(projectPath, draft.chapterId);
  assert.equal((await operationJournal.listDrafts(projectPath)).length, 0, "正常保存或放弃后应清理恢复草稿");
  await operationJournal.endSession(projectPath, secondSession.session.id);

  const migrationProject = path.join(projectPath, "migration");
  await fs.mkdir(migrationProject, { recursive: true });
  const originalConfig = { version: 1, title: "旧项目", chapters: [{ id: "chapter_old", title: "旧章", fileName: "old.md" }] };
  await fs.writeFile(path.join(migrationProject, "novel.config.json"), JSON.stringify(originalConfig), "utf8");
  await assert.rejects(projectMigrations.migrateProject(migrationProject, { createSnapshot: async () => { throw new Error("模拟快照失败"); } }), /已自动恢复/, "迁移前保护失败时必须停止升级并自动回滚");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(migrationProject, "novel.config.json"), "utf8")), originalConfig, "迁移失败后项目配置必须逐项恢复");
  const migrated = await projectMigrations.migrateProject(migrationProject, { createSnapshot: async () => ({ id: "snapshot_before_migration" }) });
  const migratedConfig = JSON.parse(await fs.readFile(path.join(migrationProject, "novel.config.json"), "utf8"));
  assert.equal(migrated.migrated, true, "旧项目应自动执行结构迁移");
  assert.equal(migratedConfig.projectSchemaVersion, projectMigrations.CURRENT_PROJECT_SCHEMA, "迁移后应记录当前项目结构版本");
  assert.equal(migratedConfig.chapters[0].knowledgeRole, "正文", "旧章节应补齐知识库分类而不改变正文文件");

  const currentProject = path.join(projectPath, "current-schema");
  await fs.mkdir(currentProject, { recursive: true });
  await fs.writeFile(path.join(currentProject, "novel.config.json"), JSON.stringify({ title: "新项目", projectSchemaVersion: projectMigrations.CURRENT_PROJECT_SCHEMA, chapters: [] }), "utf8");
  const synchronized = await projectMigrations.migrateProject(currentProject);
  assert.equal(synchronized.state.schemaVersion, projectMigrations.CURRENT_PROJECT_SCHEMA, "配置已经是新版时仍应同步迁移元数据，避免健康检查误报");
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novel-agent-regression-"));
  try {
    await testStoryState(path.join(root, "story"));
    await testTaskCenter(path.join(root, "tasks"));
    await testSnapshots(path.join(root, "snapshots"));
    await testVectorShards(path.join(root, "vectors"));
    await testRetrievalPlanner(path.join(root, "retrieval"));
    await testKnowledgeFreshness(path.join(root, "freshness"));
    testNovelAgentPlanning();
    await testCreativeWorkspace(path.join(root, "workspace"));
    await testRecoveryAndMigrations(path.join(root, "recovery"));
    console.log("PASS: 创作状态、任务中心、快照分支、向量分片、长篇检索、创作工作区、崩溃恢复和项目迁移回归测试全部通过。");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
