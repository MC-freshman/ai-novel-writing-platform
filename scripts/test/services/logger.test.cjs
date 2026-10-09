const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const logger = require("../../../electron/services/logger.cjs");

async function makeTempLogDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novel-logger-test-"));
  t.after(async () => {
    logger.resetForTests();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function waitForWrites() {
  // 等待挂起的写盘链真正完成，而非轮询事件循环轮次。
  await logger.flushForTests();
  await new Promise((resolve) => setImmediate(resolve));
}

test("未初始化时完全静默", () => {
  logger.resetForTests();
  assert.equal(logger.isLoggerActive(), false);
  logger.log("test", "error", "不应写任何文件", { error: new Error("x") });
  assert.equal(logger.getLogDir(), null);
});

test("initLogger 后 JSON 行落盘且字段完整", async (t) => {
  const dir = await makeTempLogDir(t);
  const result = logger.initLogger(dir, { minLevel: "info" });
  assert.equal(result.ok, true);
  logger.log("ipc", "info", "chapter:save", { durationMs: 123 });
  logger.log("ipc", "error", "chapter:save", { error: new Error("磁盘写入失败", { cause: "EBUSY" }) });
  await waitForWrites();

  const files = (await fs.readdir(dir)).filter((name) => /^novel-platform-\d{4}-\d{2}-\d{2}\.log$/.test(name));
  assert.equal(files.length, 1);
  const content = await fs.readFile(path.join(dir, files[0]), "utf8");
  const lines = content.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].domain, "ipc");
  assert.equal(lines[0].level, "info");
  assert.equal(lines[0].msg, "chapter:save");
  assert.equal(lines[0].extra.durationMs, 123);
  assert.ok(lines[0].ts, "时间戳必须存在");
  assert.equal(lines[1].level, "error");
  assert.equal(lines[1].extra.error.name, "Error");
  assert.equal(lines[1].extra.error.message, "磁盘写入失败");
  assert.ok(lines[1].extra.error.stack, "Error 必须带 stack");
});

test("minLevel 过滤 debug，长字段被截断", async (t) => {
  const dir = await makeTempLogDir(t);
  logger.initLogger(dir, { minLevel: "warn" });
  logger.log("test", "debug", "应被过滤");
  logger.log("test", "warn", "应保留", { payload: "x".repeat(5000) });
  await waitForWrites();

  const files = await fs.readdir(dir);
  const content = await fs.readFile(path.join(dir, files[0]), "utf8");
  const lines = content.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 1, "debug 必须被 minLevel 过滤");
  assert.equal(lines[0].level, "warn");
  assert.ok(lines[0].extra.payload.length <= 2100, "超长字段必须截断");
  assert.match(lines[0].extra.payload, /\(truncated \d+\)$/, "截断值必须带长度标注");
});

test("pruneOldLogs 清理过期日志并保留当天", async (t) => {
  const dir = await makeTempLogDir(t);
  logger.initLogger(dir, { retentionDays: 14 });
  const oldName = `novel-platform-2020-01-01.log`;
  await fs.writeFile(path.join(dir, oldName), "{}\n", "utf8");
  const stale = new Date("2020-01-02T00:00:00Z");
  await fs.utimes(path.join(dir, oldName), stale, stale);
  const result = await logger.pruneOldLogs();
  assert.ok(result.removed >= 1);
  const remaining = await fs.readdir(dir);
  assert.ok(!remaining.includes(oldName));
});
