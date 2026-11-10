"use strict";

const { CHAT_API_TIMEOUT_MS } = require("./constants.cjs");
const { formatBytes } = require("./project-files.cjs");

function safeEndpointLabel(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return String(url || "");
  }
}

function describeFetchError(error) {
  const parts = [];
  if (error?.name) parts.push(error.name);
  if (error?.message) parts.push(error.message);
  const cause = error?.cause;
  if (cause) {
    const causeParts = [cause.code, cause.name, cause.message].filter(Boolean);
    if (causeParts.length) parts.push(`底层原因：${causeParts.join(" / ")}`);
    const networkParts = [cause.syscall, cause.address, cause.port].filter(Boolean);
    if (networkParts.length) parts.push(`网络信息：${networkParts.join(" ")}`);
  }
  if (!parts.length) parts.push(String(error || "未知网络错误"));
  return [...new Set(parts)].join("；");
}

async function fetchJsonWithDiagnostics(url, payload, headers, label, options = {}) {
  const body = JSON.stringify(payload);
  const bodyBytes = Buffer.byteLength(body, "utf8");
  const timeoutMs = Math.max(0, Number(CHAT_API_TIMEOUT_MS) || 0);
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: options.signal || controller?.signal,
    });
    return { response, bodyBytes };
  } catch (error) {
    const timeoutHint = error?.name === "AbortError" && timeoutMs > 0 ? `请求超过 ${Math.round(timeoutMs / 1000)} 秒未完成，已自动中断。` : "";
    const sizeHint = bodyBytes > 1024 * 1024 ? "请求体超过 1MB，可能被本地代理、网关或安全软件中断。" : "如果问题很长，可减少引用片段上限或拆成几次提问。";
    throw new Error(`${label}本地连接失败：${describeFetchError(error)}\n请求地址：${safeEndpointLabel(url)}\n请求体大小：${formatBytes(bodyBytes)}。${timeoutHint}${sizeHint}`, { cause: error });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { safeEndpointLabel, describeFetchError, fetchJsonWithDiagnostics };
