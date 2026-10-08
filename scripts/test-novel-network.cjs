const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const { parseDocuments, normalizeNetwork } = require("../electron/services/novel-network.cjs");
const { htmlToPlanningText, mergeNetworks, parseNetworkJson, readImportFiles } = require("../electron/services/novel-network-import.cjs");
const workspace = require("../electron/services/creative-workspace.cjs");
const snapshots = require("../electron/services/project-snapshots.cjs");
const journal = require("../electron/services/operation-journal.cjs");

const testRoot = process.env.NOVEL_TEST_ROOT || path.join(__dirname, "..", ".test-runs", `novel_network_${Date.now()}`);
async function project(name) { const directory = path.join(testRoot, name); await fs.mkdir(directory, { recursive: true }); return directory; }
const simpleNetwork = () => parseDocuments([{ name: "示例.md", text: "# 排期\n## 第一块\n01｜T1｜修理路灯｜埋R1\n" }]);

test("导入统筹资料保留线程、章计划、矩阵、信息台账及未识别原文", () => {
  const source = "# 示例统筹网\n说明：计划编号与正文编号独立。\n\n## POV线程\n| 线 | 名称 | 活跃章区 |\n|---|---|---|\n| T1 | 调查线 | 1-8 |\n\n## 世界钟\n| 块 | 东区 | 西区 |\n|---|---|---|\n| 块一 | 公告(1) | 出发(2) |\n\n## 信息控制台账\n| 真相 | 埋设章 | 验证章 | 揭露章 | 回收章 |\n|---|---|---|---|---|\n| R1 线索来源 | 1 | 2 | 7 | 8 |\n\n## 块一\n01｜T1｜修理路灯，留下线索｜埋R1\n02｜T1｜核对公告｜验R1\n\n自由说明：不要提前揭露。\n";
  const result = parseDocuments([{ name: "示例.md", text: source }]);
  assert.equal(result.tables.find((table) => table.kind === "threads").rows[0].cells[0], "T1");
  assert.deepEqual(result.tables.find((table) => table.kind === "clock").rows[0].cells, ["块一", "公告(1)", "出发(2)"]);
  assert.equal(result.tables.find((table) => table.kind === "information").rows[0].cells[0], "R1 线索来源");
  const chapters = result.tables.filter((table) => table.kind === "chapters").flatMap((table) => table.rows);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].cells[0], "01");
  assert.equal(chapters[0].chapterId, "");
  assert.equal(result.documents[0].text, source);
});

test("表格转义分隔符、Word真实表格和自由说明均保留", () => {
  const html = '<h1>规划</h1><p>自由说明</p><table><tr><td>名称</td><td>备注</td></tr><tr><td>甲</td><td>前因 | 后果</td></tr></table>';
  const network = parseDocuments([{ name: "表.docx", text: htmlToPlanningText(html) }]);
  assert.deepEqual(network.tables[0].rows[0].cells, ["甲", "前因 | 后果"]);
  assert.match(network.documents[0].text, /自由说明/);
});

test("追加只去掉完全重复记录，差异内容和来源说明保留", () => {
  const base = simpleNetwork();
  const second = simpleNetwork();
  second.tables[0].rows.push({ id: "different", cells: ["01", "T1", "新增转折", "验R1", "第一块"], chapterId: "" });
  const merged = mergeNetworks(base, second);
  assert.equal(merged.duplicates, 1);
  assert.equal(merged.network.tables[0].rows.length, 2);
  assert.equal(merged.network.documents.length, 1);
});

test("无效列数、超长字段和JSON原型字段被拒绝，JSON往返不丢数据", () => {
  const base = simpleNetwork();
  assert.deepEqual(parseNetworkJson(JSON.stringify({ schema: "novel-network/v1", network: base })), base);
  assert.throws(() => parseNetworkJson('{"schema":"novel-network/v1","network":{"__proto__":{}}}'), /不安全/);
  const bad = structuredClone(base); bad.tables[0].rows[0].cells.pop();
  assert.throws(() => normalizeNetwork(bad), /列数/);
  assert.throws(() => normalizeNetwork({ ...base, title: "字".repeat(201) }), /长度/);
});

test("新小说网保存、修改和旧版本写入冲突不会损失数据", async () => {
  const root = await project("revision");
  const saved = await workspace.upsertItem(root, "novelNetworks", simpleNetwork());
  assert.match(saved.revision, /^[a-f0-9]{64}$/);
  const updated = await workspace.upsertItem(root, "novelNetworks", { ...saved, title: "作者改名" });
  await assert.rejects(workspace.upsertItem(root, "novelNetworks", { ...saved, title: "过期覆盖" }), /版本|其他窗口/);
  const current = await workspace.loadWorkspace(root);
  assert.equal(current.novelNetworks[0].title, "作者改名");
  assert.equal(current.novelNetworks[0].revision, updated.revision);
  await workspace.deleteItem(root, "novelNetworks", saved.id);
  assert.equal((await workspace.loadWorkspace(root)).novelNetworks.length, 0);
});

