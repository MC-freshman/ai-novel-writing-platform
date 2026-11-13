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
  getWritingOverview,
  globalSearch,
  loadAnalysisState,
  loadConfig,
  loadIssueStatuses,
  multiExport,
  nameGen,
  nowIso,
  projectSearch,
  saveAnalysisState,
  saveIssueStatuses,
  sensitiveCheck,
  styleCheck,
} = require("../domain-dependencies/analysis.cjs");

function registerDomain() {
  registerIpcHandler("writing-stats:get", async () => {
    const projectPath = await ensureCurrentProject();
    const config = await loadConfig(projectPath);
    return getWritingOverview(projectPath, { dailyGoal: config.ui?.dailyWordGoal || 0 });
  });

  registerIpcHandler("export:formats", async () => multiExport.listExportFormats());

  registerIpcHandler("export:run", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return multiExport.runFormatExport(projectPath, payload || {});
  });

  registerIpcHandler("sensitive:get-state", async () => {
    const projectPath = await ensureCurrentProject();
    return sensitiveCheck.getState(projectPath);
  });

  registerIpcHandler("sensitive:import-dictionary", async () => {
    const projectPath = await ensureCurrentProject();
    return sensitiveCheck.importDictionary(projectPath);
  });

  registerIpcHandler("sensitive:toggle-dictionary", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return sensitiveCheck.toggleDictionary(projectPath, payload?.id, payload?.enabled);
  });

  registerIpcHandler("sensitive:delete-dictionary", async (_event, dictionaryId) => {
    const projectPath = await ensureCurrentProject();
    return sensitiveCheck.deleteDictionary(projectPath, String(dictionaryId || ""));
  });

  registerIpcHandler("sensitive:update-ignore", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return sensitiveCheck.updateIgnore(projectPath, payload?.word, payload?.remove === true);
  });

  registerIpcHandler("sensitive:scan", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return sensitiveCheck.scan(projectPath, payload || {});
  });

  registerIpcHandler("sensitive:ai-review", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return sensitiveCheck.aiReview(projectPath, payload || {});
  });

  registerIpcHandler("search:book", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return projectSearch.searchBook(projectPath, payload || {});
  });

  registerIpcHandler("search:replace-plan", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return projectSearch.buildReplacePlan(projectPath, payload || {});
  });

  registerIpcHandler("search:replace-execute", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return projectSearch.executeReplace(projectPath, payload || {});
  });

  registerIpcHandler("style:analyze", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return styleCheck.analyzeBook(projectPath, payload || {});
  });

  registerIpcHandler("style:get-report", async () => {
    const projectPath = await ensureCurrentProject();
    return styleCheck.getReport(projectPath);
  });

  registerIpcHandler("names:generate", async (_event, payload) => nameGen.generateNames(payload || {}));

  registerIpcHandler("names:generate-ai", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return nameGen.generateNamesAi(projectPath, payload || {});
  });

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
