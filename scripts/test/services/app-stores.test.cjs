const assert = require("node:assert/strict");
const { test } = require("node:test");
require("../helpers/typescript-loader.cjs");
const { createAppStores, applyProjectState, readChapterDraft, isCurrentEpoch } = require("../../../src/stores/app-stores.ts");
function project(name, chapter = "one") { return { projectPath: name, selectedChapter: { id: chapter, title: name, volume: "卷一" }, chapterContent: name + "正文", chapterRevision: name + "修订", config: { ui: {} } }; }

test("状态域按App实例隔离，字段setter在更新后保持稳定", () => {
  const a = createAppStores(), b = createAppStores();
  const setter = a.chat.setters.chatMessages;
  setter([{ id: "a", content: "片段" }]);
  assert.deepEqual(b.chat.store.getState().chatMessages, []);
  assert.equal(a.chat.setters.chatMessages, setter);
  assert.equal(a.project.store.getState().dirty, false);
});
test("流式函数更新读最新状态，多次追加不丢片段", async () => {
  const stores = createAppStores();
  stores.chat.setters.chatMessages([{ id: "request", content: "" }]);
  await Promise.all(["一", "二", "三"].map(async (text) => {
    await Promise.resolve();
    stores.chat.setters.chatMessages((items) => items.map((item) => ({ ...item, content: item.content + text })));
  }));
  assert.equal(stores.chat.store.getState().chatMessages[0].content, "一二三");
});
test("草稿同步可读，保存中的新编辑不能被旧保存结果当成已保存", () => {
  const stores = createAppStores();
  applyProjectState(stores, project("A"));
  const saved = readChapterDraft(stores);
  stores.project.setters.chapterContent("保存期间的新内容");
  stores.project.setters.dirty(true);
  assert.notDeepEqual(readChapterDraft(stores), saved);
  assert.equal(stores.project.store.getState().dirty, true);
});
test("切项目清空会话和任务，旧项目异步结果失效，布局保留", () => {
  const stores = createAppStores(1180);
  applyProjectState(stores, project("A"));
  const epoch = stores.project.store.getState().projectEpoch;
  stores.chat.setters.activeAiRequestId("old-request");
  stores.chat.setters.chatMessages([{ id: "old", content: "A私有内容" }]);
  stores.tasks.setters.backgroundTasks([{ id: "A-task" }]);
  stores.layout.setters.leftWidth(310);
  applyProjectState(stores, project("B"));
  assert.equal(isCurrentEpoch(stores, epoch), false);
  assert.deepEqual(stores.chat.store.getState().chatMessages, []);
  assert.equal(stores.chat.store.getState().activeAiRequestId, "");
  assert.deepEqual(stores.tasks.store.getState().backgroundTasks, []);
  assert.equal(stores.layout.store.getState().leftWidth, 310);
  assert.equal(stores.project.store.getState().chapterRevision, "B修订");
});
test("同项目刷新不取消会话，切章后的草稿及修订指向新章节", () => {
  const stores = createAppStores();
  applyProjectState(stores, project("A", "one"));
  const epoch = stores.project.store.getState().projectEpoch;
  stores.chat.setters.activeChatSessionId("session");
  applyProjectState(stores, project("A", "two"));
  assert.equal(isCurrentEpoch(stores, epoch), true);
  assert.equal(stores.chat.store.getState().activeChatSessionId, "session");
  assert.equal(stores.project.store.getState().selectedChapter.id, "two");
  assert.equal(readChapterDraft(stores).content, "A正文");
});
