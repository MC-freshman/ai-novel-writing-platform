"use strict";
// 分屏参考契约测试（P87）：布局字段/只读面板/专注互斥/接线。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("布局域含参考面板字段", () => {
  const stores = source("src/stores/app-stores.ts");
  assert.ok(stores.includes("referenceChapterId: string"));
  assert.ok(stores.includes('referenceChapterId: ""'));
});

test("参考面板只读且可切换/打开/关闭", () => {
  const pane = source("src/components/writing/ReferencePane.tsx");
  assert.ok(pane.includes("loadChapter"));
  assert.ok(pane.includes("只读参考"));
  assert.ok(pane.includes("onSwitch"));
  assert.ok(pane.includes("onOpenChapter"));
  assert.ok(!pane.includes("onChange={") || !pane.includes("textarea"), "参考面板不得提供编辑输入");
});

test("编辑器接线：工具栏按钮/专注互斥/App 传参", () => {
  const editor = source("src/components/writing/EditorPanel.tsx");
  assert.ok(editor.includes("editor-split"));
  assert.ok(editor.includes("referencePanels.length > 0 && !focusMode"));
  assert.ok(editor.includes("分屏参考"));
  assert.ok(editor.includes("onOpenChapter"));
  const app = source("src/App.tsx");
  assert.ok(app.includes("onOpenChapter={(chapterId) => void selectChapter(chapterId)}"));
});
test("P99 多参考面板（最多 4 个）", () => {
  const stores = source("src/stores/app-stores.ts");
  assert.ok(stores.includes("referenceChapterIds: string[]"));
  assert.ok(stores.includes("referenceChapterIds: []"));
  const editor = source("src/components/writing/EditorPanel.tsx");
  assert.ok(editor.includes("next.length >= 4"), "须限制最多 4 个面板");
  assert.ok(editor.includes("multi-reference"));
  assert.ok(editor.includes("removeReferencePanel"));
  assert.ok(editor.includes("switchReferencePanel"));
});
