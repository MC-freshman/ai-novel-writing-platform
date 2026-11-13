// 专注锁定编排（P86）：守卫 setter 统一拦截进入/退出专注的全部路径（快捷键/按钮/菜单）。
// 默认关闭；启用后进入专注先设目标，退出需确认；「确认退出」始终可用（紧急退出≤2步）。
import { useCallback, useEffect, useState, type SetStateAction } from "react";
import type { AppStores } from "../stores/app-stores";
import { useStoreField } from "../stores/use-app-stores";
import type { AppState } from "../types";
import { FocusExitConfirmDialog, FocusGoalDialog, FocusLockBar } from "../components/shell/FocusLockDialogs";

export function useFocusLock({ stores, state }: { stores: AppStores; state: AppState | null }) {
  const [focusMode, setFocusModeRaw] = useStoreField(stores.layout, "focusMode");
  const [focusLock, setFocusLock] = useStoreField(stores.layout, "focusLock");
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const lockEnabled = state?.config.ui.focusLockEnabled === true;
  const totalWords = state?.config.stats.totalWords ?? 0;
  const projectPath = state?.projectPath ?? "";

  // 切换项目时清空锁定会话，避免起点字数失效。
  useEffect(() => {
    setFocusLock(null);
    setGoalDialogOpen(false);
    setExitConfirmOpen(false);
  }, [projectPath, setFocusLock]);

  const guardedSetFocusMode = useCallback((next: SetStateAction<boolean>) => {
    const layout = stores.layout.store.getState();
    const target = typeof next === "function" ? (next as (value: boolean) => boolean)(layout.focusMode) : next;
    if (target === layout.focusMode) return;
    if (!target) {
      if (layout.focusLock) {
        setExitConfirmOpen(true);
        return;
      }
      setFocusModeRaw(false);
      return;
    }
    if (lockEnabled && !layout.focusLock) {
      setGoalDialogOpen(true);
      return;
    }
    setFocusModeRaw(true);
  }, [stores, lockEnabled, setFocusModeRaw]);

  const startLock = useCallback((goalWords: number, goalMinutes: number) => {
    const currentWords = stores.project.store.getState().state?.config.stats.totalWords ?? 0;
    setFocusLock({
      goalWords: Math.max(0, Math.floor(goalWords) || 0),
      goalMinutes: Math.max(0, Math.floor(goalMinutes) || 0),
      startedAt: Date.now(),
      startWords: currentWords,
    });
    setGoalDialogOpen(false);
    setFocusModeRaw(true);
  }, [stores, setFocusLock, setFocusModeRaw]);

  const confirmExit = useCallback(() => {
    setFocusLock(null);
    setExitConfirmOpen(false);
    setFocusModeRaw(false);
  }, [setFocusLock, setFocusModeRaw]);

  const clearFocusLock = useCallback(() => {
    setFocusLock(null);
  }, [setFocusLock]);

  const focusDialogsOpen = goalDialogOpen || exitConfirmOpen;
  const focusLockDialogs = (
    <>
      {goalDialogOpen && <FocusGoalDialog onConfirm={startLock} onCancel={() => setGoalDialogOpen(false)} />}
      {exitConfirmOpen && focusLock && (
        <FocusExitConfirmDialog lock={focusLock} totalWords={totalWords} onConfirm={confirmExit} onCancel={() => setExitConfirmOpen(false)} />
      )}
      {focusMode && focusLock && <FocusLockBar lock={focusLock} totalWords={totalWords} onExit={() => guardedSetFocusMode(false)} />}
    </>
  );

  return { guardedSetFocusMode, focusDialogsOpen, clearFocusLock, focusLockDialogs };
}