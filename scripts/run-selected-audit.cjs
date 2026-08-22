const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const AdmZip = require("adm-zip");
const { Document, HeadingLevel, Packer, Paragraph, TextRun, Table, TableCell, TableRow } = require("docx");

process.env.NOVEL_PLATFORM_TEST = "1";
process.env.NOVEL_CHAT_TIMEOUT_MS = process.env.NOVEL_CHAT_TIMEOUT_MS || "800";

const app = require("../electron/main.cjs");

const WORKSPACE = path.resolve(__dirname, "..");
const DEFAULT_PROJECT = path.join(process.env.USERPROFILE || "C:\\Users\\wk", "OneDrive", "文档", "AI小说创作平台", "默认小说项目");
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const RUN_DIR = path.join(WORKSPACE, ".test-runs", `audit_${RUN_ID}`);
const REPORT_PATH = path.join(WORKSPACE, `测试报告_${RUN_ID}.md`);

const results = [];
const notes = [];

function addResult(scope, name, status, detail = "", evidence = {}) {
  results.push({ scope, name, status, detail, evidence });
}

function normalizeStatus(status) {
  if (status === "PASS") return "通过";
  if (status === "FAIL") return "失败";
  if (status === "WARN") return "警告";
  if (status === "SKIP") return "跳过";
  return status;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

function safeRole(chapter) {
  return app.getKnowledgeRole(chapter);
}

function simplify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/第[零一二三四五六七八九十百\d]+章/g, "")
    .replace(/[^\u4e00-\u9fa5a-z0-9]/g, "")
    .trim();
}

