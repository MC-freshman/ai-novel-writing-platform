import { useCallback, useMemo, useRef, useState } from "react";
import type { AppState, CreativeWorkspaceState, NovelNetwork, NovelNetworkImportPreview, NovelNetworkKind, NovelNetworkTable } from "../types";
import { useEntityDraft, type PageSaveHandle, type PageSaveKind } from "../hooks/useEntityDraft";
import { createNetwork, createNetworkTable, NETWORK_TEMPLATES } from "../lib/novel-network";
import { NovelNetworkTableEditor } from "./NovelNetworkTable";

export function NovelNetworks({ state, workspace, onWorkspace, onRegisterSave, onOpenChapter, onStatus }: {
  state: AppState; workspace: CreativeWorkspaceState;
  onWorkspace: (workspace: CreativeWorkspaceState) => void;
  onRegisterSave: (kind: PageSaveKind, handle: PageSaveHandle | null) => void;
  onOpenChapter: (id: string) => void; onStatus: (message: string) => void;
}) {
  const blank = useMemo(createNetwork, []);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [tableId, setTableId] = useState("");
  const [rowFocus, setRowFocus] = useState("");
  const [newKind, setNewKind] = useState<NovelNetworkKind>("custom");
  const [preview, setPreview] = useState<NovelNetworkImportPreview | null>(null);
  const [importMode, setImportMode] = useState<"new" | "append">("new");
  const [importTitle, setImportTitle] = useState("");
  const [showDocuments, setShowDocuments] = useState(false);
  const register = useCallback((kind: PageSaveKind, handle: PageSaveHandle | null) => {
    onRegisterSave(kind, handle && {
      save: async () => !busyRef.current && handle.save(),
      protect: async () => !busyRef.current && handle.protect(),
    });
  }, [onRegisterSave]);
  const save = useCallback(async (value: NovelNetwork) => {
    const result = await window.novelAPI.saveNovelNetwork({ network: value });
    onWorkspace(result.workspace);
    return result.network;
  }, [onWorkspace]);
  const draft = useEntityDraft("novel-network", workspace.novelNetworks || [], blank, {
    projectPath: state.projectPath, recoveryEnabled: state.config.ui.recoveryEnabled !== false, onSave: save, onRegisterSave: register,
  });
  const network = draft.active;
  const table = network.tables.find((item) => item.id === tableId) || network.tables[0];

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await action(); }
    catch (error) { onStatus(`小说网操作失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function newNetwork() {
    if (!(await draft.save())) return;
    draft.update(createNetwork()); setTableId(""); setRowFocus(""); setShowDocuments(false);
  }
  async function chooseImport(mode: "files" | "folder") {
    if (!(await draft.protect())) return;
    await run(async () => {
      const result = await window.novelAPI.previewNovelNetworkImport({ mode });
      if ("canceled" in result) return;
      setPreview(result); setImportTitle(result.network.title); setImportMode("new");
    });
  }
  async function confirmImport() {
    if (!preview || !(await draft.save())) return;
    await run(async () => {
      const current = draft.getCurrent();
      const result = await window.novelAPI.importNovelNetwork({ token: preview.token, ...(importMode === "append" ? { targetId: current.id, expectedRevision: current.revision } : { title: importTitle }) });
      onWorkspace(result.workspace);
      await draft.select(result.network);
      setPreview(null); setTableId(""); setRowFocus(""); setShowDocuments(false);
      onStatus(`小说网已导入：${result.network.tables.length}张表，跳过${preview.duplicates + result.duplicates}条重复记录`);
    });
  }
  function changeTable(value: NovelNetworkTable) { draft.update({ ...network, tables: network.tables.map((item) => item.id === value.id ? value : item) }); }
  async function deleteNetwork() {
    if (!network.id || !window.confirm(`删除“${network.title}”及其中的统筹表？`)) return;
    await run(async () => {
      const result = await window.novelAPI.deleteNovelNetwork({ id: network.id, expectedRevision: network.revision });
      await draft.discard(); onWorkspace(result.workspace); setTableId(""); setRowFocus(""); onStatus("小说网已删除");
    });
  }
  async function reload() {
    if (draft.dirty && !window.confirm("重新读取会丢弃当前未保存草稿。需要保留时，请先导出JSON。")) return;
    await run(async () => { const result = await window.novelAPI.getCreativeWorkspace(); await draft.discard(); onWorkspace(result); setTableId(""); setRowFocus(""); });
  }

  return <section className="novel-network-panel" aria-label="小说统筹网">
    <fieldset disabled={busy}>
      <div className="novel-network-toolbar">
        <select aria-label="选择小说网" value={network.id} onChange={(event) => { const target = workspace.novelNetworks.find((item) => item.id === event.target.value); if (target) { void draft.select(target); setTableId(""); setRowFocus(""); } }}><option value="">新网 / 未保存草稿</option>{workspace.novelNetworks.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
        <button onClick={() => void newNetwork()}>新建小说网</button><button onClick={() => void chooseImport("files")}>导入文件</button><button onClick={() => void chooseImport("folder")}>导入目录</button>
        <button onClick={() => void run(async () => { const result = await window.novelAPI.exportNovelNetwork({ network: draft.getCurrent() }); if (!result.canceled) onStatus("小说网已导出，可再次导入"); })}>导出JSON</button>
        <button className="primary" disabled={draft.saving} onClick={() => void draft.save()}>保存小说网</button><button onClick={() => void reload()}>重新读取</button><button disabled={!network.id} onClick={() => void deleteNetwork()}>删除小说网</button>
      </div>
      <div className="novel-network-heading"><label>小说网名称<input aria-label="小说网名称" maxLength={200} value={network.title} onChange={(event) => draft.update({ ...network, title: event.target.value })} /></label><span role="status" aria-live="polite">{draft.feedback}</span></div>
      {preview && <section className="novel-network-import-preview" aria-label="小说网导入预览"><h3>导入预览</h3><p>{preview.fileNames.join(" / ")}</p><p>{preview.network.tables.length} 张表 / {preview.network.tables.reduce((sum, item) => sum + item.rows.length, 0)} 条记录 / {preview.network.documents.length} 份原始说明</p>{preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}<div>{preview.network.tables.map((item) => <span key={item.id}>{item.title} · {item.rows.length}</span>)}</div><label>导入方式<select aria-label="小说网导入方式" value={importMode} onChange={(event) => setImportMode(event.target.value as "new" | "append")}><option value="new">创建新小说网</option><option value="append" disabled={!network.id}>追加到当前小说网</option></select></label>{importMode === "new" && <label>新网名称<input aria-label="导入小说网名称" value={importTitle} maxLength={200} onChange={(event) => setImportTitle(event.target.value)} /></label>}<button onClick={() => setPreview(null)}>取消导入</button><button className="primary" onClick={() => void confirmImport()}>确认导入小说网</button></section>}
      <div className="novel-network-table-switch"><select aria-label="选择统筹表" value={table?.id || ""} onChange={(event) => { setTableId(event.target.value); setRowFocus(""); setShowDocuments(false); }}>{network.tables.map((item) => <option key={item.id} value={item.id}>{item.title}（{item.rows.length}）</option>)}</select><select aria-label="新统筹表类型" value={newKind} onChange={(event) => setNewKind(event.target.value as NovelNetworkKind)}>{NETWORK_TEMPLATES.map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}</select><button onClick={() => { const added = createNetworkTable(newKind); draft.update({ ...network, tables: [...network.tables, added] }); setTableId(added.id); setRowFocus(""); setShowDocuments(false); }}>添加统筹表</button><button disabled={!table} onClick={() => { if (table && window.confirm(`删除“${table.title}”和全部记录？`)) { draft.update({ ...network, tables: network.tables.filter((item) => item.id !== table.id) }); setTableId(""); } }}>删除表</button><button title="查看统筹说明与导入原文" onClick={() => setShowDocuments((value) => !value)}>{showDocuments ? "返回表格" : "说明与导入原文"}</button></div>
      {showDocuments ? <div className="novel-network-documents"><label>统筹说明<textarea aria-label="小说网说明" value={network.notes} onChange={(event) => draft.update({ ...network, notes: event.target.value })} /></label>{network.documents.map((document, index) => <details key={`${index}-${document.name}`}><summary>原文：{document.name}</summary><textarea aria-label={`说明文档 ${document.name}`} value={document.text} onChange={(event) => draft.update({ ...network, documents: network.documents.map((item, position) => position === index ? { ...item, text: event.target.value } : item) })} /></details>)}</div> : table ? <NovelNetworkTableEditor key={`${table.id}-${rowFocus}`} initialRowId={rowFocus} network={network} table={table} chapters={state.chapters} onChange={changeTable} onSelectTable={(id, rowId) => { setTableId(id); setRowFocus(rowId); }} onOpenChapter={onOpenChapter} /> : <p>点击“添加统筹表”开始规划，或导入已有资料。</p>}
    </fieldset>
  </section>;
}
