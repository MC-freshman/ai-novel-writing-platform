"use strict";
// 多格式导出测试（P79）：EPUB OCF 结构/XHTML 良构/图片提取/TXT 命名/注册表分发。
// PDF 依赖真实 Electron 窗口，列为真机验证项（P 表 V2），不在纯 Node 套件内执行。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { fixture } = require("../helpers/service-fixture.cjs");
const registry = require("../../../electron/services/export-providers/registry.cjs");
const epub = require("../../../electron/services/export-providers/epub.cjs");
const txt = require("../../../electron/services/export-providers/txt.cjs");
const { htmlToXhtml, contentToHtml } = require("../../../electron/services/export-providers/shared.cjs");

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function makeProject(root, chapters) {
  const project = path.join(root, "project");
  await fs.mkdir(path.join(project, "chapters"), { recursive: true });
  const now = new Date().toISOString();
  const config = {
    version: 1, title: "导出验证小说", author: "测试作者", createdAt: now, updatedAt: now,
    api: { provider: "deepseek", apiKey: "", baseUrl: "", chatModel: "", embeddingProvider: "", embeddingApiKey: "", embeddingBaseUrl: "", embeddingModel: "", temperature: 0.7, maxTokens: 2048, topK: 5, scanK: 50, sendFullText: false },
    ui: { theme: "light", fontSize: 16, lineHeight: 1.8, autosaveMs: 2000, backupOnSave: true, recoveryEnabled: true },
    agent: { autoLocalAnalysis: false, autoDeepAnalysis: false, evidenceRequired: true, snapshotBeforeBulkChanges: true, permissionLevel: "只读分析" },
    stats: { todayDate: "", todayWords: 0, totalWords: 0, lastAutoBackupAt: "" },
    chapters: chapters.map((chapter, index) => ({ id: `ch_${index}`, title: chapter.title, fileName: chapter.fileName, order: index, volume: chapter.volume || "卷一", knowledgeRole: "正文", wordCount: 10 })),
  };
  await fs.writeFile(path.join(project, "novel.config.json"), JSON.stringify(config, null, 2));
  for (const chapter of chapters)
    await fs.writeFile(path.join(project, "chapters", chapter.fileName), chapter.content);
  return project;
}

test("注册表列出三种格式并拒绝未知格式", () => {
  const formats = registry.listFormats();
  assert.deepEqual(formats.map((item) => item.id).sort(), ["epub", "pdf", "txt"]);
  assert.equal(registry.getProvider("epub").mode, "file");
  assert.equal(registry.getProvider("txt").mode, "directory");
  assert.throws(() => registry.getProvider("mobi"), /不支持的导出格式/);
});

