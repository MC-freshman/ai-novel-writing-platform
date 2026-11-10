// Extracted from src/App.tsx by the P3 refactor (cut-paste, no logic changes).
import { useCallback, useEffect, useState } from "react";
import { ListChecks, Trash2, X } from "lucide-react";
import type { BackgroundTask, OperationJournalItem } from "../../types";
import { formatDateTime, getErrorMessage } from "../../lib/text-utils";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { InlineFeedback } from "../ui/InlineFeedback";

export function TaskCenterDrawer({
  tasks,
  onClose,
  onChange,
  onOpenStoryCenter,
  onStatus,
}: {
  tasks: BackgroundTask[];
  onClose: () => void;
  onChange: (tasks: BackgroundTask[]) => void;
  onOpenStoryCenter: (tab: "facts" | "board") => void;
  onStatus: (message: string) => void;
}) {
  const dialogRef = useDialogFocus(onClose);
  const activeCount = tasks.filter((task) => ["等待中", "运行中", "正在停止", "已暂停"].includes(task.status)).length;
  const [operations, setOperations] = useState<OperationJournalItem[]>([]);
  const [operationsStatus, setOperationsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [operationsError, setOperationsError] = useState("");

  const loadOperations = useCallback(() => {
    setOperationsStatus("loading");
    setOperationsError("");
    void window.novelAPI.listOperationJournal()
      .then((result) => { setOperations(result.operations); setOperationsStatus("ready"); })
      .catch((error) => {
        setOperationsStatus("error");
        setOperationsError(getErrorMessage(error));
      });
  }, []);

  useEffect(() => { loadOperations(); }, [loadOperations]);

  async function updateTask(
    request: () => Promise<{ task?: BackgroundTask }>,
    failureLabel: string,
  ) {
    try {
      const result = await request();
      if (result.task) {
        onChange([
          result.task,
          ...tasks.filter((task) => task.id !== result.task?.id),
        ]);
      }
    } catch (error) {
      onStatus(`${failureLabel}：${getErrorMessage(error)}`);
    }
  }

  function cancelTask(taskId: string) {
    return updateTask(() => window.novelAPI.cancelTask(taskId), "停止任务失败");
  }

  function pauseTask(taskId: string) {
    return updateTask(() => window.novelAPI.pauseTask(taskId), "暂停任务失败");
  }

  function resumeTask(taskId: string) {
    return updateTask(() => window.novelAPI.resumeTask(taskId), "继续任务失败");
  }

  async function retryTask(taskId: string) {
    try {
      const result = await window.novelAPI.retryTask(taskId);
      onChange([result.task, ...tasks]);
      onStatus(`已重新加入任务：${result.task.title}`);
    } catch (error) {
      onStatus(`重试失败：${getErrorMessage(error)}`);
    }
  }

  async function removeTask(taskId: string) {
    try {
      onChange((await window.novelAPI.removeTask(taskId)).tasks);
    } catch (error) {
      onStatus(`删除任务记录失败：${getErrorMessage(error)}`);
    }
  }

  async function clearTaskHistory() {
    try {
      const result = await window.novelAPI.clearTaskHistory();
      onChange(result.tasks);
      onStatus(`已清理 ${result.removed} 条已结束任务记录`);
    } catch (error) {
      onStatus(`清理任务记录失败：${getErrorMessage(error)}`);
    }
  }

  return (
    <div className="task-drawer-backdrop" onClick={onClose}>
      <aside ref={dialogRef} className="task-center-drawer" role="dialog" aria-modal="true" aria-label="后台任务" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <header><div><ListChecks size={18} /><strong>后台任务</strong><span>{activeCount ? `${activeCount} 个进行中或暂停` : "当前空闲"}</span></div><div><button onClick={() => void clearTaskHistory()} disabled={!tasks.some((task) => !["等待中", "运行中", "正在停止", "已暂停"].includes(task.status))}>清理记录</button><button onClick={onClose} title="关闭"><X size={17} /></button></div></header>
        <details className="operation-history">
          <summary>项目操作记录（{operations.length}）</summary>
          <div>
            {operationsStatus === "loading" && <p role="status">正在读取项目操作记录…</p>}
            {operationsStatus === "error" && <InlineFeedback title="项目操作记录读取失败" message={operationsError} actionLabel="重试" onAction={loadOperations} />}
            {operationsStatus === "ready" && operations.slice(0, 40).map((item) => <article key={item.id} className={`operation-${item.status}`}><strong>{item.title}</strong><span>{item.status} / {formatDateTime(item.updatedAt)}</span>{item.error && <em>{item.error}</em>}</article>)}
            {operationsStatus === "ready" && !operations.length && <p>暂无保存、导入、拖动或修订记录。</p>}
          </div>
        </details>
        <div className="task-list">
          {tasks.map((task) => {
            const active = ["等待中", "运行中", "正在停止", "已暂停"].includes(task.status);
            const progress = task.total ? Math.min(100, Math.round((task.current / task.total) * 100)) : active ? null : task.status === "已完成" ? 100 : 0;
            return (
              <article key={task.id} className={`task-row status-${task.status}`}>
                <div className="task-row-title"><strong>{task.title}</strong><span>{task.status}</span></div>
                <p>{task.phase}{task.detail ? `：${task.detail}` : ""}</p>
                <div className={`task-progress ${progress === null ? "indeterminate" : ""}`} role="progressbar" aria-valuenow={progress ?? undefined} aria-valuemin={progress === null ? undefined : 0} aria-valuemax={progress === null ? undefined : 100}>
                  <span style={progress === null ? undefined : { width: `${progress}%` }} />
                </div>
                <small>{task.total ? `${task.current}/${task.total}` : ""} {formatDateTime(task.updatedAt)}{task.usage?.totalTokens ? ` / 约 ${task.usage.totalTokens.toLocaleString("zh-CN")} Token` : ""}</small>
                {task.error && <em>{task.error}</em>}
                {task.partialOutput && <details><summary>查看已保留的部分输出</summary><pre>{task.partialOutput.slice(-12000)}</pre></details>}
                <div className="task-actions">
                  {["等待中", "运行中"].includes(task.status) && <button onClick={() => void pauseTask(task.id)}>暂停</button>}
                  {task.status === "已暂停" && <button onClick={() => void resumeTask(task.id)}>继续</button>}
                  {active && <button onClick={() => void cancelTask(task.id)}>停止</button>}
                  {task.canRetry && <button onClick={() => void retryTask(task.id)}>重试</button>}
                  {task.status === "已完成" && ["story-analysis", "creative-board"].includes(task.type) && <button onClick={() => onOpenStoryCenter(task.type === "creative-board" ? "board" : "facts")}>查看结果</button>}
                  {!active && <button onClick={() => void removeTask(task.id)} title="删除任务记录"><Trash2 size={14} /></button>}
                </div>
              </article>
            );
          })}
          {!tasks.length && <div className="analysis-empty">长篇分析、知识库重建和项目快照会在这里运行，不阻塞正文编辑。</div>}
        </div>
      </aside>
    </div>
  );
}
