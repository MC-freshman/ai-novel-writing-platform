const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const AdmZip = require("adm-zip");

process.env.NOVEL_PLATFORM_TEST = "1";

const platform = require("../electron/main.cjs");
const workspace = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDirectory = path.join(workspace, ".test-runs", `batch_export_${runId}`);
const projectPath = path.join(runDirectory, "project");
const outputPath = path.join(runDirectory, "output");

async function listDocxFiles(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listDocxFiles(entryPath)));
    else if (entry.name.toLowerCase().endsWith(".docx")) files.push(entryPath);
  }
  return files;
}

async function main() {
  await fs.mkdir(outputPath, { recursive: true });
  await platform.ensureProjectStructure(projectPath, "批量导出测试");
  const config = await platform.loadConfig(projectPath);
  const specs = [
    ["主线大纲", "大纲", "大纲"],
    ["支线大纲", "大纲", "大纲"],
    ["物品设定", "补充材料", "补充材料"],
    ["装备设定", "补充材料", "补充材料"],
    ["地点设定", "补充材料", "补充材料"],
    ["北境文化札记", "世界文化", "补充材料"],
    ["南境文化札记", "世界文化", "补充材料"],
    ["东境文化札记", "世界文化", "补充材料"],
    ["西境文化札记", "世界文化", "补充材料"],
    ["群岛文化札记", "世界文化", "补充材料"],
  ];

  config.title = "回归测试项目";
  config.chapters = [];
  for (const [index, [title, volume, knowledgeRole]] of specs.entries()) {
    const fileName = `test_${String(index + 1).padStart(2, "0")}${index === 2 ? ".html" : ".md"}`;
    const content =
      index === 2
        ? `<h1>${title}</h1><h2>材料属性</h2><table><tr><th>名称</th><th>用途</th></tr><tr><td>测试材料</td><td>测试用途</td></tr></table>`
        : `# ${title}\n\n## 可折叠小标题\n\n测试内容 ${index + 1}`;
    const chapter = {
      id: `export_test_${index + 1}`,
      title,
      volume,
      knowledgeRole,
      order: index,
      fileName,
      wordCount: content.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    config.chapters.push(chapter);
    await fs.writeFile(platform.getChapterPath(projectPath, chapter), content, "utf8");
  }
  await platform.saveConfig(projectPath, config);

  const result = await platform.exportBookDocumentsToDirectory(projectPath, outputPath, {
    includeOutline: true,
    includeMaterials: true,
  });
  const files = await listDocxFiles(result.directoryPath);
  assert.equal(result.exportedCount, 10, "十个目录树文档应返回十个导出结果");
  assert.equal(result.failedCount, 0, "十个有效文档不应出现导出失败");
  assert.equal(files.length, 10, "十个目录树文档应生成十个 docx 文件");
  assert.equal(result.chapterCount, 10, "目录树导出计数应为十个");

  for (const filePath of files) {
    const zip = new AdmZip(filePath);
    assert.ok(zip.getEntry("word/document.xml"), `${filePath} 必须是有效 docx`);
  }
  const tableFile = files.find((filePath) => path.basename(filePath).startsWith("物品设定"));
  assert.ok(tableFile, "应导出物品设定");
  const tableXml = new AdmZip(tableFile).getEntry("word/document.xml").getData().toString("utf8");
  assert.match(tableXml, /<w:tbl>/, "富文档表格应作为 Word 表格导出");

  config.chapters[0].knowledgeRole = "正文";
  await platform.saveConfig(projectPath, config);
  const bodyResult = await platform.exportBookDocumentsToDirectory(projectPath, outputPath, {});
  assert.equal(bodyResult.exportedCount, 1, "只导出正文时不应混入大纲或补充材料");

  console.log(`PASS: 逐篇导出、目录分类、选项过滤和表格均正常。测试目录：${runDirectory}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
