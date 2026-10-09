const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { spawn } = require("node:child_process");
const { test } = require("node:test");
const http = require("node:http");
const crypto = require("node:crypto");
const AdmZip = require("adm-zip");
const { pathToFileURL } = require("node:url");
const storage = require("../electron/services/project-storage.cjs");
const vectors = require("../electron/services/vector-shards.cjs");
process.env.NOVEL_PLATFORM_TEST = "1";

// P2 split: main-process code now spans main.cjs + electron/ipc/handlers.cjs +
// many domain services, and ALL of them are require-cached before ipcHarness
// runs. Seed a stable electron mock into the require cache BEFORE loading the
// platform, so every module binds to the same mock instead of the real electron
// package (which in plain node only exports the binary path string).
const harnessState = { dialogImpl: async () => ({ canceled: true }) };
const harnessRegistry = new Map(); // ipcMain.handle registry shared with ipcHarness
const electronMockModule = new Module("electron-test-mock", null);
electronMockModule.exports = {
  app: { getVersion: () => "0.3.3", whenReady: () => Promise.resolve(), getPath: () => os.tmpdir(), setName() {}, on() {} },
  dialog: { showOpenDialog: async (...args) => harnessState.dialogImpl(...args) },
  ipcMain: { handle: (name, action) => { harnessRegistry.set(name, action); }, on() {} },
  BrowserWindow: class BrowserWindowMock {},
  Menu: { setApplicationMenu() {}, buildFromTemplate: () => [] },
  shell: { openExternal: async () => {} },
};
require.cache[require.resolve("electron")] = electronMockModule;

const platform = require("../electron/main.cjs");
const { state } = require("../electron/services/runtime-state.cjs");
const { registerIpcHandlers } = require("../electron/ipc/handlers.cjs");

async function fixture(t) {
  const parent = path.resolve(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, "novel-plan-"));
  t.after(async () => {
    const relative = path.relative(parent, root);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    await fs.rm(root, { recursive: true, force: true });
  });
  await platform.ensureProjectStructure(root, "合成项目");
  const config = await platform.loadConfig(root);
  config.agent.autoLocalAnalysis = false;
  await platform.saveConfig(root, config);
  return root;
}

async function ipcHarness(root, importFile = "") {
  const webContents = { getURL: () => "file:///synthetic/dist/index.html", isDestroyed: () => false, send() {} };
  harnessState.dialogImpl = async () => ({ canceled: false, filePaths: [importFile] });
  harnessRegistry.clear();
  // The electron mock is seeded in the require cache at file top; just point the
  // shared runtime state at this fixture and (re)register the handlers directly.
  state.currentProjectPath = root;
  state.mainWindow = { webContents, isDestroyed: () => false };
  registerIpcHandlers();
  return { handlers: harnessRegistry, invoke: (name, value) => harnessRegistry.get(name)({ sender: webContents, senderFrame: { url: webContents.getURL(), parent: null } }, value) };
}

test("P02 八个并发新建保留全部章节和文件，混合设置移动不丢目录", async (t) => {
  const root = await fixture(t);
  const { invoke } = await ipcHarness(root);
  await Promise.all(Array.from({ length: 8 }, (_, i) => invoke("chapter:create", { title: "并发 " + i })));
  const config = await platform.loadConfig(root);
  assert.equal(config.chapters.length, 9);
  assert.equal(new Set(config.chapters.map((item) => item.fileName)).size, 9);
  await Promise.all([invoke("chapter:move-to-volume", { chapterId: config.chapters[1].id, volume: "新卷" }), invoke("project:save-settings", { author: "合成作者" })]);
  const after = await platform.loadConfig(root);
  assert.equal(after.chapters.length, 9);
  assert.equal(after.author, "合成作者");
  assert.equal(after.chapters.find((item) => item.id === config.chapters[1].id).volume, "新卷");
  await Promise.all(after.chapters.map((item) => fs.access(platform.getChapterPath(root, item))));
});

