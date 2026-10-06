function assertTrustedSender(event, window) {
  if (!window || window.isDestroyed() || event?.sender !== window.webContents) throw new Error("IPC 来源不是当前应用窗口。");
  const frame = event.senderFrame;
  if (!frame || frame.parent || frame.url !== window.webContents.getURL()) throw new Error("IPC 来源页面不受信任。");
  const url = new URL(frame.url);
  if (url.protocol !== "file:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) throw new Error("IPC 来源地址不受信任。");
}

function validateIpcArguments(channel, args) {
  let bytes = 0;
  function visit(value, depth = 0) {
    if (depth > 15) throw new Error("IPC 参数层级超过上限。");
    if (value === undefined || value === null || typeof value === "boolean") return;
    if (typeof value === "string") { bytes += Buffer.byteLength(value); if (bytes > 16 * 1024 * 1024) throw new Error("IPC 参数体积超过 16 MB 上限。"); return; }
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (Array.isArray(value)) { if (value.length > 20000) throw new Error("IPC 参数数组超过上限。"); value.forEach((item) => visit(item, depth + 1)); return; }
    if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("IPC 参数类型不合法。");
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("IPC 参数包含不安全字段。");
      if (/^(chapterId|snapshotId|versionId|fileName)$/.test(key) && item != null && (typeof item !== "string" || /[\\/\0]/.test(item) || item === "..")) throw new Error("IPC 参数标识不合法。");
      visit(item, depth + 1);
    }
  }
  args.forEach((value) => visit(value));
  const payload = args[0];
  if (["chapter:save", "chapter:create", "character:save", "world:save", "project:save-settings", "project:import-exchange"].includes(channel) && (!payload || typeof payload !== "object" || Array.isArray(payload))) throw new Error("IPC 参数必须是对象。");
  if (channel === "chapter:save" && (typeof payload.chapterId !== "string" || typeof payload.content !== "string" || (payload.expectedRevision && !/^[a-f0-9]{64}$/.test(payload.expectedRevision)))) throw new Error("章节保存参数不合法。");
  for (const key of ["title", "name", "volume", "author", "content", "appearance", "personality", "background", "relationships", "notes"]) if (payload && typeof payload === "object" && payload[key] !== undefined && typeof payload[key] !== "string") throw new Error(`IPC 参数 ${key} 必须是文字。`);
  if (channel === "project:save-settings" && payload.api) {
    for (const key of ["baseUrl", "embeddingBaseUrl"]) if (payload.api[key]) {
      let url;
      try { url = new URL(payload.api[key]); } catch { throw new Error("接口地址参数不合法。"); }
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("接口地址参数仅允许 HTTP/HTTPS。");
    }
  }
}

module.exports = { assertTrustedSender, validateIpcArguments };
