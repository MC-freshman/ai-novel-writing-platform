// IPC 契约启动期自检：对比实际注册的通道与契约要求的通道集合。
// 契约单源：shared/contracts/ipc-channels.cjs。
// 测试模式（NOVEL_PLATFORM_TEST=1）下不一致直接 throw（回归门禁 fail-fast）；
// 生产模式记录 error 日志但不阻断启动（避免一次疏漏让用户软件无法打开）。

const { log } = require("./logger.cjs");

function verifyIpcContract({ registered, contractChannels, testMode = false }) {
  const registeredSet = new Set(registered || []);
  const contractSet = new Set(contractChannels || []);
  const missing = [...contractSet].filter((channel) => !registeredSet.has(channel));
  const unregistered = [...registeredSet].filter((channel) => !contractSet.has(channel));
  if (!missing.length && !unregistered.length) return { ok: true, missing, unregistered };
  const detail = `IPC 契约不一致：main 缺失 ${JSON.stringify(missing)}；契约未登记 ${JSON.stringify(unregistered)}。`;
  if (testMode) throw new Error(detail);
  log("ipc-contract", "error", detail);
  return { ok: false, missing, unregistered };
}

module.exports = { verifyIpcContract };
