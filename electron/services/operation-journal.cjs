const fs = require("node:fs/promises");
const path = require("node:path");
const { ensureDir, readJson, stableId, writeJsonAtomic } = require("./project-storage.cjs");

const JOURNAL_VERSION = 1;
const MAX_OPERATIONS = 3000;
const writeQueues = new Map();

function nowIso() {
  return new Date().toISOString();
}

function systemDir(projectPath) {
  return path.join(projectPath, "analysis", "system");
}

function recoveryDir(projectPath) {
  return path.join(projectPath, "analysis", "recovery");
}

function journalPath(projectPath) {
  return path.join(systemDir(projectPath), "operation-journal.json");
}

function draftsDir(projectPath) {
  return path.join(recoveryDir(projectPath), "drafts");
}

function windowStatePath(projectPath) {
  return path.join(recoveryDir(projectPath), "window-state.json");
}

function emptyJournal() {
  return {
    version: JOURNAL_VERSION,
    updatedAt: "",
    activeSession: null,
    sessions: [],
    operations: [],
  };
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
}

async function ensureJournal(projectPath) {
  await ensureDir(systemDir(projectPath));
  await ensureDir(draftsDir(projectPath));
  if (!(await fs.stat(journalPath(projectPath)).catch(() => null))) await writeJsonAtomic(journalPath(projectPath), emptyJournal());
}

async function loadJournal(projectPath) {
  await ensureJournal(projectPath);
  const data = await readJson(journalPath(projectPath), emptyJournal());
  return {
    ...emptyJournal(),
    ...data,
    version: JOURNAL_VERSION,
    sessions: Array.isArray(data?.sessions) ? data.sessions : [],
    operations: Array.isArray(data?.operations) ? data.operations : [],
  };
}

async function mutate(projectPath, mutator) {
  const key = path.resolve(projectPath);
  const previous = writeQueues.get(key) || Promise.resolve();
  const next = previous.catch(() => null).then(async () => {
    const journal = await loadJournal(projectPath);
    const result = await mutator(journal);
    journal.updatedAt = nowIso();
    journal.operations = journal.operations.slice(0, MAX_OPERATIONS);
    journal.sessions = journal.sessions.slice(0, 80);
    await writeJsonAtomic(journalPath(projectPath), journal);
    return result === undefined ? journal : result;
  });
  writeQueues.set(key, next);
  try {
    return await next;
  } finally {
    if (writeQueues.get(key) === next) writeQueues.delete(key);
  }
}

async function startSession(projectPath, appVersion = "") {
  return mutate(projectPath, (journal) => {
    const previous = journal.activeSession;
    if (previous?.id) {
      journal.sessions.unshift({ ...previous, status: "异常中断", endedAt: nowIso() });
      for (const operation of journal.operations) {
        if (operation.sessionId === previous.id && operation.status === "进行中") {
          operation.status = "已中断";
          operation.updatedAt = nowIso();
        }
      }
    }
    const session = {
      id: stableId("session", `${nowIso()}|${process.pid}|${Math.random()}`),
      appVersion: String(appVersion || ""),
      processId: process.pid,
      status: "运行中",
      startedAt: nowIso(),
      endedAt: "",
    };
    journal.activeSession = session;
    return { session, previousUnclean: previous || null };
  });
}

async function endSession(projectPath, sessionId) {
  return mutate(projectPath, (journal) => {
    if (!journal.activeSession || journal.activeSession.id !== sessionId) return { ended: false };
    const session = { ...journal.activeSession, status: "正常结束", endedAt: nowIso() };
    journal.sessions.unshift(session);
    journal.activeSession = null;
    return { ended: true, session };
  });
}

