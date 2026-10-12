// Public compatibility entry. Implementation is organized by domain below.
"use strict";
const world_cards = require("./analysis/world-cards.cjs");
const state = require("./analysis/state.cjs");
const search = require("./analysis/search.cjs");
const timeline = require("./analysis/timeline.cjs");
const relationships = require("./analysis/relationships.cjs");
const consistency = require("./analysis/consistency.cjs");
const story_analysis = require("./analysis/story-analysis.cjs");

const api = {
  normalizeComparableTitle: world_cards.normalizeComparableTitle,
  findSimilarWorldDoc: world_cards.findSimilarWorldDoc,
  loadIssueStatuses: state.loadIssueStatuses,
  saveIssueStatuses: state.saveIssueStatuses,
  loadAnalysisState: state.loadAnalysisState,
  saveAnalysisState: state.saveAnalysisState,
  applyIssueStatuses: state.applyIssueStatuses,
  queryTokens: search.queryTokens,
  makeSearchSnippet: search.makeSearchSnippet,
  globalSearch: search.globalSearch,
  extractTimeHints: timeline.extractTimeHints,
  buildTimelineEvents: timeline.buildTimelineEvents,
  normalizeTimelinePayload: timeline.normalizeTimelinePayload,
  buildAiTimelineEvents: timeline.buildAiTimelineEvents,
  addRelationEdge: relationships.addRelationEdge,
  buildRelationshipGraph: relationships.buildRelationshipGraph,
  normalizeConsistencyIssues: consistency.normalizeConsistencyIssues,
  buildLocalConsistencyIssues: consistency.buildLocalConsistencyIssues,
  analyzeConsistency: consistency.analyzeConsistency,
  normalizeExtractedWorldCards: world_cards.normalizeExtractedWorldCards,
  buildExtractionMaterials: world_cards.buildExtractionMaterials,
  prepareWorldCardCandidates: world_cards.prepareWorldCardCandidates,
  saveWorldCardCandidates: world_cards.saveWorldCardCandidates,
  refreshLocalStoryState: story_analysis.refreshLocalStoryState,
  getStoryOverviewForProject: story_analysis.getStoryOverviewForProject,
  storyAnalysisSystemPrompt: story_analysis.storyAnalysisSystemPrompt,
  analyzeStoryStateWithAI: story_analysis.analyzeStoryStateWithAI,
};
// Preserve captured exports during the existing CommonJS service load cycle.
Object.assign(module.exports, api);
module.exports = api;
