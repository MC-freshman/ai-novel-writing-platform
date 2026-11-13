// 全书批量替换（P76）：搜索→选择→预览→确认执行（先保存当前章，替换前自动快照，冲突即停）。
import { useState } from "react";
import { Replace } from "lucide-react";
import type { BookSearchResult, ReplacePlan, ReplaceExecutionResult } from "../../types";
import { getErrorMessage } from "../../lib/text-utils";
import { InlineFeedback } from "../ui/InlineFeedback";
import { useDialogFocus } from "../../hooks/useDialogFocus";

export function BookReplace({ onStatus, saveCurrentPage }: { onStatus: (message: string) => void; saveCurrentPage: () => Promise<boolean> }) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [scope, setScope] = useState<"chapters" | "cards" | "all">("chapters");
  const [result, setResult] = useState<BookSearchResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<ReplacePlan | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "error" | "warning" | "info"; message: string } | null>(null);
  const confirmRef = useDialogFocus(() => setConfirmOpen(false), confirmOpen);

  async function runSearch() {
    setBusy(true);
    setFeedback(null);
    setPlan(null);
    try {
      const next = await window.novelAPI.searchBook({ query, caseSensitive, wholeWord, useRegex, scope });
      setResult(next);
      setSelected(new Set(next.chapters.map((chapter) => chapter.chapterId)));
      setSelectedCards(new Set((next.cards || []).map((card) => card.cardId)));
      if (!next.totalMatches) setFeedback({ tone: "info", message: "全书没有命中。" });
    } catch (error) {
      setFeedback({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function buildPlan() {
    if (!result || (selected.size === 0 && selectedCards.size === 0)) return;
    setBusy(true);
    setFeedback(null);
    try {
      const next = await window.novelAPI.buildReplacePlan({ query, replacement, caseSensitive, wholeWord, useRegex, scope, chapterIds: [...selected], cardIds: [...selectedCards] });
      setPlan(next);
    } catch (error) {
      setFeedback({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!plan) return;
    setBusy(true);
    setFeedback(null);
    try {
      const saved = await saveCurrentPage();
      if (!saved) {
        setFeedback({ tone: "error", message: "当前页面保存失败，已停止替换。请先处理保存问题。" });
        return;
      }
      const execution: ReplaceExecutionResult = await window.novelAPI.executeBookReplace({
        query, replacement, caseSensitive, wholeWord, useRegex, scope,
        selections: plan.chapters.map((chapter) => ({ chapterId: chapter.chapterId })),
        cardSelections: (plan.cards || []).map((card) => ({ cardType: card.cardType, cardId: card.cardId })),
        expectedRevisions: Object.fromEntries(plan.chapters.map((chapter) => [chapter.chapterId, chapter.revision])),
      });
      setConfirmOpen(false);
      setPlan(null);
      setResult(null);
      setFeedback({ tone: "info", message: `已替换 ${execution.totalReplaced} 处（正文 ${execution.results.length} 章${execution.cardResults?.length ? `，卡片 ${execution.cardResults.length} 张` : ""}）。替换前快照已创建，可在「快照与分支」恢复。` });
      onStatus(`全书替换完成：${execution.totalReplaced} 处`);
    } catch (error) {
      setConfirmOpen(false);
      setFeedback({ tone: "error", message: `${getErrorMessage(error)} 替换前快照已创建，可在「快照与分支」恢复。` });
    } finally {
      setBusy(false);
    }
  }

  async function enqueueBackground() {
    if (!plan) return;
    setBusy(true);
    setFeedback(null);
    try {
      const saved = await saveCurrentPage();
      if (!saved) {
        setFeedback({ tone: "error", message: "当前页面保存失败，已停止。请先处理保存问题。" });
        return;
      }
      await window.novelAPI.enqueueTask({
        type: "book-replace",
        title: `全书替换「${query}」→「${replacement || "(删除)"}」`,
        options: {
          replacePayload: {
            query, replacement, caseSensitive, wholeWord, useRegex, scope,
            selections: plan.chapters.map((chapter) => ({ chapterId: chapter.chapterId })),
            cardSelections: (plan.cards || []).map((card) => ({ cardType: card.cardType, cardId: card.cardId })),
            expectedRevisions: Object.fromEntries(plan.chapters.map((chapter) => [chapter.chapterId, chapter.revision])),
          },
        },
      });
      setPlan(null);
      setResult(null);
      setFeedback({ tone: "info", message: "已放入后台任务中心，可在底部任务入口查看进度或停止。" });
      onStatus("全书替换已加入后台任务");
    } catch (error) {
      setFeedback({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="book-replace">
      <div className="book-replace-head">
        <Replace size={15} />
        <strong>全书批量替换</strong>
        <span className="book-replace-note">字面匹配；执行前自动保存当前章并创建快照；预览后若章节被修改会停止替换。</span>
      </div>
      <form
        className="book-replace-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch();
        }}
      >
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={useRegex ? "正则表达式（如 林.|陆远）" : "搜索词（如角色旧名）"} aria-label="全书搜索词" />
        <input value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder={useRegex ? "替换为（支持 $1/$&）" : "替换为（留空=删除）"} aria-label="替换词" />
        <label className="checkbox-line"><input type="checkbox" checked={useRegex} onChange={(event) => setUseRegex(event.target.checked)} /> 正则</label>
        <label className="checkbox-line"><input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} /> 区分大小写</label>
        {!useRegex && <label className="checkbox-line"><input type="checkbox" checked={wholeWord} onChange={(event) => setWholeWord(event.target.checked)} /> 整词（英文）</label>}
        <label className="book-replace-scope">
          范围
          <select value={scope} onChange={(event) => setScope(event.target.value as "chapters" | "cards" | "all")}>
            <option value="chapters">正文</option>
            <option value="cards">角色/世界卡</option>
            <option value="all">正文+卡片</option>
          </select>
        </label>
        <button type="submit" disabled={busy || !query.trim()}>全书搜索</button>
      </form>
      {feedback && <InlineFeedback tone={feedback.tone} message={feedback.message} />}
      {result && result.totalMatches > 0 && (
        <div className="book-replace-results">
          <div className="book-replace-results-head">
            <span>命中 {result.totalMatches} 处 / {result.chapters.length} 章{(result.cards || []).length ? ` / ${(result.cards || []).length} 卡` : ""}{result.truncated ? "（结果已截断）" : ""}</span>
            <button disabled={busy || (selected.size === 0 && selectedCards.size === 0)} onClick={() => void buildPlan()}>生成替换预览（已选 {selected.size} 章 {selectedCards.size} 卡）</button>
          </div>
          <ul className="book-replace-chapters">
            {result.chapters.map((chapter) => (
              <li key={chapter.chapterId}>
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={selected.has(chapter.chapterId)}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(chapter.chapterId);
                      else next.delete(chapter.chapterId);
                      setSelected(next);
                      setPlan(null);
                    }}
                  />
                  {chapter.title || chapter.fileName}（{chapter.matchCount} 处）
                </label>
                <span className="book-replace-sample">{chapter.matches[0]?.context}</span>
              </li>
            ))}
          </ul>
          {(result.cards || []).length > 0 && (
            <ul className="book-replace-chapters">
              {(result.cards || []).map((card) => (
                <li key={card.cardId}>
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={selectedCards.has(card.cardId)}
                      onChange={(event) => {
                        const next = new Set(selectedCards);
                        if (event.target.checked) next.add(card.cardId);
                        else next.delete(card.cardId);
                        setSelectedCards(next);
                        setPlan(null);
                      }}
                    />
                    {card.cardType === "character" ? "角色" : "世界"}：{card.title}（{card.matchCount} 处）
                  </label>
                  <span className="book-replace-sample">{card.hits[0]?.field}：{card.hits[0]?.context}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {plan && (
        <div className="book-replace-plan">
          <InlineFeedback tone="warning" message={`预览：「${plan.query}」→「${plan.replacement || "(删除)"}」，共 ${plan.totalOccurrences} 处 / ${plan.chapters.length} 章${(plan.cards || []).length ? ` / ${(plan.cards || []).length} 卡` : ""}。执行将创建快照并逐章保存新版本。`} />
          <button className="primary" disabled={busy} onClick={() => setConfirmOpen(true)}>执行替换…</button>
          <button disabled={busy} onClick={() => void enqueueBackground()} title="放入后台任务中心执行（可暂停/停止）">后台执行</button>
        </div>
      )}
      {confirmOpen && plan && (
        <div className="modal-backdrop">
          <section ref={confirmRef} className="focus-lock-dialog modal-surface" role="dialog" aria-modal="true" aria-label="确认全书替换" tabIndex={-1}>
            <header>
              <div><strong>确认全书替换</strong></div>
              <button onClick={() => setConfirmOpen(false)}>取消</button>
            </header>
            <p>将替换 {plan.chapters.length} 章{(plan.cards || []).length ? ` 与 ${(plan.cards || []).length} 张卡片` : ""}中的 {plan.totalOccurrences} 处「{plan.query}」为「{plan.replacement || "(删除)"}」。当前章会先保存；替换前创建快照；任何章节在预览后被修改都会停止替换。</p>
            <footer>
              <button onClick={() => setConfirmOpen(false)}>取消</button>
              <button className="primary" disabled={busy} onClick={() => void execute()}>{busy ? "替换中..." : "确认替换"}</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}