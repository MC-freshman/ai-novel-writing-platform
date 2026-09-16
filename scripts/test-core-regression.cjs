const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const AdmZip = require("adm-zip");

process.env.NOVEL_PLATFORM_TEST = "1";
process.env.NOVEL_CHAT_TIMEOUT_MS = "0";

const platform = require("../electron/main.cjs");
const creativeWorkspace = require("../electron/services/creative-workspace.cjs");
const docxFidelity = require("../electron/services/docx-fidelity.cjs");
const { scanReleaseInputs } = require("../electron/services/release-privacy.cjs");
const workspace = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDirectory = path.join(workspace, ".test-runs", `core_regression_${runId}`);
const projectPath = path.join(runDirectory, "project");

function chapter(index, title, volume, knowledgeRole, content) {
  return {
    item: {
      id: `regression_chapter_${index}`,
      title,
      volume,
      knowledgeRole,
      order: index - 1,
      fileName: `regression_${index}.md`,
      wordCount: content.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    content,
  };
}

async function testKnowledgeAndHealth() {
  await platform.ensureProjectStructure(projectPath, "回归测试项目");
  const config = await platform.loadConfig(projectPath);
  const fixtures = [
    chapter(1, "第一章 起点", "卷一", "正文", "# 第一章 起点\n\n李明在圣城发现一封异常来信，决定追查失踪者。"),
    chapter(2, "第二章 追踪", "卷一", "正文", "# 第二章 追踪\n\n李明沿着线索进入旧城区，并发现来信上的印记。"),
    chapter(3, "全书大纲", "大纲", "大纲", "# 全书大纲\n\n第一幕围绕圣城失踪案展开，第二幕揭示幕后势力。"),
  ];
  config.title = "回归测试项目";
  config.chapters = fixtures.map((item) => item.item);
  await platform.saveConfig(projectPath, config);
  for (const fixture of fixtures) await fs.writeFile(platform.getChapterPath(projectPath, fixture.item), fixture.content, "utf8");

  await platform.indexSources(
    projectPath,
    fixtures.map((fixture) => ({
      id: fixture.item.id,
      type: "chapter",
      title: fixture.item.title,
      volume: fixture.item.volume,
      category: fixture.item.volume,
      knowledgeRole: fixture.item.knowledgeRole,
      content: fixture.content,
    })),
    { replaceSummaries: true },
  );
  let status = await platform.getKnowledgeSyncStatus(projectPath);
  assert.equal(status.counts.pending, 0, "初次索引后不应存在待同步文档");
  assert.equal(status.counts.synced, 3, "三份资料都应完成同步");

  const summaries = await platform.loadKnowledgeSummaries(projectPath);
  assert.equal(summaries.sources.length, 3, "应生成三份文档摘要");
  assert.ok(summaries.volumes.length >= 2, "应生成分卷/分类摘要");
  assert.ok(summaries.book?.summary, "应生成全书结构摘要");

  const changed = `${fixtures[1].content}\n\n新增内容：李明确认印记来自北门守卫。`;
  await fs.writeFile(platform.getChapterPath(projectPath, fixtures[1].item), changed, "utf8");
  status = await platform.getKnowledgeSyncStatus(projectPath);
  assert.equal(status.items.find((item) => item.sourceId === fixtures[1].item.id)?.status, "等待更新", "文件直接变化后必须标记为等待更新");
  const repaired = await platform.repairKnowledgeSync(projectPath);
  assert.equal(repaired.status.items.find((item) => item.sourceId === fixtures[1].item.id)?.status, "已同步", "增量修复后应恢复同步状态");

  assert.throws(
    () => platform.assertExpectedChapterRevision("stale-revision", changed),
    /保存已停止/,
    "旧窗口修订号不得覆盖新内容",
  );

  await new Promise((resolve) => setTimeout(resolve, 5));
  await fs.writeFile(platform.getChapterPath(projectPath, fixtures[1].item), `${changed}\n\n再次新增：守卫承认自己隐瞒证词。`, "utf8");
  const retrieval = await platform.buildChatRetrievalPackage(projectPath, await platform.loadConfig(projectPath), { retrievalMode: "book" }, "检查全书失踪案的推进是否连贯");
  assert.ok(retrieval.retrieval.layersUsed.includes("全书"), "全书检索应使用全书摘要层");
  assert.ok(retrieval.retrieval.layersUsed.includes("原始片段"), "全书检索仍应读取原始片段");
  assert.ok(retrieval.retrieval.freshness?.repairedSourceCount >= 1, "AI 检索前应自动修复本次所需的过期索引");
  assert.equal((await platform.getKnowledgeSyncStatus(projectPath)).items.find((item) => item.sourceId === fixtures[1].item.id)?.status, "已同步", "检索预检修复后知识库状态应立即更新");
  assert.ok((retrieval.retrieval.firstPassCount || 0) >= 1, "检索诊断应记录首轮证据数量");
  assert.ok(["高", "中", "低"].includes(retrieval.retrieval.evidenceConfidence), "检索诊断应提供证据置信度");
  const maintenance = await platform.getMaintenanceDiagnostics(projectPath);
  assert.equal(maintenance.retrievalCache.valid, true, "检索后分卷缓存应处于有效状态");
  assert.equal(maintenance.staleSourceCount, 0, "维护诊断不得漏报或误报已修复的过期资料");

  const advice = await platform.buildCreativeAdvice(projectPath, { mode: "next", chapterId: fixtures[1].item.id });
  assert.ok(advice.toolReport?.length >= 6, "创作参谋应报告实际调用的项目工具");
  assert.ok(advice.items.length, "接口不可用时也应提供本地参谋结果");
  const agentPlan = await platform.prepareCreativeAgentRun(projectPath, { mode: "plot", chapterId: fixtures[1].item.id, focus: "检查本卷人物动机", scopeType: "auto" });
  assert.equal(agentPlan.scopeType, "volume", "创作 Agent 应按目标自动推荐当前分卷范围");
  assert.ok(agentPlan.stageCheckpoints.some((item) => item.id === "creative_advisor"), "Agent 计划应保存可恢复的阶段检查点");
  const controlledPlan = await platform.prepareCreativeAgentRun(projectPath, {
    mode: "plot",
    chapterId: fixtures[1].item.id,
    focus: "只根据指定资料检查人物动机",
    scopeType: "book",
    includeSourceIds: [fixtures[2].item.id],
    excludeSourceIds: [fixtures[0].item.id],
  });
  assert.deepEqual(controlledPlan.includeSourceIds, [fixtures[2].item.id], "Agent 必须保存作者强制纳入的资料");
  assert.deepEqual(controlledPlan.excludeSourceIds, [fixtures[0].item.id], "Agent 必须保存作者明确排除的资料");
  assert.ok(controlledPlan.retrievalAudit.selectedSources.includes(fixtures[2].item.title), "强制纳入的资料必须进入本次检索结果");
  assert.ok(!controlledPlan.retrievalAudit.selectedSources.includes(fixtures[0].item.title), "明确排除的资料不得混入检索结果");
  assert.ok(controlledPlan.retrievalAudit.warnings.some((item) => item.includes("强制纳入")), "检索审计必须提示作者指定的纳入规则");
  assert.ok(controlledPlan.retrievalAudit.warnings.some((item) => item.includes("已排除")), "检索审计必须提示作者指定的排除规则");
  await assert.rejects(
    platform.buildCreativeAdvice(projectPath, { mode: "next", chapterId: "deleted_chapter" }),
    /章节已不存在/,
    "章节删除后遗留的后台任务不得错误地改用第一章",
  );

  await fs.rm(platform.getChapterPath(projectPath, fixtures[0].item), { force: true });
  const health = await platform.inspectProjectHealth(projectPath);
  assert.ok(health.issues.some((item) => item.code === "missing-file" && item.severity === "高"), "章节文件缺失必须报告为高风险");
}

async function testCancelableStreaming() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "已生成部分" } }] })}\n\n`);
    setTimeout(() => {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "不应丢失" } }] })}\n\n`);
      response.end("data: [DONE]\n\n");
    }, 180);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const controller = new AbortController();
  try {
    const answer = await platform.callChatApi(
      { api: { provider: "custom", apiKey: "", baseUrl: `http://127.0.0.1:${port}/v1`, chatModel: "mock", maxTokens: 1000, temperature: 0 } },
      "system",
      "question",
      [],
      {
        stream: true,
        signal: controller.signal,
        onToken: () => controller.abort(),
      },
    );
    assert.match(answer, /已生成部分/, "停止生成后必须返回已收到内容");
    assert.match(answer, /已保留/, "停止结果必须明确说明内容已保留");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testClaudeHistoryVectorCompatibilityAndBackups() {
  let receivedPayload = null;
  const server = http.createServer(async (request, response) => {
    const parts = [];
    for await (const part of request) parts.push(part);
    receivedPayload = JSON.parse(Buffer.concat(parts).toString("utf8"));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ content: [{ text: "保留上下文的回答" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const answer = await platform.callChatApi(
      { api: { provider: "claude", apiKey: "test-key", baseUrl: `http://127.0.0.1:${port}`, chatModel: "mock-claude", maxTokens: 1000, temperature: 0 } },
      "system",
      "继续回答",
      [
        { role: "user", content: "第一问" },
        { role: "assistant", content: "第一答" },
      ],
    );
    assert.equal(answer, "保留上下文的回答", "Claude 响应必须正常解析");
    assert.deepEqual(receivedPayload.messages, [
      { role: "user", content: "第一问" },
      { role: "assistant", content: "第一答" },
      { role: "user", content: "继续回答" },
    ], "Claude 请求必须携带压缩后的多轮历史");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  assert.equal(
    platform.compatibleVectorScore({ source: "api", identity: "api:a:model", vector: [1, 0] }, [0, 1], { embeddingSource: "local", embedding: [0, 1] }),
    1,
    "本地索引必须使用本地查询向量计算相似度",
  );
  assert.equal(
    platform.compatibleVectorScore({ source: "api", identity: "api:a:model", vector: [1, 0] }, [0, 1], { embeddingSource: "api", embeddingIdentity: "api:b:model", embedding: [1, 0] }),
    0,
    "不同远程向量模型的结果不得混算",
  );

  const backupProject = path.join(runDirectory, "backup-recursion");
  await platform.ensureProjectStructure(backupProject, "备份递归测试");
  await fs.writeFile(path.join(backupProject, "backups", "old-backup.zip"), "old backup", "utf8");
  const backupPath = path.join(backupProject, "backups", "new-backup.zip");
  await platform.createBackup(backupProject, backupPath);
  const backupZip = new AdmZip(backupPath);
  const backupEntries = backupZip.getEntries().map((entry) => entry.entryName.replace(/\\/g, "/"));
  assert.ok(backupEntries.every((name) => !name.includes("/backups/")), "新备份不得递归包含历史 backups 目录");
}

async function testChapterUndoAndSaveIsolation() {
  const isolationProject = path.join(runDirectory, "chapter-isolation");
  await platform.ensureProjectStructure(isolationProject, "章节隔离测试");
  const config = await platform.loadConfig(isolationProject);
  const firstContent = `# 序章测试\n\n${"序章原始内容。".repeat(80)}`;
  const secondContent = `# 当前章节测试\n\n${"当前章节独立内容。".repeat(80)}`;
  const first = {
    ...config.chapters[0],
    id: "isolation_prologue",
    title: "序章测试",
    fileName: "isolation_prologue.md",
    order: 0,
  };
  const second = {
    ...config.chapters[0],
    id: "isolation_current",
    title: "当前章节测试",
    fileName: "isolation_current.md",
    order: 1,
  };
  config.chapters = [first, second];
  await platform.saveConfig(isolationProject, config);
  await fs.writeFile(platform.getChapterPath(isolationProject, first), firstContent, "utf8");
  await fs.writeFile(platform.getChapterPath(isolationProject, second), secondContent, "utf8");
  await platform.buildAppState(isolationProject, first.id);

  await assert.rejects(
    platform.loadChapterContent(isolationProject, "missing-chapter"),
    /已经不存在/,
    "不存在的章节不得静默回退并打开序章",
  );

  const loadedFirst = await platform.loadChapterContent(isolationProject, first.id);
  const savedFirstContent = `${firstContent}\n\n第一次保存。`;
  const staleFirstContent = `${firstContent}\n\n过期请求不应覆盖。`;
  const concurrent = await Promise.allSettled([
    platform.saveChapterContent(isolationProject, {
      chapterId: first.id,
      title: first.title,
      volume: first.volume,
      content: savedFirstContent,
      expectedRevision: loadedFirst.revision,
    }),
    platform.saveChapterContent(isolationProject, {
      chapterId: first.id,
      title: first.title,
      volume: first.volume,
      content: staleFirstContent,
      expectedRevision: loadedFirst.revision,
    }),
  ]);
  assert.equal(concurrent[0].status, "fulfilled", "队列中的第一份有效保存应成功");
  assert.equal(concurrent[1].status, "rejected", "同一旧修订号的后到保存必须被拒绝");
  assert.match(String(concurrent[1].reason?.message || concurrent[1].reason), /保存已停止/, "被拒绝的并发保存应说明版本冲突");
  assert.equal(await fs.readFile(platform.getChapterPath(isolationProject, first), "utf8"), savedFirstContent, "过期保存不得覆盖先完成的正文");

  const latestFirst = await platform.loadChapterContent(isolationProject, first.id);
  await assert.rejects(
    platform.saveChapterContent(isolationProject, {
      chapterId: first.id,
      title: first.title,
      volume: first.volume,
      content: secondContent,
      expectedRevision: latestFirst.revision,
    }),
    /整章内容.*完全相同|跨章节撤销|误覆盖/,
    "把一章整篇变成另一章时必须阻止自动保存",
  );
  assert.equal(await fs.readFile(platform.getChapterPath(isolationProject, first), "utf8"), savedFirstContent, "跨章节克隆被拦截后序章必须保持不变");
  assert.equal(await fs.readFile(platform.getChapterPath(isolationProject, second), "utf8"), secondContent, "跨章节保存检查不得修改来源章节");

  const versionDir = path.join(isolationProject, "backups", "versions", first.id);
  const versionMetadata = (await fs.readdir(versionDir)).filter((file) => file.endsWith(".json"));
  const revisions = await Promise.all(versionMetadata.map(async (file) => JSON.parse(await fs.readFile(path.join(versionDir, file), "utf8"))));
  assert.equal(new Set(revisions.map((item) => item.contentRevision).filter(Boolean)).size, revisions.filter((item) => item.contentRevision).length, "相同正文不得重复占用历史版本名额");
}

async function testSafeRevisionAndExchange() {
  const revisionProject = path.join(runDirectory, "safe-revision");
  await platform.ensureProjectStructure(revisionProject, "安全修订测试");
  const revisionConfig = await platform.loadConfig(revisionProject);
  const revisionChapter = revisionConfig.chapters[0];
  const originalContent = "# 第一章 开篇\n\n旧句只在这里出现。\n";
  await fs.writeFile(platform.getChapterPath(revisionProject, revisionChapter), originalContent, "utf8");
  const sourceRevision = crypto.createHash("sha256").update(originalContent, "utf8").digest("hex");
  const accepted = await creativeWorkspace.upsertItem(revisionProject, "revisions", {
    chapterId: revisionChapter.id,
    chapterTitle: revisionChapter.title,
    action: "润色",
    original: "旧句只在这里出现。",
    replacement: "新句仍然只在这里出现。",
    sourceRevision,
    status: "待确认",
  });
  await platform.applySafeRevision(revisionProject, accepted.id);
  assert.match(await fs.readFile(platform.getChapterPath(revisionProject, revisionChapter), "utf8"), /新句仍然只在这里出现/, "采纳安全修订后应替换唯一命中的原文");
  const versionFiles = await fs.readdir(path.join(revisionProject, "backups", "versions", revisionChapter.id));
  assert.ok(versionFiles.some((file) => file.endsWith(".json")), "应用安全修订前必须保留章节历史版本");

  const partial = await creativeWorkspace.upsertItem(revisionProject, "revisions", {
    chapterId: revisionChapter.id,
    chapterTitle: revisionChapter.title,
    action: "润色",
    original: "新句仍然只在这里出现。",
    replacement: "更新句仍然只在这里出现。",
    sourceRevision: crypto.createHash("sha256").update(await fs.readFile(platform.getChapterPath(revisionProject, revisionChapter), "utf8"), "utf8").digest("hex"),
    status: "待确认",
  });
  const partialResult = await platform.applySafeRevisionPart(revisionProject, {
    revisionId: partial.id,
    original: "新句",
    replacement: "更新句",
  });
  assert.match(await fs.readFile(platform.getChapterPath(revisionProject, revisionChapter), "utf8"), /更新句仍然只在这里出现/, "局部采纳只能替换作者确认的句段");
  assert.equal(partialResult.revision.status, "部分采纳", "局部应用后应保留其余建议供作者继续确认");
  assert.equal(partialResult.revision.acceptedParts.length, 1, "局部采纳记录必须写入修订历史");
  const partialVersionFiles = await fs.readdir(path.join(revisionProject, "backups", "versions", revisionChapter.id));
  assert.ok(partialVersionFiles.length > versionFiles.length, "局部采纳前也必须自动保存章节版本");

  await creativeWorkspace.upsertItem(revisionProject, "annotations", {
    chapterId: revisionChapter.id,
    chapterTitle: revisionChapter.title,
    quote: "更新句",
    comment: "这里需要再次确认语气。",
    status: "待处理",
    origin: "manual",
  });
  await creativeWorkspace.upsertItem(revisionProject, "revisions", {
    chapterId: revisionChapter.id,
    chapterTitle: revisionChapter.title,
    action: "改写",
    instruction: "测试导出修订",
    original: "更新句仍然只在这里出现。",
    replacement: "最终句仍然只在这里出现。",
    status: "待确认",
  });
  const reviewDocxPath = path.join(runDirectory, "review-export.docx");
  await platform.exportChapterToDocx(revisionProject, revisionChapter, reviewDocxPath);
  const reviewZip = new AdmZip(reviewDocxPath);
  const reviewDocumentXml = reviewZip.getEntry("word/document.xml")?.getData().toString("utf8") || "";
  const reviewCommentsXml = reviewZip.getEntry("word/comments.xml")?.getData().toString("utf8") || "";
  assert.match(reviewDocumentXml, /<w:commentRangeStart\b/, "Word 导出必须在正文中保留批注范围");
  assert.match(reviewCommentsXml, /这里需要再次确认语气/, "Word 导出必须写入批注正文");
  assert.match(reviewDocumentXml, /<w:del\b/, "Word 导出必须写入修订删除标记");
  assert.match(reviewDocumentXml, /<w:ins\b/, "Word 导出必须写入修订新增标记");
  const importedFidelity = docxFidelity.readDocxFidelity(reviewDocxPath);
  assert.ok(importedFidelity.comments.some((item) => item.comment.includes("再次确认语气")), "平台必须能重新识别自己导出的 Word 批注");
  assert.ok(importedFidelity.revisions.some((item) => item.original.includes("更新句") && item.replacement.includes("最终句")), "平台必须能重新识别自己导出的 Word 修订");

  const firstStatistics = await platform.buildCreativeStatistics(revisionProject, "修订前诊断");
  const secondStatistics = await platform.buildCreativeStatistics(revisionProject, "修订后诊断");
  assert.equal(firstStatistics.snapshot.metrics.length, 1, "创作统计必须覆盖项目中的正文文档");
  assert.ok(secondStatistics.workspace.statisticsHistory.some((item) => item.label === "修订前诊断"), "创作统计历史不得在再次诊断后丢失");
  assert.ok(secondStatistics.workspace.statisticsHistory.some((item) => item.label === "修订后诊断"), "最新创作统计必须写入历史记录");

  const beforeConflict = await fs.readFile(platform.getChapterPath(revisionProject, revisionChapter), "utf8");
  const stale = await creativeWorkspace.upsertItem(revisionProject, "revisions", {
    chapterId: revisionChapter.id,
    chapterTitle: revisionChapter.title,
    action: "改写",
    original: "已经不存在的原文",
    replacement: "不应写入",
    sourceRevision: "stale-revision",
    status: "待确认",
  });
  await assert.rejects(platform.applySafeRevision(revisionProject, stale.id), /正文已经变化/, "正文变化且无法唯一定位时必须拒绝应用修订");
  assert.equal(await fs.readFile(platform.getChapterPath(revisionProject, revisionChapter), "utf8"), beforeConflict, "冲突修订不得修改任何正文内容");

  const exchangeProject = path.join(runDirectory, "exchange");
  await platform.ensureProjectStructure(exchangeProject, "交换包测试");
  const exchangeConfig = await platform.loadConfig(exchangeProject);
  exchangeConfig.api.apiKey = "SECRET_API_KEY_SHOULD_NOT_EXPORT";
  exchangeConfig.api.embeddingApiKey = "SECRET_VECTOR_KEY_SHOULD_NOT_EXPORT";
  exchangeConfig.chapters[0].importedFrom = "C:\\Users\\author\\private-novel.docx";
  await platform.saveConfig(exchangeProject, exchangeConfig);
  await fs.writeFile(path.join(exchangeProject, "vector_db", "private-vector.json"), "SECRET_VECTOR_PAYLOAD", "utf8");
  const archivePath = path.join(runDirectory, "exchange-test.zip");
  await platform.buildProjectExchangeArchive(exchangeProject, archivePath, { includeWorkspace: true, appVersion: "0.2.0-test" });
  const zip = new AdmZip(archivePath);
  const names = zip.getEntries().map((entry) => entry.entryName);
  const textPayload = zip.getEntries().filter((entry) => !entry.isDirectory).map((entry) => zip.readAsText(entry)).join("\n");
  assert.ok(names.includes("manifest.json") && names.includes("project/novel.config.json"), "交换包必须包含清单和项目目录配置");
  assert.ok(names.every((name) => !name.includes("vector_db") && !name.includes("backups")), "交换包不得包含向量库或历史备份");
  assert.doesNotMatch(textPayload, /SECRET_API_KEY|SECRET_VECTOR_KEY|SECRET_VECTOR_PAYLOAD/, "交换包不得泄露聊天密钥、向量密钥或向量内容");
  assert.doesNotMatch(textPayload, /private-novel\.docx|C:\\Users/, "交换包不得泄露导入文档的本机路径");
}

async function testReleasePrivacyScanner() {
  const privacyRoot = path.join(runDirectory, "privacy-scan");
  await fs.mkdir(path.join(privacyRoot, "dist"), { recursive: true });
  const fakeSecret = `${"s"}k-test_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456`;
  await fs.writeFile(path.join(privacyRoot, "dist", "fake.js"), `const token = "${fakeSecret}";\n`, "utf8");
  const unsafe = await scanReleaseInputs(privacyRoot, ["dist"]);
  assert.equal(unsafe.ok, false, "发布扫描必须拦截疑似 API 密钥");
  assert.ok(unsafe.findings.some((item) => item.rule === "api-key"), "发布扫描应明确报告密钥风险类型");
  await fs.writeFile(path.join(privacyRoot, "dist", "fake.js"), 'const label = "没有私人内容";\n', "utf8");
  const safe = await scanReleaseInputs(privacyRoot, ["dist"]);
  assert.equal(safe.ok, true, "清理敏感信息后发布扫描应恢复通过");
}

async function testFrontendSafetyContracts() {
  const [appSource, preloadSource, mainSource] = await Promise.all([
    fs.readFile(path.join(workspace, "src", "App.tsx"), "utf8"),
    fs.readFile(path.join(workspace, "electron", "preload.cjs"), "utf8"),
    fs.readFile(path.join(workspace, "electron", "main.cjs"), "utf8"),
  ]);
  assert.match(preloadSource, /cancelAI:\s*\(requestId\)/, "渲染层必须能够停止正在生成的 AI 请求");
  assert.match(mainSource, /aiStreamRecovery/, "主进程必须保存 AI 流式回答恢复点");
  assert.match(appSource, /remainingChars\s*=\s*600000/, "会话持久化总容量不得意外降级");
  assert.match(appSource, /expectedRevision:\s*chapterRevisionRef\.current/, "章节保存必须携带已读取版本");
  assert.match(appSource, /key=\{selectedChapter\?\.id \|\| "empty-document"\}/, "不同章节必须重建编辑器并隔离撤销历史");
  assert.match(appSource, /selectedChapterIdRef\.current !== documentId/, "富文档更新必须校验事件所属章节");
  assert.match(appSource, /requestId !== chapterLoadRequestRef\.current/, "快速切换章节时必须丢弃迟到的加载结果");
  assert.match(appSource, /onAppCloseRequested/, "关闭窗口前必须请求渲染层保存正文或恢复草稿");
  assert.match(mainSource, /app:before-close/, "主进程关闭窗口前必须等待正文保护流程");
  assert.match(mainSource, /!normalized\.startsWith\("backups\/"\)/, "项目备份必须排除历史 backups 目录");
}

async function main() {
  await fs.mkdir(runDirectory, { recursive: true });
  await testKnowledgeAndHealth();
  await testChapterUndoAndSaveIsolation();
  await testCancelableStreaming();
  await testClaudeHistoryVectorCompatibilityAndBackups();
  await testSafeRevisionAndExchange();
  await testReleasePrivacyScanner();
  await testFrontendSafetyContracts();
  console.log(`PASS: 知识库同步、分层摘要、检索、Agent、安全修订、Word 批注修订、创作统计、交换包脱敏、发布扫描、章节保护和停止生成均通过。测试目录：${runDirectory}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
