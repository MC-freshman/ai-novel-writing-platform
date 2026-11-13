const assert = require("node:assert/strict");
const { listenSafe } = require("../../lib/safe-port.cjs");
const test = require("node:test");
const http = require("node:http");
const { safeEndpointLabel, describeFetchError, fetchJsonWithDiagnostics } = require("../../../electron/services/http-diagnostics.cjs");

test("safeEndpointLabel 去掉查询串，describeFetchError 保留底层原因", () => {
  assert.equal(safeEndpointLabel("https://api.example.com/v1/chat?token=secret"), "https://api.example.com/v1/chat");
  assert.equal(safeEndpointLabel("not a url"), "not a url");
  const text = describeFetchError(Object.assign(new Error("连接失败"), { cause: { code: "ECONNRESET", syscall: "connect", address: "127.0.0.1", port: 7897 } }));
  assert.match(text, /连接失败/);
  assert.match(text, /ECONNRESET/);
  assert.match(text, /127\.0\.0\.1/);
});

test("fetchJsonWithDiagnostics 成功返回响应，失败附带地址与请求体大小", async (t) => {
  const server = http.createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await listenSafe(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/v1/test?secret=1`;
  const { response, bodyBytes } = await fetchJsonWithDiagnostics(url, { ping: "中文" }, { "Content-Type": "application/json" }, "合成接口");
  assert.equal(response.status, 200);
  assert.ok(bodyBytes > 0);
  await assert.doesNotReject(response.json());

  await assert.rejects(
    () => fetchJsonWithDiagnostics("http://127.0.0.1:1/v1/test", { ping: "x" }, {}, "合成接口"),
    (error) => /合成接口本地连接失败/.test(error.message) && /请求地址/.test(error.message) && /请求体大小/.test(error.message),
  );
});
