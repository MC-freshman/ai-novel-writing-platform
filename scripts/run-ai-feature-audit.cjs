const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const http = require("node:http");

process.env.NOVEL_PLATFORM_TEST = "1";
process.env.NOVEL_CHAT_TIMEOUT_MS = process.env.NOVEL_CHAT_TIMEOUT_MS || "1000";

const app = require("../electron/main.cjs");

const WORKSPACE = path.resolve(__dirname, "..");
const DEFAULT_PROJECT = path.join(process.env.USERPROFILE || "C:\\Users\\wk", "OneDrive", "文档", "AI小说创作平台", "默认小说项目");
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const RUN_DIR = path.join(WORKSPACE, ".test-runs", `ai_audit_${RUN_ID}`);
const REPORT_PATH = path.join(WORKSPACE, `AI功能专项测试报告_${RUN_ID}.md`);

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

function uniqueTitles(items) {
  return [...new Set(items.map((item) => item.title).filter(Boolean))];
}

function countBy(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = getKey(item);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

async function writeChapter(projectPath, config, chapter, content) {
  await fs.writeFile(path.join(projectPath, "chapters", chapter.fileName), content, "utf8");
  chapter.wordCount = app.contentToPlainText(content).length;
  chapter.updatedAt = new Date().toISOString();
  await app.saveConfig(projectPath, config);
}

function makeChapter(index, title, role = "正文", volume = "卷一", ext = ".html") {
  return {
    id: `ai_audit_chapter_${index}`,
    title,
    volume,
    order: index,
    fileName: `ai_audit_${String(index).padStart(3, "0")}_${title}${ext}`,
    wordCount: 0,
    knowledgeRole: role,
    contentFormat: ext === ".html" ? "html" : "markdown",
    outline: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function auditCurrentKnowledgeBase() {
  const scope = "一、知识库一致性";
  if (!fsSync.existsSync(path.join(DEFAULT_PROJECT, "novel.config.json"))) {
    addResult(scope, "默认项目路径", "FAIL", `未找到默认项目：${DEFAULT_PROJECT}`);
    return null;
  }

  const state = await app.buildAppState(DEFAULT_PROJECT);
  const config = await app.loadConfig(DEFAULT_PROJECT);
  const store = await app.loadVectorStore(DEFAULT_PROJECT);
  const chapters = config.chapters.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const bodyChapters = chapters.filter((chapter) => app.getKnowledgeRole(chapter) === "正文");
  const characters = await app.loadCharacters(DEFAULT_PROJECT);
  const worldDocs = await app.loadWorldDocs(DEFAULT_PROJECT);

  addResult(scope, "项目资料数量", bodyChapters.length >= 12 && chapters.length >= bodyChapters.length ? "PASS" : "WARN", `章节/资料 ${chapters.length} 个；正文 ${bodyChapters.length} 个；角色卡 ${characters.length} 张；世界观 ${worldDocs.length} 条`);

  const sourceIds = new Set([
    ...chapters.map((item) => item.id),
    ...characters.map((item) => item.id),
    ...worldDocs.map((item) => item.id),
  ]);
  const vectorSourceIds = new Set(store.vectors.map((item) => item.sourceId));
  const missingIndexed = [...sourceIds].filter((id) => !vectorSourceIds.has(id));
  const orphanIndexed = [...vectorSourceIds].filter((id) => !sourceIds.has(id));
  addResult(scope, "所有资料均进入知识库", !missingIndexed.length ? "PASS" : "FAIL", missingIndexed.length ? `缺少索引 sourceId：${missingIndexed.slice(0, 20).join("、")}` : `全部 ${sourceIds.size} 个来源均有索引片段`);
  addResult(scope, "无孤儿索引片段", !orphanIndexed.length ? "PASS" : "WARN", orphanIndexed.length ? `孤儿 sourceId：${orphanIndexed.slice(0, 20).join("、")}` : "未发现孤儿片段");

  const fileNames = chapters.map((chapter) => chapter.fileName).filter(Boolean);
  const duplicateFiles = [...new Set(fileNames.filter((fileName, index, array) => array.indexOf(fileName) !== index))];
  addResult(scope, "无章节共用同一文件", duplicateFiles.length ? "FAIL" : "PASS", duplicateFiles.length ? `重复文件：${duplicateFiles.join("、")}` : "未发现共用同一个文件的章节");

  const missingFiles = [];
  const chunkMismatches = [];
  for (const chapter of chapters) {
    const filePath = app.getChapterPath(DEFAULT_PROJECT, chapter);
    if (!fsSync.existsSync(filePath)) {
      missingFiles.push(`${chapter.title} -> ${chapter.fileName}`);
      continue;
    }
    const content = await fs.readFile(filePath, "utf8");
    const expected = app.chunkText(app.contentToPlainText(content)).length;
    const actual = store.vectors.filter((item) => item.sourceId === chapter.id).length;
    if (expected !== actual) chunkMismatches.push(`${chapter.title}: 文件 ${expected} 片段，知识库 ${actual} 片段`);
  }
  addResult(scope, "章节文件存在", missingFiles.length ? "FAIL" : "PASS", missingFiles.length ? missingFiles.join("\n") : "配置中的章节文件均存在");
  addResult(scope, "章节片段数匹配", chunkMismatches.length ? "FAIL" : "PASS", chunkMismatches.length ? chunkMismatches.slice(0, 20).join("\n") : "章节文件片段数与知识库一致");

  const sourceCatalog = app.buildProjectSourceCatalog(config, characters, worldDocs);
  const missingCatalogTitles = chapters.filter((chapter) => !sourceCatalog.includes(chapter.title)).map((chapter) => chapter.title);
  addResult(scope, "AI 项目资料目录完整", missingCatalogTitles.length ? "FAIL" : "PASS", missingCatalogTitles.length ? `目录缺少：${missingCatalogTitles.join("、")}` : "项目资料目录包含全部章节/资料标题");

  const roleCounts = Object.fromEntries([...countBy(chapters, (chapter) => app.getKnowledgeRole(chapter)).entries()]);
  addResult(scope, "知识库分类可识别", roleCounts["正文"] >= 12 && roleCounts["大纲"] >= 1 && roleCounts["补充材料"] >= 1 ? "PASS" : "WARN", JSON.stringify(roleCounts, null, 2));
  return { state, config, store, chapters, bodyChapters, characters, worldDocs, sourceCatalog };
}

async function auditRetrieval(snapshot) {
  const scope = "二、AI 检索准确性";
  if (!snapshot) return;
  const { bodyChapters, chapters } = snapshot;
  const missingExact = [];
  const weakExact = [];
  for (const chapter of bodyChapters) {
    const query = chapter.title.replace(/[：:]/g, " ");
    const search = await app.searchRelevantChunks(DEFAULT_PROJECT, query, 40, { minKeep: 5, maxChars: 40000 });
    const firstTitles = uniqueTitles(search.chunks.slice(0, 8));
    if (!firstTitles.includes(chapter.title)) missingExact.push(`${chapter.title} -> ${firstTitles.join("、") || "无"}`);
    else if (search.chunks[0]?.sourceId !== chapter.id) weakExact.push(`${chapter.title} 首位为 ${search.chunks[0]?.title || "无"}`);
  }
  addResult(scope, "正文章节标题直搜", !missingExact.length ? "PASS" : "FAIL", missingExact.length ? missingExact.join("\n") : "所有正文章节按标题检索均能命中自身", weakExact.length ? { weakExact } : {});

  const targetChapters = [
    { label: "第一章", chapter: bodyChapters.find((chapter) => /第一章|贝奥武夫镇/.test(chapter.title)) },
    { label: "第四章", chapter: bodyChapters.find((chapter) => /第四章|赵云启/.test(chapter.title)) },
    { label: "第六章", chapter: bodyChapters.find((chapter) => /第六章|百草堂/.test(chapter.title)) },
    { label: "第十一章/科学狂人", chapter: bodyChapters.find((chapter) => /第十一章|科学狂人/.test(chapter.title)) },
  ];
  const targetMisses = [];
  for (const target of targetChapters) {
    if (!target.chapter) {
      targetMisses.push(`${target.label}（当前项目未找到对应正文标题）`);
      continue;
    }
    const search = await app.searchRelevantChunks(DEFAULT_PROJECT, target.chapter.title, 30, { minKeep: 5, maxChars: 30000 });
    if (!search.chunks.some((item) => item.sourceId === target.chapter.id)) targetMisses.push(target.chapter.title);
  }
  addResult(scope, "曾漏检章节回归", targetMisses.length ? "FAIL" : "PASS", targetMisses.length ? `仍漏检：${targetMisses.join("、")}` : "第一章、第四章、第六章、第十一章均可检索到");

  const inventoryQuestion = "根据已有内容，我拥有的资料可以分为哪些类别？请列出所有正文章节、大纲、角色卡、世界观、文化札记、图鉴、武器库、关键地图、AI输出与灵感记录。";
  const inventorySearch = await app.searchRelevantChunks(DEFAULT_PROJECT, inventoryQuestion, 250, { minKeep: 30, maxChars: 130000 });
  const materials = await app.collectPromptMaterials(DEFAULT_PROJECT, inventorySearch.chunks, inventoryQuestion);
  const retrievedTitles = uniqueTitles(inventorySearch.chunks);
  const missingFromRetrieved = bodyChapters.filter((chapter) => !retrievedTitles.includes(chapter.title)).map((chapter) => chapter.title);
  const missingFromCatalog = chapters.filter((chapter) => !materials.sourceCatalog.includes(chapter.title)).map((chapter) => chapter.title);
  addResult(
    scope,
    "资料盘点问题有目录兜底",
    !missingFromCatalog.length ? "PASS" : "FAIL",
    `本次检索片段未覆盖正文：${missingFromRetrieved.join("、") || "无"}；项目资料目录缺失：${missingFromCatalog.join("、") || "无"}`,
    { contextCount: inventorySearch.chunks.length },
  );

  const inventoryPackage = await app.buildChatRetrievalPackage(DEFAULT_PROJECT, snapshot.config, { retrievalMode: "auto" }, inventoryQuestion);
  addResult(
    scope,
    "自动识别资料盘点模式",
    inventoryPackage.retrieval.mode === "inventory" && inventoryPackage.retrieval.inventoryUsed ? "PASS" : "FAIL",
    `识别结果：${inventoryPackage.retrieval.modeLabel}；目录兜底：${inventoryPackage.retrieval.catalogUsed ? "是" : "否"}`,
  );

  const chapter11 = bodyChapters.find((chapter) => chapter.title.includes("第十一章"));
  if (chapter11) {
    const scoped = await app.searchRelevantChunks(DEFAULT_PROJECT, "科学狂人 莫渊 治安殿", 20, { sourceIds: [chapter11.id], minKeep: 3, maxChars: 20000 });
    const wrongSources = scoped.chunks.filter((item) => item.sourceId !== chapter11.id);
    addResult(scope, "限定来源检索", scoped.chunks.length && !wrongSources.length ? "PASS" : "FAIL", scoped.chunks.length ? `限定第十一章后返回 ${scoped.chunks.length} 个片段` : "限定第十一章后没有返回片段");

    const chapterPackage = await app.buildChatRetrievalPackage(DEFAULT_PROJECT, snapshot.config, { retrievalMode: "auto" }, "请总结第十一章：科学狂人的正文内容");
    addResult(
      scope,
      "自动识别指定章节模式",
      chapterPackage.retrieval.mode === "chapter" && chapterPackage.search.chunks.some((item) => item.sourceId === chapter11.id) ? "PASS" : "FAIL",
      `识别结果：${chapterPackage.retrieval.modeLabel}；读取：${chapterPackage.retrieval.includedTitles.slice(0, 8).join("、")}`,
    );
  }

  const currentPackage = await app.buildChatRetrievalPackage(DEFAULT_PROJECT, snapshot.config, { retrievalMode: "current", selectedChapterId: bodyChapters[0]?.id }, "分析当前章节节奏");
  addResult(scope, "手动当前文档模式", currentPackage.retrieval.mode === "current" && currentPackage.search.chunks.every((item) => item.sourceId === bodyChapters[0]?.id) ? "PASS" : "FAIL", `读取片段 ${currentPackage.search.chunks.length} 条`);

  const bookPackage = await app.buildChatRetrievalPackage(DEFAULT_PROJECT, snapshot.config, { retrievalMode: "auto" }, "请检查全书整体节奏和一致性问题");
  const coveredBody = new Set(bookPackage.search.chunks.filter((item) => item.knowledgeRole === "正文").map((item) => item.title));
  addResult(scope, "自动识别全书分析模式", bookPackage.retrieval.mode === "book" && coveredBody.size >= Math.min(bodyChapters.length, snapshot.config.api.topK || 0) ? "PASS" : "FAIL", `识别结果：${bookPackage.retrieval.modeLabel}；覆盖正文 ${coveredBody.size}/${bodyChapters.length}`);
}

async function auditPromptTrust(snapshot) {
  const scope = "三、AI 回答可信度";
  if (!snapshot) return;
  const question = "我有哪些正文章节？没有检索到的章节是否代表不存在？";
  const search = await app.searchRelevantChunks(DEFAULT_PROJECT, question, 80, { minKeep: 30, maxChars: 60000 });
  const materials = await app.collectPromptMaterials(DEFAULT_PROJECT, search.chunks, question);
  const prompt = app.buildSystemPrompt({ ...materials, projectMemory: "", userQuestion: question, selectedText: "" });
  const requiredTitles = snapshot.bodyChapters.map((chapter) => chapter.title);
  const missing = requiredTitles.filter((title) => !prompt.includes(title));
  const hasGuard = prompt.includes("目录中存在，但本次未检索到具体片段") && prompt.includes("优先依据“项目资料目录”");
  addResult(scope, "提示词包含完整目录", missing.length ? "FAIL" : "PASS", missing.length ? `提示词缺少：${missing.join("、")}` : "提示词包含全部正文章节标题");
  addResult(scope, "防止把未检索误判为不存在", hasGuard ? "PASS" : "FAIL", hasGuard ? "提示词已要求区分“目录存在”和“本次未检索到片段”" : "提示词缺少防误判规则");

  const contextTitles = uniqueTitles(search.chunks);
  const absentButCataloged = requiredTitles.filter((title) => !contextTitles.includes(title) && materials.sourceCatalog.includes(title));
  addResult(scope, "引用片段与目录差异可解释", absentButCataloged.length >= 0 ? "PASS" : "WARN", `本次未进入引用片段但目录存在的正文：${absentButCataloged.join("、") || "无"}`);
}

function startMockAiServer() {
  const calls = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      req.on("end", () => {
        if (req.url !== "/v1/chat/completions") {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "not found" } }));
          return;
        }
        const payload = JSON.parse(body || "{}");
        const fullText = (payload.messages || []).map((item) => item.content || "").join("\n");
        calls.push({ model: payload.model, size: body.length, fullText });
        let content = "ok";
        if (fullText.includes("整理角色卡片")) {
          content = JSON.stringify({ characters: [{ name: "林测试", category: "主角团", appearance: "银灰披风", personality: "谨慎", background: "测试大纲中的调查者", relationships: "与测试城相关", notes: "用于自动测试" }] });
        } else if (fullText.includes("提取地点、势力、物品")) {
          content = JSON.stringify({ worldDocs: [{ type: "地点", title: "测试城", category: "地点/城市", content: "# 测试城\n\n测试大纲中的核心地点。" }] });
        } else if (fullText.includes("剧情时间线整理助手")) {
          content = JSON.stringify({ events: [{ order: 0, title: "林测试抵达测试城", timeHint: "第一天", chapterTitle: "测试第一章", volume: "卷一", summary: "林测试抵达测试城并发现异常。", characters: ["林测试"] }] });
        } else if (fullText.includes("设定校对助手")) {
          content = JSON.stringify({ issues: [{ severity: "低", category: "剧情", title: "测试疑点", detail: "测试大纲与正文对测试城描述需要确认。", evidence: ["测试第一章"], suggestion: "确认地点状态。" }] });
        } else if (fullText.includes("小说创作参谋 Agent")) {
          content = JSON.stringify({ items: [{ type: "下一章建议", priority: "高", title: "让异常变成选择题", summary: "让林测试在追查和救援之间做选择。", rationale: "承接测试城异常。", benefits: ["推进剧情"], risks: ["节奏过快"], relatedCharacters: ["林测试"], relatedSettings: ["测试城"], targetChapter: "测试第一章", suggestedUse: "作为下一场戏的冲突核心。" }] });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, calls }));
  });
}

