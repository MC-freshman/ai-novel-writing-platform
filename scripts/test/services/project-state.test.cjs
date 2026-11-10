const assert = require("node:assert/strict");
const test = require("node:test");
const { fixture } = require("../helpers/service-fixture.cjs");
const projectConfig = require("../../../electron/services/project-config.cjs");
const projectState = require("../../../electron/services/project-state.cjs");

test("buildAppStateUnlocked 返回章节、配置和向量统计，并写入字数统计", async (t) => {
  const project = await fixture(t);
  await projectConfig.ensureProjectStructureUnlocked(project, "项目状态测试");
  const state = await projectState.buildAppStateUnlocked(project);
  assert.equal(state.projectPath, project);
  assert.equal(state.config.title, "项目状态测试");
  assert.equal(state.chapters.length, 1);
  assert.equal(state.selectedChapter?.id, state.chapters[0].id);
  assert.ok(typeof state.chapterContent === "string");
  assert.equal(typeof state.vectorStats.chunks, "number");
  assert.equal(typeof state.vectorStats.embeddingFallback, "object");
});
