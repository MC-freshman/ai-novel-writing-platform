// 敏感词自查面板（P77）：词库管理/忽略名单/全书扫描/报告定位。仅提示不阻断。
import { useCallback, useEffect, useState } from "react";
import { RefreshCcw, ShieldCheck, Trash2, Upload } from "lucide-react";
import type { SensitiveState } from "../../types";
import { getErrorMessage } from "../../lib/text-utils";
import { InlineFeedback } from "../ui/InlineFeedback";
import type { AnalysisContext } from "./context";

export function SensitivePanel({ onSelectChapter, onStatus }: Pick<AnalysisContext, "onSelectChapter" | "onStatus">) {
  const [state, setState] = useState<SensitiveState | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "error" | "warning" | "info"; message: string } | null>(null);
  const [ignoreDraft, setIgnoreDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [verdicts, setVerdicts] = useState<Array<{ word: string; verdict: string; reason: string }>>([]);
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await window.novelAPI.getSensitiveState());
    } catch (error) {
      setFeedback({ tone: "error", message: `读取自查状态失败：${getErrorMessage(error)}` });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, successMessage?: string) {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      await load();
      if (successMessage) onStatus(successMessage);
    } catch (error) {
      setFeedback({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function aiReview() {
    if (!report) return;
    setReviewing(true);
    setFeedback(null);
    try {
      const hits = report.results.flatMap((chapter) => chapter.hits.map((hit) => ({ word: hit.word, context: hit.context }))).slice(0, 30);
      const result = await window.novelAPI.aiReviewSensitive({ hits });
      setVerdicts(result.verdicts);
      if (!result.verdicts.length) setFeedback({ tone: "warning", message: "AI 未返回有效判定，请检查接口配置或重试。" });
    } catch (error) {
      setFeedback({ tone: "error", message: `AI 复核失败：${getErrorMessage(error)}` });
    } finally {
      setReviewing(false);
    }
  }

  const report = state?.report;
  return (
    <div className="sensitive-panel">
      <div className="sensitive-toolbar">
        <ShieldCheck size={16} />
        <strong>敏感词自查</strong>
        <span className="sensitive-note">发布前自查辅助，仅提示不阻断；词库由你导入维护，结果不代表任何平台审核结论。</span>
        <button disabled={busy} onClick={() => void run(() => window.novelAPI.scanSensitive({}), "敏感词自查完成")}>
          <RefreshCcw size={14} />
          {busy ? "扫描中..." : "全书扫描"}
        </button>
      </div>
      {feedback && <InlineFeedback tone={feedback.tone} message={feedback.message} />}
      {state && (
        <>
          <section className="sensitive-section">
            <div className="sensitive-section-head">
              <strong>词库（{state.dictionaries.length}/{state.limits.maxDictionaries}）</strong>
              <button disabled={busy} onClick={() => void run(() => window.novelAPI.importSensitiveDictionary(), "词库已导入")}>
                <Upload size={14} /> 导入词库（TXT 每行一词 / JSON）
              </button>
            </div>
            <ul className="sensitive-dict-list">
              {state.dictionaries.map((dictionary) => (
                <li key={dictionary.id}>
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={dictionary.enabled}
                      disabled={busy}
                      onChange={(event) => void run(() => window.novelAPI.toggleSensitiveDictionary({ id: dictionary.id, enabled: event.target.checked }))}
                    />
                    {dictionary.name}
                  </label>
                  <span className="sensitive-dict-meta">{dictionary.wordCount.toLocaleString()} 词{dictionary.builtin ? " · 内置示例（非平台官方）" : ""}</span>
                  {!dictionary.builtin && (confirmDeleteId === dictionary.id ? (
                    <button className="sensitive-delete-confirm" disabled={busy} onClick={() => { setConfirmDeleteId(""); void run(() => window.novelAPI.deleteSensitiveDictionary(dictionary.id), "词库已删除"); }}>确认删除词库</button>
                  ) : (
                    <button disabled={busy} title="删除词库" onClick={() => setConfirmDeleteId(dictionary.id)}><Trash2 size={14} /></button>
                  ))}
                </li>
              ))}
            </ul>
          </section>
          <section className="sensitive-section">
            <div className="sensitive-section-head">
              <strong>忽略名单（{state.ignoreList.length}）</strong>
            </div>
            <div className="sensitive-ignore-row">
              <input value={ignoreDraft} onChange={(event) => setIgnoreDraft(event.target.value)} placeholder="加入忽略词（误报词）" aria-label="忽略词" />
              <button disabled={busy || !ignoreDraft.trim()} onClick={() => { const word = ignoreDraft.trim(); setIgnoreDraft(""); void run(() => window.novelAPI.updateSensitiveIgnore({ word })); }}>加入</button>
            </div>
            {state.ignoreList.length > 0 && (
              <div className="sensitive-ignore-chips">
                {state.ignoreList.map((word) => (
                  <button key={word} disabled={busy} title="点击移出忽略名单" onClick={() => void run(() => window.novelAPI.updateSensitiveIgnore({ word, remove: true }))}>{word} ×</button>
                ))}
              </div>
            )}
          </section>
          <section className="sensitive-section">
            <div className="sensitive-section-head">
              <strong>扫描报告</strong>
              {report && <span className="sensitive-dict-meta">{report.updatedAt ? new Date(report.updatedAt).toLocaleString() : ""} · 扫描 {report.scannedChapters} 章 · 启用 {report.activeWordCount} 词</span>}
              {report && report.totalHits > 0 && (
                <button disabled={busy || reviewing} onClick={() => void aiReview()}>{reviewing ? "复核中..." : "AI 复核（仅建议）"}</button>
              )}
            </div>
            {verdicts.length > 0 && (
              <ul className="sensitive-verdicts">
                {verdicts.map((verdict, index) => (
                  <li key={`${verdict.word}-${index}`}>
                    <mark data-verdict={verdict.verdict}>{verdict.word} · {verdict.verdict}</mark>
                    <span className="sensitive-hit-context">{verdict.reason}</span>
                    {verdict.verdict === "误报" && (
                      <button disabled={busy} onClick={() => void run(() => window.novelAPI.updateSensitiveIgnore({ word: verdict.word }))}>加入忽略</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!report ? (
              <p className="sensitive-note">还没有扫描报告。启用词库后点击「全书扫描」。</p>
            ) : report.totalHits === 0 ? (
              <p className="sensitive-note">本次扫描未发现命中（启用词库 {report.activeWordCount} 词，扫描 {report.scannedChapters} 章）。</p>
            ) : (
              <>
                <InlineFeedback tone="warning" message={`共 ${report.totalHits} 处命中，涉及 ${report.results.length} 章。请人工核对上下文后决定是否修改。`} />
                <ul className="sensitive-report-list">
                  {report.results.map((chapter) => (
                    <li key={chapter.chapterId}>
                      <div className="sensitive-report-chapter">
                        <button disabled={busy} onClick={() => onSelectChapter(chapter.chapterId)} title="打开章节">{chapter.title || chapter.fileName}</button>
                        <span className="sensitive-dict-meta">{chapter.hitCount} 处{chapter.truncated ? "（仅显示前 500 处）" : ""}</span>
                      </div>
                      <ul className="sensitive-hit-list">
                        {chapter.hits.map((hit, index) => (
                          <li key={`${hit.word}-${hit.start}-${index}`}>
                            <mark>{hit.word}</mark>
                            <span className="sensitive-hit-context">…{hit.context}…</span>
                            <button disabled={busy} title="加入忽略名单" onClick={() => void run(() => window.novelAPI.updateSensitiveIgnore({ word: hit.word }))}>忽略</button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}