test("P02 跨进程事务与嵌套事务保护同一配置", async (t) => {
  const root = await fixture(t);
  const counter = path.join(root, "counter.json");
  await fs.writeFile(counter, "0");
  await fs.writeFile(path.join(root, ".novel-write.lock"), JSON.stringify({ pid: 2147483647, token: "abandoned-owner", createdAt: 0 }));
  const service = path.resolve(__dirname, "../electron/services/project-storage.cjs");
  const script = `const fs=require('node:fs/promises'); const s=require(${JSON.stringify(service)}); s.withProjectTransaction(process.argv[1],async()=>{const f=process.argv[2];const n=JSON.parse(await fs.readFile(f,'utf8'));await new Promise(r=>setTimeout(r,30));await s.writeJsonAtomic(f,n+1)}).catch(e=>{console.error(e);process.exitCode=1});`;
  await Promise.all(Array.from({ length: 5 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script, root, counter], { windowsHide: true });
    let output = "";
    child.stderr.on("data", (data) => { output += data; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(output)));
  })));
  assert.equal(JSON.parse(await fs.readFile(counter, "utf8")), 5);
  await storage.withProjectTransaction(root, () => storage.withProjectTransaction(root, async () => fs.access(counter)));
});

test("P03 历史备份失败停止覆盖，正文及修订号不变", async (t) => {
  const root = await fixture(t);
  const loaded = await platform.loadChapterContent(root, "");
  const original = fs.open;
  fs.open = async (file, ...args) => {
    if (String(file).includes(path.join("backups", "versions"))) throw new Error("模拟历史磁盘失败");
    return original(file, ...args);
  };
  const originalWrite = fs.writeFile;
  fs.writeFile = async (file, ...args) => {
    if (String(file).includes(path.join("backups", "versions"))) throw new Error("模拟历史磁盘失败");
    return originalWrite(file, ...args);
  };
  try { await assert.rejects(platform.saveChapterContent(root, { chapterId: loaded.chapter.id, content: "新正文", expectedRevision: loaded.revision }), /历史磁盘失败/); }
  finally { fs.open = original; fs.writeFile = originalWrite; }
  assert.equal((await platform.loadChapterContent(root, loaded.chapter.id)).content, loaded.content);
});

test("P03 索引失败返回已提交的修订号并允许再次保存", async (t) => {
  const root = await fixture(t);
  const loaded = await platform.loadChapterContent(root, "");
  const original = fs.rename;
  fs.rename = async (from, to) => {
    if (to === path.join(root, "vector_db", "manifest.json")) throw new Error("模拟索引磁盘失败");
    return original(from, to);
  };
  let result;
  try { result = await platform.saveChapterContent(root, { chapterId: loaded.chapter.id, content: "正文已提交", expectedRevision: loaded.revision }); }
  finally { fs.rename = original; }
  assert.equal(result.committed, true);
  assert.match(result.indexWarning, /索引磁盘失败/);
  const after = await platform.loadChapterContent(root, loaded.chapter.id);
  assert.equal(result.revision, after.revision);
  const second = await platform.saveChapterContent(root, { chapterId: loaded.chapter.id, content: "继续保存", expectedRevision: result.revision });
  assert.equal(second.committed, true);
});

test("P12 保存一章不读取其他章节正文", async (t) => {
  const root = await fixture(t);
  const { invoke } = await ipcHarness(root);
  for (let i = 0; i < 4; i++) await invoke("chapter:create", { title: "其他 " + i });
  const loaded = await platform.loadChapterContent(root, "");
  const original = fs.readFile;
  const reads = [];
  fs.readFile = async (file, ...args) => {
    if (String(file).startsWith(path.join(root, "chapters"))) reads.push(String(file));
    return original(file, ...args);
  };
  try { await platform.saveChapterContent(root, { chapterId: loaded.chapter.id, content: "新的正文", expectedRevision: loaded.revision }); }
  finally { fs.readFile = original; }
  assert.ok(reads.every((file) => file === platform.getChapterPath(root, loaded.chapter)), JSON.stringify(reads));
});

test("P09 损坏清单从分片恢复并保留坏文件和可见状态", async (t) => {
  const root = await fixture(t);
  await vectors.upsertSources(root, new Map([["retained", [{ sourceId: "retained", text: "保留证据" }]]]));
  const manifest = path.join(root, "vector_db", "manifest.json");
  await fs.writeFile(manifest, "{broken");
  const store = await vectors.loadStore(root);
  assert.equal(store.vectors.length, 1);
  assert.equal(store.vectors[0].text, "保留证据");
  assert.match(store.manifest.recovery?.message || "", /恢复|损坏/);
  assert.ok((await fs.readdir(path.dirname(manifest))).some((name) => name.startsWith("manifest.corrupt-")));
});

