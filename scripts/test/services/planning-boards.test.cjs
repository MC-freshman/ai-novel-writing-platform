const assert = require("node:assert/strict");
const test = require("node:test");
const { after } = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const workspace = require("../../../electron/services/creative-workspace.cjs");

const testRoot = path.join(__dirname, "..", "..", "..", ".test-runs", `planning_boards_${Date.now()}_${process.pid}`);
async function project(name) {
  const directory = path.join(testRoot, name);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

const mindMap = (id) => ({
  id,
  title: "第一幕线索",
  rootId: "root",
  nodes: [
    { id: "root", parentId: "", text: "中心主题", note: "", color: "", collapsed: false, order: 0, side: "right" },
    { id: "a", parentId: "root", text: "伏笔", note: "待接", color: "#ff0000", collapsed: true, order: 0, side: "left" },
  ],
});

const grid = (id) => ({
  id,
  title: "第一幕进度",
  description: "按幕跟踪",
  columns: [
    { id: "c1", title: "目标", kind: "text" },
    { id: "c2", title: "阶段", kind: "status" },
  ],
  rows: [
    { id: "r1", title: "开篇", status: "已完成", note: "", chapterId: "oldChapter", cells: { c1: "引出冲突", c2: "已完成", injected: "不应保留" } },
    { id: "r2", title: "转折", status: "不存在的状态", note: "", chapterId: "", cells: { c1: "反转" } },
  ],
});

test("旧项目缺少新集合时读取为空数组，损坏字段也会降级", async () => {
  const root = await project("legacy");
  const initial = await workspace.loadWorkspace(root);
  assert.deepEqual(initial.mindMaps, []);
  assert.deepEqual(initial.progressGrids, []);
  const file = path.join(root, "analysis", "creative-workspace", "state.json");
  await fs.writeFile(file, JSON.stringify({ ...initial, mindMaps: { broken: true }, progressGrids: "bad" }));
  const recovered = await workspace.loadWorkspace(root);
  assert.deepEqual(recovered.mindMaps, []);
  assert.deepEqual(recovered.progressGrids, []);
});

test("思维导图保存后可从列表查到、更新不重复、根节点自动补齐", async () => {
  const root = await project("mindmap");
  const saved = await workspace.upsertItem(root, "mindMaps", mindMap("map-1"));
  assert.equal(saved.title, "第一幕线索");
  assert.equal(saved.nodes[1].side, "left");
  assert.equal(saved.nodes[1].collapsed, true);
  const updated = await workspace.upsertItem(root, "mindMaps", { ...saved, title: "第一幕线索（修订）" });
  assert.equal(updated.id, "map-1");
  assert.equal(updated.nodes.length, 2);
  assert.equal((await workspace.loadWorkspace(root)).mindMaps.length, 1);
  assert.equal((await workspace.loadWorkspace(root)).mindMaps[0].title, "第一幕线索（修订）");

  const bare = await workspace.upsertItem(root, "mindMaps", { id: "map-2", rootId: "missing-root", nodes: [] });
  assert.equal(bare.nodes.length, 1);
  assert.equal(bare.nodes[0].id, "missing-root");
  await workspace.deleteItem(root, "mindMaps", "map-1");
  const remaining = (await workspace.loadWorkspace(root)).mindMaps;
  assert.deepEqual(remaining.map((item) => item.id), ["map-2"]);
});

test("进度网格清洗非法状态、未知单元格，并保留合法内容", async () => {
  const root = await project("grid-clean");
  const saved = await workspace.upsertItem(root, "progressGrids", grid("grid-1"));
  assert.equal(saved.rows[0].status, "已完成");
  assert.equal(saved.rows[1].status, "计划中");
  assert.deepEqual(saved.rows[0].cells, { c1: "引出冲突", c2: "已完成" });
  assert.equal(saved.rows[0].chapterId, "oldChapter");
  assert.equal(saved.columns[1].kind, "status");
});

test("删除章节会清空网格里的失效关联，不删除行本身", async () => {
  const root = await project("grid-chapter");
  await workspace.upsertItem(root, "progressGrids", grid("grid-1"));
  await workspace.removeChapterReferences(root, "oldChapter");
  const rows = (await workspace.loadWorkspace(root)).progressGrids[0].rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].chapterId, "");
  assert.equal(rows[0].title, "开篇");
});

test("交换导入重映射章节引用，超出容量时拒绝且不破坏已有数据", async () => {
  const source = await project("exchange-source");
  const target = await project("exchange-target");
  const saved = await workspace.upsertItem(source, "progressGrids", grid("grid-1"));
  await workspace.upsertItem(target, "progressGrids", grid("grid-local"));
  await workspace.mergeImportedWorkspace(target, { progressGrids: [saved] }, new Map([["oldChapter", "newChapter"]]));
  const imported = (await workspace.loadWorkspace(target)).progressGrids.find((item) => item.id !== "grid-local");
  assert.equal(imported.rows[0].chapterId, "newChapter");

  const many = Array.from({ length: 60 }, (_, index) => grid(`bulk-${index}`));
  await assert.rejects(workspace.mergeImportedWorkspace(target, { progressGrids: many }), /容量|60/);
  assert.equal((await workspace.loadWorkspace(target)).progressGrids.length, 2);
});

test("新建第61张思维导图会被拒绝，之前创建的全部保留", async () => {
  const root = await project("capacity");
  const many = Array.from({ length: 60 }, (_, index) => mindMap(`bulk-${index}`));
  await workspace.mergeImportedWorkspace(root, { mindMaps: many });
  const before = await workspace.loadWorkspace(root);
  assert.equal(before.mindMaps.length, 60);
  await assert.rejects(workspace.upsertItem(root, "mindMaps", mindMap("one-too-many")), /上限|60/);
  assert.equal((await workspace.loadWorkspace(root)).mindMaps.length, 60);
});

after(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});
