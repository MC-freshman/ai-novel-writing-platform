import type { NovelNetwork, NovelNetworkKind, NovelNetworkRow, NovelNetworkTable } from "../types";

export const NETWORK_TEMPLATES: Array<{ kind: NovelNetworkKind; label: string; columns: string[] }> = [
  { kind: "threads", label: "POV线程", columns: ["线", "名称", "视角人物", "本地问题→尝试→代价→新常态", "活跃章区"] },
  { kind: "chapters", label: "逐章排期", columns: ["章号", "线程", "事件", "标记", "分块"] },
  { kind: "clock", label: "世界钟", columns: ["块", "地区一", "地区二", "地区三"] },
  { kind: "information", label: "信息台账", columns: ["真相", "埋设章", "验证章", "揭露章", "回收章", "边界"] },
  { kind: "alignment", label: "已写章节对齐", columns: ["已写章", "素材落位（新排期章号）", "覆盖度", "新章缺口"] },
  { kind: "custom", label: "自定义表", columns: ["名称", "说明"] },
];
export const networkId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export function createNetworkTable(kind: NovelNetworkKind): NovelNetworkTable {
  const template = NETWORK_TEMPLATES.find((item) => item.kind === kind) || NETWORK_TEMPLATES[5];
  return { id: networkId("table"), title: template.label, kind, columns: [...template.columns], rows: [] };
}
export function createNetwork(): NovelNetwork {
  return { id: "", title: "新小说网", notes: "", tables: NETWORK_TEMPLATES.slice(0, 5).map((item) => createNetworkTable(item.kind)), documents: [], revision: "", createdAt: "", updatedAt: "" };
}

function markers(value: string) { return new Set(value.match(/(?:^|[^A-Za-z0-9])([TR]\d+)\b/g)?.map((item) => item.match(/[TR]\d+/)?.[0] || "") || []); }
function containsChapter(value: string, chapter: number) {
  return [...value.matchAll(/\d+(?:\s*[-—–~至]\s*\d+)?/g)].some((match) => {
    const values = match[0].split(/\s*[-—–~至]\s*/).map(Number);
    return chapter >= values[0] && chapter <= (values[1] ?? values[0]);
  });
}
function plannedChapter(table: NovelNetworkTable, row: NovelNetworkRow) {
  const index = table.columns.findIndex((column) => /^(章号|计划章|排期章)/.test(column));
  return table.kind === "chapters" && index >= 0 && /^\d+$/.test(row.cells[index].trim()) ? Number(row.cells[index]) : null;
}
function referencesChapter(table: NovelNetworkTable, row: NovelNetworkRow, chapter: number) {
  return table.columns.some((column, index) => {
    const value = row.cells[index];
    if (table.kind === "clock") return [...value.matchAll(/[（(]([^）)]+)[）)]/g)].some((match) => containsChapter(match[1], chapter));
    return /章区|排期章|计划章|素材落位|埋设章|验证章|揭露章|回收章/.test(column) && containsChapter(value, chapter);
  });
}
export function relatedNetworkRows(network: NovelNetwork, selectedTable: NovelNetworkTable, selectedRow: NovelNetworkRow) {
  const selectedMarkers = markers(selectedRow.cells.join(" "));
  const chapter = plannedChapter(selectedTable, selectedRow);
  const matches: Array<{ table: NovelNetworkTable; row: NovelNetworkRow; reason: string }> = [];
  for (const table of network.tables) for (const row of table.rows) {
    if (row.id === selectedRow.id) continue;
    const shared = [...markers(row.cells.join(" "))].filter((marker) => selectedMarkers.has(marker));
    const otherChapter = plannedChapter(table, row);
    const range = (chapter !== null && referencesChapter(table, row, chapter)) || (otherChapter !== null && referencesChapter(selectedTable, selectedRow, otherChapter));
    const bound = selectedRow.chapterId && row.chapterId === selectedRow.chapterId;
    if (shared.length || range || bound) matches.push({ table, row, reason: shared.length ? `标记 ${shared.join(" / ")}` : range ? `计划第${chapter ?? otherChapter}章落点` : "同一正文文档" });
  }
  return matches;
}
