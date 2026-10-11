const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const AdmZip = require("adm-zip");
const { fixture, electron } = require("../helpers/service-fixture.cjs");
const files = require("../../../electron/services/project-files.cjs");
const credentials = require("../../../electron/services/credentials.cjs");
const windowsCredentials = require("../../../electron/services/windows-credentials.cjs");
const security = require("../../../electron/services/ipc-security.cjs");
const encryption = require("../../../electron/services/project-exchange-security.cjs");
const archives = require("../../../electron/services/project-archives.cjs");
const freshness = require("../../../electron/services/knowledge-freshness.cjs");
const knowledge = require("../../../electron/services/knowledge-index.cjs");
const update = require("../../../electron/services/app-update.cjs");
const { consumeChatStream } = require("../../../electron/services/chat-stream.cjs");
const ai = require("../../../electron/services/ai-generate.cjs");
const analysis = require("../../../electron/services/analysis-tools.cjs");
const migrations = require("../../../electron/services/project-migrations.cjs");
const journal = require("../../../electron/services/operation-journal.cjs");
const stats = require("../../../electron/services/creative-statistics.cjs");
const privacy = require("../../../electron/services/release-privacy.cjs");
const runtime = require("../../../electron/services/runtime-state.cjs");
const agent = require("../../../electron/services/novel-agent.cjs");
const creativeAgent = require("../../../electron/services/creative-agent.cjs");
const pipeline = require("../../../electron/services/retrieval-pipeline.cjs");