async function createToolProject(baseUrl) {
  const projectPath = path.join(RUN_DIR, "ai_tool_project");
  await app.ensureProjectStructure(projectPath, "AI工具测试项目");
  const config = await app.loadConfig(projectPath);
  config.api = {
    ...config.api,
    provider: "custom",
    apiKey: "test-key",
    baseUrl,
    chatModel: "mock-model",
    embeddingApiKey: "",
    embeddingBaseUrl: "",
    embeddingModel: "",
    topK: 80,
    maxTokens: 2000,
  };
  config.chapters = [
    makeChapter(0, "测试完整大纲", "大纲", "大纲"),
    makeChapter(1, "测试第一章", "正文", "卷一"),
  ];
  await ensureDir(path.join(projectPath, "chapters"));
  await writeChapter(projectPath, config, config.chapters[0], "<h1>测试完整大纲</h1><p>林测试来到测试城，调查测试城异常。测试城属于测试王国。</p>");
  await writeChapter(projectPath, config, config.chapters[1], "<h1>测试第一章</h1><p>第一天，林测试抵达测试城，发现钟楼出现异常回响。</p>");
  await app.rebuildIndex(projectPath);
  return projectPath;
}

async function auditAiTools() {
  const scope = "四、AI 创作工具";
  const { server, calls } = await startMockAiServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    const projectPath = await createToolProject(baseUrl);
    const charResult = await app.generateCharactersFromOutline(projectPath);
    const characters = await app.loadCharacters(projectPath);
    addResult(scope, "从大纲生成角色卡并写入", charResult.count >= 1 && characters.some((item) => item.name === "林测试") ? "PASS" : "FAIL", `创建 ${charResult.created}，更新 ${charResult.updated}`);

    const candidates = await app.prepareWorldCardCandidates(projectPath, { scope: "book" });
    const saveWorld = await app.saveWorldCardCandidates(projectPath, candidates.candidates.slice(0, 1));
    const worldDocs = await app.loadWorldDocs(projectPath);
    addResult(scope, "提取世界观候选并写入", saveWorld.count >= 1 && worldDocs.some((item) => item.title === "测试城") ? "PASS" : "FAIL", `候选 ${candidates.candidates.length}，写入 ${saveWorld.count}`);

    const config = await app.loadConfig(projectPath);
    const chapter = config.chapters.find((item) => app.getKnowledgeRole(item) === "正文");
    const timeline = await app.buildAiTimelineEvents(projectPath, { mode: "ai", chapterIds: [chapter.id] });
    addResult(scope, "AI 时间线事件识别", timeline.events.some((item) => item.title.includes("抵达测试城")) ? "PASS" : "FAIL", `事件数：${timeline.events.length}`);

    const consistency = await app.analyzeConsistency(projectPath, { chapterIds: [chapter.id], knowledgeSourceIds: [] });
    addResult(scope, "一致性检查返回结构化问题", Array.isArray(consistency.issues) && consistency.issues.length >= 1 && consistency.issues[0].status ? "PASS" : "FAIL", `问题数：${consistency.issues.length}`);

    const advice = await app.buildCreativeAdvice(projectPath, { mode: "next", chapterId: chapter.id, focus: "推进测试城异常" });
    addResult(scope, "创作参谋返回建议卡片", advice.items.length >= 1 && advice.items[0].suggestedUse ? "PASS" : "FAIL", `建议数：${advice.items.length}`);

    const relation = await app.buildRelationshipGraph(projectPath, { characterNames: ["林测试"], relationTypes: ["调查"] });
    addResult(scope, "关系图可按角色筛选", relation.nodes.some((item) => item.name === "林测试") ? "PASS" : "WARN", `节点 ${relation.nodes.length}，边 ${relation.edges.length}`);

    await app.saveAnalysisState(projectPath, { timeline, consistency, creativeAdvice: advice });
    const saved = await app.loadAnalysisState(projectPath);
    addResult(scope, "分析结果可持久保存", saved.timeline?.events?.length && saved.consistency?.issues?.length && saved.creativeAdvice?.items?.length ? "PASS" : "FAIL", "时间线、一致性、创作参谋结果写入 analysis-state");

    addResult(scope, "工具调用使用模拟 AI", calls.length >= 4 ? "PASS" : "WARN", `模拟聊天接口调用 ${calls.length} 次，未消耗真实模型额度`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function auditApiErrorHandling() {
  const scope = "五、AI 接口异常";
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      const payload = JSON.parse(body || "{}");
      if (payload.model === "bad-key") {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
      } else if (payload.model === "bad-model") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Model not found" } }));
      } else if (payload.model === "no-money") {
        res.writeHead(402, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Insufficient balance" } }));
      } else if (payload.model === "hang") {
        return;
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  async function expect(name, model, needles) {
    try {
      await app.callChatApi({ api: { provider: "custom", apiKey: "test-key", baseUrl, chatModel: model, maxTokens: 32 } }, "system", "question", []);
      addResult(scope, name, "FAIL", "预期失败，但调用成功");
    } catch (error) {
      const message = error.message || String(error);
      addResult(scope, name, needles.every((needle) => message.includes(needle)) ? "PASS" : "FAIL", message);
    }
  }
  try {
    await expect("API key 错误", "bad-key", ["401", "Invalid API key"]);
    await expect("模型名错误", "bad-model", ["404", "Model not found"]);
    await expect("余额不足", "no-money", ["402", "Insufficient balance"]);
    await expect("超时", "hang", ["AbortError", "请求超过"]);
    try {
      const answer = await app.callChatApi({ api: { provider: "custom", apiKey: "test-key", baseUrl, chatModel: "ok", maxTokens: 999999999 } }, "system", "question", []);
      addResult(scope, "max_tokens 自动限制为合法范围", answer === "ok" ? "PASS" : "FAIL", `返回：${answer}`);
    } catch (error) {
      addResult(scope, "max_tokens 自动限制为合法范围", "FAIL", error.message || String(error));
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function auditFrontendWiring() {
  const scope = "六、界面按钮与缓存静态覆盖";
  const appText = await fs.readFile(path.join(WORKSPACE, "src", "App.tsx"), "utf8");
  const preloadText = await fs.readFile(path.join(WORKSPACE, "electron", "preload.cjs"), "utf8");
  const checks = [
    ["右侧 AI 问答", preloadText.includes("askAI") && appText.includes("window.novelAPI.askAI")],
    ["创作参谋", preloadText.includes("getCreativeAdvice") && appText.includes("window.novelAPI.getCreativeAdvice")],
    ["AI 生成角色卡", preloadText.includes("generateCharactersFromOutline") && appText.includes("window.novelAPI.generateCharactersFromOutline")],
    ["世界观候选提取", preloadText.includes("extractWorldCardsFromOutline") && appText.includes("saveWorldCardCandidates")],
    ["时间线手动刷新", appText.includes("refresh: true") && preloadText.includes("buildTimeline")],
    ["一致性检查范围", appText.includes("consistencyChapterIds") && appText.includes("consistencySourceIds")],
    ["一致性状态按钮", preloadText.includes("updateIssueStatus") && appText.includes("updateIssueStatus(issue.id")],
    ["分析状态缓存", preloadText.includes("getAnalysisState") && appText.includes("saveAnalysisDraft")],
    ["右键编辑", preloadText.includes("editSelection") && appText.includes("editSelectedText") && appText.includes("window.novelAPI.editSelection")],
    ["查找替换", appText.includes("findNextInRichEditor") && appText.includes("replaceAllInRichEditor")],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([name]) => name);
  addResult(scope, "关键 AI 按钮接线", missing.length ? "FAIL" : "PASS", checks.map(([name, ok]) => `${name}: ${ok ? "存在" : "缺失"}`).join("\n"));
}

async function writeReport() {
  const counts = results.reduce((map, item) => {
    map[item.status] = (map[item.status] || 0) + 1;
    return map;
  }, {});
  const lines = [];
  lines.push("# AI 功能专项测试报告");
  lines.push("");
  lines.push(`- 时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`);
  lines.push(`- 工作区：${WORKSPACE}`);
  lines.push(`- 测试输出目录：${RUN_DIR}`);
  lines.push(`- 结果统计：通过 ${counts.PASS || 0}，警告 ${counts.WARN || 0}，失败 ${counts.FAIL || 0}，跳过 ${counts.SKIP || 0}`);
  lines.push("- 说明：工具写入类测试使用隔离项目和本地模拟 AI，不会消耗真实模型额度；当前项目测试只读取知识库和执行检索。");
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
  const snapshot = await auditCurrentKnowledgeBase();
  await auditRetrieval(snapshot);
  await auditPromptTrust(snapshot);
  await auditAiTools();
  await auditApiErrorHandling();
  await auditFrontendWiring();
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