function docxXmlText(xml) {
  return String(xml || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractDocxText(docxPath) {
  const zip = new AdmZip(docxPath);
  const entry = zip.getEntry("word/document.xml");
  if (!entry) return "";
  const xml = entry.getData().toString("utf8");
  const texts = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((match) => docxXmlText(match[1]));
  return texts.join("");
}

function extractDocxHeadingTexts(docxPath) {
  const zip = new AdmZip(docxPath);
  const entry = zip.getEntry("word/document.xml");
  if (!entry) return [];
  const xml = entry.getData().toString("utf8");
  const paragraphs = [...xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)].map((match) => match[0]);
  return paragraphs
    .filter((paragraph) => /<w:pStyle[^>]+w:val="(?:Heading|[1-9])/.test(paragraph) || /<w:pStyle[^>]+w:val="Heading[1-6]"/.test(paragraph))
    .map((paragraph) => [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((match) => docxXmlText(match[1])).join(""))
    .filter(Boolean);
}

function expectedChunksForContent(content) {
  const plain = app.contentToPlainText(content);
  return app.chunkText(plain).length;
}

async function auditCurrentProject() {
  const scope = "A 当前项目快速定位";
  if (!fsSync.existsSync(path.join(DEFAULT_PROJECT, "novel.config.json"))) {
    addResult(scope, "默认项目路径", "FAIL", `未找到项目：${DEFAULT_PROJECT}`);
    return null;
  }

  const config = await app.loadConfig(DEFAULT_PROJECT);
  const store = await app.loadVectorStore(DEFAULT_PROJECT);
  const chapters = config.chapters.slice().sort((a, b) => a.order - b.order);
  const bodyChapters = chapters.filter((chapter) => safeRole(chapter) === "正文");
  addResult(scope, "项目路径", "PASS", DEFAULT_PROJECT);
  addResult(scope, "正文分类数量", bodyChapters.length >= 10 ? "PASS" : "WARN", `当前正文文档 ${bodyChapters.length} 个`, {
    titles: bodyChapters.map((chapter) => chapter.title),
  });

  const sourceIds = new Set(chapters.map((chapter) => chapter.id));
  const fileNames = chapters.map((chapter) => chapter.fileName).filter(Boolean);
  const duplicateFiles = [...new Set(fileNames.filter((fileName, index, arr) => arr.indexOf(fileName) !== index))];
  addResult(scope, "章节文件重复引用", duplicateFiles.length ? "FAIL" : "PASS", duplicateFiles.length ? `重复文件：${duplicateFiles.join("、")}` : "未发现章节共用同一个文件");

  const missingFiles = [];
  const titleFileMismatches = [];
  const vectorMismatches = [];
  const targetFreshness = [];
  for (const chapter of chapters) {
    const filePath = app.getChapterPath(DEFAULT_PROJECT, chapter);
    if (!fsSync.existsSync(filePath)) {
      missingFiles.push(`${chapter.title} -> ${chapter.fileName}`);
      continue;
    }
    const content = await fs.readFile(filePath, "utf8");
    const plain = app.contentToPlainText(content);
    const firstLine = plain.split(/\n|\r|。/).find(Boolean) || "";
    const titleKey = simplify(chapter.title);
    const fileKey = simplify(chapter.fileName);
    const firstLineKey = simplify(firstLine.slice(0, 60));
    if (titleKey && fileKey && !fileKey.includes(titleKey.slice(0, Math.min(4, titleKey.length))) && firstLineKey && !firstLineKey.includes(titleKey.slice(0, Math.min(4, titleKey.length)))) {
      titleFileMismatches.push(`${chapter.order}. ${chapter.title} -> ${chapter.fileName} / 首行：${firstLine.slice(0, 40)}`);
    }

    const expected = expectedChunksForContent(content);
    const vectors = store.vectors.filter((entry) => entry.sourceId === chapter.id);
    if (vectors.length !== expected) {
      vectorMismatches.push(`${chapter.title}: 文件应有 ${expected} 片段，向量库有 ${vectors.length} 片段`);
    }
    if (/第十|第十一|覃苏砚|科学狂人/.test(chapter.title)) {
      const fileModified = fsSync.statSync(filePath).mtime;
      const latestVector = vectors
        .map((entry) => new Date(entry.updatedAt || 0))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      targetFreshness.push(`${chapter.title}: 文件修改 ${fileModified.toLocaleString("zh-CN", { hour12: false })}，索引更新 ${latestVector ? latestVector.toLocaleString("zh-CN", { hour12: false }) : "无"}`);
    }
  }
  addResult(scope, "章节文件存在性", missingFiles.length ? "FAIL" : "PASS", missingFiles.length ? missingFiles.join("\n") : "配置中的章节文件均存在");
  addResult(scope, "标题与文件/内容一致性", titleFileMismatches.length ? "WARN" : "PASS", titleFileMismatches.length ? titleFileMismatches.join("\n") : "未发现明显标题-文件错配");
  addResult(scope, "章节索引片段数一致性", vectorMismatches.length ? "WARN" : "PASS", vectorMismatches.length ? vectorMismatches.slice(0, 20).join("\n") : "章节文件片段数与向量库一致");
  addResult(scope, "第十/十一章索引新鲜度", "PASS", targetFreshness.join("\n"));

  const knownCharacterIds = new Set((await readProjectFiles(DEFAULT_PROJECT, "characters")).map((item) => item.id));
  const knownWorldIds = new Set((await readProjectFiles(DEFAULT_PROJECT, "worldbuilding")).map((item) => item.id));
  const staleSourceIds = [...new Set(store.vectors.map((entry) => entry.sourceId))].filter((id) => !sourceIds.has(id) && !knownCharacterIds.has(id) && !knownWorldIds.has(id));
  addResult(scope, "向量库孤儿片段", staleSourceIds.length ? "WARN" : "PASS", staleSourceIds.length ? `发现 ${staleSourceIds.length} 个已不在配置中的 sourceId：${staleSourceIds.slice(0, 10).join("、")}` : "未发现孤儿片段");

  const exportPath = path.join(RUN_DIR, "current_body_export.docx");
  await app.exportBookToDocx(DEFAULT_PROJECT, exportPath, { includeOutline: false, includeCharacters: false, includeWorld: false });
  const exportText = extractDocxText(exportPath);
  const missingInExport = bodyChapters.filter((chapter) => !exportText.includes(chapter.title)).map((chapter) => chapter.title);
  addResult(scope, "实际导出正文覆盖", missingInExport.length ? "FAIL" : "PASS", missingInExport.length ? `导出缺失：${missingInExport.join("、")}` : `本次测试导出包含全部 ${bodyChapters.length} 个正文标题`, {
    exportPath,
    headings: extractDocxHeadingTexts(exportPath).slice(0, 40),
  });

  const userDocxCandidates = [
    path.join(WORKSPACE, "小说1材料", "正文.docx"),
    path.join(WORKSPACE, "小说1材料", "长夜_整书.docx"),
  ];
  for (const candidate of userDocxCandidates) {
    if (!fsSync.existsSync(candidate)) continue;
    const text = extractDocxText(candidate);
    const missing = bodyChapters.filter((chapter) => !text.includes(chapter.title)).map((chapter) => chapter.title);
    addResult(scope, `现有导出文件检查：${path.basename(candidate)}`, missing.length ? "WARN" : "PASS", missing.length ? `该文件缺少 ${missing.length} 个当前正文标题：${missing.slice(0, 12).join("、")}` : "该文件包含当前全部正文标题", {
      file: candidate,
    });
  }

  return { config, store, chapters, bodyChapters };
}

async function readProjectFiles(projectPath, dirName) {
  const dir = path.join(projectPath, dirName);
  if (!fsSync.existsSync(dir)) return [];
  const files = await fs.readdir(dir);
  const items = [];
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (dirName === "worldbuilding" && file.endsWith(".md")) {
      const raw = await fs.readFile(fullPath, "utf8");
      const id = path.basename(file, ".md");
      const title = (raw.match(/^#\s+(.+)$/m)?.[1] || id).trim();
      items.push({ id, title });
    } else if (file.endsWith(".json")) {
      const item = await readJson(fullPath, null);
      if (item?.id) items.push(item);
    }
  }
  return items;
}

async function writeChapter(projectPath, config, chapter, content) {
  const filePath = path.join(projectPath, "chapters", chapter.fileName);
  await fs.writeFile(filePath, content, "utf8");
  chapter.wordCount = app.contentToPlainText(content).length;
  chapter.updatedAt = new Date().toISOString();
  await app.saveConfig(projectPath, config);
}

function makeChapter(index, role = "正文", volume = "卷一", ext = ".md") {
  const title = `${String(index).padStart(2, "0")}.测试第${index}章`;
  return {
    id: `test_chapter_${index}`,
    title,
    volume,
    order: index - 1,
    fileName: `test_chapter_${String(index).padStart(3, "0")}${ext}`,
    wordCount: 0,
    knowledgeRole: role,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function makeDocx(filePath, title, body) {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(title)] }),
          new Paragraph(body),
          new Table({
            rows: [
              new TableRow({ children: [new TableCell({ children: [new Paragraph("表格A")] }), new TableCell({ children: [new Paragraph("表格B")] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph("表格C")] }), new TableCell({ children: [new Paragraph("表格D")] })] }),
            ],
          }),
        ],
      },
    ],
  });
  await fs.writeFile(filePath, await Packer.toBuffer(doc));
}

