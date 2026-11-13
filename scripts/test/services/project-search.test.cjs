"use strict";
// 全书搜索替换测试（P76）：字面匹配/预览基线/执行/冲突即停/快照保护/部分选择。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture } = require("../helpers/service-fixture.cjs");
const projectSearch = require("../../../electron/services/project-search.cjs");
const { getChapterPath, contentRevision } = require("../../../electron/services/project-files.cjs");
const { listSnapshots } = require("../../../electron/services/project-snapshots.cjs");

async function makeProject(root, chapters) {
  const project = path.join(root, "project");
  await fs.mkdir(path.join(project, "chapters"), { recursive: true });
  const now = new Date().toISOString();
  const config = {
    version: 1, title: "替换验证", author: "t", createdAt: now, updatedAt: now,
    api: { provider: "deepseek", apiKey: "", baseUrl: "", chatModel: "", embeddingProvider: "", embeddingApiKey: "", embeddingBaseUrl: "", embeddingModel: "", temperature: 0.7, maxTokens: 2048, topK: 5, scanK: 50, sendFullText: false },
    ui: { theme: "light", fontSize: 16, lineHeight: 1.8, autosaveMs: 2000, backupOnSave: true, recoveryEnabled: true },
    agent: { autoLocalAnalysis: false, autoDeepAnalysis: false, evidenceRequired: true, snapshotBeforeBulkChanges: true, permissionLevel: "只读分析" },
    stats: { todayDate: "", todayWords: 0, totalWords: 0, lastAutoBackupAt: "" },
    chapters: chapters.map((chapter, index) => ({ id: `ch_${index}`, title: chapter.title, fileName: chapter.fileName, order: index, volume: "卷一", knowledgeRole: "正文", wordCount: 10, contentRevision: "", updatedAt: now })),
  };
  await fs.writeFile(path.join(project, "novel.config.json"), JSON.stringify(config));
  for (const chapter of chapters)
    await fs.writeFile(path.join(project, "chapters", chapter.fileName), chapter.content);
  return project;
}

test("findMatches：字面/大小写/整词边界", () => {
  const text = "林风走了。林风又回来。linfeng 是拼音。小林风来了。";
  const all = projectSearch.findMatches(text, "林风", {});
  assert.equal(all.length, 3);
  const ci = projectSearch.findMatches("ABC abc Abc", "abc", {});
  assert.equal(ci.length, 3);
  const cs = projectSearch.findMatches("ABC abc Abc", "abc", { caseSensitive: true });
  assert.equal(cs.length, 1);
  const whole = projectSearch.findMatches("cat category cat.", "cat", { wholeWord: true });
  assert.equal(whole.length, 2, "整词按 ASCII 词边界");
  assert.deepEqual(projectSearch.findMatches(text, "", {}), []);
});

test("searchBook：分组/上下文/空词拒绝", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, [
    { title: "第一章", fileName: "c1.md", content: "林风推开门。门外下雨，林风叹了口气。" },
    { title: "第二章", fileName: "c2.md", content: "没有人。" },
  ]);
  const result = await projectSearch.searchBook(project, { query: "林风" });
  assert.equal(result.totalMatches, 2);
  assert.equal(result.chapters.length, 1);
  assert.equal(result.chapters[0].chapterId, "ch_0");
  assert.ok(result.chapters[0].matches[0].context.includes("推开门"));
  await assert.rejects(() => projectSearch.searchBook(project, { query: "  " }), /搜索词/);
});

test("buildReplacePlan：revision 基线/章节过滤/无命中拒绝", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, [
    { title: "第一章", fileName: "c1.md", content: "林风来了。林风走了。" },
    { title: "第二章", fileName: "c2.md", content: "林风笑了。" },
  ]);
  const plan = await projectSearch.buildReplacePlan(project, { query: "林风", replacement: "陆远" });
  assert.equal(plan.totalOccurrences, 3);
  assert.equal(plan.chapters.length, 2);
  const raw = await fs.readFile(getChapterPath(project, { fileName: "c1.md" }), "utf8");
  assert.equal(plan.chapters[0].revision, contentRevision(raw));
  const filtered = await projectSearch.buildReplacePlan(project, { query: "林风", replacement: "陆远", chapterIds: ["ch_1"] });
  assert.equal(filtered.chapters.length, 1);
  await assert.rejects(() => projectSearch.buildReplacePlan(project, { query: "不存在", replacement: "x" }), /没有可替换的命中/);
});

