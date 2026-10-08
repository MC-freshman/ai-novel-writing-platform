import { useMemo, useState } from "react";
import type { Chapter, NovelNetwork, NovelNetworkRow, NovelNetworkTable as Table } from "../types";
import { networkId, relatedNetworkRows } from "../lib/novel-network";

export function NovelNetworkTableEditor({ network, table, chapters, onChange, onSelectTable, onOpenChapter, initialRowId = "" }: {
  network: NovelNetwork; table: Table; chapters: Chapter[]; onChange: (table: Table) => void;
  onSelectTable: (id: string, rowId: string) => void; onOpenChapter: (id: string) => void;
  initialRowId?: string;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState(initialRowId);
  const [columnName, setColumnName] = useState("");
  const [overview, setOverview] = useState(false);
  const selected = table.rows.find((row) => row.id === selectedId) || table.rows[0];
  const filtered = useMemo(() => table.rows.filter((row) => !query.trim() || row.cells.join(" ").toLowerCase().includes(query.trim().toLowerCase())), [query, table.rows]);
  const related = useMemo(() => selected ? relatedNetworkRows(network, table, selected) : [], [network, selected, table]);
  const maximumPage = Math.max(0, Math.ceil(filtered.length / 40) - 1);
  const currentPage = Math.min(page, maximumPage);
  const visible = filtered.slice(currentPage * 40, (currentPage + 1) * 40);

  function updateRow(row: NovelNetworkRow) { onChange({ ...table, rows: table.rows.map((item) => item.id === row.id ? row : item) }); }
  function addRow() { const row = { id: networkId("row"), cells: table.columns.map(() => ""), chapterId: "" }; onChange({ ...table, rows: [...table.rows, row] }); setSelectedId(row.id); setPage(Math.floor(table.rows.length / 40)); setQuery(""); }
  function addColumn() {
    if (!columnName.trim() || table.columns.length >= 32) return;
    onChange({ ...table, columns: [...table.columns, columnName.trim()], rows: table.rows.map((row) => ({ ...row, cells: [...row.cells, ""] })) }); setColumnName("");
  }

  return <section className="novel-network-table-editor">
    <div className="novel-network-table-tools">
      <label>表名<input aria-label="表名" maxLength={200} value={table.title} onChange={(event) => onChange({ ...table, title: event.target.value })} /></label>
      <input aria-label="筛选小说网记录" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="筛选记录或 T/R 标记" />
      <button onClick={addRow}>添加记录</button><button title="切换表格总览和记录列表" onClick={() => setOverview((value) => !value)}>{overview ? "记录列表" : "表格总览"}</button><span>{filtered.length} 条 / {table.columns.length} 列</span>
    </div>
    <details className="novel-network-columns"><summary>调整列与地区</summary>
      {table.columns.map((column, index) => <label key={index}><input aria-label={`第${index + 1}列标题`} maxLength={200} value={column} onChange={(event) => onChange({ ...table, columns: table.columns.map((item, position) => position === index ? event.target.value : item) })} /><button disabled={table.columns.length === 1} onClick={() => { if (window.confirm(`删除“${column}”列及其中的内容？`)) onChange({ ...table, columns: table.columns.filter((_, position) => position !== index), rows: table.rows.map((row) => ({ ...row, cells: row.cells.filter((_, position) => position !== index) })) }); }}>删除列</button></label>)}
      <label><input aria-label="新列名称" value={columnName} onChange={(event) => setColumnName(event.target.value)} placeholder="新列或地区名称" /><button disabled={!columnName.trim() || table.columns.length >= 32} onClick={addColumn}>添加列</button></label>
    </details>
    <div className="novel-network-record-layout">
      <div className="novel-network-records">
        {overview ? <div className="novel-network-grid-scroll"><table><thead><tr>{table.columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead><tbody>{visible.map((row) => <tr key={row.id} className={selected?.id === row.id ? "active" : ""}>{row.cells.map((cell, index) => <td key={index}><button onClick={() => setSelectedId(row.id)} title="点击编辑这条记录">{cell || "—"}</button></td>)}</tr>)}</tbody></table></div> : visible.map((row) => <button title="选择并编辑记录" key={row.id} className={selected?.id === row.id ? "active" : ""} onClick={() => setSelectedId(row.id)}><strong>{row.cells[0] || "新记录"}</strong><span>{row.cells.slice(1).join(" / ") || "点击填写内容"}</span></button>)}
        {!filtered.length && <p>暂无记录，点击“添加记录”开始填写。</p>}
        <div className="novel-network-pagination"><button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage + 1}/{maximumPage + 1}</span><button disabled={currentPage >= maximumPage} onClick={() => setPage(currentPage + 1)}>下一页</button></div>
      </div>
      {selected && <div className="novel-network-record-detail">
        <header><strong>编辑记录</strong><button onClick={() => { if (window.confirm("删除这条统筹记录？")) onChange({ ...table, rows: table.rows.filter((row) => row.id !== selected.id) }); }}>删除记录</button></header>
        {table.columns.map((column, index) => <label key={index}><span>{column || `第${index + 1}列`}</span><textarea aria-label={`记录 ${column || index + 1}`} maxLength={16000} value={selected.cells[index]} onChange={(event) => updateRow({ ...selected, cells: selected.cells.map((cell, position) => position === index ? event.target.value : cell) })} /></label>)}
        <label><span>关联已写正文</span><select aria-label="关联已写正文" value={selected.chapterId} onChange={(event) => updateRow({ ...selected, chapterId: event.target.value })}><option value="">尚未绑定（计划号独立）</option>{selected.chapterId && !chapters.some((chapter) => chapter.id === selected.chapterId) && <option value={selected.chapterId}>原链接待重新绑定</option>}{chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.volume} / {chapter.title}</option>)}</select></label>
        {chapters.some((chapter) => chapter.id === selected.chapterId) && <button onClick={() => onOpenChapter(selected.chapterId)}>打开关联正文</button>}
        <details className="novel-network-related" open><summary>关联查看（{related.length}）</summary><p>T/R 标记、计划章区间和作者绑定的正文链接用于关联。</p>{related.slice(0, 80).map(({ table: target, row, reason }) => <button key={`${target.id}-${row.id}`} onClick={() => onSelectTable(target.id, row.id)}><strong>{target.title} · {row.cells[0]}</strong><span>{reason} · {row.cells.slice(1).join(" / ")}</span></button>)}{related.length > 80 && <p>关联超过80条，可筛选对应表继续查看。</p>}</details>
      </div>}
    </div>
  </section>;
}