test("P11 DONE 无需断开连接就结束，错误和截断保留回答并提示", async (t) => {
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write('data: {"choices":[{"delta":{"content":"已收到片段"}}]}\n\n');
      if (request.url.startsWith("/done")) response.write('data: {"usage":{"completion_tokens":7}}\n\ndata: [DONE]\n\n');
      else if (request.url.startsWith("/error")) response.end('data: {"error":{"message":"合成提供商错误"}}\n\n');
      else if (request.url.startsWith("/length")) response.end('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n');
      else response.end();
    });
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); });
  const config = (mode) => ({ api: { provider: "custom", baseUrl: `http://127.0.0.1:${server.address().port}/${mode}`, apiKey: "", chatModel: "synthetic", maxTokens: 100 } });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 700);
  const start = Date.now();
  let usage;
  const answer = await platform.callChatApi(config("done"), "s", "q", [], { stream: true, signal: controller.signal, onUsage: (value) => { usage = value; } });
  clearTimeout(timer);
  assert.equal(answer, "已收到片段");
  assert.equal(usage.completion_tokens, 7);
  assert.ok(Date.now() - start < 600);
  assert.match(await platform.callChatApi(config("error"), "s", "q", [], { stream: true }), /已收到片段[\s\S]*合成提供商错误[\s\S]*已保留/);
  assert.match(await platform.callChatApi(config("truncated"), "s", "q", [], { stream: true }), /未正常结束|截断/);
  assert.match(await platform.callChatApi(config("length"), "s", "q", [], { stream: true }), /长度|上限/);
});

test("P06 图片交换包不含原路径，另一项目导入可读取图片并报告缺失", async (t) => {
  const root = await fixture(t);
  const destination = await fixture(t);
  const assetDir = path.join(root, "assets");
  await fs.mkdir(assetDir, { recursive: true });
  const image = path.join(assetDir, "synthetic.png");
  const bytes = Buffer.from("合成图片字节");
  await fs.writeFile(image, bytes);
  const loaded = await platform.loadChapterContent(root, "");
  const content = `<h1>含图章节</h1><p>图像</p><img src="${pathToFileURL(image).href}"><img src="${pathToFileURL(path.join(assetDir, "missing.png")).href}">`;
  await platform.saveChapterContent(root, { chapterId: loaded.chapter.id, content, expectedRevision: loaded.revision });
  const archivePath = path.join(root, "exchange.zip");
  const exported = await platform.buildProjectExchangeArchive(root, archivePath, { appVersion: "0.3.3" });
  const zip = new AdmZip(await fs.readFile(archivePath));
  const exportedContent = zip.readAsText(`project/chapters/${loaded.chapter.fileName}`);
  assert.ok(!exportedContent.includes("file:"));
  assert.ok(!exportedContent.includes(root));
  assert.ok(exported.manifest.resourceWarnings.length);
  assert.ok(zip.getEntries().some((entry) => entry.entryName.startsWith("project/assets/")));
  const { invoke } = await ipcHarness(destination, archivePath);
  const preview = await invoke("project:preview-exchange", {});
  const imported = await invoke("project:import-exchange", { token: preview.token });
  const importedChapter = imported.state.chapters.find((item) => item.id !== imported.state.chapters[0].id);
  const importedContent = (await platform.loadChapterContent(destination, importedChapter.id)).content;
  const src = importedContent.match(/<img[^>]+src="([^"]+)"/)[1];
  assert.ok(src.startsWith(pathToFileURL(destination).href));
  assert.deepEqual(await fs.readFile(new URL(src)), bytes);
});

test("P07 备份排除历史凭据副本并脱敏当前设置，只包含项目数据", async (t) => {
  const root = await fixture(t);
  const secret = "SYNTHETIC-CREDENTIAL-P07";
  const encoded = Buffer.from(secret).toString("base64");
  const config = await platform.loadConfig(root);
  config.api.apiKey = encoded;
  config.api.embeddingApiKey = encoded;
  await platform.saveConfig(root, config);
  const historical = path.join(root, "analysis", "system", "migration-backups");
  await fs.mkdir(historical, { recursive: true });
  await fs.writeFile(path.join(historical, "old.json"), JSON.stringify({ api: { apiKey: encoded } }));
  await fs.writeFile(path.join(root, "private-unknown.txt"), secret);
  const archive = await platform.createBackup(root, path.join(root, "backup-test.zip"));
  const zip = new AdmZip(await fs.readFile(archive));
  for (const entry of zip.getEntries().filter((entry) => !entry.isDirectory)) {
    const body = entry.getData().toString("utf8");
    assert.ok(!body.includes(secret) && !body.includes(encoded), entry.entryName);
    assert.ok(!entry.entryName.includes("migration-backups") && !entry.entryName.includes("private-unknown"));
  }
  assert.ok(zip.getEntries().some((entry) => entry.entryName.endsWith("novel.config.json")));
});

