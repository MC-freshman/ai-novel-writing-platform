// 从 shared/contracts/ipc-channels.cjs 单源契约生成 electron/preload.cjs。
// 用法：
//   node scripts/gen-preload.cjs            → 重新生成 electron/preload.cjs
//   node scripts/gen-preload.cjs --verify   → 校验磁盘上的 preload.cjs 与契约一致（CI/测试用）
// 契约是唯一事实来源：新增/删除通道请改契约文件，不要手改 preload.cjs。

const fs = require("node:fs");
const path = require("node:path");

const workspace = path.resolve(__dirname, "..");
const contractPath = path.join(workspace, "shared", "contracts", "ipc-channels.cjs");
const preloadPath = path.join(workspace, "electron", "preload.cjs");

const { channels } = require(contractPath);

function validateContract() {
  const seenMethods = new Set();
  const seenChannels = new Set();
  for (const item of channels) {
    if (!item.method || !item.channel || !item.kind) throw new Error(`契约项缺字段: ${JSON.stringify(item)}`);
    if (seenMethods.has(item.method)) throw new Error(`契约方法重复: ${item.method}`);
    if (seenChannels.has(item.channel)) throw new Error(`契约通道重复: ${item.channel}`);
    if (item.kind === "invoke" && "arg" in item === false) throw new Error(`invoke 项缺少 arg 字段: ${item.method}`);
    if (item.kind === "event" && typeof item.payload !== "boolean") throw new Error(`event 项缺少 payload 布尔字段: ${item.method}`);
    if (!["invoke", "send", "event"].includes(item.kind)) throw new Error(`未知 kind: ${item.kind} (${item.method})`);
    seenMethods.add(item.method);
    seenChannels.add(item.channel);
  }
}

function renderInvoke(item) {
  return item.arg
    ? `  ${item.method}: (${item.arg}) => ipcRenderer.invoke(${JSON.stringify(item.channel)}, ${item.arg}),`
    : `  ${item.method}: () => ipcRenderer.invoke(${JSON.stringify(item.channel)}),`;
}

function renderEvent(item) {
  const handlerBody = item.payload ? "(_event, payload) => callback(payload)" : "() => callback()";
  return [
    `  ${item.method}: (callback) => {`,
    `    const handler = ${handlerBody};`,
    `    ipcRenderer.on(${JSON.stringify(item.channel)}, handler);`,
    `    return () => ipcRenderer.removeListener(${JSON.stringify(item.channel)}, handler);`,
    `  },`,
  ].join("\n");
}

function renderSend(item) {
  return `  ${item.method}: () => ipcRenderer.send(${JSON.stringify(item.channel)}),`;
}

function renderPreload() {
  const blocks = [];
  let lastKind = null;
  for (const item of channels) {
    if (item.kind !== lastKind) {
      if (lastKind !== null) blocks.push("");
      blocks.push(...kindSectionComment(item.kind));
      lastKind = item.kind;
    }
    if (item.kind === "invoke") blocks.push(renderInvoke(item));
    else if (item.kind === "event") blocks.push(...renderEvent(item).split("\n"));
    else blocks.push(renderSend(item));
  }
  return [
    "// 本文件由 scripts/gen-preload.cjs 依据 shared/contracts/ipc-channels.cjs 生成。",
    "// 请勿手工编辑：修改通道请改契约文件后运行 npm run gen:preload。",
    "const { contextBridge, ipcRenderer } = require(\"electron\");",
    "",
    "contextBridge.exposeInMainWorld(\"novelAPI\", {",
    ...blocks,
    "});",
    "",
  ].join("\n");
}

function kindSectionComment(kind) {
  if (kind === "event") return ["  // ---- 事件推送：主进程 → 渲染监听 ----"];
  if (kind === "send") return ["  // ---- 渲染单向发送 ----"];
  return ["  // ---- 渲染调用 ----"];
}

function main(argv = []) {
  validateContract();
  const rendered = renderPreload();
  if (argv.includes("--verify")) {
    const current = fs.readFileSync(preloadPath, "utf8");
    if (current !== rendered) {
      console.error("FAIL: electron/preload.cjs 与契约不一致——请运行 npm run gen:preload 重新生成。");
      process.exit(1);
    }
    console.log(`PASS: preload.cjs 与契约一致（${channels.length} 个通道）。`);
    return;
  }
  fs.writeFileSync(preloadPath, rendered);
  console.log(`OK: 已重新生成 electron/preload.cjs（${channels.length} 个通道）。`);
}

if (require.main === module) main(process.argv.slice(2));

// 导出纯函数供测试进程内调用（沙箱环境 spawn node 子进程不可靠）。
module.exports = { renderPreload, validateContract };
