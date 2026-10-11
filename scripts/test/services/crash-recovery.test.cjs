const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { fork } = require("node:child_process");
const { test } = require("node:test");
const storage = require("../../../electron/services/project-storage.cjs");
const snapshots = require("../../../electron/services/project-snapshots.cjs");
const AdmZip = require("adm-zip");
const worker = path.join(__dirname, "../helpers/crash-worker.cjs");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novel-crash-"));
  t.after(async () => {
    const relative = path.relative(path.resolve(os.tmpdir()), root);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, "chapters"));
  for (const id of ["a", "b", "d"]) await fs.writeFile(path.join(root, "chapters", id + ".md"), "原稿" + id.toUpperCase());
  await fs.writeFile(path.join(root, "novel.config.json"), '{"chapters":["a","b","d"]}');
  return root;
}
function crash(root, mode, stopAt, snapshotId = "") {
  return new Promise((resolve, reject) => {
    const child = fork(worker, [root, mode, stopAt, snapshotId], { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true });
    let hit = false;
    let errorText = "";
    child.stderr.on("data", (data) => { errorText += data; });
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("强杀检查点超时: " + stopAt + errorText)); }, 15000);
    child.on("error", reject);
    child.on("message", (message) => {
      if (message.error) { clearTimeout(timeout); reject(new Error(message.error)); }
      if (message.checkpoint === stopAt) { hit = true; child.kill("SIGKILL"); }
    });
    child.on("exit", () => { clearTimeout(timeout); if (hit) resolve(); else reject(new Error("未经过指定检查点: " + stopAt + errorText)); });
  });
}
async function verifyOriginal(root) {
  assert.deepEqual((await fs.readdir(path.join(root, "chapters"))).sort(), ["a.md", "b.md", "d.md"]);
  for (const id of ["a", "b", "d"]) assert.equal(await fs.readFile(path.join(root, "chapters", id + ".md"), "utf8"), "原稿" + id.toUpperCase());
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "novel.config.json"), "utf8")), { chapters: ["a", "b", "d"] });
}
for (const checkpoint of ["prepared", "temporary:a.md", "write:a.md", "write:b.md", "write:c.md", "delete:d.md"]) {
  test("多文件提交强杀后完整恢复: " + checkpoint, async (t) => {
    const root = await fixture(t);
    await crash(root, "write", checkpoint);
    await storage.withProjectTransaction(root, async () => {});
    await verifyOriginal(root);
    await storage.withProjectTransaction(root, async () => {});
    await verifyOriginal(root);
  });
}
test("持久化提交标记后的强杀保留新稿及配置", async (t) => {
  const root = await fixture(t);
  await crash(root, "write", "committed");
  await storage.withProjectTransaction(root, async () => {});
  assert.equal(await fs.readFile(path.join(root, "chapters", "a.md"), "utf8"), "新稿A");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "novel.config.json"), "utf8")), { chapters: ["a", "b", "c"] });
  assert.deepEqual((await fs.readdir(path.join(root, "chapters"))).filter((file) => file.endsWith(".md")).sort(), ["a.md", "b.md", "c.md"]);
});
test("恢复过程再次强杀后可幂等恢复", async (t) => {
  const root = await fixture(t);
  await crash(root, "write", "delete:d.md");
  await crash(root, "recover", "recover:d.md");
  await storage.withProjectTransaction(root, async () => {});
  await verifyOriginal(root);
});
test("快照恢复提交中强杀后恢复到操作前", async (t) => {
  const root = await fixture(t);
  const snapshot = await snapshots.createSnapshot(root, { name: "基线" });
  await fs.writeFile(path.join(root, "chapters", "a.md"), "快照之后的作者稿");
  await crash(root, "snapshot", "write:a.md", snapshot.id);
  await storage.withProjectTransaction(root, async () => {});
  assert.equal(await fs.readFile(path.join(root, "chapters", "a.md"), "utf8"), "快照之后的作者稿");
});
test("外部改稿拒绝覆盖，恢复证据保留，失败释放项目锁", async (t) => {
  const root = await fixture(t);
  await crash(root, "write", "write:a.md");
  await fs.writeFile(path.join(root, "chapters", "a.md"), "外部编辑器新稿");
  await assert.rejects(storage.withProjectTransaction(root, async () => {}), (error) => Boolean(error.recoveryPath) && /外部修改/.test(error.message));
  assert.equal(await fs.readFile(path.join(root, "chapters", "a.md"), "utf8"), "外部编辑器新稿");
  await assert.rejects(fs.access(path.join(root, ".novel-write.lock")));
  await fs.writeFile(path.join(root, "chapters", "a.md"), "新稿A");
  await storage.withProjectTransaction(root, async () => {});
  await verifyOriginal(root);
});

test("并行写入一项提前失败，等其余写入结束后再完整回滚", async (t) => {
  const root = await fixture(t), a = path.join(root, "chapters", "a.md"), b = path.join(root, "chapters", "b.md");
  const rename = fs.rename;
  fs.rename = async (from, to) => {
    if (to === a && (await fs.readFile(from, "utf8")) === "失败新稿") throw Object.assign(new Error("合成提前失败"), { code: "EIO" });
    if (to === b) await new Promise((resolve) => setTimeout(resolve, 80));
    return rename(from, to);
  };
  try {
    await assert.rejects(storage.withProjectTransaction(root, () => Promise.all([storage.writeFileAtomic(a, "失败新稿"), storage.writeFileAtomic(b, "延迟新稿")])), /提前失败/);
    await verifyOriginal(root);
  } finally { fs.rename = rename; }
});

for (const checkpoint of ["exchange:chapter", "exchange:config"]) test("交换导入强杀后原稿和目录一致: " + checkpoint, async (t) => {
  require("../helpers/service-fixture.cjs");
  const files = require("../../../electron/services/project-files.cjs");
  const root = await fixture(t);
  const config = files.defaultConfig("合成目标项目");
  config.agent.autoLocalAnalysis = false;
  config.chapters = ["a", "b", "d"].map((id, order) => ({ id, title: id, fileName: id + ".md", order, volume: "卷一" }));
  const before = JSON.stringify(config);
  await fs.writeFile(path.join(root, "novel.config.json"), before);
  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(JSON.stringify({ format: "ai-novel-project-exchange", version: 1 })));
  zip.addFile("project/novel.config.json", Buffer.from(JSON.stringify({ chapters: [{ id: "imported", title: "导入稿", fileName: "imported.md" }] })));
  zip.addFile("project/chapters/imported.md", Buffer.from("合成导入正文"));
  await fs.writeFile(path.join(root, "exchange.zip"), zip.toBuffer());
  await crash(root, "exchange", checkpoint);
  await storage.withProjectTransaction(root, async () => {});
  assert.equal(await fs.readFile(path.join(root, "novel.config.json"), "utf8"), before);
  assert.deepEqual((await fs.readdir(path.join(root, "chapters"))).sort(), ["a.md", "b.md", "d.md"]);
  for (const id of ["a", "b", "d"]) assert.equal(await fs.readFile(path.join(root, "chapters", id + ".md"), "utf8"), "原稿" + id.toUpperCase());
});
