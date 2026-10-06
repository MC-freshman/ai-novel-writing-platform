async function consumeChatStream(response, onToken, options = {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf8");
  let answer = "";
  let buffer = "";
  let completed = false;
  let finishReason = "";
  let warning = "";
  const consumeEvent = (event) => {
    const dataLines = event.split(/\r?\n/).filter((line) => line.startsWith("data:"));
    const raw = dataLines.map((line) => line.slice(5).trimStart()).join("\n").trim();
    if (!raw) return;
    if (raw === "[DONE]") { completed = true; return; }
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    if (data.error) throw new Error(`提供商错误：${String(data.error.message || data.error.type || data.error).slice(0, 400)}`);
    if (data.usage) options.onUsage?.(data.usage);
    const choice = data.choices?.[0] || {};
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const token = String(choice.delta?.content || choice.message?.content || data.message?.content || data.output_text || "");
    if (token) { answer += token; onToken?.(token); }
  };
  try {
    while (!completed) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";
      for (const event of events) { consumeEvent(event); if (completed) break; }
      if (buffer.trim() === "data: [DONE]") { consumeEvent(buffer); buffer = ""; }
      if (done) { if (!completed && buffer.trim()) consumeEvent(buffer); break; }
    }
    if (finishReason === "length") warning = "生成达到长度上限，回答可能被截断";
    else if (finishReason === "content_filter") warning = "提供商停止了生成（内容过滤）";
    else if (!completed && !["stop", "tool_calls"].includes(finishReason)) warning = "连接未正常结束，回答可能被截断";
  } catch (error) {
    warning = options.signal?.aborted ? "用户已停止生成" : error?.message === "timeout" ? "请求超时，生成已中断" : error?.message || String(error);
    if (!answer.trim() && !options.signal?.aborted) throw error;
  } finally {
    try { await reader.cancel(); } catch { /* The transport may already be closed. */ }
    reader.releaseLock();
  }
  if (warning) return `${answer.trim()}\n\n【提示：${warning}，以上内容已保留。】`.trim();
  return answer.trim() || "模型返回了空内容。";
}

module.exports = { consumeChatStream };