test("EPUB 结构：mimetype 首条目不压缩、OPF/导航/章节齐备、图片提取", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, [
    { title: "第一章 起风", fileName: "chapter_001.md", content: "# 第一章 起风\n\n夜里起了风。\n\n第二段。" },
    { title: "第二章 落雨", fileName: "chapter_002.html", content: `<h2>第二章 落雨</h2><p>雨落下来了。</p><img src="data:image/png;base64,${PNG_1PX}" alt="雨"/>` },
  ]);
  const target = path.join(root, "book.epub");
  const result = await epub.export(project, target);
  assert.deepEqual(result.files, [target]);
  const zip = new AdmZip(target);
  const entries = zip.getEntries();
  assert.equal(entries[0].entryName, "mimetype", "mimetype 必须为首个条目");
  assert.equal(entries[0].header.method, 0, "mimetype 必须不压缩（stored）");
  assert.equal(entries[0].getData().toString("utf8"), "application/epub+zip");
  const names = entries.map((entry) => entry.entryName);
  for (const required of ["META-INF/container.xml", "OEBPS/content.opf", "OEBPS/nav.xhtml", "OEBPS/style.css", "OEBPS/chapter-0001.xhtml", "OEBPS/chapter-0002.xhtml", "OEBPS/images/img-1.png"])
    assert.ok(names.includes(required), `缺少 ${required}`);
  const opf = zip.readAsText("OEBPS/content.opf");
  assert.ok(opf.includes("<dc:title>导出验证小说</dc:title>"));
  assert.ok(opf.includes("<dc:creator>测试作者</dc:creator>"));
  assert.ok(opf.includes('<itemref idref="ch1"/>') && opf.includes('<itemref idref="ch2"/>'));
  assert.ok(opf.includes('properties="nav"'));
  const nav = zip.readAsText("OEBPS/nav.xhtml");
  assert.ok(nav.includes("第一章 起风") && nav.includes("第二章 落雨"));
  const chapter2 = zip.readAsText("OEBPS/chapter-0002.xhtml");
  assert.ok(chapter2.includes('src="images/img-1.png"'), "data: 图片须改写为资源引用");
  assert.ok(chapter2.includes("<img"), "图片须保留");
  assert.ok(/<img[^>]*\/>/.test(chapter2), "void 元素须自闭合（XHTML 良构）");
  assert.ok(!chapter2.includes("<script"), "脚本须剥离");
  const image = zip.getEntry("OEBPS/images/img-1.png").getData();
  assert.equal(image.toString("base64"), PNG_1PX);
  // 良构性：零依赖标签配平校验（自闭合/void 处理、实体之外不允许裸 < >）
  const assertWellFormed = (xml, name) => {
    const stack = [];
    const tagPattern = /<\/?([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>/g;
    let match;
    let consumed = 0;
    while ((match = tagPattern.exec(xml)) !== null) {
      const between = xml.slice(consumed, match.index);
      assert.ok(!/[<>]/.test(between.replace(/&[a-z]+;|&#\d+;/gi, "")), `${name} 文本含未转义尖括号`);
      consumed = match.index + match[0].length;
      if (!match[1]) continue;
      const [, tag, , selfClose] = match;
      if (match[0].startsWith("</")) {
        assert.equal(stack.pop(), tag, `${name} 闭合标签不配平：${tag}`);
      } else if (!selfClose) {
        stack.push(tag);
      }
    }
    assert.equal(stack.length, 0, `${name} 存在未闭合标签：${stack.join(",")}`);
  };
  for (const name of ["OEBPS/chapter-0001.xhtml", "OEBPS/chapter-0002.xhtml", "OEBPS/content.opf", "OEBPS/nav.xhtml", "META-INF/container.xml"])
    assertWellFormed(zip.readAsText(name), name);
});

test("TXT 逐章导出：命名/标题行/分卷目录/图片警告", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, [
    { title: "第一章 起风", fileName: "chapter_001.md", content: "夜里起了风。", volume: "卷一" },
    { title: "第二章 落雨", fileName: "chapter_002.html", content: `<p>雨落下来了。</p><img src="data:image/png;base64,${PNG_1PX}"/>`, volume: "卷二" },
  ]);
  const targetDir = path.join(root, "txt-out");
  await fs.mkdir(targetDir);
  const result = await txt.export(project, targetDir, { byVolume: true });
  assert.equal(result.files.length, 2);
  assert.ok(result.files[0].includes(path.join("卷一", "001-第一章_起风.txt")), "sanitizeFileName 空格转下划线");
  assert.ok(result.files[1].includes(path.join("卷二", "002-第二章_落雨.txt")));
  const first = await fs.readFile(result.files[0], "utf8");
  assert.ok(first.startsWith("第一章 起风\n\n"), "首行为章节标题");
  assert.ok(first.includes("夜里起了风。"));
  assert.ok(result.warnings.some((warning) => warning.includes("图片")), "含图章节须给出警告");
  // 不分卷 + 无标题行
  const flat = await txt.export(project, targetDir, { byVolume: false, titleLine: false });
  const flatContent = await fs.readFile(flat.files[0], "utf8");
  assert.ok(!flatContent.startsWith("第一章"), "titleLine=false 不加标题行");
});

test("空书拒绝导出；XHTML 序列化剥离脚本并转义实体", async (t) => {
  const root = await fixture(t);
  const project = await makeProject(root, []);
  await assert.rejects(() => epub.export(project, path.join(root, "x.epub")), /没有可导出的正文章节/);
  await assert.rejects(() => txt.export(project, root, {}), /没有可导出的正文章节/);
  const xhtml = htmlToXhtml('<p>A &amp; B &lt; C</p><script>alert(1)</script><style>x{}</style><br><img src="x.png">', null);
  assert.ok(xhtml.includes("A &amp; B &lt; C"));
  assert.ok(!xhtml.includes("alert"));
  assert.ok(!xhtml.includes("x{}"));
  assert.ok(xhtml.includes("<br/>"));
  const fromMarkdown = contentToHtml("# 标题\n\n正文段落");
  assert.ok(fromMarkdown.includes("<h1>"));
});