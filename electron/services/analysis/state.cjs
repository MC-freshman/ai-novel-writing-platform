"use strict";
const {
  getAnalysisStatePath,
  getIssueStatusPath,
  nowIso,
  readJson,
  withProjectTransaction,
  writeJson,
} = require("./dependencies.cjs");

async function loadIssueStatuses(projectPath) {
  const data = await readJson(getIssueStatusPath(projectPath), {});
  return data && typeof data === "object" ? data : {};
}

async function saveIssueStatuses(projectPath, statuses) {
  await writeJson(getIssueStatusPath(projectPath), statuses || {});
}

async function loadAnalysisState(projectPath) {
  const data = await readJson(getAnalysisStatePath(projectPath), {});
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

async function saveAnalysisState(projectPath, patch) {
  return withProjectTransaction(projectPath, async () => {
    const previous = await loadAnalysisState(projectPath);
    const next = { ...previous, ...(patch || {}), updatedAt: nowIso() };
    await writeJson(getAnalysisStatePath(projectPath), next);
    return next;
  });
}

function applyIssueStatuses(issues, statuses) {
  return issues.map((issue) => ({
    ...issue,
    status: statuses[issue.id]?.status || "待处理",
    statusUpdatedAt: statuses[issue.id]?.updatedAt || "",
  }));
}

module.exports = {
  loadIssueStatuses,
  saveIssueStatuses,
  loadAnalysisState,
  saveAnalysisState,
  applyIssueStatuses,
};
