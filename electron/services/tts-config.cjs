"use strict";
// TTS 引擎配置（P94）：系统语音（默认，离线）或外部本地 HTTP 引擎。
// 外部引擎契约：POST {url} body {text, voice?, rate?} → 音频字节（audio/wav|mpeg|ogg）。
// 渲染层直连 127.0.0.1（CSP connect-src 允许）；不捆绑任何外部 TTS 服务。
const path = require("node:path");
const { readAppPreferences, getAppPreferencesPath } = require("./project-config.cjs");
const { ensureDir, writeFileAtomic } = require("./project-storage.cjs");

function defaultConfig() {
  return { engine: "system", externalUrl: "" };
}

async function getConfig() {
  const preferences = await readAppPreferences();
  const saved = preferences?.tts && typeof preferences.tts === "object" ? preferences.tts : {};
  return {
    engine: saved.engine === "external" ? "external" : "system",
    externalUrl: String(saved.externalUrl || "").trim().replace(/\/$/, ""),
  };
}

async function saveConfig(payload) {
  const next = {
    engine: payload?.engine === "external" ? "external" : "system",
    externalUrl: String(payload?.externalUrl || "").trim().replace(/\/$/, ""),
  };
  if (next.engine === "external") {
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/.*)?$/.test(next.externalUrl))
      throw new Error("外部 TTS 引擎仅允许本机地址（http://127.0.0.1 或 localhost）。");
  }
  const preferences = await readAppPreferences();
  const preferencesPath = getAppPreferencesPath();
  await ensureDir(path.dirname(preferencesPath));
  await writeFileAtomic(preferencesPath, JSON.stringify({ ...preferences, tts: next }, null, 2));
  return getConfig();
}

module.exports = { defaultConfig, getConfig, saveConfig };