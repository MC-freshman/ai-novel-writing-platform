const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { domainProject, replace } = require("../helpers/domain-project.cjs");
const story = require("../../../electron/services/story-state.cjs");
const storage = require("../../../electron/services/project-storage.cjs");
const paths = require("../../../electron/services/story/dependencies.cjs");

test("本地分析提取证据、角色状态和伏笔，修订跟随原文", async (t) => {
  const { chapters, characters, contents } = await domainProject(t);
  const ledger = story.analyzeChapterLocally({
    chapter: chapters[0],
    content: contents[0],
    characters,
  });
  assert.equal(ledger.sourceRevision, storage.sha256(Buffer.from(contents[0])));
  assert.ok(ledger.facts.some((f) => f.type === "地点变化"));
  assert.ok(ledger.facts.some((f) => f.type === "知情变化"));
  assert.equal(
    story.analyzeChapterLocally({
      chapter: chapters[0],
      content: "李明获得铜钥匙。",
      characters,
    }).facts[0].type,
    "物品变化",
  );
  assert.ok(ledger.facts.some((f) => f.type === "关系变化"));
  assert.ok(
    ledger.characterStates.some(
      (s) => s.characterId === "li" && s.possessions.length,
    ),
  );
  assert.ok(ledger.foreshadows.length);
  for (const fact of ledger.facts)
    assert.ok(
      fact.evidence[0].quote && fact.evidence[0].chapterId === chapters[0].id,
    );
  assert.equal(
    story.analyzeChapterLocally({
      chapter: chapters[0],
      content: "<style>x</style><script>x</script><p>短句</p>",
    }).facts.length,
    0,
  );
});
test("AI结构化归一化过滤无证据事实并保留角色和伏笔阶段", async (t) => {
  const { chapters, characters } = await domainProject(t);
  const payload = {
    facts: [
      {
        subject: "李明",
        object: "进入圣城",
        evidence: ["李明进入圣城。"],
        confidence: 2,
      },
      { detail: "无证据编造" },
    ],
    characterStates: [
      {
        name: "李明",
        route: "圣城",
        physical: ["受伤"],
        relationships: ["同盟"],
        evidence: { text: "李明受伤。" },
        lastAppearancePosition: { start: 0, end: 7 },
      },
      { characterName: "未知角色", location: "城门" },
    ],
    foreshadows: ["埋设", "强化", "回收"].map((stage) => ({
      title: "神秘铜钥匙",
      detail: "钥匙出现",
      stage,
      evidence: [{ quote: "钥匙的线索。" }],
    })),
  };
  const ledger = story.normalizeAiChapterAnalysis(
    payload,
    chapters[0],
    "revision",
    characters,
  );
  assert.equal(ledger.facts.length, 1);
  assert.equal(ledger.facts[0].confidence, 1);
  assert.equal(ledger.characterStates[0].characterId, "li");
  assert.deepEqual(ledger.characterStates[0].route, ["圣城"]);
  assert.equal(ledger.foreshadows[1].reinforcedAt.length, 1);
  assert.equal(ledger.foreshadows[2].payoffAt.length, 1);
  assert.equal(
    story.normalizeAiChapterAnalysis({}, chapters[0], "revision").facts.length,
    0,
  );
});
test("剧情重新分析保留人工编辑和已确认历史，并标记过期证据", async (t) => {
  const { root, chapters, characters, contents } = await domainProject(t);
  const first = await story.saveChapterLedger(
    root,
    story.analyzeChapterLocally({
      chapter: chapters[0],
      content: contents[0],
      characters,
    }),
  );
  const fact = first.facts[0],
    clue = first.foreshadows[0];
  await story.updateFact(root, fact.id, {
    status: "已确认",
    object: "作者确认内容",
    userNote: "保留此项",
  });
  await story.updateForeshadow(root, clue.id, {
    status: "等待回收",
    plannedPayoff: "下一卷",
    relatedCharacters: ["李明"],
    plantedAt: [...clue.plantedAt, ...clue.plantedAt],
  });
  await story.saveChapterLedger(root, {
    ...first,
    facts: first.facts.map((f) => ({ ...f, object: "模型改写" })),
  });
  let overview = await story.getStoryOverview(root);
  assert.equal(
    overview.facts.find((f) => f.id === fact.id).object,
    "作者确认内容",
  );
  assert.equal(
    overview.foreshadows.find((f) => f.id === clue.id).plannedPayoff,
    "下一卷",
  );
  await story.saveChapterLedger(
    root,
    story.analyzeChapterLocally({
      chapter: chapters[0],
      content: "完全不同的原文。",
      characters,
    }),
  );
  overview = await story.getStoryOverview(root, {
    projectChapters: [{ id: chapters[0].id, revision: "newer" }],
  });
  assert.equal(overview.facts.find((f) => f.id === fact.id).stale, true);
  assert.equal(overview.foreshadows.find((f) => f.id === clue.id).stale, true);
  assert.deepEqual(overview.coverage.stale, [chapters[0].id]);
  await assert.rejects(story.updateFact(root, "missing"), /没有找到/);
  await assert.rejects(story.updateForeshadow(root, "missing"), /没有找到/);
});
test("人工事实和伏笔CRUD、过滤分页及自动条目删除保护", async (t) => {
  const { root, chapters } = await domainProject(t);
  await assert.rejects(story.createManualFact(root, {}), /填写/);
  await assert.rejects(
    story.createManualForeshadow(root, { title: "缺内容" }),
    /填写/,
  );
  const fact = await story.createManualFact(root, {
    chapterId: chapters[0].id,
    chapterTitle: chapters[0].title,
    volume: "卷一",
    subject: "李明",
    object: "守卫与钥匙有关",
  });
  const clue = await story.createManualForeshadow(root, {
    chapterId: chapters[0].id,
    volume: "卷一",
    title: "城门钥匙",
    description: "铜钥匙打开城门",
    relatedCharacters: ["李明"],
  });
  assert.equal(
    (
      await story.updateFact(root, fact.id, {
        status: "无效",
        predicate: "知道",
      })
    ).status,
    "已确认",
  );
  assert.equal(
    (
      await story.updateForeshadow(root, clue.id, {
        status: "已经回收",
        payoffAt: [{ quote: "城门打开。", start: "invalid" }],
      })
    ).payoffAt[0].start,
    -1,
  );
  const overview = await story.getStoryOverview(root, {
    chapterIds: [chapters[0].id],
    volume: "卷一",
    query: "钥匙",
    factStatus: "已确认",
    foreshadowStatus: "已经回收",
    factLimit: 1,
  });
  assert.equal(overview.facts.length, 1);
  assert.equal(overview.foreshadows.length, 1);
  assert.equal(overview.pageInfo.facts.limit, 20);
  assert.equal(
    (await story.getStoryOverview(root, { factOffset: 1 })).facts.length,
    0,
  );
  assert.equal((await story.deleteFact(root, fact.id)).removed, true);
  await assert.rejects(story.deleteFact(root, "automatic"), /不能直接删除/);
  assert.equal((await story.deleteForeshadow(root, clue.id)).removed, true);
  assert.equal((await story.deleteForeshadow(root, "absent")).removed, false);
  const ledger = story.normalizeAiChapterAnalysis(
    {
      foreshadows: [
        { title: "自动伏笔", description: "不能删除", evidence: ["合成证据"] },
      ],
    },
    chapters[0],
    "rev",
  );
  await story.saveChapterLedger(root, ledger);
  await assert.rejects(
    story.deleteForeshadow(root, ledger.foreshadows[0].id),
    /不能直接删除/,
  );
});
test("同项目并发人工记录不丢项，多章节索引全部保留", async (t) => {
  const { root, chapters, contents, characters } = await domainProject(t);
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      story.createManualFact(root, { object: `并发事实-${i}` }),
    ),
  );
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      story.createManualForeshadow(root, {
        title: `并发线索-${i}`,
        description: `证据-${i}`,
      }),
    ),
  );
  await Promise.all(
    chapters.map((chapter, i) =>
      story.saveChapterLedger(
        root,
        story.analyzeChapterLocally({
          chapter,
          content: contents[i],
          characters,
        }),
      ),
    ),
  );
  const overview = await story.getStoryOverview(root);
  assert.equal(overview.facts.filter((f) => f.origin === "manual").length, 8);
  assert.equal(
    overview.foreshadows.filter((f) => f.origin === "manual").length,
    8,
  );
  assert.equal(overview.chapterEntries.length, 3);
});
test("剧情账本多文件写入失败回滚，重试可正常分析", async (t) => {
  const { root, chapters, contents, characters } = await domainProject(t);
  const before = await story.saveChapterLedger(
    root,
    story.analyzeChapterLocally({
      chapter: chapters[0],
      content: contents[0],
      characters,
    }),
  );
  const files = [
    paths.getLedgerPath(root, chapters[0].id),
    paths.getForeshadowsPath(root),
    paths.getStoryIndexPath(root),
  ];
  const original = await Promise.all(files.map((f) => fs.readFile(f, "utf8")));
  const rename = fs.rename;
  let injected = false;
  replace(t, fs, "rename", async (from, to) => {
    if (to === paths.getForeshadowsPath(root) && !injected) {
      injected = true;
      throw Object.assign(new Error("合成磁盘故障"), { code: "EIO" });
    }
    return rename(from, to);
  });
  await assert.rejects(
    story.saveChapterLedger(root, {
      ...before,
      sourceRevision: "changed",
      facts: [],
    }),
    /合成磁盘故障/,
  );
  assert.deepEqual(
    await Promise.all(files.map((f) => fs.readFile(f, "utf8"))),
    original,
  );
  await story.saveChapterLedger(root, before);
  assert.equal((await story.getStoryOverview(root)).chapterEntries.length, 1);
});
test("跨章节同标题伏笔合并强化回收，人工条目优先", async (t) => {
  const { root, chapters } = await domainProject(t);
  const manual = await story.createManualForeshadow(root, {
    title: "神秘铜钥匙",
    description: "作者的设定",
  });
  for (const [i, stage] of ["埋设", "强化", "回收"].entries())
    await story.saveChapterLedger(
      root,
      story.normalizeAiChapterAnalysis(
        {
          foreshadows: [
            {
              title: "神秘铜钥匙",
              description: "模型线索",
              stage,
              evidence: ["钥匙出现。"],
            },
          ],
        },
        chapters[i],
        `r${i}`,
      ),
    );
  const clues = (await story.getStoryOverview(root)).foreshadows;
  assert.equal(clues.length, 1);
  assert.equal(clues[0].id, manual.id);
  assert.equal(clues[0].description, "作者的设定");
  assert.equal(clues[0].reinforcedAt.length, 1);
  assert.equal(clues[0].payoffAt.length, 1);
});
test("筹备板生成保留锁定项，上下文包含手工指定事实和人物", async (t) => {
  const { root, chapters, characters, contents } = await domainProject(t);
  await story.saveChapterLedger(
    root,
    story.analyzeChapterLocally({
      chapter: chapters[0],
      content: contents[0],
      characters,
    }),
  );
  let board = await story.generateLocalBoard(root, chapters[0], chapters[1]);
  board.items[0] = { ...board.items[0], locked: true, title: "作者锁定目标" };
  await story.saveBoard(root, board);
  board = await story.generateLocalBoard(root, chapters[0], null);
  assert.equal(board.items[0].title, "作者锁定目标");
  assert.equal(board.targetChapterTitle, "下一章");
  assert.equal((await story.listBoards(root)).length, 1);
  assert.equal((await story.getBoard(root, chapters[0].id)).id, board.id);
  await assert.rejects(story.saveBoard(root, {}), /缺少/);
  const fact = await story.createManualFact(root, {
    chapterId: chapters[1].id,
    object: "跨章节指定事实",
  });
  const overview = await story.getStoryOverview(root, {
    query: "李明",
    chapterIds: [chapters[0].id],
    volume: "卷一",
  });
  assert.equal(overview.characterStates[0].characterId, "li");
  const context = await story.getAgentContext(
    root,
    chapters[0].id,
    ["李明"],
    [fact.id, "li", overview.characterStates[0].latest.id],
  );
  assert.equal(context.facts[0].id, fact.id);
  assert.equal(context.characterStates[0].characterId, "li");
  assert.ok(context.foreshadows.length);
  await fs.writeFile(
    path.join(paths.getBoardsDir(root), "bad.json"),
    "{broken",
  );
  assert.equal((await story.listBoards(root)).length, 1);
});
test("移除章节删除关联事实、角色状态和伏笔，重复移除安全", async (t) => {
  const { root, chapters, characters, contents } = await domainProject(t);
  for (const [i, chapter] of chapters.entries())
    await story.saveChapterLedger(
      root,
      story.analyzeChapterLocally({
        chapter,
        content: contents[i],
        characters,
      }),
    );
  await story.createManualFact(root, {
    chapterId: chapters[0].id,
    object: "删除关联",
  });
  await story.removeChapterLedger(root, chapters[0].id);
  let overview = await story.getStoryOverview(root, {
    projectChapters: chapters,
  });
  assert.equal(overview.chapterEntries.length, 2);
  assert.ok(!overview.facts.some((f) => f.chapterId === chapters[0].id));
  assert.ok(
    overview.characterStates.every((r) =>
      r.states.every((s) => s.chapterId !== chapters[0].id),
    ),
  );
  await story.removeChapterLedger(root, chapters[0].id);
  await story.removeChapterLedger(root, chapters[1].id);
  overview = await story.getStoryOverview(root);
  assert.equal(overview.characterStates.length, 0);
});
