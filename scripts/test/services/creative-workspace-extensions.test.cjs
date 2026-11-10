const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const workspace = require("../../../electron/services/creative-workspace.cjs");

const testRoot = path.join(__dirname, "..", "..", "..", ".test-runs", `creative_workspace_extensions_${Date.now()}_${process.pid}`);

async function project(name) {
  const directory = path.join(testRoot, name);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

function mindMap(overrides = {}) {
  return {
    id: "map-extensions",
    title: "扩展字段测试",
    rootId: "root",
    nodes: [
      { id: "root", parentId: "", text: "中心主题", note: "", color: "", collapsed: false, order: 0, side: "right", legacyStyle: { color: "paper" } },
      { id: "a", parentId: "root", text: "分支 A", note: "", color: "", collapsed: false, order: 0, side: "left", legacyBadge: "保留" },
    ],
    relations: [{
      id: "rel-1", sourceId: "root", targetId: "a", label: "关系", note: "",
      legacyArrow: { head: "open" },
    }],
    positions: {
      root: { dx: 0, dy: 0, pin: "keep" },
      a: { dx: 12, dy: -8 },
    },
    ...overrides,
  };
}

test("节点、关系、位置的契约外字段按 id 保存，节点白名单字段不变", async () => {
  const root = await project("roundtrip");
  const saved = await workspace.upsertItem(root, "mindMaps", mindMap());
  assert.equal(saved.schemaVersion, 1);
  assert.equal(saved.extensions.contractVersion, 1);
  assert.deepEqual(saved.extensions.nodes.root, { legacyStyle: { color: "paper" } });
  assert.deepEqual(saved.extensions.nodes.a, { legacyBadge: "保留" });
  assert.deepEqual(saved.extensions.relations["rel-1"], { legacyArrow: { head: "open" } });
  assert.deepEqual(saved.extensions.positions.root, { pin: "keep" });
  assert.deepEqual(Object.keys(saved.nodes[0]).sort(), ["collapsed", "color", "id", "note", "order", "parentId", "side", "text"]);

  const reloaded = await workspace.loadWorkspace(root);
  const again = await workspace.upsertItem(root, "mindMaps", reloaded.mindMaps[0]);
  assert.deepEqual(again.extensions.nodes.root, { legacyStyle: { color: "paper" } });
  assert.deepEqual(again.extensions.relations["rel-1"], { legacyArrow: { head: "open" } });
  assert.deepEqual(again.extensions.positions.root, { pin: "keep" });
});

test("删除节点后扩展字段随之移除，原型键与超长值被过滤", async () => {
  const root = await project("cleanup");
  const payload = mindMap();
  payload.nodes[0] = JSON.parse('{"id":"root","parentId":"","text":"中心主题","note":"","color":"","collapsed":false,"order":0,"side":"right","legacyStyle":{"color":"paper"},"__proto__":{"polluted":true},"big":"' + "x".repeat(5000) + '"}');
  const saved = await workspace.upsertItem(root, "mindMaps", payload);
  assert.equal({}.polluted, undefined);
  assert.equal(saved.extensions.nodes.root.big.length, 2000);
  assert.equal(Object.prototype.hasOwnProperty.call(saved.extensions.nodes.root, "__proto__"), false);

  const reduced = await workspace.upsertItem(root, "mindMaps", {
    ...saved,
    nodes: saved.nodes.filter((node) => node.id !== "a"),
    relations: [],
    positions: { root: saved.positions.root },
  });
  assert.equal(reduced.extensions.nodes.a, undefined);
  assert.equal(reduced.extensions.relations?.["rel-1"], undefined);
  assert.equal(reduced.extensions.positions.a, undefined);
  assert.deepEqual(reduced.extensions.nodes.root.legacyStyle, { color: "paper" });
});
