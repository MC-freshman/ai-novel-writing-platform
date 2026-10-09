// 本文件由 P2 重构自 electron/main.cjs 机械搬迁（scripts/refactor-split.cjs），逻辑未改动。
"use strict";

const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const { createWriteStream, existsSync } = require("node:fs");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { state, sendRendererEvent } = require("./runtime-state.cjs");
const __dep0 = require("./project-files.cjs");
const path = require("node:path");
const fs = require("node:fs/promises");

function sanitizeFileName(...args) { return __dep0.sanitizeFileName(...args); }

function compareVersionNumbers(left, right) {
  const parse = (value) => String(value || "0").replace(/^v/i, "").split(/[.-]/).slice(0, 3).map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}


async function checkForAppUpdate() {
  const endpoint = "https://api.github.com/repos/MC-freshman/ai-novel-writing-platform/releases/latest";
  const response = await fetch(endpoint, { headers: { Accept: "application/vnd.github+json", "User-Agent": "AI-Novel-Writing-Platform" }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
  const release = /** @type {any} */ (await response.json());
  const latestVersion = String(release.tag_name || release.name || "").replace(/^v/i, "");
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const executable = assets.find((item) => /setup.*\.exe$/i.test(item.name)) || assets.find((item) => /\.exe$/i.test(item.name));
  const currentVersion = app.getVersion();
  return {
    currentVersion,
    latestVersion,
    updateAvailable: Boolean(latestVersion) && compareVersionNumbers(latestVersion, currentVersion) > 0,
    releaseName: String(release.name || release.tag_name || latestVersion),
    notes: String(release.body || "").slice(0, 12000),
    pageUrl: String(release.html_url || "https://github.com/MC-freshman/ai-novel-writing-platform/releases"),
    downloadUrl: String(executable?.browser_download_url || ""),
    assetName: String(executable?.name || ""),
  };
}


async function downloadAndOpenAppUpdate(url, suggestedName = "") {
  const parsed = new URL(String(url || ""));
  if (parsed.protocol !== "https:" || !["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"].includes(parsed.hostname)) throw new Error("更新下载地址不是受信任的 GitHub 地址。");
  const result = await dialog.showSaveDialog(state.mainWindow, {
    title: "保存软件更新",
    defaultPath: path.join(app.getPath("downloads"), sanitizeFileName(suggestedName || path.basename(parsed.pathname) || "AI小说创作平台_更新.exe")),
    filters: [{ name: "Windows 程序", extensions: ["exe"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const response = await fetch(url, { headers: { "User-Agent": "AI-Novel-Writing-Platform" }, redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`下载更新失败：HTTP ${response.status}`);
  const temporary = `${result.filePath}.download`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    await fs.rename(temporary, result.filePath).catch(async () => {
      await fs.copyFile(temporary, result.filePath);
      await fs.rm(temporary, { force: true });
    });
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => null);
    throw error;
  }
  const confirmation = await dialog.showMessageBox(state.mainWindow, { type: "question", title: "更新已下载", message: "是否现在打开更新程序？", detail: "请先保存正在编辑的章节。软件不会在未确认时自动安装。", buttons: ["暂不打开", "打开更新程序"], defaultId: 1, cancelId: 0 });
  if (confirmation.response === 1) {
    const openError = await shell.openPath(result.filePath);
    if (openError) throw new Error(openError);
  }
  return { filePath: result.filePath, opened: confirmation.response === 1 };
}


const __moduleExports = {
  compareVersionNumbers,
  checkForAppUpdate,
  downloadAndOpenAppUpdate,
};

// Augment the original exports object so cyclic requires (whose captured
// reference may be a Proxy over the pre-assignment exports) see every key.
Object.assign(module.exports, __moduleExports);
module.exports = __moduleExports;
