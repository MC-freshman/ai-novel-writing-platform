const fs = require("node:fs/promises");
const path = require("node:path");
const { ensureDir, readJson, safeFileSegment, sha256, stableId, writeJsonAtomic } = require("./project-storage.cjs");

const MANAGED_ROOTS = ["novel.config.json", "chapters", "characters", "worldbuilding", "materials", "analysis", "assets"];

function nowIso() {
  return new Date().toISOString();
}

function getSnapshotRoot(projectPath) {
  return path.join(projectPath, "backups", "snapshots");
}

function getObjectDir(projectPath) {
  return path.join(getSnapshotRoot(projectPath), "objects");
}

function getManifestDir(projectPath) {
  return path.join(getSnapshotRoot(projectPath), "manifests");
}

function getBranchPath(projectPath) {
  return path.join(getSnapshotRoot(projectPath), "branches.json");
}

async function ensureSnapshotStore(projectPath) {
  await Promise.all([ensureDir(getObjectDir(projectPath)), ensureDir(getManifestDir(projectPath))]);
  const branchPath = getBranchPath(projectPath);
  try {
    await fs.access(branchPath);
  } catch {
    await writeJsonAtomic(branchPath, { version: 1, updatedAt: "", activeBranchId: "main", branches: [{ id: "main", name: "主线", snapshotId: "", createdAt: nowIso(), updatedAt: nowIso() }] });
  }
}

