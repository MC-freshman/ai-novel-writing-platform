import { useCallback } from "react";
import type { AppState, CreativeWorkspaceState, ProgressGridBoard, ProgressGridColumn, ProgressGridColumnKind, ProgressGridRow, ProgressGridStatus } from "../../types";
import type { PageSaveHandle, PageSaveKind } from "../../hooks/useEntityDraft";
import { useWorkspaceDraft } from "../../hooks/useWorkspaceDraft";
import {
  createGridBoard, createGridColumn, createGridRow, GRID_COLUMN_KINDS, GRID_STATUSES, gridCompletion,
} from "../../lib/progress-grid";

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function ProgressGrids({ state, workspace, onWorkspace, onRegisterSave, onOpenChapter, onStatus }: {
  state: AppState;
  workspace: CreativeWorkspaceState;
  onWorkspace: (value: CreativeWorkspaceState) => void;
  onRegisterSave: (kind: PageSaveKind, handle: PageSaveHandle | null) => void;
  onOpenChapter: (id: string) => void;
  onStatus: (message: string) => void;
}) {
  const board = useWorkspaceDraft<ProgressGridBoard>("progress-grid", "progressGrids", workspace, onWorkspace, onRegisterSave, createGridBoard);
  const grid = board.draft;
  const rows = grid?.rows || [];
  const columns = grid?.columns || [];
  const completion = gridCompletion(rows);

  const patch = useCallback((change: (previous: ProgressGridBoard) => ProgressGridBoard) => {
    board.update((previous) => ({ ...change(previous), updatedAt: new Date().toISOString() }));
  }, [board]);

  const patchRow = useCallback((id: string, change: Partial<ProgressGridRow>) => {
    patch((previous) => ({ ...previous, rows: previous.rows.map((row) => row.id === id ? { ...row, ...change } : row) }));
  }, [patch]);

  const patchCell = useCallback((rowId: string, columnId: string, value: string) => {
    patch((previous) => ({
      ...previous,
      rows: previous.rows.map((row) => row.id === rowId ? { ...row, cells: { ...row.cells, [columnId]: value } } : row),
    }));
  }, [patch]);

  function addRow() {
    patch((previous) => ({ ...previous, rows: [...previous.rows, createGridRow(previous.rows.length)] }));
  }
  function removeRow(id: string) {
    patch((previous) => ({ ...previous, rows: previous.rows.filter((row) => row.id !== id) }));
  }
  function moveRow(index: number, delta: number) {
    patch((previous) => {
      const next = [...previous.rows];
      const target = index + delta;
      if (target < 0 || target >= next.length) return previous;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...previous, rows: next };
    });
  }
  function addColumn() {
    patch((previous) => ({ ...previous, columns: [...previous.columns, createGridColumn()] }));
  }
  function removeColumn(id: string) {
    patch((previous) => ({
      ...previous,
      columns: previous.columns.filter((column) => column.id !== id),
      rows: previous.rows.map((row) => {
        const cells = { ...row.cells };
        delete cells[id];
        return { ...row, cells };
      }),
    }));
  }
  function patchColumn(id: string, change: Partial<ProgressGridColumn>) {
    patch((previous) => ({ ...previous, columns: previous.columns.map((column) => column.id === id ? { ...column, ...change } : column) }));
  }
  function syncChapterStatus() {
    const linked = rows.filter((row) => row.chapterId);
    if (!linked.length) { onStatus("当前网格还没有关联章节。"); return; }
    patch((previous) => ({
      ...previous,
      rows: previous.rows.map((row) => {
        const chapter = state.chapters.find((item) => item.id === row.chapterId);
        return chapter?.progressStatus ? { ...row, status: chapter.progressStatus } : row;
      }),
    }));
    onStatus(`已按章节进度同步 ${linked.length} 项状态`);
  }
  async function removeBoard() {
    if (!grid || !window.confirm(`删除「${grid.title}」及其全部行列？此操作不可撤销。`)) return;
    try { await board.remove(); onStatus("进度网格已删除"); }
    catch (error) { onStatus(`删除失败：${error instanceof Error ? error.message : String(error)}`); }
  }

  function renderCell(row: ProgressGridRow, column: ProgressGridColumn) {
    const value = row.cells[column.id] || "";
    const label = `${row.title} / ${column.title}`;
    if (column.kind === "status") return <select aria-label={label} value={value} onChange={(event) => patchCell(row.id, column.id, event.target.value)}>
      <option value="">未设置</option>{GRID_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
    </select>;
    if (column.kind === "chapter") return <select aria-label={label} value={value} onChange={(event) => patchCell(row.id, column.id, event.target.value)}>
      <option value="">未关联</option>{state.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.volume || "未分卷"} / {chapter.title}</option>)}
    </select>;
    return <input aria-label={label} value={value} onChange={(event) => patchCell(row.id, column.id, event.target.value)} />;
  }

  return <section className="progress-grid-panel" aria-label="进度网格">
    <header className="progress-grid-toolbar">
      <select aria-label="选择进度网格" value={board.activeId} onChange={(event) => { if (event.target.value) void board.select(event.target.value); }}>
        {!board.items.length && <option value="">还没有网格</option>}
        {board.items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
      <button onClick={() => void board.create()}>新建网格</button>
      <button disabled={!grid} onClick={() => void removeBoard()}>删除此网格</button>
      <label>名称<input aria-label="进度网格名称" maxLength={160} value={grid?.title || ""} onChange={(event) => patch((previous) => ({ ...previous, title: event.target.value }))} /></label>
      <span role="status" aria-live="polite">{board.saveState}</span>
      <button disabled={!grid} onClick={addRow}>添加行</button>
      <button disabled={!grid} onClick={addColumn}>新增自定义列</button>
      <button disabled={!grid} onClick={syncChapterStatus}>同步章节状态</button>
    </header>

    {!grid ? <div className="progress-grid-empty"><p>还没有进度网格。</p><button onClick={() => void board.create()}>创建第一张网格</button></div> :
      <div className="progress-grid-body">
        <aside className="progress-grid-list" aria-label="已创建的进度网格">
          <header><strong>我的网格</strong><span>{board.items.length} 张</span></header>
          {board.items.map((item) => {
            const itemCompletion = gridCompletion(item.rows || []);
            return <button key={item.id} className={item.id === board.activeId ? "active" : ""} onClick={() => void board.select(item.id)}>
              <strong>{item.title}</strong>
              <span>{itemCompletion.done}/{itemCompletion.total} 已完成 · {formatTime(item.updatedAt)}</span>
            </button>;
          })}
          {!board.items.length && <p>点击上方「新建网格」创建第一张。</p>}
        </aside>

        <div className="progress-grid-main">
          <div className="progress-grid-summary">
            <div className="progress-grid-summary-labels">
              <strong>进度总览</strong>
              {GRID_STATUSES.map((status) => <span key={status}>{status} {rows.filter((row) => row.status === status).length}</span>)}
            </div>
            <div className="progress-grid-bar" role="progressbar" aria-label="网格完成率" aria-valuenow={completion.percent} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${completion.percent}%` }} />
            </div>
            <span className="progress-grid-percent">{completion.done}/{completion.total} 项 · {completion.percent}% 已完成</span>
          </div>
          <label className="progress-grid-description">网格说明<textarea aria-label="网格说明" value={grid.description} onChange={(event) => patch((previous) => ({ ...previous, description: event.target.value }))} placeholder="这张网格用来跟踪什么？" /></label>

          <div className="progress-grid-table-scroll">
            <table className="progress-grid-table">
              <thead><tr>
                <th>进度项</th><th>状态</th><th>关联章节</th>
                {columns.map((column) => <th key={column.id}>
                  <input aria-label="列名称" value={column.title} onChange={(event) => patchColumn(column.id, { title: event.target.value })} />
                  <select aria-label="列类型" value={column.kind} onChange={(event) => patchColumn(column.id, { kind: event.target.value as ProgressGridColumnKind })}>
                    {GRID_COLUMN_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
                  </select>
                  <button aria-label={`删除列：${column.title}`} onClick={() => removeColumn(column.id)}>删除列</button>
                </th>)}
                <th>备注</th><th>操作</th>
              </tr></thead>
              <tbody>{rows.map((row, index) => {
                const chapter = state.chapters.find((item) => item.id === row.chapterId);
                return <tr key={row.id}>
                  <td><input aria-label="进度项名称" value={row.title} onChange={(event) => patchRow(row.id, { title: event.target.value })} /></td>
                  <td><select aria-label="进度状态" value={row.status} onChange={(event) => patchRow(row.id, { status: event.target.value as ProgressGridStatus })}>
                    {GRID_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select></td>
                  <td className="progress-grid-chapter-cell">
                    <select aria-label="关联章节" value={row.chapterId} onChange={(event) => patchRow(row.id, { chapterId: event.target.value })}>
                      <option value="">未关联</option>{state.chapters.map((item) => <option key={item.id} value={item.id}>{item.volume || "未分卷"} / {item.title}</option>)}
                    </select>
                    {chapter && <button aria-label={`打开章节：${chapter.title}`} onClick={() => onOpenChapter(chapter.id)}>打开章节{chapter.progressStatus ? `（${chapter.progressStatus}）` : ""}</button>}
                  </td>
                  {columns.map((column) => <td key={column.id}>{renderCell(row, column)}</td>)}
                  <td><input aria-label="进度项备注" value={row.note} onChange={(event) => patchRow(row.id, { note: event.target.value })} /></td>
                  <td className="progress-grid-row-actions">
                    <button aria-label={`上移：${row.title}`} disabled={index === 0} onClick={() => moveRow(index, -1)}>上移</button>
                    <button aria-label={`下移：${row.title}`} disabled={index === rows.length - 1} onClick={() => moveRow(index, 1)}>下移</button>
                    <button aria-label={`删除行：${row.title}`} onClick={() => removeRow(row.id)}>删除</button>
                  </td>
                </tr>;
              })}</tbody>
            </table>
            {!rows.length && <p className="progress-grid-empty-hint">这张网格还没有行，点击「添加行」开始记录进度。</p>}
          </div>
          <p className="progress-grid-hint">行列与单元格改动会自动保存；左侧可随时切回之前创建的网格。</p>
        </div>
      </div>}
  </section>;
}