test("凭据往返、明文兼容与非枚举运行时秘密", async () => {
  const secret = "synthetic-credential-中文";
  assert.equal(credentials.decodeSecret(credentials.encodeSecret(secret)), secret);
  assert.equal(credentials.decodeSecret("not base64?"), "not base64?");
  const config = { api: { apiKey: credentials.encodeSecret(secret), embeddingApiKey: "" } };
  await credentials.loadCredentialSecrets("synthetic", config);
  assert.equal(credentials.runtimeSecret(config.api), secret);
  assert.ok(!JSON.stringify(config).includes("__chatSecret"));
  assert.equal((await credentials.saveCredentialSecrets("synthetic", { clearApiKey: true }, config)).chat, "");
});
test("Windows凭据命名隔离项目和用途，合成凭据读写删除", async (t) => {
  const root = await fixture(t);
  assert.notEqual(windowsCredentials.credentialTarget(root, "chat"), windowsCredentials.credentialTarget(root, "embedding"));
  assert.notEqual(windowsCredentials.credentialTarget(root, "chat"), windowsCredentials.credentialTarget(root + "other", "chat"));
  if (process.platform !== "win32") return;
  t.after(async () => { await windowsCredentials.deleteSecret(root, "chat"); });
  await windowsCredentials.setSecret(root, "chat", "synthetic-test-secret");
  assert.equal(await windowsCredentials.getSecret(root, "chat"), "synthetic-test-secret");
  await windowsCredentials.deleteSecret(root, "chat");
  assert.equal(await windowsCredentials.getSecret(root, "chat"), "");
});
test("IPC拒绝冒充sender、子frame及远端页面", () => {
  const contents = { getURL: () => "file:///synthetic/index.html" };
  const window = { webContents: contents, isDestroyed: () => false };
  const event = { sender: contents, senderFrame: { url: contents.getURL(), parent: null } };
  security.assertTrustedSender(event, window);
  assert.throws(() => security.assertTrustedSender({ ...event, sender: {} }, window), /来源/);
  assert.throws(() => security.assertTrustedSender({ ...event, senderFrame: { ...event.senderFrame, parent: {} } }, window), /不受信任/);
  contents.getURL = () => "https://example.invalid/";
  assert.throws(() => security.assertTrustedSender({ ...event, senderFrame: { url: contents.getURL(), parent: null } }, window), /不受信任/);
});
test("IPC拒绝越界标识、原型字段、非有限数、超深和超大参数", () => {
  security.validateIpcArguments("chapter:save", [{ chapterId: "one", content: "合成正文" }]);
  for (const args of [[{ fileName: "../one" }], [JSON.parse('{"__proto__":{}}')], [Infinity], [Array(20001).fill(0)], ["a".repeat(16 * 1024 * 1024 + 1)]]) assert.throws(() => security.validateIpcArguments("test", args));
  let nested = {}; for (let count = 0; count < 17; count++) nested = { next: nested };
  assert.throws(() => security.validateIpcArguments("test", [nested]), /层级/);
  assert.throws(() => security.validateIpcArguments("chapter:save", [{ chapterId: "one", content: 7 }]), /不合法/);
});
test("交换包加密往返，密码错误和篡改拒绝", async () => {
  const body = Buffer.from("合成交换包正文");
  assert.deepEqual(await encryption.decryptBuffer(await encryption.encryptBuffer(body, ""), ""), body);
  const encrypted = await encryption.encryptBuffer(body, "synthetic-password");
  assert.ok(encryption.isEncrypted(encrypted));
  assert.deepEqual(await encryption.decryptBuffer(encrypted, "synthetic-password"), body);
  await assert.rejects(encryption.decryptBuffer(encrypted, ""), /密码/);
  await assert.rejects(encryption.decryptBuffer(encrypted, "wrong-password"), /密码错误/);
  encrypted[encrypted.length - 1] ^= 1;
  await assert.rejects(encryption.decryptBuffer(encrypted, "synthetic-password"), /损坏/);
});
test("交换包拒绝未知目录和重复大小写路径，递归脱敏不改正文", () => {
  const bad = new AdmZip(); bad.addFile("unexpected.json", Buffer.from("{}"));
  assert.throws(() => archives.validateExchangeZip(bad), /未知/);
  const duplicate = new AdmZip(); duplicate.addFile("project/chapters/A.md", Buffer.from("A")); duplicate.addFile("project/chapters/a.md", Buffer.from("B"));
  assert.throws(() => archives.validateExchangeZip(duplicate), /重复/);
  const redacted = archives.redactSecrets({ content: "正文", api: { apiKey: "SYNTHETIC", embeddingApiKey: "SYNTHETIC", nested: [{ accessToken: "SYNTHETIC" }] } });
  assert.equal(redacted.content, "正文"); assert.equal(redacted.api.apiKey, ""); assert.equal(redacted.api.nested[0].accessToken, "");
});
test("新鲜度复用未改文件哈希，更新及缺失被分别报告", async (t) => {
  const root = await fixture(t), file = path.join(root, "one.md");
  await fs.writeFile(file, "合成初稿");
  let reads = 0;
  const sources = [{ id: "one", filePath: file, getContent: async () => { reads++; return fs.readFile(file, "utf8"); } }];
  const first = await freshness.inspectSources(root, sources);
  assert.equal(first.items[0].status, "未索引");
  const opts = { vectorManifest: { sources: [{ sourceId: "one", chunkCount: 1, sourceHash: first.items[0].contentHash }] }, summaries: { sources: [{ sourceId: "one", contentHash: first.items[0].contentHash }] } };
  assert.equal((await freshness.inspectSources(root, sources, opts)).items[0].status, "已同步");
  assert.equal(reads, 1);
  await fs.writeFile(file, "长度不同的合成修改稿");
  assert.equal((await freshness.inspectSources(root, sources, opts)).items[0].status, "等待更新");
  await fs.rm(file);
  assert.equal((await freshness.inspectSources(root, sources, opts)).items[0].status, "文件缺失");
});
test("分片评分拒绝不同维度和API身份，本地嵌入无外部请求", async () => {
  const local = knowledge.localEmbedding("合成小说正文");
  assert.ok(local.length > 0);
  assert.ok(Math.abs(knowledge.cosineSimilarity(local, local) - 1) < 1e-8);
  assert.equal(knowledge.compatibleVectorScore({ source: "api", identity: "A", vector: [1, 0] }, [1, 0], { embeddingSource: "api", embeddingIdentity: "B", embedding: [1, 0] }), 0);
  assert.equal(knowledge.compatibleVectorScore({ source: "local", vector: [1] }, [1], { embeddingSource: "local", embedding: [1, 0] }), 0);
});
test("流式完成、usage和无效帧，完成之后内容不进入回答", async () => {
  let usage;
  const body = 'data: garbage\n\ndata: {"choices":[{"delta":{"content":"中文片段"}}]}\n\ndata: {"usage":{"total_tokens":3}}\n\ndata: [DONE]\n\ndata: {"output_text":"不应出现"}\n\n';
  assert.equal(await consumeChatStream(new Response(body), null, { onUsage: (value) => { usage = value; } }), "中文片段");
  assert.equal(usage.total_tokens, 3);
});
test("流式错误保留已有片段，空回答错误明确抛出", async () => {
  const error = 'data: {"error":{"message":"合成网络错误"}}\n\n';
  await assert.rejects(consumeChatStream(new Response(error)), /合成网络错误/);
  const result = await consumeChatStream(new Response('data: {"output_text":"已经生成"}\n\n' + error));
  assert.match(result, /已经生成[\s\S]*以上内容已保留/);
  assert.match(await consumeChatStream(new Response('data: {"output_text":"截断内容"}\n\n')), /连接未正常结束/);
});
test("模型结构化文本解析和token估计边界", () => {
  assert.deepEqual(ai.extractJsonFromModelText('```json\n{"ok":true}\n```'), { ok: true });
  assert.throws(() => ai.extractJsonFromModelText("无法识别"), /JSON/);
  assert.ok(ai.estimateTokenCount("中文".repeat(100)) > ai.estimateTokenCount("ab".repeat(100)));
});
test("手动更新优先安装包、比较版本，GitHub失败明确报告", async (t) => {
  const original = global.fetch; t.after(() => { global.fetch = original; });
  global.fetch = async () => new Response(JSON.stringify({ tag_name: "v0.3.8", assets: [{ name: "Portable.exe", browser_download_url: "https://github.com/portable" }, { name: "Setup.exe", browser_download_url: "https://github.com/setup" }] }));
  const info = await update.checkForAppUpdate();
  assert.equal(info.updateAvailable, true); assert.equal(info.assetName, "Setup.exe");
  assert.equal(update.compareVersionNumbers("v0.3.10", "0.3.9"), 1);
  assert.equal(update.compareVersionNumbers("0.3.7", "0.3.7"), 0);
  global.fetch = async () => new Response("", { status: 503 });
  await assert.rejects(update.checkForAppUpdate(), /503/);
  await assert.rejects(update.downloadAndOpenAppUpdate("https://example.invalid/update.exe"), /受信任/);
});
test("更新下载取消不调用网络，确认打开只执行模拟安装入口", async (t) => {
  const root = await fixture(t), target = path.join(root, "synthetic-update.exe");
  const previous = { fetch: global.fetch, save: electron.dialog.showSaveDialog, confirm: electron.dialog.showMessageBox, open: electron.shell.openPath };
  t.after(() => { global.fetch = previous.fetch; electron.dialog.showSaveDialog = previous.save; electron.dialog.showMessageBox = previous.confirm; electron.shell.openPath = previous.open; });
  global.fetch = async () => { throw new Error("取消时不应下载"); };
  assert.equal((await update.downloadAndOpenAppUpdate("https://github.com/synthetic.exe")).canceled, true);
  electron.dialog.showSaveDialog = async () => ({ filePath: target });
  electron.dialog.showMessageBox = async () => ({ response: 0 });
  global.fetch = async () => new Response("synthetic executable bytes");
  let opened = 0; electron.shell.openPath = async () => { opened++; return ""; };
  assert.equal((await update.downloadAndOpenAppUpdate("https://github.com/synthetic.exe")).opened, false);
  assert.equal(opened, 0);
  electron.dialog.showMessageBox = async () => ({ response: 1 });
  assert.equal((await update.downloadAndOpenAppUpdate("https://github.com/synthetic.exe")).opened, true);
  assert.equal(opened, 1);
  assert.equal(await fs.readFile(target, "utf8"), "synthetic executable bytes");
});
test("路径与DOCX文本清理保留Unicode且拒绝目录逃逸", () => {
  assert.equal(files.sanitizeExportPathSegment("CON"), "_CON");
  assert.ok(!files.sanitizeExportPathSegment("a\0/b").includes("\0"));
  assert.equal(files.sanitizeDocxText("甲\0\u000b\t\r\n乙\uffff"), "甲\t\n乙");
  assert.equal(files.getChapterPath("synthetic", { fileName: "../outside.md" }), path.join("synthetic", "chapters", "outside.md"));
  assert.equal(files.contentToPlainText("<p>中文&amp;内容</p>"), "中文&内容");
});
test("项目配置迁移默认只读权限，不改变输入及正文目录身份", () => {
  const original = { chapters: [{ id: "one", title: "原稿" }], agent: { permissionLevel: "invalid" } };
  const migrated = migrations.migrateConfig(original, migrations.CURRENT_PROJECT_SCHEMA);
  assert.equal(migrated.agent.permissionLevel, "只读分析");
  assert.equal(migrated.chapters[0].id, "one");
  assert.equal(original.agent.permissionLevel, "invalid");
});
test("操作日志把异常会话的进行中操作标记中断", async (t) => {
  const root = await fixture(t);
  const first = await journal.startSession(root, "test");
  const second = await journal.startSession(root, "test");
  assert.equal(second.previousUnclean.id, first.session.id);
  const data = await journal.loadJournal(root);
  assert.equal(data.sessions[0].status, "异常中断");
  await journal.endSession(root, second.session.id);
  assert.equal((await journal.loadJournal(root)).activeSession, null);
});
test("创作统计清除脚本正文并保留对话比例范围", () => {
  assert.equal(stats.plainText('<script>秘密</script><p>正文</p>'), "正文");
  const metric = stats.chapterMetrics({ id: "one", title: "第一章" }, '甲说：“你好。”甲跑向门。', [{ name: "甲" }], [], []);
  assert.ok(metric.dialogueRatio > 0 && metric.dialogueRatio <= 100);
  assert.equal(metric.characterMentions.甲, 2);
});
test("Agent默认权限拒绝修订，唯一选区替换拒绝歧义", () => {
  assert.equal(agent.normalizePermission("invalid"), "只读分析");
  assert.equal(agent.canUseTool("只读分析", "safe_revision_proposer"), false);
  assert.throws(() => creativeAgent.replaceUniqueSelection("重复重复", "重复", "新稿"), /多|唯一|重复/);
});
test("检索诊断隐藏URL凭据且处理空模式和空上下文", () => {
  const endpoint = pipeline.safeEndpointLabel("https://user:secret@example.invalid/v1?apiKey=synthetic");
  assert.ok(!endpoint.includes("secret") && !endpoint.includes("apiKey"));
  assert.equal(pipeline.normalizeRetrievalMode("invalid"), "auto");
  assert.ok(Array.isArray(pipeline.contextFromChunks([])));
  assert.ok(analysis.queryTokens("合成检索问题").length > 0);
});
test("发布扫描发现合成密钥但不回传原始秘密，事件发送按窗口生命周期保护", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, "input.js"), 'const key="sk-' + "SYNTHETIC".repeat(4) + '";');
  const report = await privacy.scanReleaseInputs(root, ["input.js"]);
  assert.ok(report.findings.length > 0);
  assert.ok(!JSON.stringify(report).includes("SYNTHETIC".repeat(4)));
  runtime.state.mainWindow = null; runtime.sendRendererEvent("synthetic", {});
  let sent = 0; runtime.state.mainWindow = { isDestroyed: () => false, webContents: { send() { sent++; } } };
  runtime.sendRendererEvent("synthetic", {}); assert.equal(sent, 1); runtime.state.mainWindow = null;
});
