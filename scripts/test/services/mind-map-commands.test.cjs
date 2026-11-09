const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..", "..", "..");

/** 用仓库自带的 typescript 把纯 TS 模块转译成 CJS，供 node:test 直接调用。 */
function loadModule(file) {
  const source = fs.readFileSync(path.join(root, "src", "lib", file), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exported = {};
  new Function("exports", "require", "module", outputText)(exported, require, { exports: exported });
  return exported;
}

const layoutLib = loadModule("mind-map.ts");
const commands = loadModule("mind-map-commands.ts");

function makeMap() {
  return {
    id: "m1", title: "测试导图", rootId: "root",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    nodes: [
      { id: "root", parentId: "", text: "中心", note: "", color: "", collapsed: false, order: 0, side: "right" },
      { id: "a", parentId: "root", text: "A", note: "", color: "", collapsed: false, order: 0, side: "left" },
      { id: "a1", parentId: "a", text: "A1", note: "", color: "", collapsed: false, order: 0, side: "left" },
      { id: "b", parentId: "root", text: "B", note: "", color: "", collapsed: false, order: 1, side: "right" },
    ],
    relations: [
      { id: "r1", sourceId: "a", targetId: "b", label: "跨分支", note: "" },
      { id: "r2", sourceId: "a", targetId: "a1", label: "子树内", note: "" },
    ],
    positions: {},
  };
}

test("applyPositions：节点与树边端点各自叠加偏移，无 positions 时原样返回", () => {
  const layout = layoutLib.layoutMindMap(makeMap());
  const originalNode = layout.nodes.find((item) => item.id === "a");
  const originalEdge = layout.edges.find((edge) => edge.id === "root>a");
  assert.equal(layoutLib.applyPositions(layout), layout, "无偏移时应返回同一对象");
  assert.equal(layoutLib.applyPositions(layout, {}), layout, "空对象应返回同一对象");

  const shifted = layoutLib.applyPositions(layout, { a: { dx: 30, dy: -12 } });
  const movedNode = shifted.nodes.find((item) => item.id === "a");
  assert.equal(movedNode.x, originalNode.x + 30);
  assert.equal(movedNode.y, originalNode.y - 12);
  const movedEdge = shifted.edges.find((edge) => edge.id === "root>a");
  assert.equal(movedEdge.x2, originalEdge.x2 + 30, "树边终点应跟随子节点偏移");
  assert.equal(movedEdge.y2, originalEdge.y2 - 12);
  assert.equal(movedEdge.x1, originalEdge.x1, "树边起点不应被子节点偏移影响");
  assert.equal(shifted.width, layout.width);
  assert.equal(shifted.height, layout.height);
});

test("applyPositions：非有限 / 脏类型偏移被忽略，不产生 NaN", () => {
  const layout = layoutLib.layoutMindMap(makeMap());
  const shifted = layoutLib.applyPositions(layout, {
    a: { dx: Infinity, dy: 0 }, b: { dx: "10", dy: 2 }, root: { dx: NaN, dy: 1 },
  });
  for (const node of shifted.nodes) assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
  for (const edge of shifted.edges) {
    assert.ok([edge.x1, edge.y1, edge.x2, edge.y2].every(Number.isFinite));
  }
  assert.deepEqual(shifted.nodes.map((item) => item.x), layout.nodes.map((item) => item.x), "全部脏值应被忽略");
});

test("layoutRelations 使用 applyPositions 后的布局，关系线端点跟随节点偏移", () => {
  const map = makeMap();
  const base = layoutLib.layoutMindMap(map);
  const before = layoutLib.layoutRelations(map, base);
  const shifted = layoutLib.applyPositions(base, { a: { dx: 40, dy: 25 }, b: { dx: -20, dy: 0 } });
  const after = layoutLib.layoutRelations(map, shifted);
  assert.equal(before.length, 2);
  assert.equal(after.length, 2);
  assert.notEqual(after[0].d, before[0].d, "端点偏移后路径必须变化");
  assert.ok(!/NaN|Infinity/.test(after[0].d));
  assert.ok(Number.isFinite(after[0].lx) && Number.isFinite(after[0].ly));
});

test("snapshotMindMap：深拷贝 nodes / relations / positions，修改原对象不影响快照", () => {
  const map = makeMap();
  map.positions.a = { dx: 5, dy: 6 };
  map.relations[0].controlPoints = [{ amount: 0.3, angle: 0.2, x: 0, y: 0 }];
  const snapshot = commands.snapshotMindMap(map);
  map.nodes[1].text = "已改";
  map.positions.a.dx = 999;
  map.relations[0].controlPoints[0].amount = 9;
  assert.equal(snapshot.nodes[1].text, "A");
  assert.equal(snapshot.positions.a.dx, 5);
  assert.equal(snapshot.relations[0].controlPoints[0].amount, 0.3);
});

test("cloneMindMapSubtree：重映射 parentId，仅复制两端都在子树内的关系线", () => {
  const map = makeMap();
  let counter = 0;
  const clipboard = commands.cloneMindMapSubtree(map, ["a"], () => `new${counter++}`);
  assert.equal(clipboard.nodes.length, 2, "应包含 a 与其子树 a1");
  assert.equal(clipboard.relations.length, 1, "跨分支的 r1 应被排除，子树内的 r2 应保留");
  const ids = new Set(clipboard.nodes.map((node) => node.id));
  assert.ok(clipboard.nodes.every((node) => !node.parentId || ids.has(node.parentId)));
  assert.ok(ids.has(clipboard.relations[0].sourceId) && ids.has(clipboard.relations[0].targetId));
  assert.ok(!map.nodes.some((node) => ids.has(node.id)), "复制结果不得复用原 id");
});

test("pasteMindMapClipboard：粘贴生成全新 id 并挂到指定父节点", () => {
  const map = makeMap();
  let counter = 0;
  const clipboard = commands.cloneMindMapSubtree(map, ["a"], () => `copy${counter++}`);
  const pasted = commands.pasteMindMapClipboard(map, clipboard, "b", () => `paste${counter++}`);
  assert.equal(pasted.nodes.length, map.nodes.length + clipboard.nodes.length);
  assert.equal(pasted.relations.length, map.relations.length + clipboard.relations.length);
  const newNodes = pasted.nodes.slice(map.nodes.length);
  assert.ok(newNodes.every((node) => !map.nodes.some((original) => original.id === node.id)));
  assert.ok(newNodes.some((node) => node.parentId === "b"), "复制根节点应挂到目标父节点");
  assert.equal(map.nodes.length, 4, "原 map 不应被修改");
});

test("removeMindMapNodes：级联删除子树与关联关系线，根节点不可删除", () => {
  const map = makeMap();
  const next = commands.removeMindMapNodes(map, ["a", "root"]);
  assert.deepEqual(next.nodes.map((node) => node.id), ["root", "b"]);
  assert.deepEqual(next.relations.map((item) => item.id), [], "a/a1 相关关系线应全部删除");
});

test("nodesInRect：矩形与节点包围盒相交即选中", () => {
  const layout = layoutLib.layoutMindMap(makeMap());
  const target = layout.nodes.find((item) => item.id === "b");
  const ids = commands.nodesInRect(
    layout,
    { x1: target.x - 200, y1: target.y - 200, x2: target.x + 5, y2: target.y + 5 },
    layoutLib.MIND_NODE_WIDTH / 2,
    layoutLib.MIND_NODE_HEIGHT / 2,
  );
  assert.ok(ids.includes("b"));
  assert.ok(Array.isArray(ids));
});

test("mergePositions：拖拽临时偏移覆盖已落盘值，空拖拽保持原值", () => {
  const stored = { a: { dx: 10, dy: 20 } };
  assert.deepEqual(commands.mergePositions(stored, null), stored);
  assert.deepEqual(commands.mergePositions(stored, { a: { dx: 99, dy: 20 }, b: { dx: 1, dy: 2 } }), {
    a: { dx: 99, dy: 20 }, b: { dx: 1, dy: 2 },
  });
  assert.deepEqual(commands.mergePositions(undefined, null), {});
});

test("layoutMindMap：单根布局保持历史输出（根节点居中、节点与树边数量不变）", () => {
  const layout = layoutLib.layoutMindMap(makeMap());
  const root = layout.nodes.find((item) => item.id === "root");
  assert.ok(root, "根节点缺失");
  assert.equal(root.x, layout.width / 2);
  assert.equal(root.y, layout.height / 2);
  assert.equal(layout.nodes.length, 4);
  assert.equal(layout.edges.length, 3);
});

test("layoutMindMap：多个独立中心各自成块、互不连线、坐标不重叠", () => {
  const map = makeMap();
  // 把 a 及其子树从 root 断开，形成第二个独立中心。
  map.nodes = map.nodes.map((node) => node.id === "a" ? { ...node, parentId: "" } : node);
  const layout = layoutLib.layoutMindMap(map);
  const ids = layout.nodes.map((item) => item.id);
  assert.ok(["root", "a", "a1", "b"].every((id) => ids.includes(id)), "断开后丢失节点");
  assert.equal(new Set(ids).size, ids.length, "同一节点被重复布局");
  assert.ok(!layout.edges.some((edge) => edge.id === "root>a"), "断开后仍保留父子树边");
  const root = layout.nodes.find((item) => item.id === "root");
  const detached = layout.nodes.find((item) => item.id === "a");
  assert.ok(root && detached && Math.abs(detached.y - root.y) > 100, "两个中心未垂直分开");
  assert.ok(layout.nodes.every((item) => Number.isFinite(item.x) && Number.isFinite(item.y)), "出现非有限坐标");
  assert.ok(layout.nodes.every((item) => item.x >= 0 && item.y >= 0), "出现负坐标");
  assert.ok(layout.width > 0 && layout.height > 0, "画布尺寸非法");
});
