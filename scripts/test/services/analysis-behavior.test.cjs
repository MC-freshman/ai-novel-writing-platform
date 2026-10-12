const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { test } = require("node:test");
const {
  domainProject,
  replace,
  control,
} = require("../helpers/domain-project.cjs");
const analysis = require("../../../electron/services/analysis-tools.cjs");
const ai = require("../../../electron/services/ai-generate.cjs");
const files = require("../../../electron/services/project-files.cjs");
const credentials = require("../../../electron/services/credentials.cjs");
const story = require("../../../electron/services/story-state.cjs");

function model(t, config, answer) {
  replace(t, ai, "buildStructuringMaterials", async () => ({
    config,
    search: { chunks: [{ id: "synthetic" }] },
    retrieved: "合成检索材料",
    corpus: "合成正文",
  }));
  replace(
    t,
    ai,
    "callStructuredChatWithProgress",
    async (_config, _prompt, _question, ctl) => {
      ctl?.throwIfCanceled?.();
      return answer;
    },
  );
}
test("分析快照并发合并、重启读取与写入失败保护", async (t) => {
  const { root } = await domainProject(t);
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      analysis.saveAnalysisState(root, { [`field${i}`]: i }),
    ),
  );
  const snapshot = await analysis.loadAnalysisState(root);
  for (let i = 0; i < 8; i++) assert.equal(snapshot[`field${i}`], i);
  const rename = fs.rename;
  let failed = false;
  replace(t, fs, "rename", async (from, to) => {
    if (to === files.getAnalysisStatePath(root) && !failed) {
      failed = true;
      throw Object.assign(new Error("合成分析状态写入失败"), { code: "EIO" });
    }
    return rename(from, to);
  });
  await assert.rejects(
    analysis.saveAnalysisState(root, { field0: "lost" }),
    /合成分析状态写入失败/,
  );
  assert.deepEqual(await analysis.loadAnalysisState(root), snapshot);
  await analysis.saveIssueStatuses(root, {
    one: { status: "已修复", updatedAt: "synthetic" },
  });
  assert.equal(
    analysis.applyIssueStatuses(
      [{ id: "one" }, { id: "two" }],
      await analysis.loadIssueStatuses(root),
    )[0].status,
    "已修复",
  );
  await fs.writeFile(files.getAnalysisStatePath(root), "[]");
  assert.deepEqual(await analysis.loadAnalysisState(root), {});
  await fs.writeFile(files.getIssueStatusPath(root), "null");
  assert.deepEqual(await analysis.loadIssueStatuses(root), {});
});
test("搜索跨正文、角色与设定，空查询和片段边界", async (t) => {
  const { root } = await domainProject(t);
  assert.deepEqual(analysis.queryTokens("  KEY key  "), ["key key", "key"]);
  assert.deepEqual(analysis.queryTokens(null), []);
  assert.equal((await analysis.globalSearch(root, "   ")).results.length, 0);
  const result = await analysis.globalSearch(root, "圣城");
  assert.equal(result.results[0].sourceType, "world");
  assert.ok(result.results.some((r) => r.sourceType === "chapter"));
  assert.equal(
    (await analysis.globalSearch(root, "李明")).results.some(
      (r) => r.sourceType === "character",
    ),
    true,
  );
  assert.equal(analysis.makeSearchSnippet("", ["key"]), "");
  assert.match(
    analysis.makeSearchSnippet("a".repeat(170) + "KEY" + "b".repeat(200), [
      "key",
    ]),
    /^\.\.\..*KEY.*\.\.\.$/,
  );
  assert.match(
    analysis.makeSearchSnippet("完全没有目标词", ["absent"]),
    /完全没有/,
  );
});
test("本地时间线尊重范围，使用时间词、小标题或首段回退", async (t) => {
  const { root, chapters } = await domainProject(t);
  assert.deepEqual(analysis.extractTimeHints("清晨、清晨、翌日、三年后"), [
    "清晨",
    "翌日",
    "三年后",
  ]);
  const scoped = await analysis.buildTimelineEvents(root, {
    chapterIds: [chapters[0].id],
    knowledgeSourceIds: ["city"],
  });
  assert.ok(scoped.events.every((e) => e.chapterId === chapters[0].id));
  assert.equal(scoped.options.mode, "local");
  const all = await analysis.buildTimelineEvents(root);
  assert.ok(all.events.some((e) => e.title === "前往城门"));
  const config = await files.readJson(files.getConfigPath(root));
  config.chapters[2].outline = [];
  await files.writeJson(files.getConfigPath(root), config);
  assert.ok(
    (
      await analysis.buildTimelineEvents(root, { chapterIds: [chapters[2].id] })
    ).events[0].summary.includes("合成段落"),
  );
  await fs.rm(files.getChapterPath(root, chapters[2]));
  assert.equal(
    (await analysis.buildTimelineEvents(root, { chapterIds: [chapters[2].id] }))
      .events.length,
    0,
  );
});
test("AI时间线排序归一化、成功、无事件及取消", async (t) => {
  const { root, chapters, config } = await domainProject(t);
  const events = analysis.normalizeTimelinePayload(
    {
      events: [
        { order: 7, chapterTitle: "第1章", summary: "李明进入圣城" },
        { order: 2, chapterTitle: "未知章节", detail: "王华返回" },
        { title: "无正文" },
      ],
    },
    chapters,
    ["李明", "王华"],
  );
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((e) => e.order),
    [0, 1],
  );
  assert.equal(events[1].characters[0], "李明");
  assert.equal(
    analysis.normalizeTimelinePayload(
      { events: [{ summary: "独立事件" }] },
      [],
      [],
    ).length,
    1,
  );
  model(
    t,
    config,
    JSON.stringify({
      events: [
        { title: "入城", summary: "李明进入圣城", chapterTitle: "第1章" },
      ],
    }),
  );
  assert.equal(
    (await analysis.buildAiTimelineEvents(root, {}, control())).contextCount,
    1,
  );
  ai.callStructuredChatWithProgress = async () => "{}";
  await assert.rejects(analysis.buildAiTimelineEvents(root), /没有返回/);
  ai.callStructuredChatWithProgress = async (_c, _p, _q, ctl) => {
    ctl.throwIfCanceled();
    return "{}";
  };
  const canceled = control();
  canceled.controller.abort();
  await assert.rejects(analysis.buildAiTimelineEvents(root, {}, canceled), {
    name: "AbortError",
  });
});
test("关系网合并同场和卡片关系，范围过滤及证据限额", async (t) => {
  const { root } = await domainProject(t);
  const edges = new Map();
  analysis.addRelationEdge(edges, "李明", "李明", 3, "self", "ignored");
  analysis.addRelationEdge(edges, "", "王华", 1, "", "ignored");
  for (let i = 0; i < 5; i++)
    analysis.addRelationEdge(
      edges,
      "李明",
      "王华",
      1,
      i % 2 ? "同盟" : "同场",
      `证据${i}`,
    );
  assert.equal(edges.size, 1);
  assert.equal([...edges.values()][0].evidence.length, 3);
  const graph = await analysis.buildRelationshipGraph(root, {
    categoryFilter: "主角",
    relationTypes: ["同盟", "合作"],
  });
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.ok(graph.edges[0].weight >= 8);
  assert.equal(
    (await analysis.buildRelationshipGraph(root, { characterNames: ["李明"] }))
      .edges.length,
    0,
  );
  assert.equal(
    (await analysis.buildRelationshipGraph(root, { categoryFilter: "不存在" }))
      .nodes.length,
    0,
  );
});
test("本地一致性检查发现短文、重复标题和空卡，来源过滤", async (t) => {
  const { root, config } = await domainProject(t);
  config.chapters[1].title = config.chapters[0].title;
  config.chapters[1].wordCount = 0;
  await files.writeJson(files.getConfigPath(root), config);
  for (const id of ["short1", "short2"])
    await files.writeWorldDoc(root, {
      id,
      title: "重复设定",
      category: "设定",
      fileName: id + ".md",
      content: "# 重复设定\n短",
      updatedAt: new Date().toISOString(),
    });
  const issues = await analysis.buildLocalConsistencyIssues(root);
  for (const prefix of [
    "local_short_",
    "local_duplicate_",
    "local_empty_character_",
    "local_short_world_",
    "local_duplicate_world_",
  ])
    assert.ok(
      issues.some((i) => i.id.startsWith(prefix)),
      prefix,
    );
  const selected = await analysis.buildLocalConsistencyIssues(root, {
    chapterIds: ["c2"],
    knowledgeSourceIds: ["city"],
  });
  assert.equal(selected.length, 0);
  assert.equal(
    analysis.normalizeConsistencyIssues({
      issues: [
        { title: "缺正文" },
        {
          title: "问题",
          detail: "原文矛盾",
          severity: "invalid",
          evidence: ["证据", ""],
        },
      ],
    }).length,
    1,
  );
});
test("一致性AI成功、去重、失败回退以及人工状态保留", async (t) => {
  const { root, config } = await domainProject(t);
  const item = {
    title: "矛盾",
    detail: "合成前后冲突",
    severity: "高",
    category: "世界观",
    evidence: ["合成证据"],
  };
  const issue = analysis.normalizeConsistencyIssues({ issues: [item] })[0];
  await analysis.saveIssueStatuses(root, { [issue.id]: { status: "已确认" } });
  model(t, config, JSON.stringify({ issues: [item, item] }));
  let result = await analysis.analyzeConsistency(
    root,
    { chapterIds: ["c0"] },
    control(),
  );
  assert.equal(result.issues.filter((i) => i.title === "矛盾").length, 1);
  assert.equal(result.issues[0].status, "已确认");
  ai.callStructuredChatWithProgress = async () => {
    throw new Error("合成网络失败");
  };
  result = await analysis.analyzeConsistency(root);
  assert.match(result.apiError, /合成网络失败/);
  assert.ok(result.issues.some((i) => i.id === "local_empty_character_empty"));
});
test("一致性取消传播AbortError，不把取消保存成检查结果", async (t) => {
  const { root, config } = await domainProject(t);
  model(t, config, "{}");
  const ctl = control();
  ctl.controller.abort();
  await assert.rejects(analysis.analyzeConsistency(root, {}, ctl), {
    name: "AbortError",
  });
});
test("世界观候选标题匹配、选择范围、模型无效及成功", async (t) => {
  const { root, config } = await domainProject(t);
  assert.equal(analysis.normalizeComparableTitle("《圣城：月港》"), "月港");
  assert.equal(analysis.findSimilarWorldDoc("", [{ title: "月港" }]), null);
  assert.equal(
    analysis.findSimilarWorldDoc("月港", [{ id: "one", title: "月港旧城" }]),
    null,
  );
  assert.equal(
    analysis.findSimilarWorldDoc("月港旧城", [{ id: "one", title: "月港" }]),
    null,
  );
  assert.equal(
    analysis.findSimilarWorldDoc("月港城区", [{ id: "one", title: "月港城区" }])
      .id,
    "one",
  );
  assert.equal(
    analysis.normalizeExtractedWorldCards({
      cards: [
        { name: "空白" },
        {
          name: "月港",
          type: "地点",
          category: "城市",
          description: "海港城市",
        },
      ],
    }).length,
    1,
  );
  assert.match(
    (await analysis.buildExtractionMaterials(root, { text: "<p>合成选文</p>" }))
      .corpus,
    /合成选文/,
  );
  assert.equal(
    (
      await analysis.buildExtractionMaterials(root, {
        scope: "chapter",
        chapterId: "c0",
      })
    ).search.embeddingSource,
    "local",
  );
  await assert.rejects(
    analysis.buildExtractionMaterials(root, {
      scope: "chapter",
      chapterId: "missing",
    }),
    /请选择/,
  );
  replace(t, ai, "buildStructuringMaterials", async () => ({
    config,
    search: { chunks: [] },
    corpus: "合成全书",
    retrieved: "",
  }));
  assert.equal(
    (await analysis.buildExtractionMaterials(root)).corpus,
    "合成全书",
  );
  replace(t, ai, "callChatApi", async () =>
    JSON.stringify({
      worldDocs: [
        { title: "圣城", type: "地点", content: "合成新证据" },
        { title: "铜钥匙", type: "物品", content: "铜制钥匙" },
      ],
    }),
  );
  const result = await analysis.prepareWorldCardCandidates(root, {
    scope: "chapter",
    chapterId: "c0",
  });
  assert.equal(result.candidates[0].action, "merge");
  assert.equal(result.candidates[1].action, "create");
  ai.callChatApi = async () => "{}";
  await assert.rejects(
    analysis.prepareWorldCardCandidates(root, { text: "合成选文" }),
    /没有生成/,
  );
});
test("世界观批量保存新增、合并和排除未选条目", async (t) => {
  const { root } = await domainProject(t);
  await assert.rejects(analysis.saveWorldCardCandidates(root, []), /至少勾选/);
  const result = await analysis.saveWorldCardCandidates(root, [
    {
      title: "圣城",
      matchedDocId: "city",
      action: "merge",
      content: "# 圣城\n\n新增城门证据",
      category: "地点/城市",
    },
    {
      title: "铜钥匙",
      content: "# 铜钥匙\n\n开启城门的钥匙",
      category: "物品",
    },
    { title: "跳过", selected: false, content: "不写入" },
  ]);
  assert.equal(result.created, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.count, 2);
  const docs = await files.loadWorldDocs(root);
  assert.equal(docs.length, 2);
  assert.match(
    docs.find((d) => d.id === "city").content,
    /守卫驻地[\s\S]*新增城门证据/,
  );
});
test("剧情分析本地降级、AI流式成功、结构回退、失败和取消保护", async (t) => {
  const { root, chapters } = await domainProject(t);
  await assert.rejects(
    analysis.refreshLocalStoryState(root, "missing"),
    /章节不存在/,
  );
  await assert.rejects(
    analysis.analyzeStoryStateWithAI(root, "missing"),
    /章节不存在/,
  );
  let result = await analysis.analyzeStoryStateWithAI(root, chapters[0].id);
  assert.equal(result.ledger.analysisMode, "local");
  assert.match(result.apiError, /未配置/);
  replace(t, credentials, "runtimeSecret", () => "synthetic-only");
  replace(
    t,
    ai,
    "callChatApi",
    async (_config, _prompt, _question, _history, options) => {
      options.onToken("合成片段");
      return JSON.stringify({
        facts: [{ object: "李明入城", evidence: ["李明进入圣城。"] }],
      });
    },
  );
  const ctl = control();
  result = await analysis.analyzeStoryStateWithAI(root, "c0", ctl);
  assert.equal(result.ledger.analysisMode, "ai");
  assert.ok(ctl.updates.some((p) => p.partialOutput === "合成片段"));
  ai.callChatApi = async () => "{}";
  result = await analysis.analyzeStoryStateWithAI(root, "c0");
  assert.equal(result.ledger.analysisMode, "local");
  assert.match(result.apiError, /无法识别/);
  const before = await story.getStoryOverview(root);
  ai.callChatApi = async () => {
    throw new Error("合成API失败");
  };
  await assert.rejects(
    analysis.analyzeStoryStateWithAI(root, "c0"),
    /合成API失败/,
  );
  ai.callChatApi = async (_c, _p, _q, _h, options) => {
    assert.ok(options.signal.aborted);
    throw Object.assign(new Error("停止"), { name: "AbortError" });
  };
  const aborted = control();
  aborted.controller.abort();
  await assert.rejects(analysis.analyzeStoryStateWithAI(root, "c0", aborted), {
    name: "AbortError",
  });
  assert.deepEqual(
    (await story.getStoryOverview(root)).chapterEntries,
    before.chapterEntries,
  );
  assert.equal(
    (await analysis.getStoryOverviewForProject(root)).coverage.total,
    chapters.length,
  );
  await analysis.refreshLocalStoryState(root, "c1", "李明决定寻找出口。");
});
