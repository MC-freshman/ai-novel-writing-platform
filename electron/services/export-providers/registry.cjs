"use strict";
// 导出提供者注册表（P79）：格式→提供者分发。
// 替换/扩展：新增提供者文件并在此登记（构建期替换，与模块替换指南一致）；
// 既有 Word 导出保持原服务与行为不变，不在本注册表内迁移。
const epub = require("./epub.cjs");
const txt = require("./txt.cjs");
const pdf = require("./pdf.cjs");

/**
 * @typedef {Object} ExportProvider
 * @property {string} id
 * @property {string} label
 * @property {string} extension
 * @property {string} mode
 * @property {(projectPath: string, target: string, options?: Record<string, unknown>) => Promise<{files: string[], warnings?: string[], directoryPath?: string}>} export
 */

/** @type {Map<string, ExportProvider>} */
const providers = new Map([
  [epub.id, epub],
  [txt.id, txt],
  [pdf.id, pdf],
]);

function listFormats() {
  return [...providers.values()].map((provider) => ({
    id: provider.id,
    label: provider.label,
    extension: provider.extension,
    mode: provider.mode,
  }));
}

function getProvider(format) {
  const provider = providers.get(String(format || ""));
  if (!provider) throw new Error(`不支持的导出格式：${format || "(空)"}。可用：${[...providers.keys()].join("、")}`);
  return provider;
}

module.exports = { listFormats, getProvider };