test("executeReplace：全量替换/快照/版本历史/部分选择/删除", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, [
    { title: "第一章", fileName: "c1.md", content: "林风来了。林风走了。" },
    { title: "第二章", fileName: "c2.md", content: "林风笑了。" },
  ]);
  const plan = await projectSearch.buildReplacePlan(project, { query: "林风", replacement: "陆远" });
  const expectedRevisions = Object.fromEntries(plan.chapters.map((chapter) => [chapter.chapterId, chapter.revision]));
  const result = await projectSearch.executeReplace(project, {
    query: "林风", replacement: "陆远",
    selections: plan.chapters.map((chapter) => ({ chapterId: chapter.chapterId })),
    expectedRevisions,
  });
  assert.equal(result.totalReplaced, 3);
  assert.ok(result.snapshotId, "须创建替换前快照");
  const { snapshots } = await listSnapshots(project);
  assert.ok(snapshots.some((snapshot) => snapshot.id === result.snapshotId));
  const first = await fs.readFile(getChapterPath(project, { fileName: "c1.md" }), "utf8");
  assert.equal(first, "陆远来了。陆远走了。");
  const second = await fs.readFile(getChapterPath(project, { fileName: "c2.md" }), "utf8");
  assert.equal(second, "陆远笑了。");
  // 部分选择：只替换第一处
  const plan2 = await projectSearch.buildReplacePlan(project, { query: "陆远", replacement: "林风" });
  const result2 = await projectSearch.executeReplace(project, {
    query: "陆远", replacement: "林风",
    selections: [{ chapterId: "ch_0", occurrenceIndices: [0] }],
    expectedRevisions: Object.fromEntries(plan2.chapters.map((chapter) => [chapter.chapterId, chapter.revision])),
  });
  assert.equal(result2.totalReplaced, 1);
  const firstAgain = await fs.readFile(getChapterPath(project, { fileName: "c1.md" }), "utf8");
  assert.equal(firstAgain, "林风来了。陆远走了。");
  // 删除（替换为空）
  const plan3 = await projectSearch.buildReplacePlan(project, { query: "陆远", replacement: "" });
  await projectSearch.executeReplace(project, {
    query: "陆远", replacement: "",
    selections: [{ chapterId: "ch_0" }],
    expectedRevisions: Object.fromEntries(plan3.chapters.map((chapter) => [chapter.chapterId, chapter.revision])),
  });
  const deleted = await fs.readFile(getChapterPath(project, { fileName: "c1.md" }), "utf8");
  assert.equal(deleted, "林风来了。走了。");
  await assert.rejects(() => projectSearch.executeReplace(project, { query: "x", replacement: "y", selections: [] }), /没有选择/);
});

test("executeReplace：预览后冲突即停，先前章节回滚", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, [
    { title: "第一章", fileName: "c1.md", content: "林风来了。" },
    { title: "第二章", fileName: "c2.md", content: "林风走了。" },
  ]);
  const plan = await projectSearch.buildReplacePlan(project, { query: "林风", replacement: "陆远" });
  const expectedRevisions = Object.fromEntries(plan.chapters.map((chapter) => [chapter.chapterId, chapter.revision]));
  // 预览后外部修改第二章
  await fs.writeFile(getChapterPath(project, { fileName: "c2.md" }), "林风走了。外部修改。");
  await assert.rejects(() => projectSearch.executeReplace(project, {
    query: "林风", replacement: "陆远",
    selections: plan.chapters.map((chapter) => ({ chapterId: chapter.chapterId })),
    expectedRevisions,
  }), /已停止替换/);
  const first = await fs.readFile(getChapterPath(project, { fileName: "c1.md" }), "utf8");
  assert.equal(first, "林风来了。", "冲突时先前章节须回滚不变");
});
test("P92 正则：安全拒绝/匹配/替换模板", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, [
    { title: "第一章", fileName: "c1.md", content: "林风来了。林风走了。陆远笑了。" },
  ]);
  // 嵌套量词拒绝
  await assert.rejects(() => projectSearch.searchBook(project, { query: "(a+)+b", useRegex: true }), /灾难性回溯/);
  await assert.rejects(() => projectSearch.searchBook(project, { query: "[", useRegex: true }), /正则无效/);
  // 正则匹配
  const result = await projectSearch.searchBook(project, { query: "林.", useRegex: true });
  assert.equal(result.totalMatches, 2);
  // 正则替换 + 捕获组模板
  const plan = await projectSearch.buildReplacePlan(project, { query: "(林|陆)(风|远)", replacement: "$1$2【改】", useRegex: true });
  assert.equal(plan.totalOccurrences, 3);
  const exec = await projectSearch.executeReplace(project, {
    query: "(林|陆)(风|远)", replacement: "$1$2【改】", useRegex: true,
    selections: plan.chapters.map((chapter) => ({ chapterId: chapter.chapterId })),
    expectedRevisions: Object.fromEntries(plan.chapters.map((chapter) => [chapter.chapterId, chapter.revision])),
  });
  assert.equal(exec.totalReplaced, 3);
  const content = await fs.readFile(getChapterPath(project, { fileName: "c1.md" }), "utf8");
  assert.ok(content.includes("林风【改】"));
  assert.ok(content.includes("陆远【改】"));
});

