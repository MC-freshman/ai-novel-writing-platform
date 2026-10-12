"use strict";
const { withProjectTransaction } = require("../project-storage.cjs");
const storyState = require("../story-state.cjs");
const { DEFAULT_CATEGORY } = require("../constants.cjs");
const __dep0 = require("../project-files.cjs");
const __dep1 = require("../credentials.cjs");
const fs = require("node:fs/promises");

function nowIso(...args) {
  return __dep0.nowIso.apply(null, args);
}

function sanitizeFileName(...args) {
  return __dep0.sanitizeFileName(...args);
}

function normalizeCategory(...args) {
  return __dep0.normalizeCategory(...args);
}

function mapWithConcurrency(...args) {
  return __dep0.mapWithConcurrency(...args);
}

function readJson(...args) {
  return __dep0.readJson(...args);
}

function writeJson(...args) {
  return __dep0.writeJson(...args);
}

function getAnalysisStatePath(...args) {
  return __dep0.getAnalysisStatePath(...args);
}

function getIssueStatusPath(...args) {
  return __dep0.getIssueStatusPath(...args);
}

function getChapterPath(...args) {
  return __dep0.getChapterPath(...args);
}

function cachedChapterRevision(...args) {
  return __dep0.cachedChapterRevision(...args);
}

function uniqueContentFileName(...args) {
  return __dep0.uniqueContentFileName(...args);
}

function contentToPlainText(...args) {
  return __dep0.contentToPlainText(...args);
}

function stripWorldDocFrontMatter(...args) {
  return __dep0.stripWorldDocFrontMatter(...args);
}

function writeWorldDoc(...args) {
  return __dep0.writeWorldDoc(...args);
}

function loadProjectSources(...args) {
  return __dep0.loadProjectSources(...args);
}

function stableHash(...args) {
  return __dep0.stableHash(...args);
}

function loadCharacters(...args) {
  return __dep0.loadCharacters(...args);
}

function loadWorldDocs(...args) {
  return __dep0.loadWorldDocs(...args);
}

function runtimeSecret(...args) {
  return __dep1.runtimeSecret(...args);
}

function extractMetadata(...args) {
  return require("../knowledge-index.cjs").extractMetadata(...args);
}

function truncateForPrompt(...args) {
  return require("../retrieval-pipeline.cjs").truncateForPrompt(...args);
}

function callChatApi(...args) {
  return require("../ai-generate.cjs").callChatApi(...args);
}

function estimateTokenCount(...args) {
  return require("../ai-generate.cjs").estimateTokenCount(...args);
}

function callStructuredChatWithProgress(...args) {
  return require("../ai-generate.cjs").callStructuredChatWithProgress(...args);
}

function extractJsonFromModelText(...args) {
  return require("../ai-generate.cjs").extractJsonFromModelText(...args);
}

function makeIdSet(...args) {
  return require("../ai-generate.cjs").makeIdSet(...args);
}

function buildStructuringMaterials(...args) {
  return require("../ai-generate.cjs").buildStructuringMaterials(...args);
}

function loadConfig(...args) {
  return require("../project-ops.cjs").loadConfig(...args);
}

function buildAppState(...args) {
  return require("../project-ops.cjs").buildAppState(...args);
}

function indexSources(...args) {
  return require("../project-ops.cjs").indexSources(...args);
}

module.exports = {
  withProjectTransaction,
  storyState,
  DEFAULT_CATEGORY,
  fs,
  nowIso,
  sanitizeFileName,
  normalizeCategory,
  mapWithConcurrency,
  readJson,
  writeJson,
  getAnalysisStatePath,
  getIssueStatusPath,
  getChapterPath,
  cachedChapterRevision,
  uniqueContentFileName,
  contentToPlainText,
  stripWorldDocFrontMatter,
  writeWorldDoc,
  loadProjectSources,
  stableHash,
  loadCharacters,
  loadWorldDocs,
  runtimeSecret,
  extractMetadata,
  truncateForPrompt,
  callChatApi,
  estimateTokenCount,
  callStructuredChatWithProgress,
  extractJsonFromModelText,
  makeIdSet,
  buildStructuringMaterials,
  loadConfig,
  buildAppState,
  indexSources,
};
