import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState, CreativeWorkspaceState } from "../types";
import type { PageSaveHandle, PageSaveKind } from "../hooks/useEntityDraft";
import { ProgressGrid } from "./ProgressBoard";
import { NovelNetworks } from "./NovelNetworks";
import { MindMaps } from "./MindMaps";
import { ProgressGrids } from "./ProgressGrids";

type ProgressMode = "chapters" | "network" | "mindmap" | "grid";

export function ProgressWorkspace({ state, selectedChapterId, onSelectChapter, onApplyState, onStatus, onRegisterSave, networkOpenRequest }: {
  state: AppState; selectedChapterId: string; onSelectChapter: (id: string) => void;
  onApplyState: (state: AppState) => void; onStatus: (message: string) => void;
  onRegisterSave: (kind: PageSaveKind, handle: PageSaveHandle | null) => void;
  networkOpenRequest: number;
}) {
  const [mode, setMode] = useState<ProgressMode>(networkOpenRequest ? "network" : "chapters");
  const [expanded, setExpanded] = useState(false);
  const [mindmapModal, setMindmapModal] = useState(false);
  const [workspace, setWorkspace] = useState<CreativeWorkspaceState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const saver = useRef<PageSaveHandle | null>(null);
  const closeModalRef = useRef<() => void>(() => {});
  const register = useCallback((kind: PageSaveKind, handle: PageSaveHandle | null) => {
    saver.current = handle; onRegisterSave(kind, handle);
  }, [onRegisterSave]);

  useEffect(() => {
    if (networkOpenRequest) setMode("network");
  }, [networkOpenRequest]);

  useEffect(() => {
    let cancelled = false;
    setLoadError("");
    void window.novelAPI.getCreativeWorkspace().then((value) => {
      if (!cancelled) setWorkspace(value);
    }).catch((error) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [state.projectPath, reload]);

  async function protectCurrent() {
    if (saver.current && !(await saver.current.protect())) {
      onStatus("当前规划草稿尚未保存，请先保存后再切换。");
      return false;
    }
    return true;
  }

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
    setMindmapModal(true);
  }

  async function closeMindmapModal() {
    if (!(await protectCurrent())) return;
    setMindmapModal(false);
  }

  closeModalRef.current = () => { void closeMindmapModal(); };

  useEffect(() => {
    if (!mindmapModal) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement)?.tagName || "")) return;
      closeModalRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mindmapModal]);

  const canExpand = mode !== "chapters" && !mindmapModal;
  const boardProps = workspace ? { workspace, onWorkspace: setWorkspace, onRegisterSave: register, onStatus } : null;
  const mindMaps = (fullscreen: boolean) => boardProps && <MindMaps
    workspace={boardProps.workspace} onWorkspace={boardProps.onWorkspace}
    onRegisterSave={register} onStatus={onStatus} fullscreen={fullscreen} />;

  return <div className={`progress-workspace ${expanded ? "expanded" : ""}`}>
    <div className="progress-workspace-modes">
      <button className={mode === "chapters" ? "active" : ""} onClick={() => void changeMode("chapters")}>章节进度</button>
      <button className={mode === "network" ? "active" : ""} onClick={() => void changeMode("network")}>小说统筹网</button>
      <button className={mode === "mindmap" ? "active" : ""} onClick={() => void changeMode("mindmap")}>思维导图</button>
      <button className={mode === "grid" ? "active" : ""} onClick={() => void changeMode("grid")}>进度网格</button>
      {mode === "mindmap" && boardProps && !mindmapModal && <button title="在独立弹窗中放大画布" onClick={() => void openMindmapModal()}>弹窗编辑</button>}
      {canExpand && <button title="调整编辑区域" onClick={() => setExpanded((value) => !value)}>{expanded ? "收起编辑区" : "展开编辑区"}</button>}
      {mode !== "chapters" && <button title="重新读取项目里的规划数据（含外部 MCP 写入）" onClick={() => setReload((value) => value + 1)}>刷新规划数据</button>}
    </div>
    {mode === "chapters" ? <ProgressGrid state={state} selectedChapterId={selectedChapterId} onSelectChapter={onSelectChapter} onApplyState={onApplyState} onStatus={onStatus} /> :
      !boardProps ? <div className="analysis-empty">{loadError ? <><p>规划数据读取失败：{loadError}</p><button onClick={() => setReload((value) => value + 1)}>重试读取</button></> : "正在读取规划数据…"}</div> :
        mode === "network" ? <NovelNetworks state={state} workspace={boardProps.workspace} onWorkspace={boardProps.onWorkspace} onRegisterSave={register} onOpenChapter={onSelectChapter} onStatus={onStatus} /> :
          mode === "mindmap" ? (mindmapModal ? null : mindMaps(false)) :
            <ProgressGrids state={state} workspace={boardProps.workspace} onWorkspace={boardProps.onWorkspace} onRegisterSave={register} onOpenChapter={onSelectChapter} onStatus={onStatus} />}

    {mindmapModal && boardProps && <div className="modal-backdrop" onClick={() => void closeMindmapModal()}>
      <section className="mind-map-modal" role="dialog" aria-modal="true" aria-label="思维导图弹窗编辑" onClick={(event) => event.stopPropagation()}>
        <header className="mind-map-modal-header">
          <strong>思维导图 · 弹窗编辑</strong>
          <span>画布已放大；可拖动空白处平移、滚轮缩放，按 Esc 返回</span>
          <button aria-label="关闭思维导图弹窗" onClick={() => void closeMindmapModal()}>关闭弹窗</button>
        </header>
        <div className="mind-map-modal-body">{mindMaps(true)}</div>
      </section>
    </div>}
  </div>;
}
