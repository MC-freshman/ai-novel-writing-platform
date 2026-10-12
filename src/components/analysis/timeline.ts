import type { AnalysisContext } from "./context";

export function useAnalysisTimeline(
  context: Pick<
    AnalysisContext,
    | "draggingEventId"
    | "onStatus"
    | "saveAnalysisDraft"
    | "setBusy"
    | "setDraggingEventId"
    | "setTimelineEvents"
    | "timelineMode"
  >,
) {
  const {
    draggingEventId,
    onStatus,
    saveAnalysisDraft,
    setBusy,
    setDraggingEventId,
    setTimelineEvents,
    timelineMode,
  } = context;
  async function loadTimeline() {
    setBusy("timeline");
    onStatus(
      timelineMode === "ai"
        ? "正在让 AI 识别真实剧情事件..."
        : "正在整理时间线...",
    );
    try {
      const result = await window.novelAPI.buildTimeline({
        mode: timelineMode,
        refresh: true,
      });
      setTimelineEvents(result.events);
      saveAnalysisDraft({
        timeline: result,
        timelineOptions: { mode: timelineMode },
      });
      onStatus(
        result.apiError
          ? `AI 时间线失败，已使用本地结果：${result.apiError}`
          : `时间线已整理：${result.events.length} 个事件`,
      );
    } catch (error) {
      onStatus(
        `整理时间线失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy("");
    }
  }

  function moveTimelineEvent(targetId: string) {
    if (!draggingEventId || draggingEventId === targetId) return;
    setTimelineEvents((items) => {
      const moving = items.find((item) => item.id === draggingEventId);
      if (!moving) return items;
      const rest = items.filter((item) => item.id !== draggingEventId);
      const targetIndex = rest.findIndex((item) => item.id === targetId);
      rest.splice(targetIndex < 0 ? rest.length : targetIndex, 0, moving);
      const next = rest.map((item, index) => ({ ...item, order: index }));
      saveAnalysisDraft({
        timeline: { events: next },
        timelineOptions: { mode: timelineMode },
      });
      return next;
    });
    setDraggingEventId("");
    onStatus("已手动调整时间线顺序");
  }
  return { loadTimeline, moveTimelineEvent };
}
