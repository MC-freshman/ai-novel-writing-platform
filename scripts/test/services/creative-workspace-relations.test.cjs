const assert = require("node:assert/strict");
const test = require("node:test");
const { after } = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const workspace = require("../../../electron/services/creative-workspace.cjs");

const testRoot = path.join(__dirname, "..", "..", "..", ".test-runs", `creative_workspace_relations_${Date.now()}_${process.pid}`);

async function project(name) {
  const directory = path.join(testRoot, name);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

function mindMap(overrides = {}) {
  return {
    id: "map-relations",
    title: "关系线测试",
    rootId: "root",
    nodes: [
      { id: "root", parentId: "", text: "中心主题", note: "", color: "", collapsed: false, order: 0, side: "right" },
      { id: "a", parentId: "root", text: "分支 A", note: "", color: "", collapsed: false, order: 0, side: "left" },
      { id: "b", parentId: "root", text: "分支 B", note: "", color: "", collapsed: false, order: 1, side: "right" },
    ],
    ...overrides,
  };
}

function relation(overrides = {}) {
  return {
    id: "rel-1",
    sourceId: "a",
    targetId: "b",
    label: "看作同时进行",
    note: "第二幕回收",
    shape: "curved",
    linePattern: "dash",
    lineColor: "#2f8f6b",
    lineWidth: 2,
    arrowBegin: "none",
    arrowEnd: "triangle",
    labelFontStyle: "italic",
    labelColor: "#6b7280",
    controlPoints: [{ amount: 0.3, angle: 0.2, x: 4, y: -6 }],
    ...overrides,
  };
}

async function save(root, overrides = {}) {
  return workspace.upsertItem(root, "mindMaps", mindMap(overrides));
}

test("合法 relations 与 positions 落盘并可回读，nodes 8 字段和额外顶层字段不变", async () => {
  const root = await project("valid");
  const item = relation();
  const saved = await save(root, {
    relations: [item],
    positions: { a: { dx: 12.5, dy: -30 }, b: { dx: 0, dy: 40 } },
    legacyField: "保留旧字段",
  });
  assert.equal(saved.relations.length, 1);
  assert.deepEqual(saved.relations[0], item);
  assert.deepEqual(saved.positions.a, { dx: 12.5, dy: -30 });
  assert.deepEqual(saved.positions.b, { dx: 0, dy: 40 });
  assert.equal(saved.legacyField, "保留旧字段");
  assert.deepEqual(Object.keys(saved.nodes[0]).sort(), ["collapsed", "color", "id", "note", "order", "parentId", "side", "text"]);

  const reloaded = await workspace.loadWorkspace(root);
  const stored = reloaded.mindMaps[0];
  assert.deepEqual(stored.relations, [item]);
  assert.deepEqual(stored.positions.a, { dx: 12.5, dy: -30 });
  assert.deepEqual(stored.positions.b, { dx: 0, dy: 40 });
  assert.equal(stored.legacyField, "保留旧字段");
  assert.equal(stored.nodes.length, 3);
});

test("悬空边（端点不在 nodes 中）被整条丢弃，state.json 不写脏值", async () => {
  const root = await project("dangling");
  const saved = await save(root, { relations: [
    relation({ id: "ok" }),
    relation({ id: "bad-source", sourceId: "missing" }),
    relation({ id: "bad-target", targetId: "missing" }),
    relation({ id: "blank-source", sourceId: "" }),
  ] });
  assert.deepEqual(saved.relations.map((item) => item.id), ["ok"]);
  const reloaded = await workspace.loadWorkspace(root);
  assert.deepEqual(reloaded.mindMaps[0].relations.map((item) => item.id), ["ok"]);
});

test("超长 label / note 按 500 / 2000 清洗，非法 id 由 stableId 兜底", async () => {
  const root = await project("long-text");
  const saved = await save(root, { relations: [relation({
    id: "", label: "标".repeat(700), note: "注".repeat(2500),
  })] });
  const item = saved.relations[0];
  assert.equal(item.label.length, 500);
  assert.equal(item.note.length, 2000);
  assert.ok(item.id.startsWith("mind-relation_"));
  assert.ok(item.id.length <= 120);
  const reloaded = await workspace.loadWorkspace(root);
  assert.equal(reloaded.mindMaps[0].relations[0].label.length, 500);
  assert.equal(reloaded.mindMaps[0].relations[0].note.length, 2000);
});

test("越界枚举、非法颜色与越界线宽回落默认值", async () => {
  const root = await project("enums");
  const saved = await save(root, { relations: [relation({
    shape: "wave", linePattern: "zigzag", arrowBegin: "circle", arrowEnd: "square",
    labelFontStyle: "bold", lineColor: "red", labelColor: "not-a-color", lineWidth: 99,
  })] });
  const item = saved.relations[0];
  assert.equal(item.shape, "curved");
  assert.equal(item.linePattern, "dash");
  assert.equal(item.arrowBegin, "none");
  assert.equal(item.arrowEnd, "triangle");
  assert.equal(item.labelFontStyle, "italic");
  assert.equal(item.lineColor, "");
  assert.equal(item.labelColor, "");
  assert.equal(item.lineWidth, 2);

  const bounded = await save(root, { relations: [relation({ lineWidth: 0, lineColor: "#AABBCC", arrowBegin: "triangle", arrowEnd: "none" })] });
  assert.equal(bounded.relations[0].lineWidth, 2);
  assert.equal(bounded.relations[0].lineColor, "#AABBCC");
  assert.equal(bounded.relations[0].arrowBegin, "triangle");
  assert.equal(bounded.relations[0].arrowEnd, "none");
});

test("非有限或越界的 dx/dy、未知节点 key 与原型键名都被拒绝", async () => {
  const root = await project("positions");
  const positions = {
    a: { dx: 10, dy: -5 },
    b: { dx: 10001, dy: 0 },
    missing: { dx: 1, dy: 2 },
    root: { dx: Infinity, dy: 0 },
    ["__proto__"]: { dx: 1, dy: 1 },
  };
  const saved = await save(root, { positions });
  assert.deepEqual(Object.keys(saved.positions), ["a"]);
  assert.deepEqual(saved.positions.a, { dx: 10, dy: -5 });

  const dirty = await save(root, { positions: {
    a: { dx: "10", dy: 0 },
    b: { dx: NaN, dy: 1 },
    root: { dx: 0, dy: -10001 },
  } });
  assert.deepEqual(dirty.positions, {});
});

test("controlPoints 最多 2 项，非有限数被丢弃", async () => {
  const root = await project("control-points");
  const saved = await save(root, { relations: [relation({ controlPoints: [
    { amount: 0.3, angle: 0.2, x: 1, y: 2 },
    { amount: NaN, angle: 0, x: 0, y: 0 },
    { amount: 0.1, angle: 0, x: 0, y: 0 },
    { amount: 0.2, angle: 0, x: 0, y: 0 },
  ] })] });
  const points = saved.relations[0].controlPoints;
  assert.equal(points.length, 2);
  assert.deepEqual(points[0], { amount: 0.3, angle: 0.2, x: 1, y: 2 });
  assert.deepEqual(points[1], { amount: 0.1, angle: 0, x: 0, y: 0 });
  assert.ok(points.every((point) => Object.values(point).every(Number.isFinite)));
  const reloaded = await workspace.loadWorkspace(root);
  assert.equal(reloaded.mindMaps[0].relations[0].controlPoints.length, 2);
});

test("旧数据无 relations / positions 时默认空集合，读取层不改动既有字段", async () => {
  const root = await project("legacy");
  const saved = await save(root, {});
  assert.deepEqual(saved.relations, []);
  assert.deepEqual(saved.positions, {});
  assert.equal(saved.nodes.length, 3);

  const file = path.join(root, "analysis", "creative-workspace", "state.json");
  const raw = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(raw.mindMaps[0].relations.length, 0);
  assert.equal(raw.mindMaps[0].nodes.length, 3);
  // 直接写入 0.3.9 风格的旧条目：读取层保持原样，由 UI 用 ?? [] 兜底。
  await fs.writeFile(file, JSON.stringify({ ...raw, mindMaps: [{
    id: "old-map", title: "旧导图", rootId: "r",
    nodes: [{ id: "r", parentId: "", text: "中心", note: "", color: "", collapsed: false, order: 0, side: "right" }],
  }] }));
  const recovered = await workspace.loadWorkspace(root);
  assert.equal(recovered.mindMaps[0].id, "old-map");
  assert.equal(recovered.mindMaps[0].relations, undefined);
  assert.equal(recovered.mindMaps[0].nodes[0].text, "中心");
});

test("relations 超过 2000 条被截断，脏类型输入按空集合处理", async () => {
  const root = await project("capacity");
  const many = Array.from({ length: 2005 }, (_unused, index) => ({
    id: `r${index}`, sourceId: "a", targetId: "b", label: `关系 ${index}`, note: "",
  }));
  const saved = await save(root, { relations: many });
  assert.equal(saved.relations.length, 2000);
  assert.equal(saved.relations[0].id, "r0");
  assert.equal(saved.relations[1999].id, "r1999");

  const dirty = await save(root, { relations: { not: "an array" }, positions: "bad" });
  assert.deepEqual(dirty.relations, []);
  assert.deepEqual(dirty.positions, {});
  const reloaded = await workspace.loadWorkspace(root);
  assert.deepEqual(reloaded.mindMaps[0].relations, []);
  assert.deepEqual(reloaded.mindMaps[0].positions, {});
});

const fsSync = require("node:fs");

/** 用仓库自带的 typescript 把纯 TS 布局模块转译为 CJS，供 node:test 直接调用。 */
function loadMindMapModule() {
  const ts = require("typescript");
  const source = fsSync.readFileSync(path.join(__dirname, "..", "..", "..", "src", "lib", "mind-map.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "mind-map.ts",
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exportsObject = {};
  // 该模块只有 type-only import，转译后不依赖任何运行时模块。
  const factory = new Function("exports", "require", "module", outputText);
  factory(exportsObject, require, { exports: exportsObject });
  return exportsObject;
}

test("P1 关系线端点落在节点矩形边界而非中心，路径与标签锚点均为有限数", () => {
  const { layoutMindMap, layoutRelations, MIND_NODE_WIDTH, MIND_NODE_HEIGHT } = loadMindMapModule();
  const map = mindMap();
  const layout = layoutMindMap(map);
  const laid = layoutRelations({ ...map, relations: [relation()] }, layout);
  assert.equal(laid.length, 1);
  const source = layout.nodes.find((item) => item.id === "a");
  const target = layout.nodes.find((item) => item.id === "b");
  assert.notEqual(laid[0].x1, source.x, "起点不应等于节点中心");
  assert.notEqual(laid[0].x2, target.x, "终点不应等于节点中心");
  const dx = laid[0].x1 - source.x;
  const dy = laid[0].y1 - source.y;
  assert.ok(Math.abs(dx) <= MIND_NODE_WIDTH / 2 + 1e-6 && Math.abs(dy) <= MIND_NODE_HEIGHT / 2 + 1e-6, "端点必须落在节点矩形内");
  assert.ok(Math.abs(Math.abs(dx) - MIND_NODE_WIDTH / 2) < 1e-6 || Math.abs(Math.abs(dy) - MIND_NODE_HEIGHT / 2) < 1e-6, "端点必须触及矩形边界");
  assert.ok(laid[0].d.includes(" C "), "默认曲线应为三次贝塞尔");
  assert.ok(!/NaN|Infinity/.test(laid[0].d), `路径含非有限数：${laid[0].d}`);
  assert.ok(Number.isFinite(laid[0].lx) && Number.isFinite(laid[0].ly), "标签锚点必须有限");

  // 自环 / 端点重合时纯函数不得产出 NaN，应直接跳过该条。
  const selfLoop = layoutRelations({ ...map, relations: [relation({ sourceId: "a", targetId: "a" })] }, layout);
  assert.equal(selfLoop.length, 0);
});

test("P2 极大有限控制点被白名单拒绝，全链路路径无 NaN/Infinity", async () => {
  const root = await project("huge-control-points");
  const huge = { amount: 1e308, angle: 1e308, x: 1e308, y: 1e308 };
  const saved = await save(root, { relations: [relation({ controlPoints: [huge, { amount: 0.3, angle: 0.2, x: 4, y: -6 }] })] });
  assert.equal(saved.relations[0].controlPoints.length, 1);
  assert.deepEqual(saved.relations[0].controlPoints[0], { amount: 0.3, angle: 0.2, x: 4, y: -6 });

  const reloaded = await workspace.loadWorkspace(root);
  const stored = reloaded.mindMaps[0];
  assert.deepEqual(stored.relations[0].controlPoints, [{ amount: 0.3, angle: 0.2, x: 4, y: -6 }]);
  const { layoutMindMap, layoutRelations } = loadMindMapModule();
  const layout = layoutMindMap(stored);
  const laid = layoutRelations(stored, layout);
  assert.equal(laid.length, 1);
  assert.ok(!/NaN|Infinity/.test(laid[0].d), `落盘回读后的路径含非有限数：${laid[0].d}`);
  assert.ok(Number.isFinite(laid[0].lx) && Number.isFinite(laid[0].ly));

  // 纯函数绕过服务白名单直接收到极端输入时，也必须回落到默认控制点。
  const direct = layoutRelations({ ...stored, relations: [relation({ controlPoints: [huge] })] }, layout);
  assert.equal(direct.length, 1);
  assert.ok(!/NaN|Infinity/.test(direct[0].d), `纯函数路径含非有限数：${direct[0].d}`);
  assert.ok(Number.isFinite(direct[0].lx) && Number.isFinite(direct[0].ly));
});

test("P5 自环被拒、重复 id 去重后仅保留第一条", async () => {
  const root = await project("self-loop-duplicate");
  const saved = await save(root, { relations: [
    relation({ id: "dup", label: "第一条" }),
    relation({ id: "dup", label: "第二条" }),
    relation({ id: "dup", label: "第三条" }),
    relation({ id: "self", sourceId: "a", targetId: "a" }),
  ] });
  assert.equal(saved.relations.length, 1);
  assert.equal(saved.relations[0].id, "dup");
  assert.equal(saved.relations[0].label, "第一条");
  assert.notEqual(saved.relations[0].sourceId, saved.relations[0].targetId);
  const reloaded = await workspace.loadWorkspace(root);
  assert.equal(reloaded.mindMaps[0].relations.length, 1);
  assert.equal(reloaded.mindMaps[0].relations[0].label, "第一条");
});

test("P7 先过滤悬空边再截断：前 2000 条悬空 + 后 5 条合法仍完整保留", async () => {
  const root = await project("filter-before-slice");
  const dangling = Array.from({ length: 2000 }, (_unused, index) => ({
    id: `dangling-${index}`, sourceId: "missing", targetId: "a", label: "", note: "",
  }));
  const valid = Array.from({ length: 5 }, (_unused, index) => ({
    id: `valid-${index}`, sourceId: "a", targetId: "b", label: `关系 ${index}`, note: "",
  }));
  const saved = await save(root, { relations: [...dangling, ...valid] });
  assert.deepEqual(saved.relations.map((item) => item.id), valid.map((item) => item.id));
  const reloaded = await workspace.loadWorkspace(root);
  assert.equal(reloaded.mindMaps[0].relations.length, 5);
});

test("P3 脏类型 relations / controlPoints 落盘与纯函数读取均不崩溃", async () => {
  const root = await project("dirty-types");
  assert.deepEqual((await save(root, { relations: {} })).relations, []);
  assert.deepEqual((await save(root, { relations: 123 })).relations, []);
  assert.deepEqual((await save(root, { relations: true })).relations, []);
  const badPoints = await save(root, { relations: [relation({ controlPoints: "bad" })] });
  assert.deepEqual(badPoints.relations[0].controlPoints, []);

  const reloaded = await workspace.loadWorkspace(root);
  const stored = reloaded.mindMaps[0];
  const { layoutMindMap, layoutRelations } = loadMindMapModule();
  const layout = layoutMindMap(stored);
  // loadWorkspace 不经 normalizeItem，模拟外部 / MCP 直接写入脏字段。
  for (const dirty of [{}, 123, true, "bad", null]) {
    const laid = layoutRelations({ ...stored, relations: dirty }, layout);
    assert.ok(Array.isArray(laid) && laid.length === 0, `脏 relations 未被安全跳过：${String(dirty)}`);
  }
  const withBadPoints = layoutRelations({ ...stored, relations: [relation({ controlPoints: "bad" })] }, layout);
  assert.equal(withBadPoints.length, 1);
  assert.ok(!/NaN|Infinity/.test(withBadPoints[0].d));
});

test("N1 极端相对量控制点被服务端拒绝，绕过服务直喂时前端包围盒钳制保证 d 可见", async () => {
  const root = await project("extreme-relative-control-points");
  const extreme = { amount: 10000, angle: 10000, x: 10000, y: 10000 };
  const negative = { amount: -10000, angle: -10000, x: -10000, y: -10000 };
  const saved = await save(root, { relations: [relation({ controlPoints: [extreme, negative] })] });
  assert.deepEqual(saved.relations[0].controlPoints, [], "服务端应拒绝 |v|>8 的极端相对量控制点");

  const reloaded = await workspace.loadWorkspace(root);
  const stored = reloaded.mindMaps[0];
  assert.equal(stored.relations[0].controlPoints.length, 0);
  const { layoutMindMap, layoutRelations } = loadMindMapModule();
  const layout = layoutMindMap(stored);
  const laid = layoutRelations(stored, layout);
  assert.equal(laid.length, 1);
  assert.ok(!/NaN|Infinity/.test(laid[0].d));

  // 不能只查 Number.isFinite：还要验证 d 的每个坐标都落在画布包围盒内，曲线才真正可见。
  const coordinatesOf = (path) => path.replace(/[A-Za-z]/g, " ").trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
  const inCanvas = (item, canvas) => coordinatesOf(item.d).every((value, index) =>
    index % 2 === 0 ? value >= 0 && value <= canvas.width : value >= 0 && value <= canvas.height);
  assert.ok(inCanvas(laid[0], layout), `落盘回读后的路径飞出画布：${laid[0].d}`);

  // 绕过服务端（模拟 MCP 直写 state.json），前端包围盒钳制必须生效。
  const bypass = layoutRelations({ ...stored, relations: [relation({ controlPoints: [extreme, negative] })] }, layout);
  assert.equal(bypass.length, 1);
  assert.ok(!/NaN|Infinity/.test(bypass[0].d));
  assert.ok(inCanvas(bypass[0], layout), `绕过服务端后路径飞出画布：${bypass[0].d}`);
  assert.ok(Number.isFinite(bypass[0].lx) && Number.isFinite(bypass[0].ly));
});

after(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});
