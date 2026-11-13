"use strict";
// 向量连接诊断测试（P89）：成功维度/失败原因/未配置判定（mock HTTP，不触真实模型）。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { listenSafe } = require("../../lib/safe-port.cjs");
const knowledge = require("../../../electron/services/knowledge-index.cjs");

async function mockEmbeddingServer(t, handler) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => handler(req, res, body));
  });
  const port = await listenSafe(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${port}/v1`;
}

test("testEmbedding：成功返回维度与耗时", async (t) => {
  const baseUrl = await mockEmbeddingServer(t, (req, res) => {
    assert.ok(req.url.endsWith("/embeddings"));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }));
  });
  const result = await knowledge.testEmbedding({ embeddingBaseUrl: baseUrl, embeddingModel: "test-model" });
  assert.equal(result.ok, true);
  assert.equal(result.dimensions, 3);
  assert.ok(result.latencyMs >= 0);
});

test("testEmbedding：服务错误返回原因", async (t) => {
  const baseUrl = await mockEmbeddingServer(t, (req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "model not found" }));
  });
  const result = await knowledge.testEmbedding({ embeddingBaseUrl: baseUrl, embeddingModel: "missing" });
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("500"));
});

test("testEmbedding：未配置返回 configured=false", async () => {
  const result = await knowledge.testEmbedding({ embeddingBaseUrl: "", embeddingModel: "" });
  assert.equal(result.ok, false);
  assert.equal(result.configured, false);
});