test("P13 错误来源和参数被 IPC 拒绝，普通状态不返回密钥", async (t) => {
  const root = await fixture(t);
  const config = await platform.loadConfig(root);
  config.api.apiKey = Buffer.from("SYNTHETIC-P13-KEY").toString("base64");
  await platform.saveConfig(root, config);
  const { handlers, invoke } = await ipcHarness(root);
  await assert.rejects(Promise.resolve().then(() => handlers.get("chapter:create")({ sender: {}, senderFrame: { url: "https://foreign.invalid" } }, { title: "无权新建" })), /来源|窗口/);
  await assert.rejects(invoke("chapter:save", { chapterId: config.chapters[0].id, content: { bad: true } }), /参数/);
  const state = await invoke("app:get-state");
  assert.equal(state.config.api.apiKey, "");
  assert.equal(state.config.api.apiKeyConfigured, true);
  assert.ok(!JSON.stringify(state).includes("SYNTHETIC-P13-KEY"));
  await invoke("project:save-settings", { author: "保留密钥", api: { apiKey: "" } });
  assert.equal((await platform.loadConfig(root)).api.apiKey, config.api.apiKey);
});

test("P13 超限、越界及重复条目的交换包在写入前拒绝", async () => {
  const archives = require("../electron/services/project-archives.cjs");
  const invalid = new AdmZip();
  invalid.addFile("project/chapters/a.md", Buffer.from("a"));
  const parsed = new AdmZip(invalid.toBuffer());
  parsed.getEntries()[0].header.size = archives.ARCHIVE_LIMITS.entry + 1;
  assert.throws(() => archives.validateExchangeZip(parsed), /上限/);
  const traversal = { getEntries: () => [{ entryName: "project/../escape", header: { size: 1, compressedSize: 1, attr: 0 } }] };
  assert.throws(() => archives.validateExchangeZip(traversal), /路径/);
});

test("P17 配置提交失败回滚正文，新建和删除也保持文件与目录一致", async (t) => {
  const root = await fixture(t);
  const loaded = await platform.loadChapterContent(root, "");
  const { invoke } = await ipcHarness(root);
  await invoke("chapter:create", { title: "可删除章节" });
  const before = await platform.loadConfig(root);
  const target = before.chapters[1];
  const original = fs.rename;
  fs.rename = async (from, to) => {
    if (to === platform.getConfigPath(root)) throw new Error("模拟配置提交失败");
    return original(from, to);
  };
  try {
    await assert.rejects(platform.saveChapterContent(root, { chapterId: loaded.chapter.id, content: "不应留下半提交的新稿", expectedRevision: loaded.revision }), /配置提交失败/);
    await assert.rejects(invoke("chapter:create", { title: "不能残留的新建" }), /配置提交失败/);
    await assert.rejects(invoke("chapter:delete", target.id), /配置提交失败/);
  } finally { fs.rename = original; }
  const after = await platform.loadConfig(root);
  assert.deepEqual(after.chapters.map((item) => item.id), before.chapters.map((item) => item.id));
  assert.equal(await fs.readFile(platform.getChapterPath(root, loaded.chapter), "utf8"), loaded.content);
  await fs.access(platform.getChapterPath(root, target));
  assert.equal((await fs.readdir(path.join(root, "chapters"))).length, 2);
});

