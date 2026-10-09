const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  writeFileAtomic,
  writeJsonAtomic,
  readJson,
  writeProjectFiles,
  withProjectTransaction,
} = require("../../../electron/services/project-storage.cjs");

async function makeTempProject(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novel-storage-test-"));
  t.after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  return dir;
}

test("writeFileAtomic 写入并覆盖内容，目标文件不含临时残留", async (t) => {
  const project = await makeTempProject(t);
  const target = path.join(project, "chapters", "a.md");
  await writeFileAtomic(target, "第一章");
  assert.equal(await fs.readFile(target, "utf8"), "第一章");
  await writeFileAtomic(target, "第一章修订");
  assert.equal(await fs.readFile(target, "utf8"), "第一章修订");
  const siblings = await fs.readdir(path.join(project, "chapters"));
  assert.deepEqual(siblings, ["a.md"], "不应残留 .tmp 文件");
});

test("writeJsonAtomic 与 readJson 往返一致；损坏 JSON 返回 fallback", async (t) => {
  const project = await makeTempProject(t);
  const file = path.join(project, "config.json");
  await writeJsonAtomic(file, { name: "默认小说项目", volumes: [1, 2] });
  assert.deepEqual(await readJson(file, null), { name: "默认小说项目", volumes: [1, 2] });
  await fs.writeFile(file, "{broken json!!", "utf8");
  assert.deepEqual(await readJson(file, { fallback: true }), { fallback: true });
  assert.equal(await readJson(path.join(project, "missing.json"), "absent"), "absent");
});

test("writeProjectFiles 多文件事务全部成功", async (t) => {
  const project = await makeTempProject(t);
  const a = path.join(project, "a.md");
  const b = path.join(project, "sub", "b.md");
  await writeProjectFiles(project, [
    { path: a, content: Buffer.from("A") },
    { path: b, content: Buffer.from("B") },
  ]);
  assert.equal(await fs.readFile(a, "utf8"), "A");
  assert.equal(await fs.readFile(b, "utf8"), "B");
});

test("writeProjectFiles 路径越界整批拒绝，不写入任何文件", async (t) => {
  const project = await makeTempProject(t);
  const inside = path.join(project, "inside.md");
  const outside = path.join(project, "..", "escaped.md");
  await assert.rejects(
    () => writeProjectFiles(project, [
      { path: inside, content: Buffer.from("x") },
      { path: outside, content: Buffer.from("y") },
    ]),
    /越界/,
  );
  const entries = await fs.readdir(project);
  assert.deepEqual(entries, [], "越界时合法文件也不应被写入");
  const escapedPath = path.join(path.dirname(project), "escaped.md");
  assert.equal(await fs.readFile(escapedPath).catch(() => "absent"), "absent", "越界目标不应被创建");
});

test("withProjectTransaction 对同项目并发写入串行化", async (t) => {
  const project = await makeTempProject(t);
  const order = [];
  const first = withProjectTransaction(project, async () => {
    order.push("first-start");
    await new Promise((resolve) => setTimeout(resolve, 50));
    order.push("first-end");
  });
  const second = withProjectTransaction(project, async () => {
    order.push("second-start");
  });
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first-start", "first-end", "second-start"], "第二个事务必须等第一个完成");
});