test("P92 卡片替换：角色字段与世界设定", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, [{ title: "第一章", fileName: "c1.md", content: "正文无命中。" }]);
  const { saveCharacterHelper, saveWorldHelper } = (() => {
    const { getCharacterPath, writeWorldDoc, writeJson } = require("../../../electron/services/project-files.cjs");
    return {
      saveCharacterHelper: async (card) => writeJson(getCharacterPath(project, card), card),
      saveWorldHelper: async (doc) => writeWorldDoc(project, doc),
    };
  })();
  await saveCharacterHelper({ id: "char_0", name: "林风", category: "未分类", appearance: "林风穿黑衣", personality: "沉稳", background: "", relationships: "", notes: "", fileName: "char_0.json", updatedAt: "" });
  await saveWorldHelper({ id: "world_0", title: "林风城", category: "未分类", fileName: "world_0.md", content: "林风城很大。", updatedAt: "" });
  const result = await projectSearch.searchBook(project, { query: "林风", scope: "all" });
  assert.ok(result.cards.length >= 2);
  const plan = await projectSearch.buildReplacePlan(project, { query: "林风", replacement: "陆远", scope: "cards" });
  assert.ok(plan.cards.length >= 2);
  const exec = await projectSearch.executeReplace(project, {
    query: "林风", replacement: "陆远", scope: "cards",
    cardSelections: plan.cards.map((card) => ({ cardType: card.cardType, cardId: card.cardId })),
  });
  assert.ok(exec.totalReplaced >= 3);
  assert.ok(exec.cardResults.length >= 2);
  const { loadCharacters, loadWorldDocs } = require("../../../electron/services/project-files.cjs");
  const characters = await loadCharacters(project);
  assert.equal(characters.find((item) => item.id === "char_0").name, "陆远");
  assert.ok(characters.find((item) => item.id === "char_0").appearance.includes("陆远"));
  const worlds = await loadWorldDocs(project);
  assert.ok(worlds.find((item) => item.id === "world_0").content.includes("陆远城"));
});

test("P93 后台任务分发：book-replace", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, [{ title: "第一章", fileName: "c1.md", content: "林风来了。" }]);
  const { executeBackgroundTask } = require("../../../electron/services/tasks/execution.cjs");
  const plan = await projectSearch.buildReplacePlan(project, { query: "林风", replacement: "陆远" });
  const updates = [];
  const control = { update: async (patch) => { updates.push(patch); }, isCanceled: () => false, signal: new AbortController().signal };
  const result = await executeBackgroundTask(project, {
    type: "book-replace",
    options: { replacePayload: { query: "林风", replacement: "陆远", selections: plan.chapters.map((chapter) => ({ chapterId: chapter.chapterId })), expectedRevisions: Object.fromEntries(plan.chapters.map((chapter) => [chapter.chapterId, chapter.revision])) } },
  }, control);
  assert.equal(result.totalReplaced, 1);
  assert.ok(updates.some((patch) => patch.phase === "替换完成"));
  // 取消即停
  const canceledControl = { update: async () => {}, isCanceled: () => true, signal: new AbortController().signal };
  await assert.rejects(() => executeBackgroundTask(project, { type: "book-replace", options: { replacePayload: { query: "林风", replacement: "x", selections: [{ chapterId: "ch_0" }] } } }, canceledControl), /任务已停止/);
});