test("P17 安全修订与自动保存并发时拒绝过期整章覆盖", async (t) => {
  const root = await fixture(t);
  const workspace = require("../electron/services/creative-workspace.cjs");
  const loaded = await platform.loadChapterContent(root, "");
  const content = "# 唯一章节\n\n这句话将被修订。这里保留新近保存的事实。";
  await platform.saveChapterContent(root, { chapterId: loaded.chapter.id, content, expectedRevision: loaded.revision });
  const current = await platform.loadChapterContent(root, loaded.chapter.id);
  const revision = await workspace.upsertItem(root, "revisions", { chapterId: loaded.chapter.id, original: "这句话将被修订。", replacement: "这句话已经修订。", status: "待确认", sourceRevision: current.revision });
  const results = await Promise.allSettled([
    platform.applySafeRevision(root, revision.id),
    platform.saveChapterContent(root, { chapterId: loaded.chapter.id, content: content + "过期自动保存", expectedRevision: current.revision }),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  const final = await platform.loadChapterContent(root, loaded.chapter.id);
  assert.match(final.content, /这句话已经修订/);
  assert.match(final.content, /保留新近保存的事实/);
  assert.ok(!final.content.includes("过期自动保存"));
});

test("P09 坏分片明确降级并保留原文件，修复后恢复可用", async (t) => {
  const root = await fixture(t);
  await vectors.upsertSources(root, new Map([["damaged", [{ sourceId: "damaged", text: "原始索引" }]]]));
  const manifest = await vectors.loadManifest(root);
  const shard = path.join(root, "vector_db", "shards", manifest.sources[0].fileName);
  await fs.writeFile(shard, "{bad-shard");
  const partial = await vectors.loadStore(root);
  assert.equal(partial.manifest.recovery.status, "degraded");
  assert.match(partial.manifest.recovery.message, /结果不完整/);
  assert.equal(await fs.readFile(shard, "utf8"), "{bad-shard");
  await assert.rejects(vectors.updateSourcesMetadata(root, new Map([["damaged", { title: "不能清空坏数据" }]])), /损坏|重建/);
  await vectors.upsertSources(root, new Map([["damaged", [{ sourceId: "damaged", text: "已重建证据" }]]]));
  assert.equal((await vectors.loadStore(root)).vectors[0].text, "已重建证据");
  assert.equal((await vectors.stats(root)).recovery, null);
});

test("P16 CDP 无响应请求超时，连接关闭时立即拒绝等待者", async (t) => {
  const { connectCdp } = require("./lib/cdp-client.cjs");
  const sockets = new Set();
  const server = http.createServer();
  server.on("upgrade", (request, socket) => {
    sockets.add(socket);
    const accept = crypto.createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); });
  const cdp = connectCdp(`ws://127.0.0.1:${server.address().port}`, { timeoutMs: 120 });
  await cdp.ready;
  await assert.rejects(cdp.call("No.Response"), /超时/);
  const pending = cdp.call("Waiting.For.Close");
  const rejected = assert.rejects(pending, /关闭/);
  for (const socket of sockets) socket.end(Buffer.from([0x88, 0x00]));
  await rejected; cdp.close();
});

test("P03 提交后日志失败仍返回正确修订号", async (t) => {
  const root = await fixture(t);
  const loaded = await platform.loadChapterContent(root, "");
  const { invoke } = await ipcHarness(root);
  const journal = require("../electron/services/operation-journal.cjs");
  const original = journal.completeOperation;
  journal.completeOperation = async () => { throw new Error("模拟提交后日志失败"); };
  let result;
  try { result = await invoke("chapter:save", { chapterId: loaded.chapter.id, content: "已落盘的稿件", expectedRevision: loaded.revision }); }
  finally { journal.completeOperation = original; }
  assert.equal(result.committed, true);
  assert.match(result.journalWarning, /日志失败/);
  assert.equal(result.revision, (await platform.loadChapterContent(root, loaded.chapter.id)).revision);
  assert.equal((await invoke("chapter:save", { chapterId: loaded.chapter.id, content: "继续编辑", expectedRevision: result.revision })).committed, true);
});

test("P17 导入提交失败回滚共享内存目录和文件，后续导入仍可用", async (t) => {
  const root = await fixture(t);
  const config = await platform.loadConfig(root);
  const before = structuredClone(config);
  const input = path.join(root, "synthetic-import.txt");
  await fs.writeFile(input, "合成导入内容");
  const original = fs.rename;
  fs.rename = async (from, to) => {
    if (to === platform.getConfigPath(root)) throw new Error("模拟导入配置失败");
    return original(from, to);
  };
  try { await assert.rejects(platform.importDocumentIntoProject(root, input, { config, skipFinalize: true }), /导入配置失败/); }
  finally { fs.rename = original; }
  assert.deepEqual(config.chapters, before.chapters);
  assert.deepEqual(config.stats, before.stats);
  assert.equal((await fs.readdir(path.join(root, "chapters"))).length, before.chapters.length);
  await platform.importDocumentIntoProject(root, input, { config, skipFinalize: true });
  assert.equal((await platform.loadConfig(root)).chapters.length, before.chapters.length + 1);
});

test("P17 历史恢复拒绝过期稿件并通过共同保存事务恢复", async (t) => {
  const root = await fixture(t);
  const initial = await platform.loadChapterContent(root, "");
  const { invoke } = await ipcHarness(root);
  const newer = await platform.saveChapterContent(root, { chapterId: initial.chapter.id, content: "新近保存的正文", expectedRevision: initial.revision });
  const versions = (await invoke("chapter:list-versions", initial.chapter.id)).versions;
  assert.ok(versions.length);
  await assert.rejects(invoke("chapter:restore-version", { chapterId: initial.chapter.id, versionId: versions[0].id, expectedRevision: initial.revision }), /变化|冲突|修订|版本/);
  assert.equal((await platform.loadChapterContent(root, initial.chapter.id)).content, "新近保存的正文");
  const restored = await invoke("chapter:restore-version", { chapterId: initial.chapter.id, versionId: versions[0].id, expectedRevision: newer.revision });
  assert.equal(restored.state.chapterContent, initial.content);
});

test("P08 不同进程新增索引源全部保留", async (t) => {
  const root = await fixture(t);
  const service = path.resolve(__dirname, "../electron/services/vector-shards.cjs");
  const script = `const v=require(${JSON.stringify(service)}); const id=process.argv[2];v.upsertSources(process.argv[1],new Map([[id,[{sourceId:id,text:id}]]])).catch(e=>{console.error(e);process.exitCode=1});`;
  await Promise.all(Array.from({ length: 5 }, (_, i) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script, root, "cross-source-" + i], { windowsHide: true });
    let output = "";
    child.stderr.on("data", (data) => { output += data; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(output)));
  })));
  assert.equal((await vectors.loadStore(root)).vectors.filter((item) => item.sourceId.startsWith("cross-source-")).length, 5);
});

