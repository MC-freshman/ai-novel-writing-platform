"use strict";
// 多格式导出编排（P79）：格式发现 + 对话框 + 提供者分发。
// 二进制与文件 IO 全部在主进程（C3）；渲染层只传格式与选项。
const path = require("node:path");
const { dialog } = require("electron");
const { state } = require("./runtime-state.cjs");
const { listFormats, getProvider } = require("./export-providers/registry.cjs");
const { sanitizeFileName } = require("./project-files.cjs");
const { loadConfig } = require("./project-ops.cjs");

function listExportFormats() {
  return { formats: listFormats() };
}

async function runFormatExport(projectPath, payload) {
  const provider = getProvider(payload?.format);
  const config = await loadConfig(projectPath);
  const baseName = sanitizeFileName(config.title || "未命名小说");
  let target;
  if (provider.mode === "directory") {
    const selected = await dialog.showOpenDialog(state.mainWindow, {
      title: `选择 ${provider.label} 导出目录`,
      properties: ["openDirectory", "createDirectory"],
    });
    if (selected.canceled || !selected.filePaths.length) return { canceled: true };
    target = selected.filePaths[0];
  } else {
    const selected = await dialog.showSaveDialog(state.mainWindow, {
      title: `导出 ${provider.label}`,
      defaultPath: `${baseName}${provider.extension}`,
      filters: [{ name: provider.label, extensions: [provider.extension.slice(1)] }],
    });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    target = selected.filePath;
  }
  const result = await provider.export(projectPath, target, payload?.options || {});
  return {
    canceled: false,
    format: provider.id,
    files: result.files || [],
    directoryPath: result.directoryPath || (result.files?.length ? path.dirname(result.files[0]) : ""),
    warnings: result.warnings || [],
  };
}

module.exports = { listExportFormats, runFormatExport };