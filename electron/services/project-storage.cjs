const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const { createFileTransaction, recordBeforeWrite, commitFileTransaction, recoverFileTransactions } = require("./project-transactions.cjs");
const projectWriteQueues = new Map();
const transactionContext = new AsyncLocalStorage();

async function ensureDir(directory) {
  await fs.mkdir(directory, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

/** @param {string} filePath @param {string | Buffer | Uint8Array} value @param {BufferEncoding} [encoding="utf8"] */
function writeFileAtomic(filePath, value, encoding = "utf8") {
  const context = transactionContext.getStore();
  const promise = performFileAtomic(filePath, value, encoding);
  if (context?.active && context.recording) {
    context.pendingWrites.add(promise);
    promise.then(() => context.pendingWrites.delete(promise), () => context.pendingWrites.delete(promise));
  }
  return promise;
}

/** @param {string} filePath @param {string | Buffer | Uint8Array} value @param {BufferEncoding} encoding */
async function performFileAtomic(filePath, value, encoding = "utf8") {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`;
  const context = transactionContext.getStore();
  const relative = context ? path.relative(path.resolve(context.projectPath), path.resolve(filePath)) : "";
  const journalable = relative && !relative.startsWith("..") && !path.isAbsolute(relative) && ![".novel-transactions", "backups"].includes(relative.split(path.sep)[0]) && !relative.startsWith(".novel-write.lock");
  if (context?.active && context.recording && journalable) {
    // The journal itself is excluded by recordBeforeWrite; serialize registration
    // when an operation issues independent writes with Promise.all.
    const body = typeof value === "string" ? Buffer.from(value, encoding) : Buffer.from(value);
    const registration = context.pendingRecord.then(() => recordBeforeWrite(context.transaction, context.projectPath, filePath, body, writeFileAtomic, temporaryPath));
    context.pendingRecord = registration.catch(() => null);
    await registration;
  }
  await ensureDir(path.dirname(filePath));
  let handle;
  try {
    handle = await fs.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(value, encoding);
    await handle.sync();
    await handle.close();
    handle = null;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fs.rename(temporaryPath, filePath);
        break;
      } catch (error) {
        // A locked Windows target must never fall back to truncating/copying the live file.
        if (!["EEXIST", "EPERM", "EBUSY", "EACCES"].includes(error?.code) || attempt >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  } finally {
    if (handle) await handle.close().catch(() => null);
    await fs.rm(temporaryPath, { force: true }).catch(() => null);
  }
}

function projectKey(projectPath) {
  const resolved = path.resolve(projectPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function acquireProjectLock(projectPath) {
  await ensureDir(projectPath);
  const lockPath = path.join(projectPath, ".novel-write.lock");
  const token = crypto.randomBytes(16).toString("hex");
  const started = Date.now();
  while (true) {
    if (Date.now() - started > 30000) throw new Error("项目正在由其他进程写入，请稍后重试；旧稿未改变。");
    try {
      const handle = await fs.open(lockPath, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: Date.now() })); }
      catch (error) { await fs.rm(lockPath, { force: true }); throw error; }
      finally { await handle.close(); }
      return async () => {
        const owner = await readJson(lockPath, null);
        if (owner?.token === token) await fs.rm(lockPath, { force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = await readJson(lockPath, null);
      let abandoned = false;
      if (Number.isInteger(owner?.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); } catch (failure) { abandoned = failure.code === "ESRCH"; }
      } else {
        const stat = await fs.stat(lockPath).catch(() => null);
        abandoned = Boolean(stat && Date.now() - stat.mtimeMs > 30000);
      }
      if (abandoned) {
        const fingerprint = owner?.token || String((await fs.stat(lockPath).catch(() => null))?.mtimeMs || "missing");
        const recoveryPath = `${lockPath}.recover-${sha256(fingerprint).slice(0, 20)}`;
        let recoveryHandle;
        try {
          recoveryHandle = await fs.open(recoveryPath, "wx", 0o600);
          const latest = await readJson(lockPath, null);
          const latestFingerprint = latest?.token || String((await fs.stat(lockPath).catch(() => null))?.mtimeMs || "missing");
          if (latestFingerprint === fingerprint) await fs.rm(lockPath, { force: true });
        } catch (failure) { if (failure.code !== "EEXIST") throw failure; }
        finally {
          if (recoveryHandle) { await recoveryHandle.close(); await fs.rm(recoveryPath, { force: true }); }
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
}

function withProjectTransaction(projectPath, action) {
  const key = projectKey(projectPath);
  const context = transactionContext.getStore();
  if (context?.active && context.key === key) return Promise.resolve().then(action);
  const previous = projectWriteQueues.get(key) || Promise.resolve();
  const queued = previous.catch(() => null).then(async () => {
    const release = await acquireProjectLock(projectPath);
    let claim;
    try {
      // Recover before reading configuration or creating any new live data.
      await recoverFileTransactions(projectPath, writeFileAtomic);
      claim = { key, projectPath, active: true, recording: true, transaction: await createFileTransaction(projectPath), pendingRecord: Promise.resolve(), pendingWrites: new Set() };
      return await transactionContext.run(claim, async () => {
        try {
          const result = await action();
          const writes = await Promise.allSettled([...claim.pendingWrites]);
          const failed = writes.find((item) => item.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
          await claim.pendingRecord;
          claim.recording = false;
          await commitFileTransaction(claim.transaction, projectPath, writeFileAtomic);
          return result;
        } catch (error) {
          // Promise.all rejects early; let the remaining live writes finish before rollback.
          await Promise.allSettled([...claim.pendingWrites]);
          claim.recording = false;
          try { await recoverFileTransactions(projectPath, writeFileAtomic); }
          catch (recoveryError) { error.message += `；${recoveryError.message}`; error.recoveryPath ||= recoveryError.recoveryPath; }
          throw error;
        }
      });
    }
    finally { if (claim) claim.active = false; await release(); }
  });
  projectWriteQueues.set(key, queued);
  return queued.finally(() => {
    if (projectWriteQueues.get(key) === queued) projectWriteQueues.delete(key);
  });
}

function removeProjectFile(projectPath, filePath) {
  const context = transactionContext.getStore();
  if (!context?.active || context.key !== projectKey(projectPath)) return withProjectTransaction(projectPath, () => removeProjectFile(projectPath, filePath));
  const promise = performProjectFileRemoval(context, projectPath, filePath);
  if (context.recording) {
    context.pendingWrites.add(promise);
    promise.then(() => context.pendingWrites.delete(promise), () => context.pendingWrites.delete(promise));
  }
  return promise;
}

async function performProjectFileRemoval(context, projectPath, filePath) {
  const registration = context.pendingRecord.then(() => recordBeforeWrite(context.transaction, projectPath, filePath, null, writeFileAtomic));
  context.pendingRecord = registration.catch(() => null);
  await registration;
  await fs.rm(filePath, { force: true });
}

function withProjectWriteQueue(projectPath, _scope, action) {
  return withProjectTransaction(projectPath, action);
}

async function writeProjectFiles(projectPath, updates) {
  return withProjectTransaction(projectPath, async () => {
    const previous = [];
    for (const update of updates) {
      const relative = path.relative(path.resolve(projectPath), path.resolve(update.path));
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("项目事务路径越界。");
      let cursor = path.resolve(projectPath);
      for (const part of relative.split(path.sep)) {
        cursor = path.join(cursor, part);
        const stat = await fs.lstat(cursor).catch((error) => { if (error.code !== "ENOENT") throw error; return null; });
        if (stat?.isSymbolicLink()) throw new Error("不安全路径：项目事务不能经过文件链接。");
      }
      let content = null;
      try { content = await fs.readFile(update.path); } catch (error) { if (error.code !== "ENOENT") throw error; }
      previous.push({ path: update.path, content });
    }
    let attempted = 0;
    try {
      for (const update of updates) {
        attempted += 1;
        if (update.content === null) await removeProjectFile(projectPath, update.path);
        else await writeFileAtomic(update.path, update.content);
      }
    } catch (error) {
      const failures = [];
      for (const old of previous.slice(0, attempted).reverse()) {
        try {
          const current = await fs.readFile(old.path).catch(() => null);
          if (old.content && current?.equals(old.content)) continue;
          if (old.content === null) await fs.rm(old.path, { force: true });
          else await writeFileAtomic(old.path, old.content);
        } catch (failure) { failures.push(failure.message); }
      }
      if (failures.length) error.message += `；回滚未完成：${failures.join("；")}，请使用保存前历史恢复。`;
      throw error;
    }
  });
}

async function writeJsonAtomic(filePath, value) {
  return writeFileAtomic(filePath, JSON.stringify(value, null, 2), "utf8");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableId(prefix, value) {
  return `${prefix}_${sha256(String(value || "")).slice(0, 20)}`;
}

function safeFileSegment(value, fallback = "item") {
  const normalized = String(value || "")
    .split("").map((character) => character.charCodeAt(0) <= 31 ? "_" : character).join("")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

module.exports = {
  ensureDir,
  readJson,
  safeFileSegment,
  sha256,
  stableId,
  writeFileAtomic,
  writeJsonAtomic,
  withProjectWriteQueue,
  withProjectTransaction,
  writeProjectFiles,
  removeProjectFile,
};
