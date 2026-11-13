"use strict";
// 专注锁定契约测试（P86）：守卫拦截/紧急退出/默认关闭/弹窗屏蔽全局快捷键。
// 运行时行为由既有 CDP 回归覆盖（test-ui-controls 专注进入退出；锁定默认关闭不改变既有行为）。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("守卫 setter 统一拦截进入/退出路径", () => {
  const hook = source("src/hooks/useFocusLock.tsx");
  assert.ok(hook.includes("guardedSetFocusMode"), "须导出守卫 setter");
  assert.ok(hook.includes("setExitConfirmOpen(true)"), "锁定中退出须弹确认");
  assert.ok(hook.includes("setGoalDialogOpen(true)"), "启用后进入须先设目标");
  assert.ok(hook.includes("lockEnabled && !layout.focusLock"), "仅启用且无会话时拦截进入");
  const controller = source("src/app/controller.ts");
  assert.ok(controller.includes("setFocusMode: focusLock.guardedSetFocusMode"), "controller 须用守卫 setter 覆盖原始 setter");
  const app = source("src/App.tsx");
  assert.ok(app.includes("clearFocusLock();"), "布局预设强制退出须先清锁");
});

test("紧急退出始终可用且默认关闭", () => {
  const hook = source("src/hooks/useFocusLock.tsx");
  assert.ok(hook.includes("focusLockEnabled === true"), "锁定须默认关闭（显式 true 才启用）");
  const dialogs = source("src/components/shell/FocusLockDialogs.tsx");
  assert.ok(dialogs.includes("确认退出"), "退出确认须始终提供确认退出按钮");
  assert.ok(dialogs.includes("紧急退出始终可用"), "须明示紧急退出可用");
  assert.ok(dialogs.includes("onConfirm={confirmExit}") || hook.includes("onConfirm={confirmExit}"), "确认退出须直达清除会话");
  assert.ok(hook.includes("setFocusLock(null);") && hook.includes("setFocusModeRaw(false);"), "确认退出须清锁并退出专注");
});

test("锁定弹窗屏蔽全局 Esc/快捷键，切换项目清锁", () => {
  const effects = source("src/app/effects.ts");
  assert.ok(effects.includes("focusDialogsOpen ||"), "dialogOpen 须包含专注锁定弹窗");
  const hook = source("src/hooks/useFocusLock.tsx");
  assert.ok(hook.includes("}, [projectPath, setFocusLock]);"), "切换项目须清空锁定会话");
  const stores = source("src/stores/app-stores.ts");
  assert.ok(stores.includes("focusLock: null"), "布局域须含 focusLock 默认空");
  const config = source("src/types/config.ts");
  assert.ok(config.includes("focusLockEnabled?: boolean"), "配置须含专注锁定开关");
  assert.ok(config.includes("interface FocusLockSession"), "须定义锁定会话类型");
});

test("进度口径与目标达成判定", () => {
  const dialogs = source("src/components/shell/FocusLockDialogs.tsx");
  assert.ok(dialogs.includes("Math.max(0, totalWords - lock.startWords)"), "字数按净增且不为负");
  assert.ok(dialogs.includes("lock.goalWords === 0 || words >= lock.goalWords"), "字数目标 0=不限");
  assert.ok(dialogs.includes("lock.goalMinutes === 0 || minutes >= lock.goalMinutes"), "分钟目标 0=不限");
});