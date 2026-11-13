"use strict";
// TTS 朗读校对契约测试（P84）：模块槽/播放器关键行为/编辑器接线/降级。
// 运行时语音可用性为真机验证项（V1）；此处验证静态契约。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("TTS 模块槽声明与编辑器接线", () => {
  const slot = source("src/modules/tts/slot.ts");
  assert.ok(slot.includes('id: "tts"'));
  assert.ok(slot.includes("declareModuleSlot"));
  const editor = source("src/components/writing/EditorPanel.tsx");
  assert.ok(editor.includes('import "../../modules/tts/slot"'));
  assert.ok(editor.includes('isModuleEnabled(stores.project.store.getState().state?.config, "tts")'));
  assert.ok(editor.includes("<TtsPlayer"));
  assert.ok(editor.includes("朗读校对"));
});

test("播放器：按句队列/语速语音/停止清理/降级提示", () => {
  const player = source("src/components/writing/TtsPlayer.tsx");
  assert.ok(player.includes("speechSynthesis"), "须用系统语音 API");
  assert.ok(player.includes("splitSentences"), "须按句切分");
  assert.ok(player.includes("voiceschanged"), "须监听语音加载");
  assert.ok(player.includes("window.speechSynthesis.cancel()"), "卸载/停止须取消朗读");
  assert.ok(player.includes("当前环境不支持语音朗读"), "不支持时须降级提示");
  assert.ok(player.includes("正在加载系统语音"), "无语音时须提示");
  assert.ok(player.includes("utterance.rate"), "须支持语速");
  // P94：外部引擎模式允许 fetch，但地址仅限本机（配置层校验）
  assert.ok(player.includes("externalUrlRef"), "外部引擎地址须来自配置");
  const ttsConfig = source("electron/services/tts-config.cjs");
  assert.ok(ttsConfig.includes("仅允许本机地址"), "外部引擎地址须限制本机");
  assert.ok(ttsConfig.includes("127\\.0\\.0\\.1|localhost"), "本机地址白名单");
});
test("P97 敏感词高亮与 AI 复核接线", () => {
  const ops = source("src/lib/editor-ops.ts");
  assert.ok(ops.includes('"sensitive"'), "标记类型须含 sensitive");
  const editor = source("src/components/writing/EditorPanel.tsx");
  assert.ok(editor.includes("sensitiveHighlight"));
  assert.ok(editor.includes("scanSensitive"));
  assert.ok(editor.includes("mergedReviews"));
  const rich = source("src/components/writing/RichDocumentEditor.tsx");
  assert.ok(rich.includes('item?.kind === "sensitive"'), "敏感标记点击不得打开修订弹窗");
  const panel = source("src/components/analysis/SensitivePanel.tsx");
  assert.ok(panel.includes("aiReviewSensitive"));
  assert.ok(panel.includes("加入忽略"));
  const service = source("electron/services/sensitive-check.cjs");
  assert.ok(service.includes("async function aiReview"));
});
