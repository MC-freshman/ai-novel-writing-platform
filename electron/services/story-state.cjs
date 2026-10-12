// Public compatibility entry. Implementation is organized by domain below.
"use strict";
const dependencies = require("./story/dependencies.cjs");
const extraction = require("./story/extraction.cjs");
const facts = require("./story/facts.cjs");
const boards = require("./story/boards.cjs");
const ledger = require("./story/ledger.cjs");

const api = {
  FACT_STATUSES: dependencies.FACT_STATUSES,
  FORESHADOW_STATUSES: dependencies.FORESHADOW_STATUSES,
  STORY_STATE_VERSION: dependencies.STORY_STATE_VERSION,
  analyzeChapterLocally: extraction.analyzeChapterLocally,
  createManualFact: facts.createManualFact,
  createManualForeshadow: facts.createManualForeshadow,
  deleteFact: facts.deleteFact,
  deleteForeshadow: facts.deleteForeshadow,
  ensureStoryState: dependencies.ensureStoryState,
  generateLocalBoard: boards.generateLocalBoard,
  getAgentContext: boards.getAgentContext,
  getBoard: boards.getBoard,
  getStoryOverview: ledger.getStoryOverview,
  listBoards: boards.listBoards,
  normalizeAiChapterAnalysis: extraction.normalizeAiChapterAnalysis,
  removeChapterLedger: ledger.removeChapterLedger,
  saveBoard: boards.saveBoard,
  saveChapterLedger: ledger.saveChapterLedger,
  updateFact: facts.updateFact,
  updateForeshadow: facts.updateForeshadow,
};
// Preserve captured exports during the existing CommonJS service load cycle.
Object.assign(module.exports, api);
module.exports = api;
