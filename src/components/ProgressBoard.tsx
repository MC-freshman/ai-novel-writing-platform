import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CheckSquare, ChevronDown, ChevronRight, Circle, Eye, EyeOff, MoveRight, Plus, RefreshCcw, RotateCcw, Sparkles, Square } from "lucide-react";
import type { AppState, Chapter, ChapterPreparationBoard, ChapterProgressStatus, ScenePlan } from "../types";

const PROGRESS_STATUSES: ChapterProgressStatus[] = ["计划中", "写作中", "已完成", "暂缓"];

const PILL_CLASS: Record<string, string> = {
  计划中: "plan",
  写作中: "writing",
  已完成: "done",
  暂缓: "paused",
};

export function deriveProgressStatus(chapter: Chapter, scenes: ScenePlan[]): { status: ChapterProgressStatus; manual: boolean } {
  if (chapter.progressStatus) return { status: chapter.progressStatus, manual: true };
  const chapterScenes = scenes.filter((scene) => scene.chapterId === chapter.id);
  if (chapterScenes.length > 0 && chapterScenes.every((scene) => scene.status === "已完成")) {
    return { status: "已完成", manual: false };
  }
  if ((chapter.wordCount || 0) > 0) return { status: "写作中", manual: false };
  return { status: "计划中", manual: false };
}

function ProgressPill({ status, onClick, title }: { status: string; onClick?: () => void; title?: string }) {
  const className = `progress-pill pill-${PILL_CLASS[status] || "plan"}`;
  return onClick ? (
    <button className={className} onClick={onClick} title={title}>
      {status}
    </button>
  ) : (
    <span className={className} title={title}>
      {status}
    </span>
  );
}

async function readWorkspaceData(): Promise<{ scenes: ScenePlan[]; boards: ChapterPreparationBoard[] }> {
  const [workspace, boardsResult] = await Promise.all([window.novelAPI.getCreativeWorkspace(), window.novelAPI.listChapterBoards()]);
  return { scenes: workspace.scenes || [], boards: boardsResult.boards || [] };
}

type CellContentLine = { key: string; title: string; done: boolean };

function cellContentLines(chapter: Chapter, scenes: ScenePlan[], boards: ChapterPreparationBoard[]): CellContentLine[] {
  const chapterScenes = scenes.filter((scene) => scene.chapterId === chapter.id);
  if (chapterScenes.length > 0) {
    return chapterScenes.map((scene) => ({ key: scene.id, title: scene.title, done: scene.status === "已完成" }));
  }
  const targeted = boards
    .filter((board) => board.targetChapterId === chapter.id)
    .sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
  if (targeted.length > 0) {
    return targeted[0].items.map((item) => ({ key: item.id, title: item.title, done: Boolean(item.completed) }));
  }
  const outline = chapter.outline || [];
  const subHeadings = outline.filter((item) => item.level > 1);
  const lines = (subHeadings.length > 0 ? subHeadings : outline.slice(1)).map((item) => ({ key: item.id, title: item.title, done: true }));
  return lines;
}