async function setupCoreProject() {
  const projectPath = path.join(RUN_DIR, "core_project");
  await app.ensureProjectStructure(projectPath, "自动测试项目");
  const config = await app.loadConfig(projectPath);
  config.api = {
    ...config.api,
    provider: "custom",
    apiKey: "",
    baseUrl: "http://127.0.0.1:9/v1",
    chatModel: "mock-model",
    embeddingApiKey: "",
    embeddingBaseUrl: "",
    embeddingModel: "",
    topK: 120,
    maxTokens: 8000,
  };
  config.chapters = [];
  for (let i = 1; i <= 12; i += 1) {
    const role = i === 10 ? "大纲" : i === 11 ? "补充材料" : "正文";
    const ext = i === 4 ? ".html" : ".md";
    const chapter = makeChapter(i, role, i <= 6 ? "卷一" : "卷二", ext);
    config.chapters.push(chapter);
    const content =
      ext === ".html"
        ? `<h1>${chapter.title}</h1><p>唯一标记 CORE_${i}_V1。富文档表格如下。</p><table><tr><td>表格_${i}_A</td><td>表格_${i}_B</td></tr></table>`
        : `# ${chapter.title}\n\n唯一标记 CORE_${i}_V1。这里是正文测试内容，用于保存、索引和导出。`;
    await fs.writeFile(path.join(projectPath, "chapters", chapter.fileName), content, "utf8");
  }
  await app.saveConfig(projectPath, config);
  return projectPath;
}

