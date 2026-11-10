import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState, CreativeWorkspaceState } from "../../types";
import type { PageSaveHandle, PageSaveKind } from "../../hooks/useEntityDraft";
import { ProgressGrid } from "./ProgressBoard";
import { NovelNetworks } from "./NovelNetworks";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { ProgressGrids } from "./ProgressGrids";
import { describeMindMapModuleProblem } from "../../modules/mindmap/contract";
import { setMindMapModuleUnloadGuard, useMindMapModule } from "../../modules/mindmap/registry";

type ProgressMode = "chapters" | "network" | "mindmap" | "grid";

export function ProgressWorkspace({ state, selectedChapterId, onSelectChapter, onApplyState, onStatus, onRegisterSave, networkOpenRequest, progressOpenRequest, progressOpenMode }: {
  state: AppState; selectedChapterId: string; onSelectChapter: (id: string) => void;
  onApplyState: (state: AppState) => void; onStatus: (message: string) => void;
  onRegisterSave: (kind: PageSaveKind, handle: PageSaveHandle | null) => void;
  networkOpenRequest: number;
  progressOpenRequest: number;
  progressOpenMode: ProgressMode | "";
}) {
  const [mode, setMode] = useState<ProgressMode>(progressOpenRequest && progressOpenMode ? progressOpenMode : networkOpenRequest ? "network" : "chapters");
  const [expanded, setExpanded] = useState(false);
  const [mindmapModal, setMindmapModal] = useState(false);
  // 弹窗窗口：最大化状态与标题栏拖动偏移。默认由 .modal-backdrop 居中，transform 只做相对位移。
  const [maximized, setMaximized] = useState(false);
  const [modalShift, setModalShift] = useState({ x: 0, y: 0 });
  const [workspace, setWorkspace] = useState<CreativeWorkspaceState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const saver = useRef<PageSaveHandle | null>(null);
  // 弹窗内的连线模式由 MindMaps 同步过来：激活时 Esc 先用于取消连线，不再关闭整个弹窗。
  const relationModeRef = useRef(false);
  const modalDrag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const register = useCallback((kind: PageSaveKind, handle: PageSaveHandle | null) => {
    saver.current = handle; onRegisterSave(kind, handle);
  }, [onRegisterSave]);

  useEffect(() => {
    if (networkOpenRequest) setMode("network");
  }, [networkOpenRequest]);

  useEffect(() => {
    if (progressOpenRequest && progressOpenMode) setMode(progressOpenMode);
  }, [progressOpenMode, progressOpenRequest]);

  useEffect(() => {
    let cancelled = false;
    setLoadError("");
    void window.novelAPI.getCreativeWorkspace().then((value) => {
      if (!cancelled) setWorkspace(value);
    }).catch((error) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [state.projectPath, reload]);

  const protectCurrent = useCallback(async () => {
    if (saver.current && !(await saver.current.protect())) {
      onStatus("当前规划草稿尚未保存，请先保存后再切换。");
      return false;
    }
    return true;
  }, [onStatus]);

  async function changeMode(next: ProgressMode) {
    if (next === mode) return;
    if (!(await protectCurrent())) return;
    setMode(next);
    setMindmapModal(false);
    if (next === "chapters") setExpanded(false);
  }

  async function openMindmapModal() {
    if (!(await protectCurrent())) return;
    setExpanded(false);
    setMaximized(false);
    setModalShift({ x: 0, y: 0 });
    setMindmapModal(true);
  }

  async function closeMindmapModal() {
    if (!(await protectCurrent())) return;
    setMindmapModal(false);
    setMaximized(false);
    setModalShift({ x: 0, y: 0 });
  }

  // 标题栏拖动：起点 + 鼠标位移换算成窗口偏移，限制在视口内，避免窗口被拖出屏幕找不回来。
  useEffect(() => {
    if (!mindmapModal || maximized) return;
    const onMove = (event: MouseEvent) => {
      const drag = modalDrag.current;
      if (!drag) return;
      const limitX = Math.max(120, window.innerWidth / 2 - 160);
      const limitY = Math.max(120, window.innerHeight / 2 - 160);
      setModalShift({
        x: Math.max(-limitX, Math.min(limitX, drag.originX + event.clientX - drag.startX)),
        y: Math.max(-limitY, Math.min(limitY, drag.originY + event.clientY - drag.startY)),
      });
    };
    const onUp = () => { modalDrag.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [mindmapModal, maximized]);

  const mindMapModule = useMindMapModule();
  const mindMapEnabled = state.config.ui.mindMapEnabled !== false;
  const mindMapProblem = !mindMapEnabled
    ? "思维导图模块已停用；导图数据保留，可在设置中重新启用。正文和其他规划功能不受影响。"
    : mindMapModule
      ? describeMindMapModuleProblem(mindMapModule)
      : "思维导图模块未安装；正文和其他规划功能不受影响。";

  useEffect(() => {
    if (!mindMapModule) {
      setMindMapModuleUnloadGuard(null);
      return;
    }
    setMindMapModuleUnloadGuard(() => protectCurrent());
    return () => setMindMapModuleUnloadGuard(null);
  }, [mindMapModule, protectCurrent]);

  const mindMapDialogRef = useDialogFocus(
    () => { void closeMindmapModal(); },
    mindmapModal,
    (event) => {
      const tag = (event.target as HTMLElement)?.tagName || "";
      return !["INPUT", "TEXTAREA", "SELECT"].includes(tag) && !relationModeRef.current;
    },
  );

  const canExpand = mode !== "chapters" && !mindmapModal;
  const boardProps = workspace ? { workspace, onWorkspace: setWorkspace, onRegisterSave: register, onStatus } : null;
  const mindMaps = (fullscreen: boolean, onRelationModeChange?: (active: boolean) => void) => boardProps && (mindMapModule && !mindMapProblem
    ? <mindMapModule.Component
        workspace={boardProps.workspace} onWorkspace={boardProps.onWorkspace}
        onRegisterSave={register} onStatus={onStatus} fullscreen={fullscreen}
        onRelationModeChange={onRelationModeChange} />
    : <div className="analysis-empty mind-map-module-unavailable" role="status">{mindMapProblem}</div>);

  return <div className={`progress-workspace ${expanded ? "expanded" : ""}`}>
    <div className="progress-workspace-modes">
      <button className={mode === "chapters" ? "active" : ""} onClick={() => void changeMode("chapters")}>章节进度</button>
      <button className={mode === "network" ? "active" : ""} onClick={() => void changeMode("network")}>小说统筹网</button>
      <button className={mode === "mindmap" ? "active" : ""} onClick={() => void changeMode("mindmap")}>思维导图</button>
      <button className={mode === "grid" ? "active" : ""} onClick={() => void changeMode("grid")}>进度网格</button>
      {mode === "mindmap" && mindMapEnabled && boardProps && !mindmapModal && !mindMapProblem && <button title="在独立弹窗中放大画布" onClick={() => void openMindmapModal()}>弹窗编辑</button>}
      {canExpand && <button title="调整编辑区域" onClick={() => setExpanded((value) => !value)}>{expanded ? "收起编辑区" : "展开编辑区"}</button>}
      {mode !== "chapters" && <button title="重新读取项目里的规划数据（含外部 MCP 写入）" onClick={() => setReload((value) => value + 1)}>刷新规划数据</button>}
    </div>
    {mode === "chapters" ? <ProgressGrid state={state} selectedChapterId={selectedChapterId} onSelectChapter={onSelectChapter} onApplyState={onApplyState} onStatus={onStatus} /> :
      !boardProps ? <div className="analysis-empty">{loadError ? <><p>规划数据读取失败：{loadError}</p><button onClick={() => setReload((value) => value + 1)}>重试读取</button></> : "正在读取规划数据…"}</div> :
        mode === "network" ? <NovelNetworks state={state} workspace={boardProps.workspace} onWorkspace={boardProps.onWorkspace} onRegisterSave={register} onOpenChapter={onSelectChapter} onStatus={onStatus} /> :
          mode === "mindmap" ? (mindmapModal ? null : mindMaps(false)) :
            <ProgressGrids state={state} workspace={boardProps.workspace} onWorkspace={boardProps.onWorkspace} onRegisterSave={register} onOpenChapter={onSelectChapter} onStatus={onStatus} />}

    {mindmapModal && boardProps && <div className={`modal-backdrop ${maximized ? "modal-maximized" : ""}`} onClick={() => void closeMindmapModal()}>
      <section ref={mindMapDialogRef} className={`mind-map-modal modal-surface ${maximized ? "maximized" : ""}`} role="dialog" aria-modal="true" aria-label="思维导图弹窗编辑" tabIndex={-1}
        style={maximized ? undefined : { transform: `translate(${modalShift.x}px, ${modalShift.y}px)` }}
        onClick={(event) => event.stopPropagation()}>
        <header className="mind-map-modal-header"
          onMouseDown={(event) => {
            if (maximized) return;
            if ((event.target as HTMLElement).closest("button, input, select, textarea")) return;
            modalDrag.current = { startX: event.clientX, startY: event.clientY, originX: modalShift.x, originY: modalShift.y };
          }}>
          <strong>思维导图 · 弹窗编辑</strong>
          <span>拖动标题栏移动 · 右下角调整尺寸 · 可切换全屏 · 按 Esc 返回</span>
          <button className="mind-map-modal-close" autoFocus aria-label="关闭思维导图弹窗" onClick={() => void closeMindmapModal()}>关闭弹窗</button>
          <button className="mind-map-modal-maximize" aria-label={maximized ? "还原窗口" : "最大化窗口"}
            onClick={() => { setMaximized((value) => !value); setModalShift({ x: 0, y: 0 }); }}>{maximized ? "还原窗口" : "全屏显示"}</button>
        </header>
        <div className="mind-map-modal-body">{mindMaps(true, (active) => { relationModeRef.current = active; })}</div>
      </section>
    </div>}
  </div>;
}
