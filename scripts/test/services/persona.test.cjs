"use strict";
// 角色对话 persona 测试（P83）：提示组装/空卡/截断/纪律文案。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildPersonaPrompt } = require("../../../electron/services/persona.cjs");

test("buildPersonaPrompt：包含人设字段与纪律", () => {
  const prompt = buildPersonaPrompt({ name: "林风", personality: "沉稳多疑", background: "边军出身", appearance: "黑衣", relationships: "与陆远敌对", notes: "左手有伤" });
  assert.ok(prompt.includes("林风"));
  assert.ok(prompt.includes("沉稳多疑"));
  assert.ok(prompt.includes("边军出身"));
  assert.ok(prompt.includes("虚构推演"));
  assert.ok(prompt.includes("不代表正文事实"));
  assert.ok(prompt.includes("左手有伤"));
});

test("buildPersonaPrompt：空卡返回空串，长字段截断", () => {
  assert.equal(buildPersonaPrompt(null), "");
  assert.equal(buildPersonaPrompt({}), "");
  assert.equal(buildPersonaPrompt({ name: "  " }), "");
  const long = buildPersonaPrompt({ name: "甲", background: "字".repeat(3000) });
  assert.ok(long.length < 2000);
});