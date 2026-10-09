const fs = require("node:fs/promises");
const path = require("node:path");

// 结构化日志：单行 JSON 落盘，按天分文件，fire-and-forget，永不抛出。
// 未调用 initLogger() 之前（例如 NOVEL_PLATFORM_TEST=1 的单测环境）保持完全静默。
// 日志目录由 main 进程传入（app.getPath("userData")/logs），不写入用户小说项目目录。

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_FIELD_CHARS = 2000;
const MAX_STACK_CHARS = 2000;
const DEFAULT_RETENTION_DAYS = 14;

let logDir = null;
let minLevel = LEVELS.info;
let retentionDays = DEFAULT_RETENTION_DAYS;
let writeChain = Promise.resolve();

function localDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function truncate(value, max) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…(truncated ${text.length - max})`;
}

function normalizeExtra(extra) {
  if (extra == null) return undefined;
  if (extra instanceof Error) {
    return { name: extra.name, message: truncate(extra.message, MAX_FIELD_CHARS), stack: truncate(extra.stack, MAX_STACK_CHARS) };
  }
  if (typeof extra !== "object") return { value: truncate(extra, MAX_FIELD_CHARS) };
  const out = {};
  for (const [key, value] of Object.entries(extra)) {
    if (value instanceof Error) out[key] = { name: value.name, message: truncate(value.message, MAX_FIELD_CHARS), stack: truncate(value.stack, MAX_STACK_CHARS) };
    else if (typeof value === "string") out[key] = truncate(value, MAX_FIELD_CHARS);
    else if (value === undefined) continue;
    else if (typeof value === "object" && value !== null) {
      try { out[key] = truncate(JSON.stringify(value), MAX_FIELD_CHARS); }
      catch { out[key] = "[unserializable]"; }
    } else out[key] = value;
  }
  return out;
}

function appendLine(line) {
  // 调用时立即捕获目标目录：写入排队期间 logDir 可能被 init/reset 切换，
  // 若在回调里再读模块变量，会把日志写到错误目录或因 null 直接丢失。
  const targetDir = logDir;
  if (!targetDir) return;
  const fileName = `novel-platform-${localDateString(new Date())}.log`;
  writeChain = writeChain.then(() => fs.appendFile(path.join(targetDir, fileName), line)).catch(() => null);
}

async function pruneOldLogs(directory = logDir) {
  if (!directory) return { removed: 0 };
  let entries = [];
  try { entries = await fs.readdir(directory); } catch { return { removed: 0 }; }
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const name of entries) {
    if (!/^novel-platform-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
    const full = path.join(directory, name);
    try {
      const stat = await fs.stat(full);
      if (stat.mtimeMs < cutoff) { await fs.rm(full, { force: true }); removed += 1; }
    } catch { /* 单个文件清理失败不影响其余 */ }
  }
  return { removed };
}

function initLogger(directory, options = {}) {
  if (!directory || typeof directory !== "string") return { ok: false, reason: "log directory is required" };
  logDir = directory;
  if (options.minLevel && LEVELS[options.minLevel]) minLevel = LEVELS[options.minLevel];
  if (Number.isInteger(options.retentionDays) && options.retentionDays > 0) retentionDays = options.retentionDays;
  const targetDir = logDir;
  fs.mkdir(targetDir, { recursive: true }).then(() => pruneOldLogs(targetDir)).catch(() => null);
  return { ok: true, logDir, minLevel: Object.keys(LEVELS).find((key) => LEVELS[key] === minLevel) };
}

function log(domain, level, msg, extra) {
  if (!logDir) return;
  const numeric = LEVELS[level] ?? LEVELS.info;
  if (numeric < minLevel) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    domain: String(domain || "app"),
    msg: truncate(msg, MAX_FIELD_CHARS),
  };
  const normalized = normalizeExtra(extra);
  if (normalized !== undefined) entry.extra = normalized;
  appendLine(`${JSON.stringify(entry)}\n`);
}

// 便捷包装：每个域一组函数，调用点更短。
function makeLogger(domain) {
  return {
    debug: (msg, extra) => log(domain, "debug", msg, extra),
    info: (msg, extra) => log(domain, "info", msg, extra),
    warn: (msg, extra) => log(domain, "warn", msg, extra),
    error: (msg, extra) => log(domain, "error", msg, extra),
  };
}

function isLoggerActive() {
  return Boolean(logDir);
}

function getLogDir() {
  return logDir;
}

// 仅供单测复位模块级单例状态；业务代码不应调用。
// 注意：不得替换 writeChain——已排队的写入仍要落盘（目标目录已在入队时捕获），
// 否则钩子交错时会把未完成的写入孤儿化，造成静默丢日志。
function resetForTests() {
  logDir = null;
  minLevel = LEVELS.info;
  retentionDays = DEFAULT_RETENTION_DAYS;
}

// 仅供单测等待挂起的写盘链完成。
function flushForTests() {
  return writeChain;
}

module.exports = {
  initLogger,
  log,
  makeLogger,
  isLoggerActive,
  getLogDir,
  pruneOldLogs,
  resetForTests,
  flushForTests,
};
