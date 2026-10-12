import { ListChecks } from "lucide-react";
import type { AppState, BackgroundTask, ProgressState } from "../types";

const ACTIVE_TASK_STATUSES = ["等待中", "运行中", "正在停止", "已暂停"];

export function StatusBar({
  view,
  saving,
  dirty,
  currentWords,
  todayWords,
  totalWords,
  vectorStats,
  chatModel,
  backgroundTasks,
  importProgress,
  indexProgress,
  status,
  onOpenTaskCenter,
  onCancelImport,
}: {
  view: "chapters" | "characters" | "world" | "knowledge" | "analysis";
  saving: boolean;
  dirty: boolean;
  currentWords: number;
  todayWords: number;
  totalWords: number;
  vectorStats: AppState["vectorStats"];
  chatModel: string;
  backgroundTasks: BackgroundTask[];
  importProgress: ProgressState | null;
  indexProgress: ProgressState | null;
  status: string;
  onOpenTaskCenter: () => void;
  onCancelImport: () => void;
}) {
  const activeTaskCount = backgroundTasks.filter((task) =>
    ACTIVE_TASK_STATUSES.includes(task.status),
  ).length;
  return (
    <footer className="statusbar">
      <span className={`save-state ${dirty ? "is-dirty" : ""}`} role="status">
        {view === "chapters"
          ? saving
            ? "保存中..."
            : dirty
              ? "有未保存修改"
              : "已保存"
          : view === "characters"
            ? "角色卡 · 保存状态见当前表单"
            : view === "world"
              ? "世界观 · 保存状态见当前表单"
              : view === "analysis"
                ? "保存状态见当前面板"
                : "当前页操作即时保存"}
      </span>
      <span>当前章节：{currentWords.toLocaleString()} 字</span>
      <span>今日：{todayWords.toLocaleString()} 字</span>
      <span>总字数：{totalWords.toLocaleString()} 字</span>
      <span>知识库：{vectorStats.chunks} 片段</span>
      {vectorStats.recovery && (
        <span
          className="index-recovery-note"
          role="status"
          title={vectorStats.recovery.message}
        >
          {vectorStats.recovery.status === "degraded"
            ? "索引需重建"
            : "索引已恢复"}
        </span>
      )}
      <span>模型：{chatModel || "未配置"}</span>
      <button
        className="task-status-button"
        onClick={onOpenTaskCenter}
        title="查看后台任务"
      >
        <ListChecks size={13} />
        任务 {activeTaskCount}
      </button>
      {importProgress && (
        <span className="progress-pill">
          导入：{importProgress.current}/{importProgress.total || "?"}{" "}
          {importProgress.fileName || importProgress.phase}
          {importProgress.cancellable && (
            <button onClick={onCancelImport} title="取消后会在当前文件处理完后停止">
              取消
            </button>
          )}
        </span>
      )}
      {indexProgress && (
        <span className="progress-pill">
          索引：{indexProgress.current}/{indexProgress.total || "?"}{" "}
          {indexProgress.detail || indexProgress.phase}
        </span>
      )}
      <strong>{status}</strong>
    </footer>
  );
}
