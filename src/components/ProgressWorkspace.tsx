import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState, CreativeWorkspaceState } from "../types";
import type { PageSaveHandle, PageSaveKind } from "../hooks/useEntityDraft";
import { ProgressGrid } from "./ProgressBoard";
import { NovelNetworks } from "./NovelNetworks";

export function ProgressWorkspace({ state, selectedChapterId, onSelectChapter, onApplyState, onStatus, onRegisterSave, networkOpenRequest }: {
  state: AppState; selectedChapterId: string; onSelectChapter: (id: string) => void;
  onApplyState: (state: AppState) => void; onStatus: (message: string) => void;
  onRegisterSave: (kind: PageSaveKind, handle: PageSaveHandle | null) => void;
  networkOpenRequest: number;
}) {
  const [mode, setMode] = useState<"chapters" | "network">(networkOpenRequest ? "network" : "chapters");
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

  async function changeMode(next: typeof mode) {
    if (next === mode) return;
    if (saver.current && !(await saver.current.protect())) { onStatus("当前小说网草稿尚未保护，请先保存后再切换。"); return; }
    setMode(next);
    if (next === "chapters") setExpanded(false);
  }

  return <div className={`progress-workspace ${expanded ? "expanded" : ""}`}>
    <div className="progress-workspace-modes">
      <button className={mode === "chapters" ? "active" : ""} onClick={() => void changeMode("chapters")}>章节进度</button>
      <button className={mode === "network" ? "active" : ""} onClick={() => void changeMode("network")}>小说统筹网</button>
      {mode === "network" && <button title="调整小说网编辑区域" onClick={() => setExpanded((value) => !value)}>{expanded ? "收起小说网" : "展开小说网"}</button>}
    </div>
    {mode === "chapters" ? <ProgressGrid state={state} selectedChapterId={selectedChapterId} onSelectChapter={onSelectChapter} onApplyState={onApplyState} onStatus={onStatus} /> :
      workspace ? <NovelNetworks state={state} workspace={workspace} onWorkspace={setWorkspace} onRegisterSave={register} onOpenChapter={onSelectChapter} onStatus={onStatus} /> :
      <div className="analysis-empty">{loadError ? <><p>小说网读取失败：{loadError}</p><button onClick={() => setReload((value) => value + 1)}>重试读取</button></> : "正在读取小说网…"}</div>}
  </div>;
}