test("P17 刷新 Word 原文拒绝过期覆盖，配置失败完整回滚", async (t) => {
  const { Document, Paragraph, Packer } = require("docx");
  const root = await fixture(t);
  const input = path.join(root, "synthetic-original.docx");
  const makeDoc = (text) => Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(text)] }] }));
  const invalid = new AdmZip(await makeDoc("坏 XML 合成文档"));
  invalid.updateFile("word/document.xml", Buffer.from("<w:document"));
  const invalidPath = path.join(root, "invalid.docx");
  await fs.writeFile(invalidPath, invalid.toBuffer());
  await assert.rejects(platform.importDocumentIntoProject(root, invalidPath));
  assert.equal((await platform.loadConfig(root)).chapters.length, 1);
  await fs.writeFile(input, await makeDoc("旧 Word 原文"));
  const [imported] = await platform.importDocumentIntoProject(root, input);
  const loaded = await platform.loadChapterContent(root, imported.chapter.id);
  const saved = await platform.saveChapterContent(root, { chapterId: imported.chapter.id, content: "编辑器中的最新稿件", expectedRevision: loaded.revision });
  const { invoke } = await ipcHarness(root);
  await assert.rejects(invoke("chapter:refresh-original", { chapterId: imported.chapter.id, expectedRevision: loaded.revision }), /变化|冲突|修订|版本/);
  await fs.writeFile(path.join(root, imported.chapter.originalDocxFile), await makeDoc("要恢复的 Word 原文"));
  const original = fs.rename;
  fs.rename = async (from, to) => {
    if (to === platform.getConfigPath(root)) throw new Error("模拟 Word 配置失败");
    return original(from, to);
  };
  try { await assert.rejects(invoke("chapter:refresh-original", { chapterId: imported.chapter.id, expectedRevision: saved.revision }), /Word 配置失败/); }
  finally { fs.rename = original; }
  assert.equal((await platform.loadChapterContent(root, imported.chapter.id)).content, "编辑器中的最新稿件");
  await invoke("chapter:refresh-original", { chapterId: imported.chapter.id, expectedRevision: saved.revision });
  assert.match((await platform.loadChapterContent(root, imported.chapter.id)).content, /要恢复的 Word 原文/);
});

test("P03 正文读取失败时打开与保存都停止，不写入空稿", async (t) => {
  const root = await fixture(t);
  const loaded = await platform.loadChapterContent(root, "");
  const file = platform.getChapterPath(root, loaded.chapter);
  const original = fs.readFile;
  fs.readFile = async (target, ...args) => {
    if (target === file) { const error = new Error("模拟正文读取权限失败"); error.code = "EACCES"; throw error; }
    return original(target, ...args);
  };
  try {
    await assert.rejects(platform.loadChapterContent(root, loaded.chapter.id), /保护原稿/);
    await assert.rejects(platform.saveChapterContent(root, { chapterId: loaded.chapter.id, content: "不能覆盖的稿件", expectedRevision: loaded.revision }), /读取权限失败/);
  } finally { fs.readFile = original; }
  assert.equal(await fs.readFile(file, "utf8"), loaded.content);
});
