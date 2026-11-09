const assert = require("node:assert/strict");
const test = require("node:test");
const { after } = require("node:test");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const AdmZip = require("adm-zip");
const {
  readXMindFile, parseXMindJson, MAX_NODES,
} = require("../../../electron/services/mind-map-import.cjs");

const root = path.resolve(__dirname, "..", "..", "..");
const testRoot = path.join(root, ".test-runs", `xmind_import_${Date.now()}_${process.pid}`);
const realXmind = path.join(root, "小说1材料", "长夜", "万龙谷阴谋", "长夜第一幕：森林之心保卫战.xmind");
fs.mkdirSync(testRoot, { recursive: true });

function writeXmind(name, entries) {
  const file = path.join(testRoot, name);
  const zip = new AdmZip();
  for (const [entry, content] of Object.entries(entries)) zip.addFile(entry, Buffer.from(content, "utf8"));
  zip.writeZip(file);
  return file;
}

const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0">
  <sheet id="s1"><title>第一画布</title>
    <topic id="root"><title>中心主题</title><children>
      <topics type="attached"><topic id="a"><title>分支 &amp; 一</title><notes><plain>这里是备注</plain></notes><children><topics type="attached"><topic id="a1"><title>子节点</title></topic></topics></children></topic></topics>
      <topics type="detached"><topic id="b"><title>浮动主题</title></topic></topics>
      <topics type="summary"><topic id="c"><title>摘要主题</title></topic></topics>
    </children></topic>
  </sheet>
  <sheet id="s2"><topic id="root2"><title>第二画布中心</title></topic></sheet>
