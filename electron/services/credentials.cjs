// 本文件由 P2 重构自 electron/main.cjs 机械搬迁（scripts/refactor-split.cjs），逻辑未改动。
"use strict";

const windowsCredentials = require("./windows-credentials.cjs");
const { CREDENTIAL_CHAT_REF, CREDENTIAL_EMBEDDING_REF } = require("./constants.cjs");
const { state, sendRendererEvent } = require("./runtime-state.cjs");
const __dep0 = require("./project-files.cjs");
const path = require("node:path");

function writeJson(...args) { return __dep0.writeJson(...args); }
function getConfigPath(...args) { return __dep0.getConfigPath(...args); }

function encodeSecret(value) {
  if (!value) return "";
  return Buffer.from(value, "utf8").toString("base64");
}


function decodeSecret(value) {
  const raw = String(value || "");
  if (!raw) return "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) return raw;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    if (!decoded || decoded.includes("\uFFFD")) return raw;
    const normalizedRaw = raw.replace(/=+$/, "");
    const normalizedDecoded = Buffer.from(decoded, "utf8").toString("base64").replace(/=+$/, "");
    return normalizedDecoded === normalizedRaw ? decoded : raw;
  } catch {
    return raw;
  }
}


function runtimeSecret(apiConfig, kind = "chat") {
  const runtimeKey = kind === "embedding" ? "__embeddingSecret" : "__chatSecret";
  return String(apiConfig?.[runtimeKey] || decodeSecret(kind === "embedding" ? apiConfig?.embeddingApiKey : apiConfig?.apiKey) || "");
}


async function loadCredentialSecrets(projectPath, config) {
  const cacheKey = path.resolve(projectPath);
  const legacyChat = config.api.apiKey && config.api.apiKey !== CREDENTIAL_CHAT_REF ? decodeSecret(config.api.apiKey) : "";
  const legacyEmbedding = config.api.embeddingApiKey && config.api.embeddingApiKey !== CREDENTIAL_EMBEDDING_REF ? decodeSecret(config.api.embeddingApiKey) : "";
  if (process.env.NOVEL_PLATFORM_TEST === "1" || process.platform !== "win32") {
    Object.defineProperty(config.api, "__chatSecret", { value: legacyChat, configurable: true, writable: true, enumerable: false });
    Object.defineProperty(config.api, "__embeddingSecret", { value: legacyEmbedding, configurable: true, writable: true, enumerable: false });
    return config;
  }
  let cached = state.credentialSecretsCache.get(cacheKey);
  let credentialError = "";
  try {
    if (!cached) {
      cached = {
        chat: config.api.apiKey === CREDENTIAL_CHAT_REF ? await windowsCredentials.getSecret(projectPath, "chat") : legacyChat,
        embedding: config.api.embeddingApiKey === CREDENTIAL_EMBEDDING_REF ? await windowsCredentials.getSecret(projectPath, "embedding") : legacyEmbedding,
      };
      if (legacyChat) {
        await windowsCredentials.setSecret(projectPath, "chat", legacyChat);
        config.api.apiKey = CREDENTIAL_CHAT_REF;
      }
      if (legacyEmbedding) {
        await windowsCredentials.setSecret(projectPath, "embedding", legacyEmbedding);
        config.api.embeddingApiKey = CREDENTIAL_EMBEDDING_REF;
      }
      state.credentialSecretsCache.set(cacheKey, cached);
      if (legacyChat || legacyEmbedding) await writeJson(getConfigPath(projectPath), config);
    }
  } catch (error) {
    credentialError = error?.message || String(error);
    cached = cached || { chat: legacyChat, embedding: legacyEmbedding };
  }
  Object.defineProperty(config.api, "__chatSecret", { value: String(cached?.chat || ""), configurable: true, writable: true, enumerable: false });
  Object.defineProperty(config.api, "__embeddingSecret", { value: String(cached?.embedding || ""), configurable: true, writable: true, enumerable: false });
  Object.defineProperty(config.api, "__credentialError", { value: credentialError, configurable: true, writable: true, enumerable: false });
  return config;
}


async function saveCredentialSecrets(projectPath, apiPatch = {}, existingConfig = null) {
  const current = existingConfig?.api || {};
  const chat = apiPatch.clearApiKey === true ? "" : String(apiPatch.apiKey || runtimeSecret(current, "chat") || "");
  const embedding = apiPatch.clearEmbeddingApiKey === true ? "" : String(apiPatch.embeddingApiKey || runtimeSecret(current, "embedding") || "");
  if (process.env.NOVEL_PLATFORM_TEST === "1" || process.platform !== "win32") return { chatRef: encodeSecret(chat), embeddingRef: encodeSecret(embedding), chat, embedding, storage: "legacy" };
  await Promise.all([
    chat ? windowsCredentials.setSecret(projectPath, "chat", chat) : windowsCredentials.deleteSecret(projectPath, "chat"),
    embedding ? windowsCredentials.setSecret(projectPath, "embedding", embedding) : windowsCredentials.deleteSecret(projectPath, "embedding"),
  ]);
  state.credentialSecretsCache.set(path.resolve(projectPath), { chat, embedding });
  return { chatRef: chat ? CREDENTIAL_CHAT_REF : "", embeddingRef: embedding ? CREDENTIAL_EMBEDDING_REF : "", chat, embedding, storage: "windows" };
}


const __moduleExports = {
  encodeSecret,
  decodeSecret,
  runtimeSecret,
  loadCredentialSecrets,
  saveCredentialSecrets,
};

// Augment the original exports object so cyclic requires (whose captured
// reference may be a Proxy over the pre-assignment exports) see every key.
Object.assign(module.exports, __moduleExports);
module.exports = __moduleExports;
