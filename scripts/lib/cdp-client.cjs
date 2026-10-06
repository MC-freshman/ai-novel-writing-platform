function connectCdp(url, { timeoutMs = 15000 } = {}) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  const rejectPending = (reason) => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(reason); }
    pending.clear();
  };
  socket.onmessage = (event) => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result || {});
  };
  let rejectReady;
  const connectionTimer = setTimeout(() => { rejectReady(new Error("连接 CDP 超时。")); socket.close(); }, timeoutMs);
  const ready = new Promise((resolve, reject) => {
    rejectReady = reject;
    socket.onopen = () => { clearTimeout(connectionTimer); resolve(); };
    socket.onerror = () => { clearTimeout(connectionTimer); reject(new Error("无法连接 CDP。")); rejectPending(new Error("CDP 连接失败。")); };
  });
  socket.onclose = () => { clearTimeout(connectionTimer); rejectReady(new Error("CDP 已关闭。")); rejectPending(new Error("CDP 已关闭。")); };
  return {
    ready,
    call(method, params = {}) {
      if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("CDP 未连接或已关闭。"));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时。`)); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
      });
    },
    async evaluate(expression) {
      const result = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result?.value;
    },
    close() { rejectPending(new Error("CDP 客户端已关闭。")); socket.close(); },
  };
}

module.exports = { connectCdp };
