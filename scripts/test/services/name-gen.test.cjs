"use strict";
// 起名助手测试（P90）：可复现/类型/风格/数量上限/去重。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const nameGen = require("../../../electron/services/name-gen.cjs");

test("同 seed 可复现，异 seed 不同", () => {
  const a = nameGen.generateNames({ type: "character", style: "古风", count: 10, seed: "abc" });
  const b = nameGen.generateNames({ type: "character", style: "古风", count: 10, seed: "abc" });
  const c = nameGen.generateNames({ type: "character", style: "古风", count: 10, seed: "xyz" });
  assert.deepEqual(a.names, b.names);
  assert.notDeepEqual(a.names, c.names);
});

test("四种类型与风格回退", () => {
  for (const type of ["character", "place", "skill", "book"]) {
    const result = nameGen.generateNames({ type, style: "玄幻", count: 8, seed: "t" });
    assert.equal(result.names.length, 8);
    assert.ok(result.names.every((name) => name.length >= 2));
  }
  const fallback = nameGen.generateNames({ type: "character", style: "不存在的风格", count: 3, seed: "t" });
  assert.equal(fallback.style, "通用");
  assert.throws(() => nameGen.generateNames({ type: "bad", count: 1 }), /不支持的起名类型/);
});

test("数量上限与去重", () => {
  const result = nameGen.generateNames({ type: "character", count: 999, seed: "cap" });
  assert.ok(result.names.length <= 50);
  assert.equal(new Set(result.names).size, result.names.length);
  const min = nameGen.generateNames({ type: "place", count: 0, seed: "min" });
  assert.ok(min.names.length >= 1);
});
test("P98 parseAiNames：JSON/逐行/去重/上限", () => {
  assert.deepEqual(nameGen.parseAiNames('["甲","乙","甲"]', 10), ["甲", "乙"]);
  assert.deepEqual(nameGen.parseAiNames('1. 甲\n2、乙\n- 丙', 10), ["甲", "乙", "丙"]);
  assert.deepEqual(nameGen.parseAiNames('前言 ["甲","乙"] 后记', 1), ["甲"]);
  assert.deepEqual(nameGen.parseAiNames("", 5), []);
  assert.deepEqual(nameGen.parseAiNames('[{"name":"甲"},{"name":"乙"}]', 5), ["甲", "乙"]);
});

test("P98 generateNamesAi：未配置接口明确报错", async (t) => {
  const { fixture } = require("../helpers/service-fixture.cjs");
  const root = await fixture(t);
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const project = path.join(root, "project");
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, "novel.config.json"), JSON.stringify({ version: 1, title: "t", chapters: [], api: { provider: "deepseek", apiKey: "", baseUrl: "", chatModel: "" } }));
  await assert.rejects(() => nameGen.generateNamesAi(project, { type: "character", count: 3 }), /密钥|接口/);
});
