// 写作统计面板（P75）：今日目标进度、连续达标、近 30 天趋势与累计概览。
import { useCallback, useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import type { WritingOverview } from "../../types";
import { getErrorMessage } from "../../lib/text-utils";
import type { AnalysisContext } from "./context";

export function WritingStatsPanel({ state, onStatus }: Pick<AnalysisContext, "state" | "onStatus">) {
  const [overview, setOverview] = useState<WritingOverview | null>(null);
  const [errorText, setErrorText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setErrorText("");
    try {
      setOverview(await window.novelAPI.getWritingOverview());
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, state.projectPath]);

  const goal = state.config.ui.dailyWordGoal || 0;
  const maxWords = Math.max(1, ...(overview?.series.map((point) => point.netWords) || [1]));

  return (
    <div className="writing-stats">
      <div className="writing-stats-toolbar">
        <strong>写作统计</strong>
        <span className="writing-stats-note">口径：每次保存的净增字数（与状态栏「今日」一致）；统计随项目保存。</span>
        <button disabled={busy} onClick={() => { void load(); onStatus("写作统计已刷新"); }} title="重新读取写作统计">
          <RefreshCcw size={14} />
          {busy ? "读取中..." : "刷新"}
        </button>
      </div>
      {errorText && <p className="writing-stats-error" role="alert">读取写作统计失败：{errorText}</p>}
      {overview && (
        <>
          <div className="writing-stats-summary">
            <div className="writing-stats-card">
              <span>今日净增</span>
              <strong>{overview.today.netWords.toLocaleString()} 字{goal > 0 ? ` / ${goal.toLocaleString()}` : ""}</strong>
              {goal > 0 && <em data-met={overview.today.metGoal ? "true" : "false"}>{overview.today.metGoal ? "已达标" : "未达标"}</em>}
            </div>
            <div className="writing-stats-card">
              <span>连续达标</span>
              <strong>{goal > 0 ? `${overview.streak} 天` : "未设目标"}</strong>
            </div>
            <div className="writing-stats-card">
              <span>累计记录</span>
              <strong>{overview.totalRecorded.toLocaleString()} 字</strong>
            </div>
            <div className="writing-stats-card">
              <span>活跃天数</span>
              <strong>{overview.activeDays} 天</strong>
            </div>
            <div className="writing-stats-card">
              <span>单日峰值</span>
              <strong>{overview.bestDay ? `${overview.bestDay.netWords.toLocaleString()} 字` : "暂无"}</strong>
              {overview.bestDay && <em>{overview.bestDay.date}</em>}
            </div>
          </div>
          {overview.activeDays === 0 ? (
            <p className="writing-stats-empty">还没有写作记录。保存章节后这里会按日累计净增字数；在设置「编辑与保存」中设定每日目标后可追踪连续达标天数。</p>
          ) : (
            <div className="writing-stats-bars" role="img" aria-label="近 30 天每日净增字数趋势">
              {overview.series.map((point) => (
                <div key={point.date} className="writing-bar-slot" title={`${point.date} · ${point.netWords.toLocaleString()} 字 · ${point.saves} 次保存${goal > 0 ? (point.metGoal ? " · 达标" : " · 未达标") : ""}`}>
                  <div className="writing-bar" data-met={goal > 0 && point.metGoal ? "true" : "false"} style={{ height: `${Math.max(point.netWords > 0 ? 6 : 2, Math.round((point.netWords / maxWords) * 100))}%` }} />
                  <span>{point.date.slice(8)}</span>
                </div>
              ))}
            </div>
          )}
          {goal === 0 && <p className="writing-stats-note">提示：在设置「编辑与保存」中设定每日字数目标（0=关闭），即可启用达标标记与连续天数。</p>}
        </>
      )}
    </div>
  );
}