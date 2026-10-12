"use strict";
const { registerIpcHandler } = require("../register.cjs");
const {
  analyzeConsistency,
  buildAiTimelineEvents,
  buildAppearanceStats,
  buildRelationshipGraph,
  buildTimelineEvents,
  buildWorldMap,
  ensureCurrentProject,
  globalSearch,
  loadAnalysisState,
  loadIssueStatuses,
  nowIso,
  saveAnalysisState,
  saveIssueStatuses,
} = require("../dependencies.cjs");

function registerDomain() {
  registerIpcHandler("global:search", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return globalSearch(projectPath, payload?.query || "");
  });

  registerIpcHandler("analysis:get-state", async () => {
    const projectPath = await ensureCurrentProject();
    return loadAnalysisState(projectPath);
  });

  registerIpcHandler("analysis:save-state", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return saveAnalysisState(projectPath, payload || {});
  });

  registerIpcHandler("analysis:timeline", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const snapshot = await loadAnalysisState(projectPath);
    if (payload?.refresh === false && snapshot.timeline?.events)
      return snapshot.timeline;
    let result;
    if (payload?.mode === "ai") {
      try {
        result = await buildAiTimelineEvents(projectPath, payload || {});
      } catch (error) {
        const fallback = await buildTimelineEvents(projectPath, payload || {});
        result = {
          ...fallback,
          contextCount: 0,
          apiError: error.message || String(error),
        };
      }
    } else {
      result = await buildTimelineEvents(projectPath, payload || {});
    }
    await saveAnalysisState(projectPath, {
      timeline: result,
      timelineOptions: result.options || payload || {},
    });
    return result;
  });

  registerIpcHandler("analysis:relationships", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const snapshot = await loadAnalysisState(projectPath);
    if (payload?.refresh === false && snapshot.relationships?.nodes)
      return snapshot.relationships;
    const result = await buildRelationshipGraph(projectPath, payload || {});
    await saveAnalysisState(projectPath, {
      relationships: result,
      relationshipOptions: result.options || payload || {},
    });
    return result;
  });

  registerIpcHandler("analysis:consistency", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    const snapshot = await loadAnalysisState(projectPath);
    if (payload?.refresh === false && snapshot.consistency?.issues)
      return snapshot.consistency;
    const result = await analyzeConsistency(projectPath, payload || {});
    await saveAnalysisState(projectPath, {
      consistency: result,
      consistencyOptions: result.options || payload || {},
    });
    return result;
  });

  registerIpcHandler(
    "analysis:update-issue-status",
    async (_event, payload) => {
      const projectPath = await ensureCurrentProject();
      const issueId = String(payload?.issueId || "");
      const status = String(payload?.status || "待处理");
      if (!issueId) throw new Error("缺少问题 ID。");
      const statuses = await loadIssueStatuses(projectPath);
      statuses[issueId] = { status, updatedAt: nowIso() };
      await saveIssueStatuses(projectPath, statuses);
      const snapshot = await loadAnalysisState(projectPath);
      if (Array.isArray(snapshot.consistency?.issues)) {
        await saveAnalysisState(projectPath, {
          consistency: {
            ...snapshot.consistency,
            issues: snapshot.consistency.issues.map((issue) =>
              issue.id === issueId
                ? {
                    ...issue,
                    status,
                    statusUpdatedAt: statuses[issueId].updatedAt,
                  }
                : issue,
            ),
          },
        });
      }
      return { issueId, status, updatedAt: statuses[issueId].updatedAt };
    },
  );

  registerIpcHandler("experiments:appearance-stats", async () => {
    const projectPath = await ensureCurrentProject();
    return buildAppearanceStats(projectPath);
  });

  registerIpcHandler("experiments:world-map", async () => {
    const projectPath = await ensureCurrentProject();
    return buildWorldMap(projectPath);
  });
}
module.exports = { registerDomain };