</xmap-content>`;

const jsonContent = JSON.stringify([
  {
    id: "s1", title: "画布一",
    rootTopic: {
      id: "r", title: "中心", notes: { plain: { content: "根备注" } },
      children: {
        attached: [{ id: "a", title: "A", children: { attached: [{ id: "a1", title: "A1" }] } }],
        detached: [{ id: "b", title: "B" }],
        summary: [{ id: "c", title: "C" }],
      },
    },
  },
  { id: "s2", title: "画布二", rootTopic: { id: "r2", title: "中心二" } },
]);

test("XMind 8 的 content.xml：多画布、attached/detached/summary、备注与实体", () => {
  const file = writeXmind("legacy.xmind", { "content.xml": xmlContent, "meta.xml": "<meta/>" });
  const result = readXMindFile(file);
  assert.equal(result.fileName, "legacy.xmind");
  assert.equal(result.sheets.length, 2);
  const first = result.sheets[0];
  assert.equal(first.rootText, "中心主题");
  assert.equal(first.nodeCount, 5);
  assert.equal(first.truncated, false);
  assert.match(first.title, /legacy/);
  const texts = first.map.nodes.map((node) => node.text);
  assert.ok(texts.includes("分支 & 一"), "HTML 实体未解码");
  assert.ok(texts.includes("浮动主题") && texts.includes("摘要主题") && texts.includes("子节点"));
  assert.equal(first.map.nodes.find((node) => node.text === "分支 & 一").note, "这里是备注");
  assert.equal(result.sheets[1].rootText, "第二画布中心");
  assert.equal(result.sheets[1].nodeCount, 1);
});

test("新版 content.json：多画布、备注与层级完整", () => {
  const file = writeXmind("zen.xmind", { "content.json": jsonContent });
  const result = readXMindFile(file);
  assert.equal(result.sheets.length, 2);
  const first = result.sheets[0];
  assert.equal(first.nodeCount, 5);
  assert.equal(first.map.nodes[0].note, "根备注");
  assert.equal(first.map.nodes[1].text, "A");
  assert.equal(first.map.nodes[2].text, "A1");
  for (const sheet of result.sheets) {
    const rootNodes = sheet.map.nodes.filter((node) => !node.parentId);
    assert.equal(rootNodes.length, 1);
    assert.equal(rootNodes[0].id, sheet.map.rootId);
    for (const node of sheet.map.nodes) {
      if (node.parentId) assert.ok(sheet.map.nodes.some((parent) => parent.id === node.parentId), "存在孤立节点");
    }
    assert.ok(sheet.map.nodes.slice(1).every((node) => ["left", "right"].includes(node.side)));
  }
});

test("一级分支左右交替，深层节点继承所在分支方向", () => {
  const sheets = parseXMindJson(jsonContent);
  const file = writeXmind("sides.xmind", { "content.json": jsonContent });
  const first = readXMindFile(file).sheets[0].map;
  const primary = first.nodes.filter((node) => node.parentId === first.rootId);
  assert.deepEqual(primary.map((node) => node.side), ["left", "right", "left"]);
  const deep = first.nodes.find((node) => node.text === "A1");
  assert.equal(deep.side, primary[0].side);
  assert.equal(sheets.length, 2);
});

test("超过节点上限时截断并标记，不产生孤立节点", () => {
  const children = Array.from({ length: MAX_NODES + 50 }, (_unused, index) => ({ id: `n${index}`, title: `主题 ${index}` }));
  const content = JSON.stringify([{ id: "s", title: "大图", rootTopic: { id: "r", title: "中心", children: { attached: children } } }]);
  const file = writeXmind("large.xmind", { "content.json": content });
  const result = readXMindFile(file);
  assert.equal(result.sheets[0].nodeCount, MAX_NODES);
  assert.equal(result.sheets[0].truncated, true);
  assert.ok(result.sheets[0].map.nodes.every((node) => !node.parentId || result.sheets[0].map.nodes.some((parent) => parent.id === node.parentId)));
});

test("非 xmind、缺内容文件、损坏压缩包与超大文件都给出明确错误", () => {
  const plain = path.join(testRoot, "note.txt");
  fs.writeFileSync(plain, "hello");
  assert.throws(() => readXMindFile(plain), /\.xmind/);
  const empty = writeXmind("empty.xmind", { "meta.xml": "<meta/>" });
  assert.throws(() => readXMindFile(empty), /content\.json|content\.xml/);
  const broken = path.join(testRoot, "broken.xmind");
  fs.writeFileSync(broken, "not a zip");
  assert.throws(() => readXMindFile(broken), /XMind 压缩包|ENOENT|Invalid|invalid/i);
  const huge = path.join(testRoot, "huge.xmind");
  fs.writeFileSync(huge, Buffer.alloc(17 * 1024 * 1024));
  assert.throws(() => readXMindFile(huge), /16 MB/);
});

test("真实 XMind 8 素材：39 个主题、层级与中心主题完整", (t) => {
  if (!fs.existsSync(realXmind)) return t.skip("真实素材不在当前工作区");
  const result = readXMindFile(realXmind);
  assert.equal(result.sheets.length, 1);
  const sheet = result.sheets[0];
  assert.equal(sheet.rootText, "森林之心保卫战");
  assert.equal(sheet.nodeCount, 39);
  assert.equal(sheet.truncated, false);
  assert.ok(sheet.title.includes("长夜第一幕"));
  const nodes = sheet.map.nodes;
  assert.equal(nodes.filter((node) => !node.parentId).length, 1);
  assert.ok(nodes.every((node) => !node.parentId || nodes.some((parent) => parent.id === node.parentId)));
  assert.ok(nodes.some((node) => node.text.includes("角色详情")));
  assert.ok(nodes.some((node) => node.text.includes("剧情脉络")));
});

// T04-B：XMind 8 关系线 + styles.xml 视觉样式 + K4 绝对像素丢弃（内联素材，不依赖外部路径）。
const relationXml = `<?xml version="1.0" encoding="UTF-8"?>
<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0">
  <sheet id="s1"><title>关系线画布</title>
    <topic id="root"><title>中心主题</title><children>
      <topics type="attached">
        <topic id="a"><title>分支 A</title><children><topics type="attached"><topic id="a1"><title>子主题 A1</title></topic></topics></children></topic>
        <topic id="b"><title>分支 B</title></topic>
      </topics>
    </children></topic>
    <relationships>
      <relationship end1="a" end2="b" id="rel-1" style-id="rel-style-1"><title>看作同时进行</title>
        <control-points>
          <control-point amount="0.3" angle="0.26" index="0"><position svg:x="129" svg:y="-154"/></control-point>
          <control-point amount="0.4" angle="-0.2" index="1"><position svg:x="80" svg:y="60"/></control-point>
        </control-points>
      </relationship>
      <relationship end1="a" end2="missing" id="rel-2"><title>悬空边</title></relationship>
      <relationship end1="root" end2="a1" id="rel-3"><title>中心到子主题</title></relationship>
    </relationships>
  </sheet>
</xmap-content>`;

const relationStylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<styles xmlns="urn:xmind:xmap:xmlns:style:2.0">
  <style id="rel-style-1" type="relationship">
    <relationship-properties arrow-begin-class="org.xmind.arrowShape.none" arrow-end-class="org.xmind.arrowShape.triangle" fo:color="#0A5CB9" fo:font-style="italic" line-color="#0A5CB9" line-pattern="dash" line-width="2pt" shape-class="org.xmind.relationshipShape.curved"/>
  </style>
</styles>`;