async function beginOperation(projectPath, payload = {}) {
  return mutate(projectPath, (journal) => {
    const operation = {
      id: stableId("operation", `${nowIso()}|${payload.type}|${Math.random()}`),
      sessionId: journal.activeSession?.id || "",
      type: String(payload.type || "unknown").slice(0, 80),
      title: String(payload.title || "未命名操作").slice(0, 160),
      status: "进行中",
      recoverable: payload.recoverable !== false,
      targetIds: Array.isArray(payload.targetIds) ? payload.targetIds.map(String).slice(0, 100) : [],
      metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
      result: null,
      error: "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    journal.operations.unshift(operation);
    return operation;
  });
}

async function finishOperation(projectPath, operationId, status, payload = {}) {
  return mutate(projectPath, (journal) => {
    const operation = journal.operations.find((item) => item.id === operationId);
    if (!operation) return null;
    operation.status = status;
    operation.result = payload.result ?? operation.result;
    operation.error = String(payload.error || "").slice(0, 3000);
    operation.updatedAt = nowIso();
    return operation;
  });
}

async function completeOperation(projectPath, operationId, result = null) {
  return finishOperation(projectPath, operationId, "已完成", { result });
}

async function failOperation(projectPath, operationId, error) {
  return finishOperation(projectPath, operationId, "失败", { error: error?.message || String(error) });
}

async function saveDraft(projectPath, payload = {}) {
  const chapterId = safeId(payload.chapterId);
  if (!chapterId) throw new Error("草稿缺少章节编号。");
  const draft = {
    version: 1,
    chapterId,
    chapterTitle: String(payload.chapterTitle || "").slice(0, 160),
    volume: String(payload.volume || "").slice(0, 160),
    content: String(payload.content || ""),
    baseRevision: String(payload.baseRevision || "").slice(0, 128),
    wordCount: Number(payload.wordCount || 0),
    updatedAt: nowIso(),
  };
  await writeJsonAtomic(path.join(draftsDir(projectPath), `${chapterId}.json`), draft);
  return draft;
}

async function listDrafts(projectPath) {
  await ensureJournal(projectPath);
  const files = await fs.readdir(draftsDir(projectPath)).catch(() => []);
  const drafts = [];
  for (const file of files.filter((item) => item.endsWith(".json"))) {
    const draft = await readJson(path.join(draftsDir(projectPath), file), null);
    if (draft?.chapterId && typeof draft.content === "string") drafts.push(draft);
  }
  return drafts.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function clearDraft(projectPath, chapterId) {
  const id = safeId(chapterId);
  if (!id) return { removed: false };
  const filePath = path.join(draftsDir(projectPath), `${id}.json`);
  const existed = Boolean(await fs.stat(filePath).catch(() => null));
  await fs.rm(filePath, { force: true });
  return { removed: existed };
}

async function saveWindowState(projectPath, payload = {}) {
  const state = {
    version: 1,
    bounds: payload.bounds && typeof payload.bounds === "object" ? {
      x: Number(payload.bounds.x), y: Number(payload.bounds.y), width: Number(payload.bounds.width), height: Number(payload.bounds.height),
    } : null,
    maximized: Boolean(payload.maximized),
    selectedChapterId: safeId(payload.selectedChapterId),
    view: ["chapters", "characters", "world", "knowledge", "analysis"].includes(payload.view) ? payload.view : "chapters",
    leftWidth: Number(payload.leftWidth || 280),
    rightWidth: Number(payload.rightWidth || 520),
    previewWidth: Number(payload.previewWidth || 46),
    updatedAt: nowIso(),
  };
  await writeJsonAtomic(windowStatePath(projectPath), state);
  return state;
}

async function loadWindowState(projectPath) {
  await ensureJournal(projectPath);
  return readJson(windowStatePath(projectPath), null);
}

async function getRecoveryStatus(projectPath) {
  const [journal, drafts, windowState] = await Promise.all([loadJournal(projectPath), listDrafts(projectPath), loadWindowState(projectPath)]);
  const interruptedOperations = journal.operations.filter((item) => ["已中断", "进行中"].includes(item.status) && item.recoverable).slice(0, 50);
  const lastSession = journal.sessions.find((item) => item.status === "异常中断") || null;
  return { drafts, interruptedOperations, lastSession, windowState };
}

module.exports = {
  JOURNAL_VERSION,
  beginOperation,
  clearDraft,
  completeOperation,
  endSession,
  ensureJournal,
  failOperation,
  getRecoveryStatus,
  listDrafts,
  loadJournal,
  loadWindowState,
  saveDraft,
  saveWindowState,
  startSession,
};