export function ProgressGrid({
  state,
  selectedChapterId,
  onSelectChapter,
  onApplyState,
  onStatus,
}: {
  state: AppState;
  selectedChapterId: string;
  onSelectChapter: (chapterId: string) => void;
  onApplyState: (state: AppState) => void;
  onStatus: (message: string) => void;
}) {
  const [scenes, setScenes] = useState<ScenePlan[]>([]);
  const [boards, setBoards] = useState<ChapterPreparationBoard[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [dense, setDense] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(() => localStorage.getItem("progressHideCompleted") === "1");
  const [hiddenVolumes, setHiddenVolumes] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("progressHiddenVolumes") || "[]");
    } catch {
      return [];
    }
  });
  const [showHiddenList, setShowHiddenList] = useState(false);

  const toggleHideCompleted = () => {
    setHideCompleted((value) => {
      localStorage.setItem("progressHideCompleted", value ? "0" : "1");
      return !value;
    });
  };

  const toggleVolumeHidden = (volume: string) => {
    setHiddenVolumes((current) => {
      const next = current.includes(volume) ? current.filter((item) => item !== volume) : [...current, volume];
      localStorage.setItem("progressHiddenVolumes", JSON.stringify(next));
      return next;
    });
  };

  const addChapterToVolume = useCallback(
    async (volume: string) => {
      const title = window.prompt(`在「${volume}」新建章节，标题：`, "新章节");
      if (title === null) return;
      try {
        const next = await window.novelAPI.createChapter({ title: title.trim() || "新章节", volume });
        onApplyState(next);
        onStatus(`已在「${volume}」新建《${title.trim() || "新章节"}》`);
      } catch (error) {
        onStatus(`新建章节失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [onApplyState, onStatus],
  );

  const reload = useCallback(async () => {
    try {
      const data = await readWorkspaceData();
      setScenes(data.scenes);
      setBoards(data.boards);
    } catch {
      // 场景/筹备读取失败时网格仍显示状态与字数。
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await reload();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [state.chapters, reload]);

  const volumes = useMemo(() => {
    const map = new Map<string, Chapter[]>();
    for (const chapter of [...state.chapters].sort((a, b) => a.order - b.order)) {
      const volume = chapter.volume || "未分卷";
      const bucket = map.get(volume);
      if (bucket) bucket.push(chapter);
      else map.set(volume, [chapter]);
    }
    return [...map.entries()];
  }, [state.chapters]);

  const orderedChapters = useMemo(() => [...state.chapters].sort((a, b) => a.order - b.order), [state.chapters]);

  const targetedBoardIds = useMemo(() => new Set(boards.map((board) => board.targetChapterId).filter(Boolean)), [boards]);

  const applyUpdates = useCallback(
    async (updates: Array<{ chapterId: string; status: string | null; note?: string; hidden?: boolean }>, message: string) => {
      try {
        const next = await window.novelAPI.setChapterProgress({ updates, selectedChapterId });
        onApplyState(next);
        onStatus(message);
      } catch (error) {
        onStatus(`更新进度失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [onApplyState, onStatus, selectedChapterId],
  );

  const hideChapter = useCallback(
    (chapter: Chapter) => {
      void applyUpdates([{ chapterId: chapter.id, status: chapter.progressStatus || null, hidden: true }], `《${chapter.title}》已移出进度表（文件保留）`);
    },
    [applyUpdates],
  );

  const restoreChapter = useCallback(
    (chapter: Chapter) => {
      void applyUpdates([{ chapterId: chapter.id, status: chapter.progressStatus || null, hidden: false }], `《${chapter.title}》已恢复显示`);
    },
    [applyUpdates],
  );

  const cycleStatus = useCallback(
    (chapter: Chapter) => {
      const current = deriveProgressStatus(chapter, scenes).status;
      const next = PROGRESS_STATUSES[(PROGRESS_STATUSES.indexOf(current) + 1) % PROGRESS_STATUSES.length];
      void applyUpdates([{ chapterId: chapter.id, status: next }], `《${chapter.title}》已标记为「${next}」`);
    },
    [applyUpdates, scenes],
  );

  const editNote = useCallback(
    (chapter: Chapter) => {
      const note = window.prompt(`给《${chapter.title}》写一句进度备注（留空清除）：`, chapter.progressNote || "");
      if (note === null) return;
      void applyUpdates([{ chapterId: chapter.id, status: chapter.progressStatus || null, note }], note ? "进度备注已保存" : "进度备注已清除");
    },
    [applyUpdates],
  );

  const toggleSelected = useCallback((chapterId: string) => {
    setSelectedIds((current) => (current.includes(chapterId) ? current.filter((id) => id !== chapterId) : [...current, chapterId]));
  }, []);

  const batchSet = useCallback(
    (status: string | null) => {
      if (!selectedIds.length) return;
      const label = status ? `「${status}」` : "自动推导";
      void applyUpdates(selectedIds.map((chapterId) => ({ chapterId, status })), `已把 ${selectedIds.length} 章批量设为${label}`);
      setSelectedIds([]);
    },
    [applyUpdates, selectedIds],
  );

  const generateBoard = useCallback(
    async (chapter: Chapter) => {
      const index = orderedChapters.findIndex((item) => item.id === chapter.id);
      const previous = orderedChapters[index - 1];
      if (!previous) {
        onStatus("本章是第一个文档，没有可依据的上文；筹备板由上一章生成。");
        return;
      }
      try {
        await window.novelAPI.generateChapterBoard({ chapterId: previous.id });
        const data = await readWorkspaceData();
        setScenes(data.scenes);
        setBoards(data.boards);
        onStatus(`已根据《${previous.title}》生成本章筹备板，可在格子里查看要点。`);
      } catch (error) {
        onStatus(`生成筹备板失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [onStatus, orderedChapters],
  );

  return (
    <div className="analysis-section progress-board">
      <div className="progress-toolbar">
        <div className="progress-toolbar-actions">
        <button className={batchMode ? "active" : ""} onClick={() => (setBatchMode((value) => !value), setSelectedIds([]))}>
          <CheckSquare size={15} />
          批量标记
        </button>
        <button className={dense ? "" : "active"} onClick={() => setDense((value) => !value)} title="内容模式显示每章的场景/筹备要点/大纲标题">
          {dense ? "紧凑" : "内容"}
        </button>
        <button className={hideCompleted ? "active" : ""} onClick={toggleHideCompleted} title="把已完成的章从网格里隐藏（只影响本视图，不删除文件）">
          <EyeOff size={15} />
          隐藏已完成
        </button>
        {state.chapters.some((chapter) => chapter.progressHidden) && (
          <button className={showHiddenList ? "active" : ""} onClick={() => setShowHiddenList((value) => !value)}>
            已移出 {state.chapters.filter((chapter) => chapter.progressHidden).length} 章
          </button>
        )}
        {hiddenVolumes.map((volume) => (
          <button key={volume} className="active" onClick={() => toggleVolumeHidden(volume)} title="恢复显示本卷">
            <Eye size={15} />
            {volume}
          </button>
        ))}
        {batchMode && (
          <>
            <span className="progress-toolbar-hint">已选 {selectedIds.length} 章：</span>
            {PROGRESS_STATUSES.map((status) => (
              <button key={status} disabled={!selectedIds.length} onClick={() => batchSet(status)}>
                设为{status}
              </button>
            ))}
            <button disabled={!selectedIds.length} onClick={() => batchSet(null)} title="清除手动标记，恢复自动推导">
              恢复自动
            </button>
          </>
        )}
        <button
          onClick={() => {
            setLoaded(false);
            void reload();
          }}
          title="重新读取场景与筹备板"
        >
          <RefreshCcw size={15} />
          刷新
        </button>
        </div>
        <p className="progress-toolbar-help">点状态标签切换进度，双击格子写备注。未手动标记时，按场景和字数自动推导。</p>
      </div>

      {!loaded && <div className="analysis-empty">正在读取创作工作台的场景规划...</div>}

      {showHiddenList && (
        <div className="progress-hidden-list">
          <div className="progress-hidden-head">以下章节只是从进度表移出显示，原文件都在：</div>
          {state.chapters
            .filter((chapter) => chapter.progressHidden)
            .map((chapter) => (
              <div className="progress-hidden-row" key={chapter.id}>
                <span title={chapter.title}>{chapter.title}</span>
                <span className="progress-hidden-volume">{chapter.volume || "未分卷"}</span>
                <button onClick={() => restoreChapter(chapter)}>
                  <RotateCcw size={13} />
                  恢复显示
                </button>
              </div>
            ))}
        </div>
      )}

      {loaded &&
        volumes.map(([volume, chapters]) => {
          if (hiddenVolumes.includes(volume)) return null;
          const visible = chapters.filter((chapter) => {
            if (chapter.progressHidden) return false;
            if (hideCompleted && deriveProgressStatus(chapter, scenes).status === "已完成") return false;
            return true;
          });
          const counts: Record<ChapterProgressStatus, number> = { 计划中: 0, 写作中: 0, 已完成: 0, 暂缓: 0 };
          for (const chapter of visible) counts[deriveProgressStatus(chapter, scenes).status] += 1;
          const allSelected = visible.length > 0 && visible.every((chapter) => selectedIds.includes(chapter.id));
          const summaryScope = hideCompleted || chapters.some((chapter) => chapter.progressHidden) ? `（显示 ${visible.length}/${chapters.length}）` : "";
          return (
            <div className="progress-volume" key={volume}>
              <div className="progress-volume-head">
                <div className="progress-volume-info">
                {batchMode && (
                  <button
                    onClick={() =>
                      setSelectedIds((current) =>
                        allSelected ? current.filter((id) => !visible.some((chapter) => chapter.id === id)) : [...new Set([...current, ...visible.map((chapter) => chapter.id)])],
                      )
                    }
                    title={allSelected ? "取消全选本卷" : "全选本卷"}
                  >
                    {allSelected ? <CheckSquare size={15} /> : <Square size={15} />}
                  </button>
                )}
                <div className="progress-volume-copy">
                <strong title={volume}>{volume}</strong>
                <span className="progress-volume-sum">
                  {visible.length} 章 · 已完成 {counts["已完成"]} · 写作中 {counts["写作中"]} · 计划中 {counts["计划中"]}
                  {counts["暂缓"] ? ` · 暂缓 ${counts["暂缓"]}` : ""}
                  {summaryScope && <span className="progress-volume-filtered"> {summaryScope}</span>}
                </span>
                </div>
                </div>
                <div className="progress-volume-controls">
                <span className="progress-volume-bar" role="progressbar" aria-label={`${volume}完成进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={visible.length ? Math.round((counts["已完成"] / visible.length) * 100) : 0}>
                  <span style={{ width: `${visible.length ? Math.round((counts["已完成"] / visible.length) * 100) : 0}%` }} />
                </span>
                <button className="progress-volume-action" onClick={() => toggleVolumeHidden(volume)} title={hiddenVolumes.includes(volume) ? "在进度表显示本卷" : "整个卷暂时隐藏（不删除文件）"}>
                  <EyeOff size={14} />
                </button>
                <button className="progress-volume-action" onClick={() => void addChapterToVolume(volume)} title={`在「${volume}」新建章节`}>
                  <Plus size={14} />
                </button>
                </div>
              </div>
              <div className="progress-cells">
                {visible.map((chapter) => {
                  const derived = deriveProgressStatus(chapter, scenes);
                  const chapterScenes = scenes.filter((scene) => scene.chapterId === chapter.id);
                  const doneScenes = chapterScenes.filter((scene) => scene.status === "已完成").length;
                  const warn = derived.status === "已完成" && derived.manual && (chapter.wordCount || 0) === 0;
                  const selected = selectedIds.includes(chapter.id);
                  const lines = dense ? [] : cellContentLines(chapter, scenes, boards);
                  const orderedIndex = orderedChapters.findIndex((item) => item.id === chapter.id);
                  const canGenerateBoard = orderedIndex > 0 && !targetedBoardIds.has(chapter.id);
                  return (
                    <div
                      key={chapter.id}
                      className={`progress-cell ${selected ? "selected" : ""} ${chapter.id === selectedChapterId ? "current" : ""} ${warn ? "warn" : ""}`}
                      onDoubleClick={() => editNote(chapter)}
                    >
                      <div className="progress-cell-top">
                        {batchMode && (
                          <button onClick={() => toggleSelected(chapter.id)} title={selected ? "取消选择" : "选择"}>
                            {selected ? <CheckSquare size={14} /> : <Square size={14} />}
                          </button>
                        )}
                        <button className="progress-title" onClick={() => onSelectChapter(chapter.id)} title={`打开《${chapter.title}》`}>
                          {chapter.title}
                        </button>
                        <button className="progress-cell-hide" onClick={() => hideChapter(chapter)} title="移出进度表（不删除文件，可在“已移出”里恢复）">
                          <EyeOff size={13} />
                        </button>
                      </div>
                      <div className="progress-meta">
                        <ProgressPill status={derived.status} onClick={() => cycleStatus(chapter)} title="点击切换状态" />
                        <span>{(chapter.wordCount || 0).toLocaleString()}字</span>
                        {chapterScenes.length > 0 && (
                          <span>
                            场景 {doneScenes}/{chapterScenes.length}
                          </span>
                        )}
                        {derived.manual && <span className="progress-manual">手动</span>}
                      </div>
                      {!dense && (
                        <div className="progress-content">
                          {lines.slice(0, 3).map((line) => (
                            <div className="progress-content-line" key={line.key}>
                              <span className={`progress-dot ${line.done ? "done" : "todo"}`} />
                              <span title={line.title}>{line.title}</span>
                            </div>
                          ))}
                          {lines.length > 3 && <div className="progress-more">还有 {lines.length - 3} 条…</div>}
                          {!lines.length && <div className="progress-empty-hint">暂无内容规划：可在“创作状态 → 规划”添加场景，或点下方按钮生成筹备。</div>}
                          {canGenerateBoard && (
                            <button className="progress-generate" onClick={() => void generateBoard(chapter)} title="按上一章剧情本地生成要点，不调用 AI">
                              <Sparkles size={12} />
                              生成本章筹备
                            </button>
                          )}
                        </div>
                      )}
                      {warn && <div className="progress-warn">标记已完成但正文为空</div>}
                      {chapter.progressNote && (
                        <div className="progress-note" title={chapter.progressNote}>
                          {chapter.progressNote}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

      {loaded && !state.chapters.length && <div className="analysis-empty">还没有任何文档。先在“章节”页新建或导入文档。</div>}
    </div>
  );
}

export function ChapterProgressStrip({
  chapter,
  onApplyState,
  onStatus,
}: {
  chapter: Chapter;
  onApplyState: (state: AppState) => void;
  onStatus: (message: string) => void;
}) {
  const [open, setOpen] = useState(() => localStorage.getItem("progressStripOpen") === "1");
  const [scenes, setScenes] = useState<ScenePlan[]>([]);
  const [board, setBoard] = useState<ChapterPreparationBoard | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await readWorkspaceData();
        if (cancelled) return;
        setScenes(data.scenes.filter((scene) => scene.chapterId === chapter.id));
        const targeted = data.boards
          .filter((item) => item.targetChapterId === chapter.id)
          .sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
        setBoard(targeted[0] || null);
      } catch {
        // 迷你条是辅助信息，读取失败保持空态即可。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chapter.id]);

  const derived = deriveProgressStatus(chapter, scenes);
  const boardItems = board?.items || [];

  const taskItems = useMemo(() => {
    const base = scenes.length > 0
      ? scenes.map((scene) => ({
          key: scene.id,
          title: scene.title,
          detail: [scene.pov, scene.location, scene.time].filter(Boolean).join(" / "),
          done: scene.status === "已完成",
        }))
      : boardItems.map((item) => ({
          key: item.id,
          title: item.title,
          detail: item.detail || "",
          done: Boolean(item.completed),
        }));
    return base;
  }, [scenes, boardItems]);
  const doneCount = taskItems.filter((item) => item.done).length;
  const currentIndex = taskItems.findIndex((item) => !item.done);

  const toggleScene = (scene: ScenePlan) => {
    const nextStatus = scene.status === "已完成" ? "写作中" : "已完成";
    void window.novelAPI
      .upsertCreativeWorkspaceItem({ collection: "scenes", item: { ...scene, status: nextStatus } })
      .then((result) => {
        setScenes((result.workspace.scenes || []).filter((item) => item.chapterId === chapter.id));
        onStatus(`场景「${scene.title}」已标记为${nextStatus}`);
      })
      .catch((error) => onStatus(`更新场景失败：${error instanceof Error ? error.message : String(error)}`));
  };

  const toggleBoardItem = (item: { id: string; completed?: boolean; title: string }) => {
    if (!board) return;
    const items = board.items.map((entry) => (entry.id === item.id ? { ...entry, completed: !entry.completed } : entry));
    void window.novelAPI
      .saveChapterBoard({ board: { ...board, items } })
      .then((result) => {
        setBoard(result.board);
        onStatus(`筹备项「${item.title}」已${!item.completed ? "完成" : "取消完成"}`);
      })
      .catch((error) => onStatus(`更新筹备板失败：${error instanceof Error ? error.message : String(error)}`));
  };

  const toggleOpen = () => {
    setOpen((value) => {
      localStorage.setItem("progressStripOpen", value ? "0" : "1");
      return !value;
    });
  };

  const setStatus = (status: ChapterProgressStatus | null) => {
    void window.novelAPI
      .setChapterProgress({ updates: [{ chapterId: chapter.id, status }], selectedChapterId: chapter.id })
      .then((next) => {
        onApplyState(next);
        onStatus(status ? `本章已标记为「${status}」` : "已恢复自动推导");
      })
      .catch((error) => onStatus(`更新进度失败：${error instanceof Error ? error.message : String(error)}`));
  };

  return (
    <div className={`progress-strip ${open ? "open" : ""}`}>
      <div className="progress-strip-head">
        <button className="progress-strip-toggle" aria-expanded={open} onClick={toggleOpen} title={open ? "收起" : "展开本章任务清单"}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <ProgressPill status={derived.status} />
          <strong title={chapter.title}>{chapter.title}</strong>
          <span className="progress-strip-sum">
            {(chapter.wordCount || 0).toLocaleString()}字
            {taskItems.length > 0 && ` · 任务 ${doneCount}/${taskItems.length}`}
            {derived.manual && " · 手动"}
          </span>
          {!open && currentIndex >= 0 && taskItems[currentIndex] && <span className="progress-strip-next">当前：{taskItems[currentIndex].title}</span>}
        </button>
        <div className="progress-strip-actions">
          {PROGRESS_STATUSES.map((status) => (
            <button key={status} className={derived.manual && derived.status === status ? "active" : ""} onClick={() => setStatus(status)}>
              {status}
            </button>
          ))}
          <button onClick={() => setStatus(null)} title="清除手动标记，恢复自动推导">
            自动
          </button>
        </div>
      </div>
      {open && (
        <div className="progress-strip-body">
          {taskItems.length === 0 && (
            <div className="progress-strip-empty">本章还没有任务清单：可在“创作状态 → 规划”里添加场景，或在分析页“进度”表为它生成筹备。</div>
          )}
          {taskItems.map((item, index) => (
            <div className={`progress-task ${item.done ? "done" : ""} ${index === currentIndex ? "current" : ""}`} key={item.key}>
              <button
                className="progress-task-check"
                onClick={() => (scenes.length > 0 ? toggleScene(scenes.find((scene) => scene.id === item.key)!) : toggleBoardItem({ id: item.key, completed: item.done, title: item.title }))}
                title={item.done ? "标记为未完成" : "标记为已完成"}
              >
                {item.done ? <Check size={13} /> : index === currentIndex ? <MoveRight size={13} /> : <Circle size={13} />}
              </button>
              <span className="progress-task-title" title={item.title}>{item.title}</span>
              {item.detail && <span className="progress-task-meta">{item.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
