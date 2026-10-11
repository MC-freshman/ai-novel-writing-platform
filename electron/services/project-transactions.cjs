const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const hash = (body) => crypto.createHash("sha256").update(body).digest("hex");
const DIRECTORY = ".novel-transactions";

function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : null;
}
async function safeTarget(projectPath, relative) {
  if (typeof relative !== "string" || !relative || relative.includes("\\") || relative.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("事务恢复路径不安全");
  const target = path.resolve(projectPath, relative);
  if (!inside(projectPath, target) || relative.startsWith(DIRECTORY + "/") || relative.startsWith(".novel-write.lock")) throw new Error("事务恢复路径越界");
  let current = path.resolve(projectPath);
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch((error) => { if (error.code !== "ENOENT") throw error; return null; });
    if (stat?.isSymbolicLink()) throw new Error("事务恢复不能经过文件链接");
  }
  return target;
}
async function readBody(target) {
  return fs.readFile(target).catch((error) => { if (error.code !== "ENOENT") throw error; return null; });
}
async function persist(transaction, atomicWrite) {
  await atomicWrite(path.join(transaction.directory, "manifest.json"), JSON.stringify(transaction.manifest, null, 2));
}
async function createFileTransaction(projectPath) {
  const root = path.join(projectPath, DIRECTORY);
  const stat = await fs.lstat(root).catch((error) => { if (error.code !== "ENOENT") throw error; return null; });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error("事务目录不安全");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(path.join(root, "txn-"));
  return { directory, manifest: { version: 1, phase: "applying", entries: [] }, entries: new Map() };
}
async function recordBeforeWrite(transaction, projectPath, target, nextBody, atomicWrite, temporary = null) {
  const relative = inside(projectPath, target)?.split(path.sep).join("/");
  if (!relative || relative.startsWith(DIRECTORY + "/") || relative.startsWith("backups/") || relative.startsWith(".novel-write.lock")) return;
  await safeTarget(projectPath, relative);
  const identity = process.platform === "win32" ? relative.toLowerCase() : relative;
  let entry = transaction.entries.get(identity);
  if (!entry) {
    const previous = await readBody(target);
    const backup = previous === null ? null : `previous-${transaction.manifest.entries.length}`;
    if (backup) await atomicWrite(path.join(transaction.directory, backup), previous);
    entry = { path: relative, backup, previousHash: previous === null ? null : hash(previous), allowedHashes: [previous === null ? null : hash(previous)], temporaryFiles: [] };
    transaction.entries.set(identity, entry);
    transaction.manifest.entries.push(entry);
  }
  const nextHash = nextBody === null ? null : hash(nextBody);
  if (!entry.allowedHashes.includes(nextHash)) entry.allowedHashes.push(nextHash);
  if (temporary) entry.temporaryFiles.push(inside(projectPath, temporary).split(path.sep).join("/"));
  // Persist both the before-image and intended content before touching the live file.
  await persist(transaction, atomicWrite);
}
async function removeTransactionDirectory(projectPath, directory) {
  const root = path.join(projectPath, DIRECTORY);
  if (!inside(root, directory) || path.dirname(path.resolve(directory)) !== path.resolve(root)) throw new Error("事务清理路径越界");
  await fs.rm(directory, { recursive: true, force: true });
  await fs.rmdir(root).catch(() => null);
}
async function commitFileTransaction(transaction, projectPath, atomicWrite) {
  if (transaction.manifest.entries.length) {
    transaction.manifest.phase = "committed";
    await persist(transaction, atomicWrite);
  }
  // Cleanup failure does not turn a durably committed operation into a failed save.
  await removeTransactionDirectory(projectPath, transaction.directory).catch(() => null);
}
async function recoverFileTransactions(projectPath, atomicWrite) {
  const root = path.join(projectPath, DIRECTORY);
  const stat = await fs.lstat(root).catch((error) => { if (error.code !== "ENOENT") throw error; return null; });
  if (!stat) return { restored: 0 };
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("事务恢复目录不安全");
  let restored = 0;
  for (const folder of await fs.readdir(root, { withFileTypes: true })) {
    if (!folder.name.startsWith("txn-")) continue;
    const directory = path.join(root, folder.name);
    try {
      if (!folder.isDirectory() || folder.isSymbolicLink()) throw new Error("事务恢复记录不安全");
      const manifestStat = await fs.lstat(path.join(directory, "manifest.json")).catch((error) => { if (error.code !== "ENOENT") throw error; return null; });
      if (manifestStat?.isSymbolicLink()) throw new Error("事务清单不能是文件链接");
      const raw = await readBody(path.join(directory, "manifest.json"));
      // No manifest means the crash happened before the first live mutation.
      if (raw === null) { await removeTransactionDirectory(projectPath, directory); continue; }
      const manifest = JSON.parse(raw.toString("utf8"));
      if (manifest.version !== 1 || !["applying", "committed"].includes(manifest.phase) || !Array.isArray(manifest.entries)) throw new Error("事务恢复清单损坏");
      const prepared = [];
      const temporaryFiles = [];
      const identities = new Set();
      for (const entry of manifest.entries) {
        const target = await safeTarget(projectPath, entry.path);
        const identity = process.platform === "win32" ? target.toLowerCase() : target;
        if (identities.has(identity)) throw new Error("事务恢复路径重复");
        identities.add(identity);
        if (entry.backup !== null && !/^previous-\d+$/.test(entry.backup)) throw new Error("事务原稿路径不安全");
        for (const name of entry.temporaryFiles || []) {
          const prefixMatches = typeof name === "string" && (process.platform === "win32" ? name.toLowerCase().startsWith(entry.path.toLowerCase() + ".") : name.startsWith(entry.path + "."));
          if (!prefixMatches || !/^\.\d+\.[a-f0-9]{10}\.tmp$/.test(name.slice(entry.path.length))) throw new Error("事务临时文件路径不安全");
          temporaryFiles.push(await safeTarget(projectPath, name));
        }
        if (manifest.phase === "committed") continue;
        if (entry.backup !== null) {
          const backupStat = await fs.lstat(path.join(directory, entry.backup));
          if (!backupStat.isFile() || backupStat.isSymbolicLink()) throw new Error("事务原稿不能是文件链接");
        }
        const previous = entry.backup === null ? null : await readBody(path.join(directory, entry.backup));
        if ((previous === null ? null : hash(previous)) !== entry.previousHash) throw new Error("事务原稿校验失败");
        const current = await readBody(target);
        const currentHash = current === null ? null : hash(current);
        if (!Array.isArray(entry.allowedHashes) || !entry.allowedHashes.includes(currentHash)) throw new Error("事务中断后文件被外部修改，请人工核对");
        prepared.push({ target, previous, unchanged: currentHash === entry.previousHash });
      }
      if (manifest.phase === "applying") {
        // Validate the whole record before restoring any file. Retry is idempotent.
        for (const item of prepared.reverse()) {
          if (item.unchanged) continue;
          if (item.previous === null) await fs.rm(item.target, { force: true });
          else await atomicWrite(item.target, item.previous);
          restored += 1;
        }
      }
      for (const temporary of temporaryFiles) await fs.rm(temporary, { force: true });
      await removeTransactionDirectory(projectPath, directory);
    } catch (cause) {
      throw Object.assign(new Error(`项目事务恢复未完成：${cause.message}；恢复原稿保留在 ${directory}`, { cause }), { recoveryPath: directory });
    }
  }
  return { restored };
}
module.exports = { createFileTransaction, recordBeforeWrite, commitFileTransaction, recoverFileTransactions };
