"use strict";
// TTS 引擎配置测试（P94）：默认系统/外部地址校验（仅本机）/持久化。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { fixture, electron } = require("../helpers/service-fixture.cjs");
const ttsConfig = require("../../../electron/services/tts-config.cjs");

test("默认系统语音；外部仅允许本机地址", async (t) => {
  const root = await fixture(t);
  electron.app.getPath = (name) => path.join(root, `userdata-${name}`);
  const initial = await ttsConfig.getConfig();
  assert.equal(initial.engine, "system");
  await assert.rejects(() => ttsConfig.saveConfig({ engine: "external", externalUrl: "https://remote.example.com/tts" }), /仅允许本机地址/);
  await assert.rejects(() => ttsConfig.saveConfig({ engine: "external", externalUrl: "" }), /仅允许本机地址/);
  const saved = await ttsConfig.saveConfig({ engine: "external", externalUrl: "http://127.0.0.1:5000/tts/" });
  assert.equal(saved.engine, "external");
  assert.equal(saved.externalUrl, "http://127.0.0.1:5000/tts");
  const reloaded = await ttsConfig.getConfig();
  assert.equal(reloaded.externalUrl, "http://127.0.0.1:5000/tts");
  const back = await ttsConfig.saveConfig({ engine: "system" });
  assert.equal(back.engine, "system");
});