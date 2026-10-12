import { RefreshCcw } from "lucide-react";
import type { AnalysisContext } from "./context";

export function ConsistencyPanel(
  context: Pick<
    AnalysisContext,
    | "busy"
    | "consistencyChapterIds"
    | "consistencyNotice"
    | "consistencySourceIds"
    | "issues"
    | "knowledgeSources"
    | "runConsistencyCheck"
    | "scopeOpen"
    | "setConsistencyChapterIds"
    | "setConsistencySourceIds"
    | "setScopeOpen"
    | "state"
    | "toggleConsistencyChapter"
    | "toggleConsistencySource"
    | "updateIssueStatus"
  >,
) {
  const {
    busy,
    consistencyChapterIds,
    consistencyNotice,
    consistencySourceIds,
    issues,
    knowledgeSources,
    runConsistencyCheck,
    scopeOpen,
    setConsistencyChapterIds,
    setConsistencySourceIds,
    setScopeOpen,
    state,
    toggleConsistencyChapter,
    toggleConsistencySource,
    updateIssueStatus,
  } = context;

  return (
    <div className="analysis-section">
      <details
        className="scope-panel"
        open={scopeOpen}
        onToggle={(event) => setScopeOpen(event.currentTarget.open)}
      >
        <summary>审查范围</summary>
        <div className="scope-grid">
          <section>
            <header>
              <strong>审查哪些章节</strong>
              <div>
                <button
                  onClick={() =>
                    setConsistencyChapterIds(
                      state.chapters.map((chapter) => chapter.id),
                    )
                  }
                >
                  全选
                </button>
                <button onClick={() => setConsistencyChapterIds([])}>
                  全书
                </button>
              </div>
            </header>
            <div className="scope-check-list">
              {state.chapters.map((chapter) => (
                <label key={chapter.id}>
                  <input
                    type="checkbox"
                    checked={consistencyChapterIds.includes(chapter.id)}
                    onChange={() => toggleConsistencyChapter(chapter.id)}
                  />
                  <span>
                    {chapter.volume || "未分卷"} / {chapter.title}
                  </span>
                </label>
              ))}
            </div>
          </section>
          <section>
            <header>
              <strong>依据哪些资料</strong>
              <div>
                <button
                  onClick={() =>
                    setConsistencySourceIds(
                      knowledgeSources.map((source) => source.id),
                    )
                  }
                >
                  全选
                </button>
                <button onClick={() => setConsistencySourceIds([])}>
                  全项目
                </button>
              </div>
            </header>
            <div className="scope-check-list">
              {knowledgeSources.map((source) => (
                <label key={`${source.sourceType}_${source.id}`}>
                  <input
                    type="checkbox"
                    checked={consistencySourceIds.includes(source.id)}
                    onChange={() => toggleConsistencySource(source.id)}
                  />
                  <span>
                    {source.role} / {source.group} / {source.title}
                  </span>
                </label>
              ))}
            </div>
          </section>
        </div>
      </details>
      <div className="analysis-actions">
        <button
          onClick={() => void runConsistencyCheck()}
          disabled={busy === "consistency"}
        >
          <RefreshCcw size={16} />
          开始检查
        </button>
        {consistencyNotice && <span>{consistencyNotice}</span>}
      </div>
      <div className="issue-list">
        {issues.map((issue) => (
          <article
            key={issue.id}
            className={`issue-card severity-${issue.severity}`}
          >
            <header>
              <strong>{issue.title}</strong>
              <span>
                {issue.severity} / {issue.category} / {issue.status || "待处理"}
              </span>
            </header>
            <p>{issue.detail}</p>
            {issue.suggestion && <em>{issue.suggestion}</em>}
            {!!issue.evidence.length && (
              <small>{issue.evidence.join("；")}</small>
            )}
            <div className="issue-actions">
              {(["已确认", "已忽略", "已修复", "待处理"] as const).map(
                (status) => (
                  <button
                    key={status}
                    onClick={() => void updateIssueStatus(issue.id, status)}
                  >
                    {status}
                  </button>
                ),
              )}
            </div>
          </article>
        ))}
        {!issues.length && (
          <div className="analysis-empty">
            点击“开始检查”后，会结合 AI 和本地规则查找前后矛盾。
          </div>
        )}
      </div>
    </div>
  );
}
