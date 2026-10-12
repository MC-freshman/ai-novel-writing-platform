"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ensureDir,
  readJson,
  safeFileSegment,
  sha256,
  stableId,
  writeJsonAtomic,
  removeProjectFile,
  withProjectTransaction,
} = require("../project-storage.cjs");
const STORY_STATE_VERSION = 2;
const FACT_STATUSES = new Set(["AI识别", "已确认", "已忽略"]);
const FORESHADOW_STATUSES = new Set([
  "AI候选",
  "已确认埋下",
  "持续强化",
  "等待回收",
  "已经回收",
  "已废弃",
]);
const ledgerReadCache = new Map();

function nowIso() {
  return new Date().toISOString();
}

function getStoryRoot(projectPath) {
  return path.join(projectPath, "analysis", "story-state");
}

function getLedgerDir(projectPath) {
  return path.join(getStoryRoot(projectPath), "chapters");
}

function getLedgerPath(projectPath, chapterId) {
  return path.join(
    getLedgerDir(projectPath),
    `${safeFileSegment(chapterId, "chapter")}.json`,
  );
}

function getStoryIndexPath(projectPath) {
  return path.join(getStoryRoot(projectPath), "index.json");
}

function getForeshadowsPath(projectPath) {
  return path.join(getStoryRoot(projectPath), "foreshadows.json");
}

function getManualFactsPath(projectPath) {
  return path.join(getStoryRoot(projectPath), "manual-facts.json");
}

function getCharacterStateDir(projectPath) {
  return path.join(getStoryRoot(projectPath), "character-states");
}

function getBoardsDir(projectPath) {
  return path.join(getStoryRoot(projectPath), "boards");
}

function getBoardPath(projectPath, chapterId) {
  return path.join(
    getBoardsDir(projectPath),
    `${safeFileSegment(chapterId, "chapter")}.json`,
  );
}

async function readLedgerCached(projectPath, chapterId) {
  const filePath = getLedgerPath(projectPath, chapterId);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) {
    ledgerReadCache.delete(filePath);
    return null;
  }
  const signature = `${stat.size}|${stat.mtimeMs}|${stat.ctimeMs}`;
  const cached = ledgerReadCache.get(filePath);
  if (cached?.signature === signature) return cached.value;
  const value = await readJson(filePath, null);
  ledgerReadCache.set(filePath, { signature, value });
  if (ledgerReadCache.size > 2000)
    ledgerReadCache.delete(ledgerReadCache.keys().next().value);
  return value;
}

async function initializeStoryState(projectPath) {
  await Promise.all([
    ensureDir(getLedgerDir(projectPath)),
    ensureDir(getCharacterStateDir(projectPath)),
    ensureDir(getBoardsDir(projectPath)),
  ]);
  const indexPath = getStoryIndexPath(projectPath);
  const foreshadowsPath = getForeshadowsPath(projectPath);
  try {
    await fs.access(indexPath);
  } catch {
    await writeJsonAtomic(indexPath, {
      version: STORY_STATE_VERSION,
      updatedAt: "",
      chapters: [],
      factCount: 0,
      characterStateCount: 0,
      foreshadowCount: 0,
    });
  }
  try {
    await fs.access(foreshadowsPath);
  } catch {
    await writeJsonAtomic(foreshadowsPath, {
      version: STORY_STATE_VERSION,
      updatedAt: "",
      items: [],
    });
  }
  try {
    await fs.access(getManualFactsPath(projectPath));
  } catch {
    await writeJsonAtomic(getManualFactsPath(projectPath), {
      version: STORY_STATE_VERSION,
      updatedAt: "",
      items: [],
    });
  }
}

function ensureStoryState(projectPath) {
  const paths = [
    getStoryIndexPath(projectPath),
    getForeshadowsPath(projectPath),
    getManualFactsPath(projectPath),
  ];
  return Promise.all(paths.map((filePath) =>
    fs.access(filePath).then(() => true, () => false),
  )).then((exists) => {
    if (!exists.every(Boolean)) {
      return withProjectTransaction(projectPath, () =>
        initializeStoryState(projectPath),
      );
    }
    return Promise.all([
      ensureDir(getLedgerDir(projectPath)),
      ensureDir(getCharacterStateDir(projectPath)),
      ensureDir(getBoardsDir(projectPath)),
    ]);
  });
}

// All read-modify-write operations share the project journal and lock. A failed
// transaction may have changed cached ledgers before rollback; discard them.
function transactionalStoryMutation(action) {
  return async function (projectPath, ...args) {
    try {
      return await withProjectTransaction(projectPath, () =>
        action(projectPath, ...args),
      );
    } finally {
      const root = path.resolve(getLedgerDir(projectPath)) + path.sep;
      for (const key of ledgerReadCache.keys())
        if (path.resolve(key).startsWith(root)) ledgerReadCache.delete(key);
    }
  };
}

module.exports = {
  fs,
  path,
  ensureDir,
  readJson,
  safeFileSegment,
  sha256,
  stableId,
  writeJsonAtomic,
  removeProjectFile,
  STORY_STATE_VERSION,
  FACT_STATUSES,
  FORESHADOW_STATUSES,
  ledgerReadCache,
  nowIso,
  getStoryRoot,
  getLedgerDir,
  getLedgerPath,
  getStoryIndexPath,
  getForeshadowsPath,
  getManualFactsPath,
  getCharacterStateDir,
  getBoardsDir,
  getBoardPath,
  readLedgerCached,
  ensureStoryState,
  transactionalStoryMutation,
};
