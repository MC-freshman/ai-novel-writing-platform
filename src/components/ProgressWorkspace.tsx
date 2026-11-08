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
  const [workspace, setWorkspace] = useState<CreativeWorkspaceState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const saver = useRef<PageSaveHandle | null>(null);
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

  async function changeMode(next: ProgressMode) {
    if (next === mode) return;
    if (saver.current && !(await saver.current.protect())) { onStatus("当前规划草稿尚未保存，请先保存后再切换。"); return; }
    setMode(next);
    if (next === "chapters") setExpanded(false);
  }

  const canExpand = mode !== "chapters";
  const boardProps = workspace ? { workspace, onWorkspace: setWorkspace, onRegisterSave: register, onStatus } : null;

  return <div className={`progress-workspace ${expanded ? "expanded" : ""}`}>
    <div className="progress-workspace-modes">
      <button className={mode === "chapters" ? "active" : ""} onClick={() => void changeMode("chapters")}>章节进度</button>
      <button className={mode === "network" ? "active" : ""} onClick={() => void changeMode("network")}>小说统筹网</button>
      <button className={mode === "mindmap" ? "active" : ""} onClick={() => void changeMode("mindmap")}>思维导图</button>
      <button className={mode === "grid" ? "active" : ""} onClick={() => void changeMode("grid")}>进度网格</button>
      {canExpand && <button title="调整编辑区域" onClick={() => setExpanded((value) => !value)}>{expanded ? "收起编辑区" : "展开编辑区"}</button>}
      {mode !== "chapters" && <button title="重新读取项目里的规划数据（含外部 MCP 写入）" onClick={() => setReload((value) => value + 1)}>刷新规划数据</button>}
    </div>
    {mode === "chapters" ? <ProgressGrid state={state} selectedChapterId={selectedChapterId} onSelectChapter={onSelectChapter} onApplyState={onApplyState} onStatus={onStatus} /> :
      !boardProps ? <div className="analysis-empty">{loadError ? <><p>规划数据读取失败：{loadError}</p><button onClick={() => setReload((value) => value + 1)}>重试读取</button></> : "正在读取规划数据…"}</div> :
        mode === "network" ? <NovelNetworks state={state} workspace={boardProps.workspace} onWorkspace={boardProps.onWorkspace} onRegisterSave={register} onOpenChapter={onSelectChapter} onStatus={onStatus} /> :
          mode === "mindmap" ? <MindMaps workspace={boardProps.workspace} onWorkspace={boardProps.onWorkspace} onRegisterSave={register} onStatus={onStatus} /> :
            <ProgressGrids state={state} workspace={boardProps.workspace} onWorkspace={boardProps.onWorkspace} onRegisterSave={register} onOpenChapter={onSelectChapter} onStatus={onStatus} />}
  </div>;
}
