// 专注锁定弹窗与进度条（P86）：目标设定、退出确认（紧急退出始终可用）、锁定进度条。
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import type { FocusLockSession } from "../../types";
import { useDialogFocus } from "../../hooks/useDialogFocus";

export function focusLockProgress(lock: FocusLockSession, totalWords: number, now = Date.now()) {
  const words = Math.max(0, totalWords - lock.startWords);
  const minutes = Math.max(0, Math.floor((now - lock.startedAt) / 60000));
  const met = (lock.goalWords === 0 || words >= lock.goalWords) && (lock.goalMinutes === 0 || minutes >= lock.goalMinutes);
  return { words, minutes, met };
}

export function FocusGoalDialog({ onConfirm, onCancel }: { onConfirm: (goalWords: number, goalMinutes: number) => void; onCancel: () => void }) {
  const dialogRef = useDialogFocus(onCancel);
  const [goalWords, setGoalWords] = useState(1000);
  const [goalMinutes, setGoalMinutes] = useState(25);
  return (
    <div className="modal-backdrop">
      <section ref={dialogRef} className="focus-lock-dialog modal-surface" role="dialog" aria-modal="true" aria-label="设定专注目标" tabIndex={-1}>
        <header>
          <div><Lock size={16} /><strong>设定专注目标</strong></div>
          <button onClick={onCancel}>取消</button>
        </header>
        <p>锁定后退出专注需要确认；「确认退出」始终可用，不会把你锁在软件里。目标 0 = 不限。</p>
        <label>
          字数目标
          <input type="number" min="0" step="100" value={goalWords} onChange={(event) => setGoalWords(Math.max(0, Math.floor(Number(event.target.value) || 0)))} />
        </label>
        <label>
          分钟目标
          <input type="number" min="0" step="5" value={goalMinutes} onChange={(event) => setGoalMinutes(Math.max(0, Math.floor(Number(event.target.value) || 0)))} />
        </label>
        <footer>
          <button onClick={onCancel}>取消</button>
          <button className="primary" onClick={() => onConfirm(goalWords, goalMinutes)}>开始专注</button>
        </footer>
      </section>
    </div>
  );
}

export function FocusExitConfirmDialog({ lock, totalWords, onConfirm, onCancel }: { lock: FocusLockSession; totalWords: number; onConfirm: () => void; onCancel: () => void }) {
  const dialogRef = useDialogFocus(onCancel);
  const { words, minutes, met } = focusLockProgress(lock, totalWords);
  return (
    <div className="modal-backdrop">
      <section ref={dialogRef} className="focus-lock-dialog modal-surface" role="dialog" aria-modal="true" aria-label="退出专注确认" tabIndex={-1}>
        <header>
          <div><Lock size={16} /><strong>{met ? "目标已完成" : "目标未完成"}</strong></div>
          <button onClick={onCancel}>关闭</button>
        </header>
        <p>
          {met
            ? `已写 ${words.toLocaleString()} 字，专注 ${minutes} 分钟。退出专注模式？`
            : `已写 ${words.toLocaleString()}${lock.goalWords > 0 ? ` / ${lock.goalWords.toLocaleString()}` : ""} 字，专注 ${minutes}${lock.goalMinutes > 0 ? ` / ${lock.goalMinutes}` : ""} 分钟。确认退出？（紧急退出始终可用）`}
        </p>
        <footer>
          <button onClick={onCancel}>继续写作</button>
          <button className="primary" onClick={onConfirm}>确认退出</button>
        </footer>
      </section>
    </div>
  );
}

export function FocusLockBar({ lock, totalWords, onExit }: { lock: FocusLockSession; totalWords: number; onExit: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const { words, minutes, met } = focusLockProgress(lock, totalWords, now);
  return (
    <div className="focus-lock-bar" role="status">
      <Lock size={13} />
      <span>专注锁定 · 已写 {words.toLocaleString()}{lock.goalWords > 0 ? ` / ${lock.goalWords.toLocaleString()}` : ""} 字 · {minutes}{lock.goalMinutes > 0 ? ` / ${lock.goalMinutes}` : ""} 分钟</span>
      {met && <em>目标已达成</em>}
      <button onClick={onExit}>退出专注</button>
    </div>
  );
}