// Extracted from src/App.tsx by the P3 refactor (cut-paste, no logic changes).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Lock, Plus, Save, Trash2, Unlock, X } from "lucide-react";
import type { AppState, BackgroundTask, ChapterPreparationBoard, ForeshadowItem, ForeshadowStatus, ProjectBranches, ProjectSnapshot, ProjectSnapshotComparison, StoryFact, StoryFactStatus, StoryOverview } from "../types";
import { formatDateTime, getErrorMessage } from "../lib/text-utils";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { CreativeWorkspace } from "../components/CreativeWorkspace";
import type { CreativeWorkspaceTab } from "../components/CreativeWorkspace";

type StoryCenterTab = "facts" | "characters" | "foreshadows" | "board" | "snapshots" | "workspace";

export function StoryCenterModal({
  state,
  selectedChapterId,
  selectedText,
  chapterRevision,
  initialTab = "facts",
  workspaceInitialTab = "planning",
  onClose,
  onOpenChapter,
  onOpenEvidence,
  onApplyState,
  onTaskCreated,
  onStatus,
}: {
  state: AppState;
  selectedChapterId: string;
  selectedText: string;
  chapterRevision: string;
  initialTab?: StoryCenterTab;
  workspaceInitialTab?: CreativeWorkspaceTab;
  onClose: () => void;
  onOpenChapter: (chapterId: string) => void;
  onOpenEvidence: (chapterId: string, quote: string) => void;
  onApplyState: (state: AppState) => void;
  onTaskCreated: (task: BackgroundTask) => void;
  onStatus: (message: string) => void;
}) {
  const dialogRef = useDialogFocus(onClose);
  const [tab, setTab] = useState<StoryCenterTab>(initialTab);
  const [overview, setOverview] = useState<StoryOverview | null>(null);
  const [board, setBoard] = useState<ChapterPreparationBoard | null>(null);
  const [snapshots, setSnapshots] = useState<ProjectSnapshot[]>([]);
  const [branches, setBranches] = useState<ProjectBranches | null>(null);
  const [snapshotComparison, setSnapshotComparison] = useState<ProjectSnapshotComparison | null>(null);
  const [snapshotRestorePaths, setSnapshotRestorePaths] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [factStatus, setFactStatus] = useState<StoryFactStatus | "全部">("全部");
  const [foreshadowStatus, setForeshadowStatus] = useState<ForeshadowStatus | "全部">("全部");
  const [volumeFilter, setVolumeFilter] = useState("全部");
  const [chapterFilter, setChapterFilter] = useState("全部");
  const [entryEditor, setEntryEditor] = useState<null | {
    kind: "fact" | "foreshadow";
    id?: string;
    chapterId: string;
    title: string;
    subject: string;
    type: string;
    detail: string;
    plannedPayoff: string;
    userNote: string;
  }>(null);
  const [busy, setBusy] = useState("");
  const [draggingBeatId, setDraggingBeatId] = useState("");
  const overviewRequestRef = useRef(0);
  const selectedChapter = state.chapters.find((chapter) => chapter.id === selectedChapterId) || state.chapters[0];

  useEffect(() => setTab(initialTab), [initialTab]);

  const loadOverview = useCallback(async () => {
    const requestId = ++overviewRequestRef.current;
    setBusy("overview");
    try {
      const result = await window.novelAPI.getStoryOverview({
        chapterIds: chapterFilter === "全部" ? [] : [chapterFilter],
        volume: volumeFilter === "全部" ? undefined : volumeFilter,
        query: query.trim(),
        factStatus: factStatus === "全部" ? undefined : factStatus,
        foreshadowStatus: foreshadowStatus === "全部" ? undefined : foreshadowStatus,
        factLimit: 100,
        characterLimit: 100,
        foreshadowLimit: 100,
      });
      if (requestId === overviewRequestRef.current) setOverview(result);
    } catch (error) {
      onStatus(`读取创作状态失败：${getErrorMessage(error)}`);
    } finally {
      if (requestId === overviewRequestRef.current) setBusy("");
    }
  }, [chapterFilter, factStatus, foreshadowStatus, onStatus, query, volumeFilter]);

  const loadBoard = useCallback(async () => {
    if (!selectedChapter?.id) return;
    const result = await window.novelAPI.getChapterBoard(selectedChapter.id);
    setBoard(result.board);
  }, [selectedChapter?.id]);

  const loadSnapshots = useCallback(async () => {
    const result = await window.novelAPI.listSnapshots();
    setSnapshots(result.snapshots);
    setBranches(result.branches);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOverview(), 180);
    return () => window.clearTimeout(timer);
  }, [loadOverview]);

  useEffect(() => {
    if (tab === "board") void loadBoard().catch((error) => onStatus(`读取筹备板失败：${getErrorMessage(error)}`));
    if (tab === "snapshots") void loadSnapshots().catch((error) => onStatus(`读取快照失败：${getErrorMessage(error)}`));
  }, [loadBoard, loadSnapshots, onStatus, tab]);

  const visibleFacts = overview?.facts || [];
  const volumes = useMemo(() => [...new Set(state.chapters.map((chapter) => chapter.volume || "未分卷"))], [state.chapters]);
  const filterChapters = useMemo(() => state.chapters.filter((chapter) => volumeFilter === "全部" || (chapter.volume || "未分卷") === volumeFilter), [state.chapters, volumeFilter]);

  async function runLocalAnalysis(chapterIds: string[]) {
    if (!chapterIds.length) {
      const result = await window.novelAPI.enqueueTask({
        type: "story-analysis",
        title: "本地更新全书创作状态",
        total: state.chapters.length,
        scope: { chapterIds: [] },
        options: { useAI: false },
      });
      onTaskCreated(result.task);
      onStatus("已加入后台任务：本地更新全书创作状态");
      return;
    }
    setBusy("local");
    try {
      await window.novelAPI.analyzeStoryLocally({ chapterIds });
      await loadOverview();
      onStatus(`本地创作状态已更新：${chapterIds.length ? "当前文档" : "全项目"}`);
    } catch (error) {
      onStatus(`更新创作状态失败：${getErrorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function enqueueDeepAnalysis(chapterIds: string[]) {
    const total = chapterIds.length || state.chapters.length;
    const result = await window.novelAPI.enqueueTask({
      type: "story-analysis",
      title: chapterIds.length === 1 ? `深度分析：${selectedChapter?.title || "当前文档"}` : "AI 深度整理全书创作状态",
      total,
      scope: { chapterIds },
      options: { useAI: true },
    });
    onTaskCreated(result.task);
    onStatus(`已加入后台任务：${result.task.title}`);
  }

  async function updateFactStatus(fact: StoryFact, status: StoryFactStatus) {
    const updated = await window.novelAPI.updateStoryFact({ factId: fact.id, patch: { status } });
    setOverview((current) => current ? { ...current, facts: current.facts.map((item) => item.id === updated.id ? updated : item) } : current);
  }

  async function updateForeshadowStatus(item: ForeshadowItem, status: ForeshadowStatus) {
    const updated = await window.novelAPI.updateForeshadow({ foreshadowId: item.id, patch: { status } });
    setOverview((current) => current ? { ...current, foreshadows: current.foreshadows.map((candidate) => candidate.id === updated.id ? updated : candidate) } : current);
  }

  function openEntryEditor(kind: "fact" | "foreshadow", item?: StoryFact | ForeshadowItem) {
    const chapterId = kind === "fact" && item ? (item as StoryFact).chapterId : kind === "foreshadow" && item ? (item as ForeshadowItem).plantedAt[0]?.chapterId : selectedChapter?.id;
    setEntryEditor({
      kind,
      id: item?.id,
      chapterId: chapterId || selectedChapter?.id || "",
      title: kind === "foreshadow" && item ? (item as ForeshadowItem).title : "",
      subject: kind === "fact" && item ? (item as StoryFact).subject : "",
      type: kind === "fact" && item ? (item as StoryFact).type : "剧情事件",
      detail: kind === "fact" && item ? (item as StoryFact).object : kind === "foreshadow" && item ? (item as ForeshadowItem).description : "",
      plannedPayoff: kind === "foreshadow" && item ? (item as ForeshadowItem).plannedPayoff || "" : "",
      userNote: item?.userNote || "",
    });
  }

  async function saveEntryEditor() {
    if (!entryEditor) return;
    setBusy("entry");
    try {
      if (entryEditor.kind === "fact") {
        if (entryEditor.id) {
          await window.novelAPI.updateStoryFact({ factId: entryEditor.id, patch: { subject: entryEditor.subject, type: entryEditor.type, predicate: entryEditor.type, object: entryEditor.detail, userNote: entryEditor.userNote } });
        } else {
          await window.novelAPI.createStoryFact({ chapterId: entryEditor.chapterId, subject: entryEditor.subject, type: entryEditor.type, predicate: entryEditor.type, object: entryEditor.detail, userNote: entryEditor.userNote });
        }
      } else if (entryEditor.id) {
        await window.novelAPI.updateForeshadow({ foreshadowId: entryEditor.id, patch: { title: entryEditor.title, description: entryEditor.detail, plannedPayoff: entryEditor.plannedPayoff, userNote: entryEditor.userNote } });
      } else {
        await window.novelAPI.createForeshadow({ chapterId: entryEditor.chapterId, title: entryEditor.title, description: entryEditor.detail, plannedPayoff: entryEditor.plannedPayoff, userNote: entryEditor.userNote });
      }
      setEntryEditor(null);
      await loadOverview();
      onStatus(entryEditor.id ? "创作状态记录已更新" : "已添加人工创作状态记录");
    } catch (error) {
      onStatus(`保存记录失败：${getErrorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function deleteManualEntry(kind: "fact" | "foreshadow", id: string) {
    if (!window.confirm("确定删除这条人工记录吗？")) return;
    try {
      if (kind === "fact") await window.novelAPI.deleteStoryFact(id);
      else await window.novelAPI.deleteForeshadow(id);
      await loadOverview();
      onStatus("人工记录已删除");
    } catch (error) {
      onStatus(`删除失败：${getErrorMessage(error)}`);
    }
  }

  async function loadMore(kind: "facts" | "characters" | "foreshadows") {
    if (!overview) return;
    const requestId = ++overviewRequestRef.current;
    const result = await window.novelAPI.getStoryOverview({
      chapterIds: chapterFilter === "全部" ? [] : [chapterFilter],
      volume: volumeFilter === "全部" ? undefined : volumeFilter,
      query: query.trim(),
      factStatus: factStatus === "全部" ? undefined : factStatus,
      foreshadowStatus: foreshadowStatus === "全部" ? undefined : foreshadowStatus,
      factOffset: kind === "facts" ? overview.facts.length : 0,
      characterOffset: kind === "characters" ? overview.characterStates.length : 0,
      foreshadowOffset: kind === "foreshadows" ? overview.foreshadows.length : 0,
      factLimit: kind === "facts" ? 100 : 20,
      characterLimit: kind === "characters" ? 100 : 20,
      foreshadowLimit: kind === "foreshadows" ? 100 : 20,
    });
    if (requestId !== overviewRequestRef.current) return;
    setOverview((current) => current ? {
      ...current,
      facts: kind === "facts" ? [...current.facts, ...result.facts] : current.facts,
      characterStates: kind === "characters" ? [...current.characterStates, ...result.characterStates] : current.characterStates,
      foreshadows: kind === "foreshadows" ? [...current.foreshadows, ...result.foreshadows] : current.foreshadows,
      pageInfo: { facts: kind === "facts" ? result.pageInfo!.facts : current.pageInfo!.facts, characters: kind === "characters" ? result.pageInfo!.characters : current.pageInfo!.characters, foreshadows: kind === "foreshadows" ? result.pageInfo!.foreshadows : current.pageInfo!.foreshadows },
    } : current);
  }

  async function updatePendingCoverage() {
    const chapterIds = [...new Set([...(overview?.coverage.missing || []), ...(overview?.coverage.stale || [])])];
    if (!chapterIds.length) return;
    const result = await window.novelAPI.enqueueTask({ type: "story-analysis", title: `更新 ${chapterIds.length} 个待处理文档`, total: chapterIds.length, scope: { chapterIds }, options: { useAI: false } });
    onTaskCreated(result.task);
    onStatus(`已在后台更新 ${chapterIds.length} 个缺失或过期文档`);
  }

  async function generateBoard() {
    if (!selectedChapter?.id) return;
    setBusy("board");
    try {
      const result = await window.novelAPI.generateChapterBoard({ chapterId: selectedChapter.id });
      setBoard(result.board);
      onStatus("已根据当前创作状态生成筹备板");
    } catch (error) {
      onStatus(`生成筹备板失败：${getErrorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function improveBoardWithAI() {
    if (!selectedChapter?.id) return;
    const result = await window.novelAPI.enqueueTask({
      type: "creative-board",
      title: `AI 完善筹备板：${selectedChapter.title}`,
      total: 3,
      scope: { chapterId: selectedChapter.id },
      options: { useAI: true },
    });
    onTaskCreated(result.task);
  }

  function patchBoardItem(itemId: string, patch: Partial<ChapterPreparationBoard["items"][number]>) {
    setBoard((current) => current ? { ...current, items: current.items.map((item) => item.id === itemId ? { ...item, ...patch } : item) } : current);
  }

  async function addCustomBoardItem() {
    if (!selectedChapter?.id) return;
    let current = board;
    if (!current) current = (await window.novelAPI.generateChapterBoard({ chapterId: selectedChapter.id })).board;
    const item = {
      id: `beat_manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: "自定义",
      title: "新的筹备项",
      detail: "",
      order: current.items.length,
      locked: true,
      completed: false,
      sourceRefs: [],
    };
    setBoard({ ...current, items: [...current.items, item] });
  }

  function moveBoardItem(targetId: string) {
    if (!board || !draggingBeatId || draggingBeatId === targetId) return;
    const items = [...board.items];
    const fromIndex = items.findIndex((item) => item.id === draggingBeatId);
    const targetIndex = items.findIndex((item) => item.id === targetId);
    if (fromIndex < 0 || targetIndex < 0) return;
    const [moved] = items.splice(fromIndex, 1);
    items.splice(targetIndex, 0, moved);
    setBoard({ ...board, items: items.map((item, index) => ({ ...item, order: index })) });
  }

  async function saveBoard() {
    if (!board) return;
    setBusy("save-board");
    try {
      setBoard((await window.novelAPI.saveChapterBoard({ board })).board);
      onStatus("下一章筹备板已保存");
    } finally {
      setBusy("");
    }
  }

  async function enqueueSnapshot() {
    const result = await window.novelAPI.enqueueTask({
      type: "snapshot",
      title: "手动项目快照",
      options: { name: `手动快照 ${new Date().toLocaleString("zh-CN")}`, reason: "用户手动创建" },
    });
    onTaskCreated(result.task);
  }

  async function restoreSnapshot(snapshot: ProjectSnapshot, paths: string[] = []) {
    try {
      setBusy("compare");
      const comparison = await window.novelAPI.compareSnapshot(snapshot.id);
      setSnapshotComparison(comparison);
      const changeSummary = `修改 ${comparison.changed.length} 个、新增 ${comparison.added.length} 个、当前缺失 ${comparison.missing.length} 个文件`;
      const partial = paths.length > 0;
      if (!window.confirm(partial ? `确定从“${snapshot.name}”恢复选中的 ${paths.length} 个文件吗？恢复前会自动创建安全快照，其他文件不变。` : `快照“${snapshot.name}”与当前项目相比：${changeSummary}。\n\n确定恢复吗？恢复前会自动创建安全快照，快照后新增的受管文件会被清理。`)) return;
      setBusy("restore");
      const result = await window.novelAPI.restoreSnapshot({ snapshotId: snapshot.id, paths });
      onTaskCreated(result.task);
      onApplyState(result.state);
      onStatus(partial ? `已从快照恢复 ${result.restored} 个文件，知识库正在后台重建` : `已恢复项目快照：${snapshot.name}；清理 ${result.removed} 个新增文件，知识库正在后台重建`);
      onClose();
    } catch (error) {
      onStatus(`恢复快照失败：${getErrorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function compareSnapshot(snapshot: ProjectSnapshot) {
    setBusy("compare");
    try {
      const comparison = await window.novelAPI.compareSnapshot(snapshot.id);
      setSnapshotComparison(comparison);
      setSnapshotRestorePaths([...comparison.changed, ...comparison.missing]);
    } catch (error) {
      onStatus(`比较快照失败：${getErrorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function compareBranch(snapshotId: string) {
    if (!snapshotId) return onStatus("这个分支还没有可比较的起点快照。");
    setBusy("compare");
    try {
      const comparison = await window.novelAPI.compareSnapshot(snapshotId);
      setSnapshotComparison(comparison);
      setSnapshotRestorePaths([...comparison.changed, ...comparison.missing]);
    } catch (error) {
      onStatus(`比较分支失败：${getErrorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function renameSnapshot(snapshot: ProjectSnapshot) {
    const name = window.prompt("输入新的快照名称", snapshot.name)?.trim();
    if (!name || name === snapshot.name) return;
    try {
      await window.novelAPI.renameSnapshot({ snapshotId: snapshot.id, name });
      await loadSnapshots();
      onStatus("快照已重命名");
    } catch (error) {
      onStatus(`重命名快照失败：${getErrorMessage(error)}`);
    }
  }

  async function deleteSnapshot(snapshot: ProjectSnapshot) {
    if (!window.confirm(`确定删除快照“${snapshot.name}”吗？被创作分支使用的快照不会被删除。`)) return;
    try {
      const result = await window.novelAPI.deleteSnapshot(snapshot.id);
      await loadSnapshots();
      setSnapshotComparison((current) => current?.snapshot.id === snapshot.id ? null : current);
      onStatus(`快照已删除，并清理 ${result.garbageCollection.removedObjects} 个不再使用的数据对象`);
    } catch (error) {
      onStatus(`删除快照失败：${getErrorMessage(error)}`);
    }
  }

  async function cleanupSnapshots() {
    try {
      const result = await window.novelAPI.cleanupSnapshots();
      onStatus(`快照存储清理完成：移除 ${result.removedObjects} 个无引用对象，释放 ${(result.removedBytes / 1024 / 1024).toFixed(1)} MB`);
    } catch (error) {
      onStatus(`清理快照存储失败：${getErrorMessage(error)}`);
    }
  }

  async function createBranch() {
    const name = window.prompt("输入实验分支名称", `实验分支 ${new Date().toLocaleDateString("zh-CN")}`)?.trim();
    if (!name) return;
    setBusy("branch");
    try {
      const result = await window.novelAPI.createBranch({ name });
      setBranches(result.branches);
      await loadSnapshots();
      onStatus(`已创建创作分支：${result.branch.name}`);
    } catch (error) {
      onStatus(`创建分支失败：${getErrorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function switchBranch(branchId: string) {
    const branch = branches?.branches.find((item) => item.id === branchId);
    if (!branch || branch.id === branches?.activeBranchId) return;
    if (!window.confirm(`切换到“${branch.name}”吗？当前分支会先自动创建快照。`)) return;
    setBusy("branch");
    try {
      const result = await window.novelAPI.switchBranch(branch.id);
      setBranches(result.branches);
      if (result.task) onTaskCreated(result.task);
      onApplyState(result.state);
      onStatus(`已切换创作分支：${result.activeBranch.name}；知识库正在后台重建`);
      onClose();
    } catch (error) {
      onStatus(`切换分支失败：${getErrorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function deleteBranch(branchId: string) {
    const branch = branches?.branches.find((item) => item.id === branchId);
    if (!branch || branch.id === "main" || branch.id === branches?.activeBranchId) return;
    if (!window.confirm(`确定删除实验分支“${branch.name}”吗？分支对应的快照仍会保留。`)) return;
    try {
      const result = await window.novelAPI.deleteBranch(branch.id);
      setBranches(result.branches);
      onStatus(`实验分支已删除：${branch.name}`);
    } catch (error) {
      onStatus(`删除分支失败：${getErrorMessage(error)}`);
    }
  }

  const tabs: Array<{ id: StoryCenterTab; label: string; count?: number }> = [
    { id: "facts", label: "剧情事实", count: overview?.counts.facts },
    { id: "characters", label: "角色状态", count: overview?.characterStates.length },
    { id: "foreshadows", label: "伏笔", count: overview?.counts.foreshadows },
    { id: "board", label: "下一章筹备", count: board?.items.length },
    { id: "snapshots", label: "快照与分支", count: snapshots.length },
    { id: "workspace", label: "创作工作台", count: (overview?.counts.boards || 0) + (overview?.counts.foreshadows || 0) },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section ref={dialogRef} className="story-center-modal" role="dialog" aria-modal="true" aria-label="创作状态" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <header className="story-center-header">
          <div><Activity size={18} /><strong>创作状态</strong></div>
          <div className="story-center-summary">
            <span>覆盖 {overview?.coverage.analyzed || 0}/{overview?.coverage.total || state.chapters.length}</span>
            {!!overview?.coverage.stale.length && <span className="warning">{overview.coverage.stale.length} 章待更新</span>}
            {!!overview?.coverage.missing.length && <span className="warning">{overview.coverage.missing.length} 章未整理</span>}
          </div>
          <button onClick={onClose} title="关闭"><X size={17} /></button>
        </header>
        <div className="story-center-tabs">
          {tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}{item.count !== undefined ? ` ${item.count}` : ""}</button>)}
        </div>
        {tab !== "workspace" && <div className="story-center-toolbar">
          <button onClick={() => void runLocalAnalysis(selectedChapter?.id ? [selectedChapter.id] : [])} disabled={Boolean(busy)}>更新当前文档</button>
          <button onClick={() => void enqueueDeepAnalysis(selectedChapter?.id ? [selectedChapter.id] : [])}>AI 深度分析当前文档</button>
          <details>
            <summary>全书操作</summary>
            <div>
              <button onClick={() => void runLocalAnalysis([])} disabled={Boolean(busy)}>本地更新全书</button>
              <button onClick={() => void enqueueDeepAnalysis([])}>AI 深度分析全书</button>
            </div>
          </details>
          {!!((overview?.coverage.stale.length || 0) + (overview?.coverage.missing.length || 0)) && <button onClick={() => void updatePendingCoverage()}>更新待处理文档</button>}
          {busy && <span>正在处理...</span>}
        </div>}
        <div className="story-center-body">
          {tab === "facts" && (
            <section className="story-facts-view">
              <div className="story-filter-row">
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索人物、事件或章节" />
                <select value={volumeFilter} onChange={(event) => { setVolumeFilter(event.target.value); setChapterFilter("全部"); }}><option value="全部">全部分卷</option>{volumes.map((volume) => <option key={volume}>{volume}</option>)}</select>
                <select value={chapterFilter} onChange={(event) => setChapterFilter(event.target.value)}><option value="全部">全部文档</option>{filterChapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select>
                <select value={factStatus} onChange={(event) => setFactStatus(event.target.value as StoryFactStatus | "全部")}>
                  <option value="全部">全部状态</option><option value="AI识别">AI识别</option><option value="已确认">已确认</option><option value="已忽略">已忽略</option>
                </select>
                <button onClick={() => openEntryEditor("fact")}><Plus size={14} />人工事实</button>
              </div>
              <div className="story-list">
                {visibleFacts.map((fact) => (
                  <article key={fact.id} className="story-row">
                    <div><strong>{fact.subject}</strong><span>{fact.type} / {fact.chapterTitle}{fact.stale ? " / 原文已变化，待核对" : ""}</span></div>
                    <p>{fact.object}</p>
                    {!!fact.evidence.length && <button className="evidence-link" onClick={() => fact.evidence[0].heading === "人工记录" ? onOpenChapter(fact.chapterId) : onOpenEvidence(fact.chapterId, fact.evidence[0].quote)} title={fact.evidence[0].quote}>{fact.evidence[0].heading === "人工记录" ? "打开关联文档" : `原文：${fact.evidence[0].quote}`}</button>}
                    <div className="story-row-actions">
                      <select value={fact.status} onChange={(event) => void updateFactStatus(fact, event.target.value as StoryFactStatus)}>
                        <option value="AI识别">AI识别</option><option value="已确认">已确认</option><option value="已忽略">已忽略</option>
                      </select>
                      <button onClick={() => openEntryEditor("fact", fact)}>编辑</button>
                      {fact.origin === "manual" && <button onClick={() => void deleteManualEntry("fact", fact.id)} title="删除人工事实"><Trash2 size={13} /></button>}
                    </div>
                  </article>
                ))}
                {!visibleFacts.length && <div className="analysis-empty">保存章节后会自动进行本地事实整理；AI 深度分析会补充更严格的证据。</div>}
                {(overview?.pageInfo?.facts.total || 0) > visibleFacts.length && <button className="story-load-more" onClick={() => void loadMore("facts")}>继续显示（{visibleFacts.length}/{overview?.pageInfo?.facts.total}）</button>}
              </div>
            </section>
          )}
          {tab === "characters" && (
            <section className="story-facts-view">
              <div className="story-filter-row compact-filter-row">
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索角色、地点、目标或知情内容" />
                <select value={volumeFilter} onChange={(event) => { setVolumeFilter(event.target.value); setChapterFilter("全部"); }}><option value="全部">全部分卷</option>{volumes.map((volume) => <option key={volume}>{volume}</option>)}</select>
                <select value={chapterFilter} onChange={(event) => setChapterFilter(event.target.value)}><option value="全部">全部文档</option>{filterChapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select>
              </div>
              <div className="story-list character-state-list">
                {(overview?.characterStates || []).map((record) => (
                  <details key={record.characterId} className="story-row">
                    <summary><strong>{record.characterName}</strong><span>{record.latest?.chapterTitle || "暂无状态"} / {record.latest?.location || "地点未记录"}</span></summary>
                    {record.states.slice().reverse().map((item) => (
                      <article key={item.id}>
                        <button title={`打开${item.chapterTitle}`} onClick={() => onOpenChapter(item.chapterId)}><span>{item.volume}</span><span>{item.chapterTitle}</span></button>
                        <p>目标：{item.goals.join("；") || "未记录"}</p>
                        <p>知情：{item.knowledge.join("；") || "未记录"}</p>
                        <p>持有：{item.possessions.join("；") || "未记录"}</p>
                      </article>
                    ))}
                  </details>
                ))}
                {!overview?.characterStates.length && <div className="analysis-empty">角色在正文中出现并保存后，这里会按章节记录位置、目标、知情范围和持有物品。</div>}
                {(overview?.pageInfo?.characters.total || 0) > (overview?.characterStates.length || 0) && <button className="story-load-more" onClick={() => void loadMore("characters")}>继续显示（{overview?.characterStates.length}/{overview?.pageInfo?.characters.total}）</button>}
              </div>
            </section>
          )}
          {tab === "foreshadows" && (
            <section className="story-facts-view">
              <div className="story-filter-row">
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索伏笔、计划或备注" />
                <select value={volumeFilter} onChange={(event) => { setVolumeFilter(event.target.value); setChapterFilter("全部"); }}><option value="全部">全部分卷</option>{volumes.map((volume) => <option key={volume}>{volume}</option>)}</select>
                <select value={chapterFilter} onChange={(event) => setChapterFilter(event.target.value)}><option value="全部">全部文档</option>{filterChapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select>
                <select value={foreshadowStatus} onChange={(event) => setForeshadowStatus(event.target.value as ForeshadowStatus | "全部")}><option value="全部">全部状态</option>{(["AI候选", "已确认埋下", "持续强化", "等待回收", "已经回收", "已废弃"] as ForeshadowStatus[]).map((status) => <option key={status}>{status}</option>)}</select>
                <button onClick={() => openEntryEditor("foreshadow")}><Plus size={14} />人工伏笔</button>
              </div>
              <div className="story-list">
              {(overview?.foreshadows || []).map((item) => (
                <article key={item.id} className="story-row foreshadow-row">
                  <div><strong>{item.title}</strong><span>{item.plantedAt[0]?.chapterTitle || "未关联章节"}{item.stale ? " / 待核对" : ""}</span></div>
                  <p>{item.description}</p>
                  {item.plannedPayoff && <em>计划回收：{item.plannedPayoff}</em>}
                  {!!item.plantedAt.length && <button className="evidence-link" title={item.plantedAt[0].quote} onClick={() => item.plantedAt[0].heading === "人工记录" ? onOpenChapter(item.plantedAt[0].chapterId) : onOpenEvidence(item.plantedAt[0].chapterId, item.plantedAt[0].quote)}>{item.plantedAt[0].heading === "人工记录" ? "打开关联文档" : "查看埋设原文"}</button>}
                  <div className="story-row-actions">
                    <select value={item.status} onChange={(event) => void updateForeshadowStatus(item, event.target.value as ForeshadowStatus)}>
                      {(["AI候选", "已确认埋下", "持续强化", "等待回收", "已经回收", "已废弃"] as ForeshadowStatus[]).map((status) => <option key={status}>{status}</option>)}
                    </select>
                    <button onClick={() => openEntryEditor("foreshadow", item)}>编辑</button>
                    {item.origin === "manual" && <button onClick={() => void deleteManualEntry("foreshadow", item.id)} title="删除人工伏笔"><Trash2 size={13} /></button>}
                  </div>
                </article>
              ))}
              {!overview?.foreshadows.length && <div className="analysis-empty">AI 或本地规则识别到的伏笔会先作为候选，不会自动认定为正式设定。</div>}
              {(overview?.pageInfo?.foreshadows.total || 0) > (overview?.foreshadows.length || 0) && <button className="story-load-more" onClick={() => void loadMore("foreshadows")}>继续显示（{overview?.foreshadows.length}/{overview?.pageInfo?.foreshadows.total}）</button>}
              </div>
            </section>
          )}
          {tab === "board" && (
            <section className="board-view">
              <header><div><strong>{selectedChapter?.title || "当前章节"}</strong><span>作为下一章筹备依据</span></div><div><button onClick={() => void generateBoard()} disabled={Boolean(busy)}>生成筹备板</button><button onClick={() => void addCustomBoardItem()}><Plus size={14} />自定义项</button><button onClick={() => void improveBoardWithAI()}>AI 完善</button><button className="primary" onClick={() => void saveBoard()} disabled={!board || Boolean(busy)}>保存筹备板</button></div></header>
              <div className="board-list">
                {(board?.items || []).map((item) => (
                  <article key={item.id} className={`board-item ${item.completed ? "completed" : ""}`} draggable onDragStart={() => setDraggingBeatId(item.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => moveBoardItem(item.id)} onDragEnd={() => setDraggingBeatId("")}>
                    <div className="board-item-main"><span>{item.order + 1}</span><input value={item.title} onChange={(event) => patchBoardItem(item.id, { title: event.target.value })} /><small>{item.type}</small></div>
                    <textarea value={item.detail} onChange={(event) => patchBoardItem(item.id, { detail: event.target.value })} />
                    {!!item.sourceRefs.length && <div className="board-source-refs">{item.sourceRefs.slice(0, 4).map((evidence, index) => <button key={`${evidence.chapterId}_${index}`} onClick={() => evidence.heading === "人工记录" ? onOpenChapter(evidence.chapterId) : onOpenEvidence(evidence.chapterId, evidence.quote)} title={evidence.quote}>{evidence.chapterTitle}</button>)}</div>}
                    <div className="board-item-actions">
                      <label><input type="checkbox" checked={item.completed} onChange={(event) => patchBoardItem(item.id, { completed: event.target.checked })} />完成</label>
                      <button onClick={() => patchBoardItem(item.id, { locked: !item.locked })} title={item.locked ? "解除锁定" : "锁定后重新生成时保留"}>{item.locked ? <Lock size={14} /> : <Unlock size={14} />}</button>
                      <button onClick={() => setBoard((current) => current ? { ...current, items: current.items.filter((candidate) => candidate.id !== item.id).map((candidate, index) => ({ ...candidate, order: index })) } : current)} title="删除筹备项"><Trash2 size={14} /></button>
                    </div>
                  </article>
                ))}
                {!board?.items.length && <div className="analysis-empty">筹备板用于安排目标、冲突、人物表现、信息释放、伏笔和结尾，不会直接改写正文。</div>}
              </div>
            </section>
          )}
          {tab === "snapshots" && (
            <section className="snapshot-view">
              <div className="snapshot-toolbar">
                <button onClick={() => void enqueueSnapshot()}>创建项目快照</button><button onClick={() => void createBranch()} disabled={Boolean(busy)}>创建实验分支</button><button onClick={() => void loadSnapshots()}>刷新</button><button onClick={() => void cleanupSnapshots()}>清理存储</button>
                <select value={branches?.activeBranchId || "main"} onChange={(event) => void switchBranch(event.target.value)}>
                  {(branches?.branches || []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.id === branches?.activeBranchId ? "（当前）" : ""}</option>)}
                </select>
              </div>
              <details className="branch-manager">
                <summary>管理创作分支（{branches?.branches.length || 0}）</summary>
                {(branches?.branches || []).map((branch) => <div key={branch.id}><span>{branch.name}{branch.id === branches?.activeBranchId ? "（当前）" : ""}</span><button onClick={() => void compareBranch(branch.snapshotId)} disabled={!branch.snapshotId || Boolean(busy)}>与当前比较</button>{branch.id !== "main" && branch.id !== branches?.activeBranchId && <button onClick={() => void deleteBranch(branch.id)} title="删除未使用的实验分支"><Trash2 size={13} /></button>}</div>)}
              </details>
              <div className="story-list">
                {snapshots.map((snapshot) => (
                  <article key={snapshot.id} className="story-row snapshot-row"><div><strong>{snapshot.name}</strong><span>{formatDateTime(snapshot.createdAt)} / {snapshot.fileCount} 个文件 / {(snapshot.totalBytes / 1024 / 1024).toFixed(1)} MB</span></div><p>{snapshot.reason}</p><div className="snapshot-actions"><button onClick={() => void compareSnapshot(snapshot)} disabled={Boolean(busy)}>比较</button><button onClick={() => void restoreSnapshot(snapshot)} disabled={Boolean(busy)}>恢复</button><button onClick={() => void renameSnapshot(snapshot)}>改名</button><button onClick={() => void deleteSnapshot(snapshot)} title="删除未被分支使用的快照"><Trash2 size={13} /></button></div></article>
                ))}
                {!snapshots.length && <div className="analysis-empty">快照按内容哈希去重；恢复前还会自动创建安全快照。</div>}
              </div>
              {snapshotComparison && (
                <div className="snapshot-comparison">
                  <header><strong>与“{snapshotComparison.snapshot.name}”比较</strong><button onClick={() => setSnapshotComparison(null)} title="关闭比较结果"><X size={14} /></button></header>
                  <div><span>已修改 {snapshotComparison.changed.length}</span><span>快照后新增 {snapshotComparison.added.length}</span><span>当前缺失 {snapshotComparison.missing.length}</span></div>
                  <details open={snapshotComparison.changed.length + snapshotComparison.added.length + snapshotComparison.missing.length <= 12}>
                    <summary>选择要恢复的文件</summary>
                    {[...snapshotComparison.changed.map((file) => ({ file, state: "已修改", restorable: true })), ...snapshotComparison.missing.map((file) => ({ file, state: "当前缺失", restorable: true })), ...snapshotComparison.added.map((file) => ({ file, state: "快照后新增", restorable: false }))].slice(0, 160).map((item) => <label key={`${item.state}_${item.file}`} className={!item.restorable ? "disabled" : ""}><input type="checkbox" disabled={!item.restorable} checked={item.restorable && snapshotRestorePaths.includes(item.file)} onChange={() => setSnapshotRestorePaths((current) => current.includes(item.file) ? current.filter((file) => file !== item.file) : [...current, item.file])} /><span>{item.state}</span><code>{item.file}</code></label>)}
                    {snapshotComparison.changed.length + snapshotComparison.added.length + snapshotComparison.missing.length > 160 && <small>仅显示前 160 项</small>}
                  </details>
                  <footer><button onClick={() => setSnapshotRestorePaths([...snapshotComparison.changed, ...snapshotComparison.missing])}>全选可恢复项</button><button onClick={() => setSnapshotRestorePaths([])}>清空</button><button className="primary" disabled={!snapshotRestorePaths.length || Boolean(busy)} onClick={() => void restoreSnapshot(snapshotComparison.snapshot, snapshotRestorePaths)}>恢复选中项</button></footer>
                </div>
              )}
            </section>
          )}
          {tab === "workspace" && (
            <CreativeWorkspace
              state={state}
              selectedChapterId={selectedChapterId}
              selectedText={selectedText}
              chapterRevision={chapterRevision}
              initialTab={workspaceInitialTab}
              onApplyState={onApplyState}
              onOpenChapter={onOpenChapter}
              onStatus={onStatus}
            />
          )}
        </div>
        {entryEditor && (
          <div className="story-entry-editor-backdrop" onClick={() => setEntryEditor(null)}>
            <form className="story-entry-editor" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void saveEntryEditor(); }}>
              <header><strong>{entryEditor.id ? "编辑" : "新增"}{entryEditor.kind === "fact" ? "剧情事实" : "伏笔"}</strong><button type="button" onClick={() => setEntryEditor(null)} title="关闭"><X size={15} /></button></header>
              {!entryEditor.id && <label><span>关联文档</span><select value={entryEditor.chapterId} onChange={(event) => setEntryEditor({ ...entryEditor, chapterId: event.target.value })}>{state.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.volume || "未分卷"} / {chapter.title}</option>)}</select></label>}
              {entryEditor.kind === "fact" ? <><label><span>主体</span><input value={entryEditor.subject} onChange={(event) => setEntryEditor({ ...entryEditor, subject: event.target.value })} placeholder="人物、势力或物品" /></label><label><span>类型</span><select value={entryEditor.type} onChange={(event) => setEntryEditor({ ...entryEditor, type: event.target.value })}>{["剧情事件", "地点变化", "物品变化", "知情变化", "关系变化", "状态变化"].map((type) => <option key={type}>{type}</option>)}</select></label></> : <label><span>标题</span><input value={entryEditor.title} onChange={(event) => setEntryEditor({ ...entryEditor, title: event.target.value })} /></label>}
              <label className="wide"><span>{entryEditor.kind === "fact" ? "事实内容" : "伏笔内容"}</span><textarea value={entryEditor.detail} onChange={(event) => setEntryEditor({ ...entryEditor, detail: event.target.value })} /></label>
              {entryEditor.kind === "foreshadow" && <label className="wide"><span>计划回收</span><textarea value={entryEditor.plannedPayoff} onChange={(event) => setEntryEditor({ ...entryEditor, plannedPayoff: event.target.value })} /></label>}
              <label className="wide"><span>作者备注</span><textarea value={entryEditor.userNote} onChange={(event) => setEntryEditor({ ...entryEditor, userNote: event.target.value })} /></label>
              <footer><button type="button" onClick={() => setEntryEditor(null)}>取消</button><button className="primary" type="submit" disabled={Boolean(busy)}><Save size={14} />保存</button></footer>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
