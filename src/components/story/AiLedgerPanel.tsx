// AI 辅助台账页签（P78）：采纳占比概览 + 创作过程证据包导出。
import { useCallback, useEffect, useState } from "react";
import { FileDown, RefreshCcw } from "lucide-react";
import type { AppState, AiLedgerOverview } from "../../types";
import { formatDateTime, getErrorMessage } from "../../lib/text-utils";
import { InlineFeedback } from "../ui/InlineFeedback";

export function AiLedgerPanel({ state, onStatus, onOpenChapter }: { state: AppState; onStatus: (message: string) => void; onOpenChapter: (chapterId: string) => void }) {
  const [overview, setOverview] = useState<AiLedgerOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [includeVersionContent, setIncludeVersionContent] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "error" | "warning" | "info"; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setOverview(await window.novelAPI.getAiLedgerOverview());
    } catch (error) {
      setFeedback({ tone: "error", message: `读取台账失败：${getErrorMessage(error)}` });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, state.projectPath]);

  async function exportEvidence() {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await window.novelAPI.exportCreationEvidence({ includeVersionContent });
      if (result.canceled) return;
      const sizeMb = ((result.sizeBytes || 0) / 1024 / 1024).toFixed(2);
      setFeedback({
        tone: result.versionTruncated ? "warning" : "info",
        message: `证据包已导出（${sizeMb} MB）：${result.filePath}。含 ${result.counts?.chapters ?? 0} 章痕迹、${result.counts?.adoptions ?? 0} 条采纳记录、${result.counts?.versionFiles ?? 0} 个版本原文${result.versionTruncated ? "（版本原文超 20MB 上限，已截断）" : ""}。`,
      });
      onStatus("创作过程证据包已导出");
    } catch (error) {
      setFeedback({ tone: "error", message: `导出失败：${getErrorMessage(error)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-ledger-panel">
      <div className="ai-ledger-toolbar">
        <strong>AI 辅助台账</strong>
        <button disabled={busy} onClick={() => { void load(); onStatus("台账已刷新"); }} title="重新读取台账">
          <RefreshCcw size={14} /> 刷新
        </button>
      </div>
      <p className="ai-ledger-note">{overview?.note || "估算仅统计平台内安全修订的采纳记录；外部粘贴文本无法识别。辅助申报参考，不构成法律或平台审核保证。"}</p>
      {feedback && <InlineFeedback tone={feedback.tone} message={feedback.message} />}
      {overview && (
        <>
          <div className="ai-ledger-summary">
            <span>采纳记录 <strong>{overview.totalAdoptions}</strong> 次</span>
            <span>采纳字数 <strong>{overview.totalAdoptedWords.toLocaleString()}</strong></span>
            <span>涉及章节 <strong>{overview.recordedChapters}</strong></span>
            <span>更新 <strong>{overview.updatedAt ? formatDateTime(overview.updatedAt) : "暂无"}</strong></span>
          </div>
          <div className="ai-ledger-table-wrap">
            <table className="ai-ledger-table">
              <thead>
                <tr><th>章节</th><th>字数</th><th>AI 采纳字数</th><th>估算占比</th><th>采纳次数</th><th>最近采纳</th></tr>
              </thead>
              <tbody>
                {overview.chapters.map((chapter) => (
                  <tr key={chapter.chapterId}>
                    <td><button disabled={busy} onClick={() => onOpenChapter(chapter.chapterId)} title="打开章节">{chapter.title || "（未命名）"}</button></td>
                    <td>{chapter.wordCount.toLocaleString()}</td>
                    <td>{chapter.adoptedWords.toLocaleString()}</td>
                    <td>{chapter.estimatedRatio === null ? <span className="ai-ledger-norecord">无记录</span> : `${(chapter.estimatedRatio * 100).toFixed(1)}%`}</td>
                    <td>{chapter.adoptions}</td>
                    <td>{chapter.lastAt ? formatDateTime(chapter.lastAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ai-ledger-export">
            <label className="checkbox-line">
              <input type="checkbox" checked={includeVersionContent} onChange={(event) => setIncludeVersionContent(event.target.checked)} />
              附版本原文（上限 20MB，超出截断）
            </label>
            <button className="primary" disabled={busy} onClick={() => void exportEvidence()}>
              <FileDown size={14} /> {busy ? "导出中..." : "导出创作过程证据包"}
            </button>
            <span className="ai-ledger-note">证据包含编辑时间线、版本哈希、字数增长与采纳记录；不含接口设置与密钥；仅本地导出。</span>
          </div>
        </>
      )}
    </div>
  );
}