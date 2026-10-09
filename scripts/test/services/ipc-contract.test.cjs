const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const workspace = path.resolve(__dirname, "..", "..", "..");
const contract = require("../../../shared/contracts/ipc-channels.cjs");
const { verifyIpcContract } = require("../../../electron/services/ipc-contract.cjs");

function readWorkspace(relative) {
  return fs.readFileSync(path.join(workspace, relative), "utf8");
}

function extractRegisteredChannels(mainText) {
  const channels = new Set();
  for (const m of mainText.matchAll(/registerIpcHandler\("([^"]+)"/g)) channels.add(m[1]);
  for (const m of mainText.matchAll(/ipcMain\.on\("([^"]+)"/g)) channels.add(m[1]);
  return channels;
}

function extractPreloadMappings(preloadText) {
  const methods = new Map();
  for (const m of preloadText.matchAll(/(\w+): \((\w*)\) => ipcRenderer\.invoke\("([^"]+)"(, (\w+))?\)/g)) {
    methods.set(m[1], { kind: "invoke", channel: m[3], arg: m[2] || null });
  }
  for (const m of preloadText.matchAll(/(\w+): \(\) => ipcRenderer\.send\("([^"]+)"\)/g)) {
    methods.set(m[1], { kind: "send", channel: m[2] });
  }
  for (const m of preloadText.matchAll(/(on\w+): \(callback\) => \{[\s\S]*?ipcRenderer\.on\("([^"]+)"/g)) {
    methods.set(m[1], { kind: "event", channel: m[2] });
  }
  return methods;
}

test("契约自检函数：一致通过 / 缺失与未登记分别报告", () => {
  assert.deepEqual(verifyIpcContract({ registered: ["a"], contractChannels: ["a"] }), { ok: true, missing: [], unregistered: [] });
  const result = verifyIpcContract({ registered: ["a", "extra"], contractChannels: ["a", "gone"], testMode: false });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["gone"]);
  assert.deepEqual(result.unregistered, ["extra"]);
  assert.throws(() => verifyIpcContract({ registered: [], contractChannels: ["x"], testMode: true }), /IPC 契约不一致/);
});

test("main/handlers 注册通道与契约精确一致（双向差集为零）", () => {
  const registered = new Set([
    ...[...extractRegisteredChannels(readWorkspace("electron/ipc/handlers.cjs"))],
    ...[...extractRegisteredChannels(readWorkspace("electron/main.cjs"))],
  ]);
  const required = new Set(contract.channelsRequiringHandler());
  const missing = [...required].filter((c) => !registered.has(c));
  const unregistered = [...registered].filter((c) => !required.has(c));
  assert.deepEqual(missing, [], "契约要求但 main 未注册");
  assert.deepEqual(unregistered, [], "main 注册但契约未登记");
});

test("preload.cjs 与契约逐项一致（方法/通道/类型）", () => {
  const preloadText = readWorkspace("electron/preload.cjs");
  const methods = extractPreloadMappings(preloadText);
  const byMethod = new Map(contract.channels.map((item) => [item.method, item]));
  assert.equal(methods.size, contract.channels.length, "preload 方法数应等于契约项数");
  for (const [method, mapping] of methods) {
    const expected = byMethod.get(method);
    assert.ok(expected, `preload 方法 ${method} 不在契约中`);
    assert.equal(mapping.channel, expected.channel, `${method} 通道不一致`);
    assert.equal(mapping.kind, expected.kind, `${method} kind 不一致`);
    if (expected.kind === "invoke") assert.equal(mapping.arg, expected.arg || null, `${method} 参数不一致`);
  }
  for (const item of contract.channels) {
    assert.ok(methods.has(item.method), `契约方法 ${item.method} 未在 preload 中生成`);
  }
});

test("生成的 preload.cjs 与契约重新渲染结果一致（未被手改）", () => {
  const { renderPreload } = require("../../../scripts/gen-preload.cjs");
  const current = readWorkspace("electron/preload.cjs");
  assert.equal(current, renderPreload(), "preload.cjs 与契约渲染结果不一致——请运行 npm run gen:preload");
});

test("vite-env.d.ts 方法集与契约一致（渲染端类型契约无漂移）", () => {
  const dtsText = readWorkspace("src/vite-env.d.ts");
  const declared = new Set([...dtsText.matchAll(/^      (\w+):/gm)].map((m) => m[1]));
  const contractMethods = new Set(contract.channels.map((item) => item.method));
  const missingInDts = [...contractMethods].filter((m) => !declared.has(m));
  const staleInDts = [...declared].filter((m) => !contractMethods.has(m));
  assert.deepEqual(missingInDts, [], "d.ts 缺少契约方法（渲染端会拿到未声明 API）");
  assert.deepEqual(staleInDts, [], "d.ts 存在契约已删除的过期方法");
});

test("契约内部完整性：通道无重复、字段齐备、kind 合法", () => {
  const seenChannels = new Set();
  for (const item of contract.channels) {
    assert.ok(item.method && item.channel && item.kind, `契约项缺字段: ${JSON.stringify(item)}`);
    assert.ok(!seenChannels.has(item.channel), `通道重复: ${item.channel}`);
    seenChannels.add(item.channel);
    if (item.kind === "invoke") assert.ok("arg" in item, `invoke 缺 arg: ${item.method}`);
    if (item.kind === "event") assert.equal(typeof item.payload, "boolean", `event 缺 payload: ${item.method}`);
  }
  assert.equal(contract.channels.length, 123, "通道总数（新增通道时应有意更新此数）");
});
