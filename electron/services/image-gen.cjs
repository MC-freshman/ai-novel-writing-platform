"use strict";
// 图像生成（P88）：OpenAI 兼容 /images/generations（b64_json），主进程调用（C2），
// 图片存 materials/images/（C3 磁盘路径），登记素材库。BYOK，不捆绑任何图像服务。
// 费用/内容政策由所选服务决定；UI 明示。方舟原生协议适配列二期。
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { readAppPreferences, getAppPreferencesPath } = require("./project-config.cjs");
const { ensureDir, writeFileAtomic } = require("./project-storage.cjs");
const { saveMaterial } = require("./knowledge-index.cjs");
const windowsCredentials = require("./windows-credentials.cjs");

const CREDENTIAL_KIND = "image-gen";
const MAX_IMAGES = 4;
const MAX_PROMPT = 4000;
const SIZES = ["1024x1024", "1536x1024", "1024x1536"];

async function readSettings() {
  const preferences = await readAppPreferences();
  const saved = preferences?.imageGen && typeof preferences.imageGen === "object" ? preferences.imageGen : {};
  return {
    baseUrl: String(saved.baseUrl || "").replace(/\/$/, ""),
    model: String(saved.model || ""),
    size: SIZES.includes(saved.size) ? saved.size : "1024x1024",
  };
}

async function getConfig(projectPath) {
  const settings = await readSettings();
  let hasKey;
  try { hasKey = Boolean(await windowsCredentials.getSecret(projectPath, CREDENTIAL_KIND)); } catch { hasKey = false; }
  return { settings, hasKey };
}

async function saveConfig(projectPath, payload) {
  const next = {
    baseUrl: String(payload?.baseUrl || "").trim().replace(/\/$/, ""),
    model: String(payload?.model || "").trim(),
    size: SIZES.includes(payload?.size) ? payload.size : "1024x1024",
  };
  const preferences = await readAppPreferences();
  const preferencesPath = getAppPreferencesPath();
  await ensureDir(path.dirname(preferencesPath));
  await writeFileAtomic(preferencesPath, JSON.stringify({ ...preferences, imageGen: next }, null, 2));
  if (typeof payload?.apiKey === "string" && payload.apiKey) {
    await windowsCredentials.setSecret(projectPath, CREDENTIAL_KIND, payload.apiKey);
  }
  if (payload?.clearKey === true) await windowsCredentials.deleteSecret(projectPath, CREDENTIAL_KIND).catch(() => {});
  return getConfig(projectPath);
}

async function generate(projectPath, payload, options = {}) {
  const settings = await readSettings();
  if (!settings.baseUrl || !settings.model) throw new Error("请先在图像生成设置中填写接口地址与模型。");
  const apiKey = await windowsCredentials.getSecret(projectPath, CREDENTIAL_KIND);
  if (!apiKey) throw new Error("未配置图像接口密钥。");
  const prompt = String(payload?.prompt || "").trim().slice(0, MAX_PROMPT);
  if (!prompt) throw new Error("请输入图像描述。");
  const count = Math.min(Math.max(1, Math.floor(Number(payload?.n) || 1)), MAX_IMAGES);
  const size = SIZES.includes(payload?.size) ? payload.size : settings.size;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
  const response = await fetch(`${settings.baseUrl}/images/generations`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: settings.model, prompt, size, n: count, response_format: "b64_json" }),
    signal: options.signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`图像接口请求失败：${response.status} ${detail.slice(0, 200)}`);
  }
  const data = /** @type {any} */ (await response.json());
  const items = Array.isArray(data?.data) ? data.data : [];
  if (!items.length) throw new Error("图像接口未返回图片数据。");
  const imageDir = path.join(projectPath, "materials", "images");
  await ensureDir(imageDir);
  const files = [];
  for (const item of items.slice(0, MAX_IMAGES)) {
    let buffer = null;
    const b64 = String(item?.b64_json || "");
    if (b64) {
      buffer = Buffer.from(b64, "base64");
    } else if (item?.url) {
      // 方舟/部分服务商返回 url 而非 b64：主进程下载（C2）。
      const imageResponse = await fetch(String(item.url));
      if (!imageResponse.ok) throw new Error(`图片下载失败：${imageResponse.status}`);
      buffer = Buffer.from(await imageResponse.arrayBuffer());
    }
    if (!buffer || !buffer.length) continue;
    const id = `img_${crypto.randomUUID()}`;
    const filePath = path.join(imageDir, `${id}.png`);
    await fs.writeFile(filePath, buffer);
    const material = await saveMaterial(projectPath, {
      title: `生成图像 · ${prompt.slice(0, 40)}`,
      category: "图像",
      content: `![${prompt.slice(0, 80)}](images/${id}.png)\n\n提示词：${prompt}\n模型：${settings.model} · 尺寸：${size}`,
    });
    files.push({ path: filePath, materialId: material.id, dataUrl: `data:image/png;base64,${buffer.toString("base64")}` });
  }
  if (!files.length) throw new Error("图像接口返回数据无法解析（需 b64_json 或 url）。");
  return { files, prompt, model: settings.model, size };
}

module.exports = { CREDENTIAL_KIND, SIZES, MAX_IMAGES, readSettings, getConfig, saveConfig, generate };