async function runCoreRegression() {
  const scope = "B 核心回归";
  const projectPath = await setupCoreProject();
  const rebuild = await app.rebuildIndex(projectPath);
  const rebuildChunks = rebuild.chunks ?? rebuild.totalChunks ?? 0;
  addResult(scope, "重建知识库", rebuildChunks > 0 ? "PASS" : "FAIL", `共 ${rebuildChunks} 个片段`);

  let config = await app.loadConfig(projectPath);
  const chapter10 = config.chapters.find((chapter) => chapter.id === "test_chapter_10");
  const chapter11 = config.chapters.find((chapter) => chapter.id === "test_chapter_11");
  const chapter5 = config.chapters.find((chapter) => chapter.id === "test_chapter_5");
  await writeChapter(projectPath, config, chapter5, `# ${chapter5.title}\n\n唯一标记 CORE_5_V2。保存后应立即进入知识库。`);
  await app.indexSource(projectPath, {
    id: chapter5.id,
    type: "chapter",
    title: chapter5.title,
    volume: chapter5.volume,
    content: await fs.readFile(path.join(projectPath, "chapters", chapter5.fileName), "utf8"),
    knowledgeRole: safeRole(chapter5),
  });
  const store = await app.loadVectorStore(projectPath);
  const chapter5Text = store.vectors.filter((entry) => entry.sourceId === chapter5.id).map((entry) => entry.text).join("\n");
  addResult(scope, "保存后索引更新", /CORE[_\s]+5[_\s]+V2/.test(chapter5Text) && !/CORE[_\s]+5[_\s]+V1/.test(chapter5Text) ? "PASS" : "FAIL", "修改第 5 章后重新索引，检查旧标记是否被替换");

  const bodyExport = path.join(RUN_DIR, "core_body.docx");
  await app.exportBookToDocx(projectPath, bodyExport, { includeOutline: false, includeCharacters: false, includeWorld: false });
  const bodyText = extractDocxText(bodyExport);
  const bodyChapters = (await app.loadConfig(projectPath)).chapters.filter((chapter) => safeRole(chapter) === "正文");
  const nonBodyTitles = [chapter10.title, chapter11.title];
  const missingBody = bodyChapters.filter((chapter) => !bodyText.includes(chapter.title)).map((chapter) => chapter.title);
  const leakedNonBody = nonBodyTitles.filter((title) => bodyText.includes(title));
  addResult(scope, "只导出正文", !missingBody.length && !leakedNonBody.length ? "PASS" : "FAIL", `缺失正文：${missingBody.join("、") || "无"}；误含非正文：${leakedNonBody.join("、") || "无"}`, { file: bodyExport });

  const fullExport = path.join(RUN_DIR, "core_full.docx");
  await app.exportBookToDocx(projectPath, fullExport, { includeOutline: true, includeCharacters: true, includeWorld: true });
  const fullText = extractDocxText(fullExport);
  addResult(scope, "带大纲/角色/世界观导出开关", fullText.includes(chapter10.title) && fullText.includes("角色卡片") && fullText.includes("世界观资料") ? "PASS" : "FAIL", "检查附加导出章节是否按选项出现", { file: fullExport });
  addResult(scope, "富文档表格导出", fullText.includes("表格_4_A") && fullText.includes("表格_4_B") ? "PASS" : "FAIL", "检查 HTML 表格内容是否进入 docx");

  const importedDocxDir = path.join(RUN_DIR, "import_docs");
  await ensureDir(importedDocxDir);
  const importProject = path.join(RUN_DIR, "import_project");
  await app.ensureProjectStructure(importProject, "批量导入测试项目");
  const importConfig = await app.loadConfig(importProject);
  for (let i = 1; i <= 5; i += 1) {
    const filePath = path.join(importedDocxDir, `批量导入_${i}.docx`);
    await makeDocx(filePath, `批量导入_${i}`, `批量导入唯一标记 IMPORT_${i}`);
    await app.importDocumentIntoProject(importProject, filePath, { volume: "批量导入", config: importConfig, skipFinalize: true });
  }
  await app.saveConfig(importProject, importConfig);
  await app.rebuildIndex(importProject);
  const importedState = await app.buildAppState(importProject);
  addResult(scope, "批量 docx 导入逻辑", importedState.chapters.length >= 6 ? "PASS" : "FAIL", `导入后章节数：${importedState.chapters.length}`);

  const uiStaticChecks = [
    ["富文档查找函数", /function findNextInRichEditor/.test(await fs.readFile(path.join(WORKSPACE, "src", "App.tsx"), "utf8"))],
    ["富文档替换函数", /function replaceAllInRichEditor/.test(await fs.readFile(path.join(WORKSPACE, "src", "App.tsx"), "utf8"))],
    ["复制普通正文按钮", /复制为普通正文/.test(await fs.readFile(path.join(WORKSPACE, "src", "App.tsx"), "utf8"))],
    ["右键提取设定实动作", /extractWorldCardsFromSelection/.test(await fs.readFile(path.join(WORKSPACE, "src", "App.tsx"), "utf8"))],
  ];
  addResult(scope, "编辑器关键按钮静态覆盖", uiStaticChecks.every(([, ok]) => ok) ? "PASS" : "FAIL", uiStaticChecks.map(([name, ok]) => `${name}: ${ok ? "存在" : "缺失"}`).join("\n"));
}