test("小说网草稿与章节草稿独立，崩溃后可读取", async () => {
  const root = await project("drafts");
  await journal.saveDraft(root, { kind: "novel-network", entityId: "network1", content: JSON.stringify(simpleNetwork()) });
  await journal.saveDraft(root, { chapterId: "chapter1", content: "正文" });
  const drafts = await journal.listDrafts(root);
  assert.equal(drafts.find((draft) => draft.kind === "novel-network").entityId, "network1");
  assert.equal(drafts.find((draft) => draft.kind === "chapter").content, "正文");
});

test("快照保留小说网，项目交换重映射实际正文链接", async () => {
  const root = await project("snapshots");
  const original = simpleNetwork(); original.tables[0].rows[0].chapterId = "oldChapter";
  const saved = await workspace.upsertItem(root, "novelNetworks", original);
  const snapshot = await snapshots.createSnapshot(root, { name: "统筹网起点" });
  assert.ok(snapshot.entries.some((entry) => entry.path.endsWith("creative-workspace/state.json")));
  const target = await project("exchange");
  await workspace.mergeImportedWorkspace(target, { novelNetworks: [saved] }, new Map([["oldChapter", "newChapter"]]));
  const imported = (await workspace.loadWorkspace(target)).novelNetworks[0];
  assert.equal(imported.tables[0].rows[0].chapterId, "newChapter");
  assert.deepEqual(imported.tables[0].rows[0].cells, saved.tables[0].rows[0].cells);
});

test("真实Word文件的标题、表格和章计划均可导入", async () => {
  const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell } = require("docx");
  const root = await project("word");
  const table = new Table({ rows: [["线", "名称", "活跃章区"], ["T1", "调查线", "1-8"]].map((cells) => new TableRow({ children: cells.map((text) => new TableCell({ children: [new Paragraph(text)] })) })) });
  const doc = new Document({ sections: [{ children: [new Paragraph({ text: "统筹网", heading: HeadingLevel.HEADING_1 }), new Paragraph({ text: "POV线程", heading: HeadingLevel.HEADING_2 }), table, new Paragraph({ text: "第一块", heading: HeadingLevel.HEADING_2 }), new Paragraph("01｜T1｜修理路灯｜埋R1")] }] });
  const file = path.join(root, "示例.docx");
  await fs.writeFile(file, await Packer.toBuffer(doc));
  const result = await readImportFiles([file]);
  assert.equal(result.network.tables.find((item) => item.kind === "threads").rows.length, 1);
  assert.equal(result.network.tables.find((item) => item.kind === "chapters").rows.length, 1);
});

test("Word中的纯文字竖线表也能识别，原始文字不被删改", () => {
  const text = "# 统筹资料\n## POV线程\n线 | 名称 | 活跃章区\nT1 | 调查线 | 1-8\n\n## 世界钟\n块 | 东区 | 西区\n块一 | 出发(1) | 收信(2)\n";
  const network = parseDocuments([{ name: "合集.docx", text }]);
  assert.equal(network.tables.find((table) => table.kind === "threads").rows.length, 1);
  assert.equal(network.tables.find((table) => table.kind === "clock").rows[0].cells[2], "收信(2)");
  assert.equal(network.documents[0].text, text);
});

test("项目交换超出小说网容量时拒绝导入，已有数据完整保留", async () => {
  const root = await project("capacity");
  const networks = Array.from({ length: 20 }, (_, index) => ({ ...simpleNetwork(), id: `network_${index}`, title: `规划${index}` }));
  await workspace.mergeImportedWorkspace(root, { novelNetworks: networks });
  const before = (await workspace.loadWorkspace(root)).novelNetworks;
  await assert.rejects(workspace.mergeImportedWorkspace(root, { novelNetworks: [{ ...simpleNetwork(), id: "extra" }] }), /容量|20/);
  assert.deepEqual((await workspace.loadWorkspace(root)).novelNetworks, before);
});

test("世界钟与正文对齐的计划章落点可以双向导航", async () => {
  const Module = require("node:module");
  const sourceFile = path.join(__dirname, "..", "src", "lib", "novel-network.ts");
  const compiled = require("esbuild").transformSync(await fs.readFile(sourceFile, "utf8"), { loader: "ts", format: "cjs" }).code;
  const helper = new Module(sourceFile); helper._compile(compiled, sourceFile);
  const network = parseDocuments([{ name: "关联.md", text: "## 世界钟\n| 块 | 东区 |\n|---|---|\n| 第一块 | 公告(1-2) |\n## 已写章节对齐\n| 已写章 | 素材落位（新排期章号） |\n|---|---|\n| 开篇 | 1 |\n## 排期\n01｜T1｜修理路灯｜埋R1\n02｜T2｜核对公告｜验R2\n" }]);
  const clock = network.tables.find(table => table.kind === "clock");
  const alignment = network.tables.find(table => table.kind === "alignment");
  assert.equal(helper.exports.relatedNetworkRows(network, clock, clock.rows[0]).filter(match => match.table.kind === "chapters").length, 2);
  assert.equal(helper.exports.relatedNetworkRows(network, alignment, alignment.rows[0]).filter(match => match.table.kind === "chapters").length, 1);
});