test("XMind 8 content.xml + styles.xml：关系线映射、样式与 K4 绝对像素丢弃", () => {
  const file = writeXmind("relations.xmind", { "content.xml": relationXml, "styles.xml": relationStylesXml });
  const result = readXMindFile(file);
  assert.equal(result.sheets.length, 1);
  const sheet = result.sheets[0];
  assert.equal(sheet.relationCount, 2, "悬空边应被整条丢弃");
  assert.match(sheet.relationNote, /绝对像素位置不导入/);
  const map = sheet.map;
  const nodeByText = (text) => map.nodes.find((node) => node.text === text);
  const relation = map.relations.find((item) => item.label === "看作同时进行");
  assert.ok(relation, "未导入带标题的关系线");
  assert.equal(relation.sourceId, nodeByText("分支 A").id, "end1 未映射到新节点 id");
  assert.equal(relation.targetId, nodeByText("分支 B").id, "end2 未映射到新节点 id");
  assert.equal(map.relations.some((item) => item.label === "悬空边"), false);
  assert.equal(relation.note, "");
  assert.equal(relation.arrowBegin, "none");
  assert.equal(relation.arrowEnd, "triangle");
  assert.equal(relation.linePattern, "dash");
  assert.equal(relation.shape, "curved");
  assert.equal(relation.labelFontStyle, "italic");
  assert.equal(relation.lineColor, "#0A5CB9");
  assert.equal(relation.labelColor, "#0A5CB9");
  assert.equal(relation.lineWidth, 2);
  // K4 硬约束：svg:x/svg:y 是绝对像素，只保留相对量 amount/angle，x/y 恒为 0。
  assert.deepEqual(relation.controlPoints, [
    { amount: 0.3, angle: 0.26, x: 0, y: 0 },
    { amount: 0.4, angle: -0.2, x: 0, y: 0 },
  ]);
  const serialized = JSON.stringify(relation.controlPoints);
  assert.ok(!serialized.includes("129") && !serialized.includes("-154"), "绝对像素不得写入 controlPoints");
  const rootRelation = map.relations.find((item) => item.label === "中心到子主题");
  assert.equal(rootRelation.sourceId, map.rootId, "root 的 topic id 也应建立映射");
  assert.equal(rootRelation.targetId, nodeByText("子主题 A1").id);
});

test("缺 styles.xml 时关系线使用安全默认值，非法颜色与线宽回落", () => {
  const file = writeXmind("relations-no-styles.xmind", { "content.xml": relationXml });
  const result = readXMindFile(file);
  const relation = result.sheets[0].map.relations.find((item) => item.label === "看作同时进行");
  assert.equal(relation.arrowEnd, "triangle");
  assert.equal(relation.arrowBegin, "none");
  assert.equal(relation.linePattern, "dash");
  assert.equal(relation.shape, "curved");
  assert.equal(relation.labelFontStyle, "italic");
  assert.equal(relation.lineColor, "");
  assert.equal(relation.labelColor, "");
  assert.equal(relation.lineWidth, 2);
});

test("新版 content.json 关系线结构未实测，保持不导入并明确标注", () => {
  const file = writeXmind("relations-json.xmind", { "content.json": jsonContent });
  const result = readXMindFile(file);
  assert.ok(result.sheets.length > 0);
  for (const sheet of result.sheets) {
    assert.equal(sheet.relationCount, 0);
    assert.equal(sheet.map.relations.length, 0);
    assert.match(sheet.relationNote, /暂不导入/);
  }
});

test("P7 导入层：先过滤悬空边再截断，前 2000 条脏边不吞掉后面的合法边", () => {
  const dangling = Array.from({ length: 2000 }, (_unused, index) =>
    `<relationship end1="missing-${index}" end2="a" id="d-${index}"><title>悬空</title></relationship>`).join("");
  const valid = Array.from({ length: 5 }, (_unused, index) =>
    `<relationship end1="a" end2="b" id="v-${index}"><title>合法 ${index}</title></relationship>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0"><sheet id="s1"><topic id="root"><title>中心</title><children><topics type="attached"><topic id="a"><title>A</title></topic><topic id="b"><title>B</title></topic></topics></children></topic><relationships>${dangling}${valid}</relationships></sheet></xmap-content>`;
  const file = writeXmind("filter-before-slice.xmind", { "content.xml": xml });
  const result = readXMindFile(file);
  assert.equal(result.sheets[0].relationCount, 5, "合法边被前面的悬空边吞掉（导入层先截断）");
  assert.deepEqual(result.sheets[0].map.relations.map((item) => item.label), ["合法 0", "合法 1", "合法 2", "合法 3", "合法 4"]);
});

after(async () => {
  await fsp.rm(testRoot, { recursive: true, force: true });
});
