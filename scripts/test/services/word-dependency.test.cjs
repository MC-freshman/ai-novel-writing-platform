const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createRequire } = require("node:module");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel } = require("docx");
const mammoth = require("../../../electron/services/word-import.cjs");
const { fixture } = require("../helpers/service-fixture.cjs");

test("Word运行时使用无sprintf-js依赖的argparse 2，mammoth版本保留", () => {
  const fromMammoth = createRequire(require.resolve("mammoth"));
  assert.equal(fromMammoth("argparse/package.json").version, "2.0.1");
  assert.equal(fromMammoth("argparse/package.json").dependencies?.["sprintf-js"], undefined);
  assert.equal(require("mammoth/package.json").version, "1.12.3");
});

test("升级命令行依赖后，Word标题/中文/表格的库转换及CLI HTML/Markdown输出仍兼容", async (t) => {
  const root = await fixture(t);
  const file = path.join(root, "中文文档.docx");
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ text: "合成章标题", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun("中文合成正文"), new TextRun({ text: "加粗片段", bold: true })] }),
    new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph("角色列")] }), new TableCell({ children: [new Paragraph("合成人物")] })] })] }),
  ] }] });
  await fs.writeFile(file, await Packer.toBuffer(doc));
  const library = await mammoth.convertToHtml({ path: file });
  assert.match(library.value, /<h1>合成章标题<\/h1>/);
  assert.match(library.value, /<strong>加粗片段<\/strong>/);
  assert.match(library.value, /<table>[\s\S]*角色列[\s\S]*合成人物/);
  const cli = path.join(path.dirname(require.resolve("mammoth/package.json")), "bin", "mammoth");
  const runtime = ["--require", path.resolve(__dirname, "../../../electron/services/word-import.cjs"), cli];
  const html = await execFile(process.execPath, [...runtime, file, "--output-format", "html"]);
  assert.equal(html.stdout.trim(), library.value);
  const markdown = await execFile(process.execPath, [...runtime, file, "--output-format", "markdown"]);
  assert.match(markdown.stdout, /合成章标题[\s\S]*中文合成正文[\s\S]*角色列/);
  const help = await execFile(process.execPath, [...runtime, "--help"]);
  assert.match(help.stdout, /docx-path/);
  await assert.rejects(execFile(process.execPath, [...runtime, file, "--output-format", "invalid"]), (error) => {
    assert.equal(error.code, 2);
    assert.match(error.stderr, /invalid choice/i);
    return true;
  });
});