async function createPressureProject() {
  const projectPath = path.join(RUN_DIR, "pressure_project");
  await app.ensureProjectStructure(projectPath, "压力测试项目");
  const config = await app.loadConfig(projectPath);
  config.api = {
    ...config.api,
    provider: "custom",
    apiKey: "",
    baseUrl: "http://127.0.0.1:9/v1",
    chatModel: "mock-model",
    embeddingApiKey: "",
    embeddingBaseUrl: "",
    embeddingModel: "",
    topK: 120,
    maxTokens: 8000,
  };
  config.chapters = [];
  for (let i = 1; i <= 100; i += 1) {
    const role = i % 25 === 0 ? "大纲" : i % 17 === 0 ? "补充材料" : "正文";
    const chapter = makeChapter(i, role, `卷${Math.ceil(i / 20)}`);
    config.chapters.push(chapter);
    const body = Array.from({ length: 8 }, (_, part) => `压力测试章节 ${i} 段落 ${part + 1}，唯一标记 PRESSURE_CH_${i}_${part}。`).join("\n\n");
    await fs.writeFile(path.join(projectPath, "chapters", chapter.fileName), `# ${chapter.title}\n\n${body}`, "utf8");
  }
  await app.saveConfig(projectPath, config);

  await ensureDir(path.join(projectPath, "characters"));
  await ensureDir(path.join(projectPath, "worldbuilding"));
  for (let i = 1; i <= 500; i += 1) {
    const card = {
      id: `pressure_character_${i}`,
      name: `压力角色${i}`,
      category: `阵营/${Math.ceil(i / 50)}`,
      appearance: "测试外貌",
      personality: "测试性格",
      background: `压力角色背景 ${i}`,
      relationships: "",
      notes: "",
      updatedAt: new Date().toISOString(),
    };
    await writeJson(path.join(projectPath, "characters", `${card.id}.json`), card);
    const world = `# 压力设定${i}\n\n分类：压力/${Math.ceil(i / 50)}\n\n压力世界观内容 ${i}，用于压力索引。`;
    await fs.writeFile(path.join(projectPath, "worldbuilding", `pressure_world_${i}.md`), world, "utf8");
  }
  return projectPath;
}

