// 文风自查面板（P85）：本地启发式指标报告；质量辅助参考，不代表平台检测结论。
import { useCallback, useEffect, useState } from "react";
import { RefreshCcw, Waves } from "lucide-react";
import type { StyleReport } from "../../types";
import { getErrorMessage } from "../../lib/text-utils";
import { InlineFeedback } from "../ui/InlineFeedback";
import type { AnalysisContext } from "./context";

export function StylePanel({ onSelectChapter, onStatus }: Pick<AnalysisContext, "onSelectChapter" | "onStatus">) {
  const [report, setReport] = useState<StyleReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "error" | "warning" | "info"; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setReport(await window.novelAPI.getStyleReport());
    } catch (error) {
      setFeedback({ tone: "error", message: `读取文风报告失败：${getErrorMessage(error)}` });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function analyze() {
    setBusy(true);
    setFeedback(null);
    try {
      const next = await window.novelAPI.analyzeStyle({});
      setReport(next);
      onStatus(`文风自查完成：${next.flaggedChapters}/${next.scannedChapters} 章有提示项`);
    } catch (error) {
      setFeedback({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="style-panel">
      <div className="style-toolbar">
        <Waves size={16} />
        <strong>文风自查</strong>
        <span className="style-note">本地启发式指标（句长变化/模板短语/连接词/重复片段），透明可复核。</span>
        <button disabled={busy} onClick={() => void analyze()}>
          <RefreshCcw size={14} /> {busy ? "分析中..." : "全书分析"}
        </button>
      </div>
      <InlineFeedback tone="info" message="质量辅助参考，不代表任何平台 AI 检测结论，不承诺过审。润色请用正文右键「润色」（候选制，逐句采纳，不直接改稿）。" />
      {feedback && <InlineFeedback tone={feedback.tone} message={feedback.message} />}
      {!report ? (
        <p className="style-note">还没有报告。点击「全书分析」生成。</p>
      ) : (
        <>
          <div className="style-summary">
            <span>扫描 <strong>{report.scannedChapters}</strong> 章</span>
            <span>提示 <strong>{report.flaggedChapters}</strong> 章</span>
            <span>更新 <strong>{report.updatedAt ? new Date(report.updatedAt).toLocaleString() : "—"}</strong></span>
          </div>
          <ul className="style-chapter-list">
            {report.chapters.map((chapter) => (
              <li key={chapter.chapterId} data-flagged={chapter.flags.length > 0 ? "true" : "false"}>
                <div className="style-chapter-head">
                  <button disabled={busy} onClick={() => onSelectChapter(chapter.chapterId)} title="打开章节">{chapter.title || chapter.fileName}</button>
                  <span className="style-metrics">
                    {chapter.metrics.chars.toLocaleString()} 字 · 均句长 {chapter.metrics.avgSentenceLen} · 句长变异 {chapter.metrics.sentenceLenCV} · 模板/千字 {chapter.metrics.templatePer1000} · 连接词/千字 {chapter.metrics.connectivePer1000} · 重复率 {chapter.metrics.repeatRate}
                  </span>
                </div>
                {chapter.flags.length > 0 && (
                  <div className="style-flags">
                    {chapter.flags.map((flag) => <span key={flag.key} className="style-flag" title={flag.detail}>{flag.label}</span>)}
                  </div>
                )}
                {chapter.topParagraphs.length > 0 && (
                  <details className="style-paragraphs">
                    <summary>模板短语定位（{chapter.topParagraphs.length} 段）</summary>
                    <ul>
                      {chapter.topParagraphs.map((paragraph, index) => (
                        <li key={index}><mark>{paragraph.hits} 处</mark> {paragraph.text}…</li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}