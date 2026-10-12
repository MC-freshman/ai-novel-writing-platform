import { RefreshCcw } from "lucide-react";
import type { AnalysisContext } from "./context";

export function TimelinePanel(
  context: Pick<
    AnalysisContext,
    | "busy"
    | "loadTimeline"
    | "moveTimelineEvent"
    | "onSelectChapter"
    | "setDraggingEventId"
    | "setTimelineMode"
    | "timelineEvents"
    | "timelineMode"
  >,
) {
  const {
    busy,
    loadTimeline,
    moveTimelineEvent,
    onSelectChapter,
    setDraggingEventId,
    setTimelineMode,
    timelineEvents,
    timelineMode,
  } = context;

  return (
    <div className="analysis-section">
      <div className="analysis-actions">
        <select
          value={timelineMode}
          onChange={(event) =>
            setTimelineMode(event.target.value as "local" | "ai")
          }
        >
          <option value="ai">AI 识别真实事件</option>
          <option value="local">本地规则整理</option>
        </select>
        <button
          onClick={() => void loadTimeline()}
          disabled={busy === "timeline"}
        >
          <RefreshCcw size={16} />
          刷新时间线
        </button>
      </div>
      <div className="timeline-list">
        {timelineEvents.map((event) => (
          <button
            key={event.id}
            className="timeline-item"
            draggable
            onDragStart={() => setDraggingEventId(event.id)}
            onDragOver={(dragEvent) => {
              dragEvent.preventDefault();
              dragEvent.dataTransfer.dropEffect = "move";
            }}
            onDrop={(dragEvent) => {
              dragEvent.preventDefault();
              moveTimelineEvent(event.id);
            }}
            onDragEnd={() => setDraggingEventId("")}
            onClick={() => onSelectChapter(event.chapterId)}
          >
            <span className="timeline-dot" />
            <div>
              <strong>{event.timeHint || event.title}</strong>
              <small>
                {event.volume} / {event.chapterTitle}
              </small>
              <p>{event.summary}</p>
              {!!event.characters.length && (
                <em>{event.characters.join("、")}</em>
              )}
            </div>
          </button>
        ))}
        {!timelineEvents.length && (
          <div className="analysis-empty">
            时间线会从章节顺序、时间词和小标题中整理事件。
          </div>
        )}
      </div>
    </div>
  );
}