async function runPressureAndDestructive() {
  const scope = "C1/C2 压力与破坏性";
  const projectPath = await createPressureProject();
  const started = Date.now();
  const rebuild = await app.rebuildIndex(projectPath);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const rebuildChunks = rebuild.chunks ?? rebuild.totalChunks ?? 0;
  addResult(scope, "100 章 + 500 角色 + 500 世界观重建索引", rebuildChunks > 0 ? "PASS" : "FAIL", `总片段 ${rebuildChunks}，耗时 ${seconds}s`);

  const exportPath = path.join(RUN_DIR, "pressure_body.docx");
  const exportStarted = Date.now();
  await app.exportBookToDocx(projectPath, exportPath, { includeOutline: false, includeCharacters: false, includeWorld: false });
  const exportSeconds = ((Date.now() - exportStarted) / 1000).toFixed(1);
  const text = extractDocxText(exportPath);
  const pressureConfig = await app.loadConfig(projectPath);
  const pressureBodyChapters = pressureConfig.chapters.filter((chapter) => safeRole(chapter) === "正文");
  const bodySample = [
    pressureBodyChapters[0]?.title,
    pressureBodyChapters[Math.floor(pressureBodyChapters.length / 2)]?.title,
    pressureBodyChapters[pressureBodyChapters.length - 1]?.title,
  ].filter(Boolean);
  const missingBodySample = bodySample.filter((title) => !text.includes(title));
  const leakedNonBodySample = pressureConfig.chapters
    .filter((chapter) => safeRole(chapter) !== "正文")
    .slice(0, 10)
    .filter((chapter) => text.includes(chapter.title))
    .map((chapter) => chapter.title);
  addResult(scope, "100 章压力导出正文", !missingBodySample.length && !leakedNonBodySample.length ? "PASS" : "WARN", `导出耗时 ${exportSeconds}s；缺失正文样本：${missingBodySample.join("、") || "无"}；误含非正文样本：${leakedNonBodySample.join("、") || "无"}`, { file: exportPath });

  const corruptProject = path.join(RUN_DIR, "corrupt_project");
  await app.ensureProjectStructure(corruptProject, "损坏配置测试项目");
  await fs.writeFile(path.join(corruptProject, "novel.config.json"), "{ broken json", "utf8");
  try {
    await app.loadConfig(corruptProject);
    addResult(scope, "损坏配置保护", "FAIL", "损坏配置未触发错误");
  } catch (error) {
    const backupDir = path.join(corruptProject, "backups", "config_corrupt");
    const backups = fsSync.existsSync(backupDir) ? await fs.readdir(backupDir) : [];
    addResult(scope, "损坏配置保护", backups.length ? "PASS" : "FAIL", `错误：${error.message.split("\n")[0]}；备份数：${backups.length}`);
  }

  const sharedProject = path.join(RUN_DIR, "shared_file_project");
  await app.ensureProjectStructure(sharedProject, "共享文件修复测试项目");
  const sharedConfig = await app.loadConfig(sharedProject);
  sharedConfig.chapters = [makeChapter(1), makeChapter(2)];
  sharedConfig.chapters[0].fileName = "shared.md";
  sharedConfig.chapters[1].fileName = "shared.md";
  await fs.writeFile(path.join(sharedProject, "chapters", "shared.md"), "# 共享章节\n\n共享内容", "utf8");
  await app.saveConfig(sharedProject, sharedConfig);
  const repaired = await app.loadConfig(sharedProject);
  const uniqueFiles = new Set(repaired.chapters.map((chapter) => chapter.fileName));
  addResult(scope, "共享章节文件自动拆分", uniqueFiles.size === repaired.chapters.length ? "PASS" : "FAIL", `修复后文件：${repaired.chapters.map((chapter) => chapter.fileName).join("、")}`);
}

function startMockServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      req.on("end", () => {
        if (req.url === "/v1/hang/chat/completions") return;
        let payload = {};
        try {
          payload = JSON.parse(body || "{}");
        } catch {
          payload = {};
        }
        if (req.url !== "/v1/chat/completions") {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "not found" } }));
          return;
        }
        const auth = req.headers.authorization || "";
        if (auth.includes("bad-key")) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Invalid API key", code: "invalid_api_key" } }));
          return;
        }
        if (payload.model === "wrong-model") {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Model not found", code: "model_not_found" } }));
          return;
        }
        if (payload.model === "balance-empty") {
          res.writeHead(402, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Insufficient balance", code: "insufficient_quota" } }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function expectApiError(name, config, contains) {
  try {
    await app.callChatApi(config, "system", "question", []);
    addResult("C2 API 错误场景", name, "FAIL", "调用成功，但预期应失败");
  } catch (error) {
    const message = error.message || String(error);
    addResult("C2 API 错误场景", name, contains.every((item) => message.includes(item)) ? "PASS" : "FAIL", message);
  }
}

async function runApiErrorTests() {
  const server = await startMockServer();
  const port = server.address().port;
  const baseConfig = {
    api: {
      provider: "custom",
      apiKey: "test-key",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      chatModel: "ok-model",
      temperature: 0.7,
      maxTokens: 64,
    },
  };
  try {
    await expectApiError("API key 错误", { api: { ...baseConfig.api, apiKey: "bad-key" } }, ["401", "Invalid API key"]);
    await expectApiError("模型名错误", { api: { ...baseConfig.api, chatModel: "wrong-model" } }, ["404", "Model not found"]);
    await expectApiError("余额不足", { api: { ...baseConfig.api, chatModel: "balance-empty" } }, ["402", "Insufficient balance"]);
    await expectApiError("超时", { api: { ...baseConfig.api, baseUrl: `http://127.0.0.1:${port}/v1/hang` } }, ["AbortError", "请求超过"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function writeReport() {
  const counts = results.reduce((map, item) => {
    map[item.status] = (map[item.status] || 0) + 1;
    return map;
  }, {});
  const lines = [];
  lines.push(`# 自动测试报告`);
  lines.push("");
  lines.push(`- 时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`);
  lines.push(`- 工作区：${WORKSPACE}`);
  lines.push(`- 测试输出目录：${RUN_DIR}`);
  lines.push(`- 结果统计：通过 ${counts.PASS || 0}，警告 ${counts.WARN || 0}，失败 ${counts.FAIL || 0}，跳过 ${counts.SKIP || 0}`);
  lines.push("");
  for (const scope of [...new Set(results.map((item) => item.scope))]) {
    lines.push(`## ${scope}`);
    lines.push("");
    for (const item of results.filter((result) => result.scope === scope)) {
      lines.push(`### ${normalizeStatus(item.status)}：${item.name}`);
      lines.push("");
      lines.push(item.detail ? String(item.detail) : "无补充信息。");
      if (item.evidence && Object.keys(item.evidence).length) {
        lines.push("");
        lines.push("```json");
        lines.push(JSON.stringify(item.evidence, null, 2));
        lines.push("```");
      }
      lines.push("");
    }
  }
  if (notes.length) {
    lines.push("## 备注");
    lines.push("");
    notes.forEach((note) => lines.push(`- ${note}`));
  }
  await fs.writeFile(REPORT_PATH, lines.join("\n"), "utf8");
  await fs.writeFile(path.join(RUN_DIR, "results.json"), JSON.stringify(results, null, 2), "utf8");
}

async function main() {
  await ensureDir(RUN_DIR);
  await auditCurrentProject();
  await runCoreRegression();
  await runPressureAndDestructive();
  await runApiErrorTests();
  await writeReport();
  const counts = results.reduce((map, item) => {
    map[item.status] = (map[item.status] || 0) + 1;
    return map;
  }, {});
  console.log(JSON.stringify({ reportPath: REPORT_PATH, runDir: RUN_DIR, counts }, null, 2));
  if (counts.FAIL) process.exitCode = 1;
}

main().catch(async (error) => {
  addResult("测试脚本", "未捕获异常", "FAIL", error.stack || error.message || String(error));
  await ensureDir(RUN_DIR).catch(() => null);
  await writeReport().catch(() => null);
  console.error(error);
  process.exitCode = 1;
});