async function walkFiles(root, relativeRoot = "") {
  const directory = path.join(root, relativeRoot);
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const relative = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(root, relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

async function managedProjectFiles(projectPath) {
  const files = [];
  for (const root of MANAGED_ROOTS) {
    const absolute = path.join(projectPath, root);
    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat) continue;
    if (stat.isFile()) files.push(root);
    else files.push(...(await walkFiles(projectPath, root)));
  }
  return files
    .filter((relative) => !relative.startsWith(path.join("backups", "snapshots")))
    .filter((relative) => relative !== path.join("analysis", "tasks.json"))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

async function writeObject(projectPath, body, hash) {
  const objectPath = path.join(getObjectDir(projectPath), hash.slice(0, 2), hash);
  try {
    await fs.access(objectPath);
  } catch {
    await ensureDir(path.dirname(objectPath));
    const temporary = `${objectPath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, body);
    try {
      await fs.rename(temporary, objectPath);
    } catch (error) {
      if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
      await fs.rm(temporary, { force: true });
    }
  }
  return objectPath;
}

async function createSnapshot(projectPath, options = {}) {
  await ensureSnapshotStore(projectPath);
  const createdAt = nowIso();
  const files = await managedProjectFiles(projectPath);
  const entries = [];
  let totalBytes = 0;
  for (let index = 0; index < files.length; index += 1) {
    const relativePath = files[index];
    const absolutePath = path.join(projectPath, relativePath);
    const body = await fs.readFile(absolutePath);
    const hash = sha256(body);
    await writeObject(projectPath, body, hash);
    entries.push({ path: relativePath.replace(/\\/g, "/"), hash, size: body.length });
    totalBytes += body.length;
    if (typeof options.onProgress === "function") await options.onProgress({ current: index + 1, total: files.length, detail: relativePath });
  }
  const id = stableId("snapshot", `${createdAt}|${options.name || ""}|${entries.map((item) => item.hash).join("|")}`);
  const manifest = {
    version: 1,
    id,
    name: String(options.name || options.reason || "手动快照").slice(0, 100),
    reason: String(options.reason || "手动创建").slice(0, 200),
    createdAt,
    fileCount: entries.length,
    totalBytes,
    entries,
  };
  await writeJsonAtomic(path.join(getManifestDir(projectPath), `${safeFileSegment(id)}.json`), manifest);
  return manifest;
}

async function listSnapshots(projectPath) {
  await ensureSnapshotStore(projectPath);
  const files = (await fs.readdir(getManifestDir(projectPath)).catch(() => [])).filter((item) => item.endsWith(".json"));
  const manifests = (await Promise.all(files.map((file) => readJson(path.join(getManifestDir(projectPath), file), null))))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const branches = await readJson(getBranchPath(projectPath), { version: 1, activeBranchId: "main", branches: [] });
  return { snapshots: manifests, branches };
}

async function getSnapshot(projectPath, snapshotId) {
  return readJson(path.join(getManifestDir(projectPath), `${safeFileSegment(snapshotId)}.json`), null);
}

async function renameSnapshot(projectPath, snapshotId, name) {
  await ensureSnapshotStore(projectPath);
  const manifest = await getSnapshot(projectPath, snapshotId);
  if (!manifest) throw new Error("没有找到这个项目快照。");
  const nextName = String(name || "").trim().slice(0, 100);
  if (!nextName) throw new Error("快照名称不能为空。");
  const next = { ...manifest, name: nextName };
  await writeJsonAtomic(path.join(getManifestDir(projectPath), `${safeFileSegment(snapshotId)}.json`), next);
  return next;
}

async function collectReferencedObjectHashes(projectPath) {
  const files = (await fs.readdir(getManifestDir(projectPath)).catch(() => [])).filter((item) => item.endsWith(".json"));
  const manifests = (await Promise.all(files.map((file) => readJson(path.join(getManifestDir(projectPath), file), null)))).filter(Boolean);
  return new Set(manifests.flatMap((manifest) => (manifest.entries || []).map((entry) => entry.hash)).filter(Boolean));
}

async function garbageCollectObjects(projectPath) {
  await ensureSnapshotStore(projectPath);
  const referenced = await collectReferencedObjectHashes(projectPath);
  const relativeFiles = await walkFiles(getObjectDir(projectPath));
  let removedObjects = 0;
  let removedBytes = 0;
  for (const relativePath of relativeFiles) {
    const hash = path.basename(relativePath);
    if (referenced.has(hash)) continue;
    const absolutePath = path.join(getObjectDir(projectPath), relativePath);
    const stat = await fs.stat(absolutePath).catch(() => null);
    await fs.rm(absolutePath, { force: true });
    removedObjects += 1;
    removedBytes += Number(stat?.size || 0);
  }
  const prefixDirs = await fs.readdir(getObjectDir(projectPath), { withFileTypes: true }).catch(() => []);
  for (const entry of prefixDirs) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(getObjectDir(projectPath), entry.name);
    const remaining = await fs.readdir(directory).catch(() => []);
    if (!remaining.length) await fs.rmdir(directory).catch(() => null);
  }
  return { removedObjects, removedBytes, referencedObjects: referenced.size };
}

async function deleteSnapshot(projectPath, snapshotId) {
  await ensureSnapshotStore(projectPath);
  const manifest = await getSnapshot(projectPath, snapshotId);
  if (!manifest) return { removed: false, snapshotId, garbageCollection: { removedObjects: 0, removedBytes: 0, referencedObjects: 0 } };
  const branches = await readJson(getBranchPath(projectPath), { branches: [] });
  const references = (branches.branches || []).filter((branch) => branch.snapshotId === snapshotId);
  if (references.length) throw new Error(`这个快照正被创作分支“${references.map((branch) => branch.name).join("、")}”使用，不能删除。`);
  await fs.rm(path.join(getManifestDir(projectPath), `${safeFileSegment(snapshotId)}.json`), { force: true });
  return { removed: true, snapshotId, garbageCollection: await garbageCollectObjects(projectPath) };
}

async function compareSnapshot(projectPath, snapshotId) {
  const manifest = await getSnapshot(projectPath, snapshotId);
  if (!manifest) throw new Error("没有找到这个项目快照。");
  const currentFiles = await managedProjectFiles(projectPath);
  const currentMap = new Map();
  for (const relativePath of currentFiles) {
    const body = await fs.readFile(path.join(projectPath, relativePath));
    currentMap.set(relativePath.replace(/\\/g, "/"), { hash: sha256(body), size: body.length });
  }
  const snapshotMap = new Map(manifest.entries.map((item) => [item.path, item]));
  const changed = [];
  const added = [];
  const missing = [];
  for (const [relativePath, current] of currentMap) {
    const previous = snapshotMap.get(relativePath);
    if (!previous) added.push(relativePath);
    else if (previous.hash !== current.hash) changed.push(relativePath);
  }
  for (const relativePath of snapshotMap.keys()) if (!currentMap.has(relativePath)) missing.push(relativePath);
  return { snapshot: manifest, changed, added, missing };
}

async function restoreSnapshot(projectPath, snapshotId, options = {}) {
  const manifest = await getSnapshot(projectPath, snapshotId);
  if (!manifest) throw new Error("没有找到这个项目快照。");
  const safetySnapshot = options.skipSafetySnapshot ? null : await createSnapshot(projectPath, { name: "恢复前自动快照", reason: `恢复 ${manifest.name} 前自动保存` });
  const selectedPaths = new Set((options.paths || []).map((item) => String(item).replace(/\\/g, "/")));
  const entries = selectedPaths.size ? manifest.entries.filter((item) => selectedPaths.has(item.path)) : manifest.entries;
  const projectRoot = path.resolve(projectPath);
  const resolveManagedPath = (relativePath) => {
    const targetPath = path.resolve(projectPath, relativePath);
    const rootForComparison = process.platform === "win32" ? projectRoot.toLowerCase() : projectRoot;
    const targetForComparison = process.platform === "win32" ? targetPath.toLowerCase() : targetPath;
    if (targetForComparison !== rootForComparison && !targetForComparison.startsWith(`${rootForComparison}${path.sep}`)) {
      throw new Error(`快照包含不安全路径：${relativePath}`);
    }
    return targetPath;
  };
  for (const entry of entries) resolveManagedPath(entry.path);

  let removed = 0;
  const removedPaths = [];
  if (!selectedPaths.size) {
    const snapshotPaths = new Set(manifest.entries.map((item) => String(item.path).replace(/\\/g, "/")));
    const currentFiles = await managedProjectFiles(projectPath);
    for (const relativePath of currentFiles) {
      const normalizedPath = String(relativePath).replace(/\\/g, "/");
      if (snapshotPaths.has(normalizedPath)) continue;
      await fs.rm(resolveManagedPath(relativePath), { force: true });
      removed += 1;
      if (removedPaths.length < 200) removedPaths.push(normalizedPath);
    }
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const objectPath = path.join(getObjectDir(projectPath), entry.hash.slice(0, 2), entry.hash);
    const body = await fs.readFile(objectPath);
    if (sha256(body) !== entry.hash) throw new Error(`快照对象校验失败：${entry.path}`);
    const targetPath = resolveManagedPath(entry.path);
    await ensureDir(path.dirname(targetPath));
    const temporary = `${targetPath}.${process.pid}.restore.tmp`;
    await fs.writeFile(temporary, body);
    try {
      await fs.rename(temporary, targetPath);
    } catch (error) {
      if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
      await fs.copyFile(temporary, targetPath);
      await fs.rm(temporary, { force: true });
    }
    if (typeof options.onProgress === "function") await options.onProgress({ current: index + 1, total: entries.length, detail: entry.path });
  }
  return { restored: entries.length, removed, removedPaths, snapshot: manifest, safetySnapshot };
}

async function createBranch(projectPath, name, snapshotId = "") {
  await ensureSnapshotStore(projectPath);
  const snapshot = snapshotId ? await getSnapshot(projectPath, snapshotId) : await createSnapshot(projectPath, { name: `分支起点：${name}`, reason: "创建实验分支" });
  if (!snapshot) throw new Error("分支起点快照不存在。");
  const data = await readJson(getBranchPath(projectPath), { version: 1, activeBranchId: "main", branches: [] });
  const createdAt = nowIso();
  const branch = { id: stableId("branch", `${createdAt}|${name}`), name: String(name || "实验分支").slice(0, 80), snapshotId: snapshot.id, createdAt, updatedAt: createdAt };
  data.branches = [...(data.branches || []), branch];
  data.updatedAt = nowIso();
  await writeJsonAtomic(getBranchPath(projectPath), data);
  return { branch, branches: data };
}

async function deleteBranch(projectPath, branchId) {
  await ensureSnapshotStore(projectPath);
  const data = await readJson(getBranchPath(projectPath), { version: 1, activeBranchId: "main", branches: [] });
  if (branchId === "main") throw new Error("主线分支不能删除。");
  if (branchId === data.activeBranchId) throw new Error("当前正在使用这个分支，请先切换到其他分支后再删除。");
  const branch = (data.branches || []).find((item) => item.id === branchId);
  if (!branch) return { removed: false, branches: data };
  data.branches = data.branches.filter((item) => item.id !== branchId);
  data.updatedAt = nowIso();
  await writeJsonAtomic(getBranchPath(projectPath), data);
  return { removed: true, branch, branches: data };
}

async function switchBranch(projectPath, branchId) {
  await ensureSnapshotStore(projectPath);
  const data = await readJson(getBranchPath(projectPath), { version: 1, activeBranchId: "main", branches: [] });
  const target = (data.branches || []).find((item) => item.id === branchId);
  const current = (data.branches || []).find((item) => item.id === data.activeBranchId);
  if (!target) throw new Error("没有找到这个创作分支。");
  if (target.id === current?.id) return { activeBranch: target, branches: data, restored: 0 };
  const currentSnapshot = await createSnapshot(projectPath, { name: `切换分支前：${current?.name || "当前工作"}`, reason: "切换创作分支" });
  if (current) {
    current.snapshotId = currentSnapshot.id;
    current.updatedAt = nowIso();
  }
  const restored = await restoreSnapshot(projectPath, target.snapshotId, { skipSafetySnapshot: true });
  data.activeBranchId = target.id;
  data.updatedAt = nowIso();
  await writeJsonAtomic(getBranchPath(projectPath), data);
  return { activeBranch: target, branches: data, restored: restored.restored };
}

module.exports = {
  compareSnapshot,
  createBranch,
  createSnapshot,
  deleteBranch,
  deleteSnapshot,
  ensureSnapshotStore,
  garbageCollectObjects,
  listSnapshots,
  renameSnapshot,
  restoreSnapshot,
  switchBranch,
};
