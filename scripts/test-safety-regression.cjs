const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const storage = require("../electron/services/project-storage.cjs");
const snapshots = require("../electron/services/project-snapshots.cjs");
const vectors = require("../electron/services/vector-shards.cjs");
const { PersistentTaskCenter } = require("../electron/services/task-center.cjs");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture(t, name) {
  const parent = path.resolve(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, "novel-safety-" + name + "-"));
  t.after(async () => {
    const relative = path.relative(parent, path.resolve(root));
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "测试清理必须位于临时目录内");
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

async function manuscript(t, name) {
  const root = await fixture(t, name);
  await fs.mkdir(path.join(root, "chapters"));
  const files = Object.fromEntries(["a", "b", "c", "d"].map((id) => [id, path.join(root, "chapters", id + ".md")]));
  await fs.writeFile(files.a, "快照旧稿 A");
  await fs.writeFile(files.b, "快照旧稿 B");
  const snapshot = await snapshots.createSnapshot(root, { name: "起点" });
  await fs.writeFile(files.a, "当前稿 A");
  await fs.writeFile(files.b, "当前稿 B");
  await fs.writeFile(files.c, "新增稿 C");
  await fs.writeFile(files.d, "新增稿 D");
  return { root, files, snapshot };
}
async function assertCurrentManuscript(files) {
  assert.deepEqual(await Promise.all(Object.values(files).map((file) => fs.readFile(file, "utf8"))), ["当前稿 A", "当前稿 B", "新增稿 C", "新增稿 D"]);
}

test("P01 替换被拒绝时保留旧文件，后续保存仍能成功", async (t) => {
  const root = await fixture(t, "replace");
  const target = path.join(root, "chapter.md");
  await fs.writeFile(target, "作者旧稿");
  const original = fs.rename;
  fs.rename = async (from, to) => {
    if (to === target) throw Object.assign(new Error("模拟 Windows 文件占用"), { code: "EPERM" });
    return original(from, to);
  };
  try {
    await assert.rejects(storage.writeFileAtomic(target, "不得覆盖的新稿"), /文件占用/);
    assert.equal(await fs.readFile(target, "utf8"), "作者旧稿");
    assert.deepEqual(await fs.readdir(root), ["chapter.md"]);
  } finally { fs.rename = original; }
  await storage.writeFileAtomic(target, "后续有效保存");
  assert.equal(await fs.readFile(target, "utf8"), "后续有效保存");
});

test("P05 坏对象必须在任何删除覆盖前拒绝恢复", async (t) => {
  const { root, files, snapshot } = await manuscript(t, "corrupt");
  const entry = snapshot.entries.find((item) => item.path === "chapters/b.md");
  await fs.writeFile(path.join(root, "backups", "snapshots", "objects", entry.hash.slice(0, 2), entry.hash), "损坏对象");
  await assert.rejects(snapshots.restoreSnapshot(root, snapshot.id), /校验失败/);
  await assertCurrentManuscript(files);
});

test("P01 临时文件无法写入时旧稿不变，二进制保存无损", async (t) => {
  const root = await fixture(t, "disk-failure");
  const target = path.join(root, "image.bin");
  const originalBody = Buffer.from([0, 255, 127, 42]);
  await fs.writeFile(target, originalBody);
  const original = fs.open;
  fs.open = async (file, ...args) => {
    if (String(file).startsWith(target + ".")) throw Object.assign(new Error("模拟磁盘已满"), { code: "ENOSPC" });
    return original(file, ...args);
  };
  try {
    await assert.rejects(storage.writeFileAtomic(target, Buffer.from([1, 2, 3])), /磁盘已满/);
    assert.deepEqual(await fs.readFile(target), originalBody);
    assert.deepEqual(await fs.readdir(root), ["image.bin"]);
  } finally { fs.open = original; }
  const nextBody = Buffer.from([255, 0, 1, 128, 254]);
  await storage.writeFileAtomic(target, nextBody);
  assert.deepEqual(await fs.readFile(target), nextBody);
});

test("P05 中途替换失败自动回滚已经写入的文件", async (t) => {
  const { root, files, snapshot } = await manuscript(t, "write-failure");
  const original = fs.rename;
  fs.rename = async (from, to) => {
    if (to === files.b) throw Object.assign(new Error("模拟恢复替换失败"), { code: "EPERM" });
    return original(from, to);
  };
  try { await assert.rejects(snapshots.restoreSnapshot(root, snapshot.id), /替换失败/); }
  finally { fs.rename = original; }
  await assertCurrentManuscript(files);
});

test("P05 删除中途失败恢复新增文件及所有当前稿", async (t) => {
  const { root, files, snapshot } = await manuscript(t, "remove-failure");
  const original = fs.rm;
  fs.rm = async (target, options) => {
    if (target === files.d) throw Object.assign(new Error("模拟删除权限失败"), { code: "EACCES" });
    return original(target, options);
  };
  try { await assert.rejects(snapshots.restoreSnapshot(root, snapshot.id), /删除权限失败/); }
  finally { fs.rm = original; }
  await assertCurrentManuscript(files);
});

test("P05 回滚也失败时保留可恢复的原稿并给出位置", async (t) => {
  const { root, files, snapshot } = await manuscript(t, "rollback-failure");
  const original = fs.rename;
  let replacedA = false;
  fs.rename = async (from, to) => {
    if (to === files.b || (to === files.a && replacedA)) throw Object.assign(new Error("模拟持续磁盘错误"), { code: "EIO" });
    const result = await original(from, to);
    if (to === files.a) replacedA = true;
    return result;
  };
  let failure;
  try {
    await assert.rejects(snapshots.restoreSnapshot(root, snapshot.id), (error) => {
      failure = error;
      return /回滚未完成/.test(error.message);
    });
  } finally { fs.rename = original; }
  assert.ok(failure.recoveryPath && failure.safetySnapshotId);
  const relative = path.relative(path.join(root, "backups", "snapshots"), failure.recoveryPath);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(await fs.readFile(path.join(failure.recoveryPath, "previous-0"), "utf8"), "当前稿 A");
});

test("P05 进度回调抛错也回滚，选择恢复不修改未选文件", async (t) => {
  const { root, files, snapshot } = await manuscript(t, "progress");
  await assert.rejects(snapshots.restoreSnapshot(root, snapshot.id, { onProgress: async () => { throw new Error("模拟进度回调失败"); } }), /进度回调失败/);
  await assertCurrentManuscript(files);
  await snapshots.restoreSnapshot(root, snapshot.id, { paths: ["chapters/a.md"] });
  assert.equal(await fs.readFile(files.a, "utf8"), "快照旧稿 A");
  assert.equal(await fs.readFile(files.b, "utf8"), "当前稿 B");
  assert.equal(await fs.readFile(files.c, "utf8"), "新增稿 C");
});

test("P05 不能恢复含越界路径的快照", async (t) => {
  const { root, files, snapshot } = await manuscript(t, "paths");
  const manifestPath = path.join(root, "backups", "snapshots", "manifests", snapshot.id + ".json");
  await fs.writeFile(manifestPath, JSON.stringify({ ...snapshot, entries: [{ ...snapshot.entries[0], path: "../escape.md" }] }));
  await assert.rejects(snapshots.restoreSnapshot(root, snapshot.id), /不安全路径/);
  await assertCurrentManuscript(files);
});

test("P05 创建快照与清理对象并发时不删除正在创建的对象", async (t) => {
  const root = await fixture(t, "snapshot-concurrency");
  await fs.mkdir(path.join(root, "chapters"));
  await fs.writeFile(path.join(root, "chapters", "a.md"), "唯一稿件");
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  let resume;
  const gate = new Promise((resolve) => { resume = resolve; });
  const creating = snapshots.createSnapshot(root, { onProgress: async () => { entered(); await gate; } });
  await started;
  const cleaning = snapshots.garbageCollectObjects(root);
  await delay(20);
  resume();
  const snapshot = await creating;
  await cleaning;
  const entry = snapshot.entries[0];
  assert.equal(await fs.readFile(path.join(root, "backups", "snapshots", "objects", entry.hash.slice(0, 2), entry.hash), "utf8"), "唯一稿件");
});

test("P05 目录链接不能把恢复写入带出项目", async (t) => {
  const { root, snapshot } = await manuscript(t, "link");
  const outside = await fixture(t, "outside");
  await fs.writeFile(path.join(outside, "a.md"), "项目外原稿");
  await fs.rename(path.join(root, "chapters"), path.join(root, "saved-chapters"));
  await fs.symlink(outside, path.join(root, "chapters"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(snapshots.restoreSnapshot(root, snapshot.id), /不安全路径/);
  assert.equal(await fs.readFile(path.join(outside, "a.md"), "utf8"), "项目外原稿");
});

function entries(id) {
  return new Map([[id, [{ id: id + "_0", sourceId: id, sourceType: "chapter", title: id, sourceHash: id, text: "正文 " + id }]]]);
}

test("P08 首次迁移与并发新增不丢索引清单条目", async (t) => {
  const root = await fixture(t, "upsert");
  await Promise.all(Array.from({ length: 8 }, (_, index) => vectors.upsertSources(root, entries("source_" + index))));
  const store = await vectors.loadStore(root);
  assert.equal(store.manifest.sources.length, 8);
  assert.equal(store.vectors.length, 8);
  assert.equal(new Set(store.vectors.map((item) => item.sourceId)).size, 8);
});

test("P08 重建后排队的增量和元数据修改不会相互覆盖", async (t) => {
  const root = await fixture(t, "replace-index");
  await vectors.upsertSources(root, entries("old"));
  await Promise.all([vectors.replaceSources(root, entries("A")), vectors.upsertSources(root, entries("B"))]);
  await Promise.all([vectors.updateSourcesMetadata(root, new Map([["A", { title: "已改标题" }]])), vectors.removeSource(root, "B")]);
  const store = await vectors.loadStore(root);
  assert.deepEqual(store.manifest.sources.map((item) => item.sourceId), ["A"]);
  assert.equal(store.vectors[0].title, "已改标题");
});

test("P08 清单写入失败不会使队列无法继续", async (t) => {
  const root = await fixture(t, "queue-recovery");
  await vectors.upsertSources(root, entries("A"));
  const original = fs.rename;
  fs.rename = async (from, to) => {
    if (to === path.join(root, "vector_db", "manifest.json")) throw Object.assign(new Error("模拟清单写入失败"), { code: "EIO" });
    return original(from, to);
  };
  try { await assert.rejects(vectors.upsertSources(root, entries("failed")), /清单写入失败/); }
  finally { fs.rename = original; }
  await vectors.upsertSources(root, entries("B"));
  assert.deepEqual((await vectors.loadManifest(root)).sources.map((item) => item.sourceId), ["A", "B"]);
});

test("P10 超过 120 条时运行与等待任务仍可见并可取消", async (t) => {
  const root = await fixture(t, "tasks");
  let resume;
  const gate = new Promise((resolve) => { resume = resolve; });
  const center = new PersistentTaskCenter({ projectPath: root, executor: async () => { await gate; return { done: true }; } });
  const first = await center.enqueue({ title: "运行任务" });
  for (let index = 0; index < 100 && !center.controllers.has(first.id); index += 1) await delay(5);
  const queued = [];
  try {
    for (let index = 0; index < 120; index += 1) queued.push(await center.enqueue({ title: "等待 " + index }));
    const tasks = (await center.list()).tasks;
    assert.ok(tasks.some((item) => item.id === first.id), "运行任务不可被历史上限裁剪");
    assert.ok(queued.every((item) => tasks.some((task) => task.id === item.id)));
    assert.equal((await center.cancel(first.id)).canceled, true);
  } finally {
    for (const item of (await center.list()).tasks.filter((task) => task.status === "等待中")) await center.cancel(item.id);
    resume();
    for (let index = 0; index < 100 && center.running; index += 1) await delay(5);
    await center.writeQueue;
  }
});

test("P10 重启保留所有可重试的中断任务", async (t) => {
  const root = await fixture(t, "restart");
  await fs.mkdir(path.join(root, "analysis"));
  const tasks = Array.from({ length: 125 }, (_, index) => ({ id: "unfinished_" + index, title: "任务 " + index, status: index === 0 ? "运行中" : "等待中" }));
  await fs.writeFile(path.join(root, "analysis", "tasks.json"), JSON.stringify({ version: 1, tasks }));
  const center = new PersistentTaskCenter({ projectPath: root, executor: async () => null });
  const loaded = (await center.list()).tasks;
  assert.equal(loaded.length, 125);
  assert.ok(loaded.every((item) => item.status === "已中断" && item.canRetry));
});

test("P10 活动队列达到 500 个时明确拒绝新任务而不丢旧任务", async (t) => {
  const root = await fixture(t, "capacity");
  let resume;
  const gate = new Promise((resolve) => { resume = resolve; });
  const center = new PersistentTaskCenter({ projectPath: root, executor: async () => { await gate; return null; } });
  try {
    for (let index = 0; index < 500; index += 1) await center.enqueue({ title: "容量任务 " + index });
    await assert.rejects(center.enqueue({ title: "超过容量" }), /500 个活动任务/);
    assert.equal((await center.list()).tasks.length, 500);
  } finally {
    for (const item of (await center.list()).tasks.filter((task) => task.status === "等待中")) await center.cancel(item.id);
    resume();
    for (let index = 0; index < 100 && center.running; index += 1) await delay(5);
    await center.writeQueue;
  }
});

test("P10 只裁剪已结束历史，保留可重试的中断任务", async (t) => {
  const root = await fixture(t, "history");
  await fs.mkdir(path.join(root, "analysis"));
  const completed = Array.from({ length: 150 }, (_, index) => ({ id: "done_" + index, status: "已完成" }));
  await fs.writeFile(path.join(root, "analysis", "tasks.json"), JSON.stringify({ tasks: [{ id: "interrupted", status: "已中断", canRetry: true }, ...completed] }));
  const center = new PersistentTaskCenter({ projectPath: root, executor: async () => null });
  const tasks = (await center.list()).tasks;
  assert.equal(tasks.filter((task) => task.status === "已完成").length, 120);
  assert.ok(tasks.some((task) => task.id === "interrupted"));
  assert.equal((await center.clearHistory()).tasks.length, 0);
});

test("P10 同时首次入队不会重复初始化丢任务", async (t) => {
  const root = await fixture(t, "init");
  let resume;
  const gate = new Promise((resolve) => { resume = resolve; });
  const center = new PersistentTaskCenter({ projectPath: root, executor: async () => { await gate; return null; } });
  try {
    const created = await Promise.all(Array.from({ length: 12 }, (_, index) => center.enqueue({ title: "并发任务 " + index })));
    const tasks = (await center.list()).tasks;
    assert.equal(tasks.length, 12);
    assert.ok(created.every((item) => tasks.some((task) => task.id === item.id)));
  } finally {
    for (const item of (await center.list()).tasks.filter((task) => task.status === "等待中")) await center.cancel(item.id);
    resume();
    for (let index = 0; index < 100 && center.running; index += 1) await delay(5);
    await center.writeQueue;
  }
});
