const path = require("node:path");
const { randomUUID } = require("node:crypto");

const KINDS = ["threads", "chapters", "clock", "information", "alignment", "custom"];
const LIMITS = { tables: 80, rows: 10000, columns: 32, cell: 16000, document: 1024 * 1024, bytes: 4 * 1024 * 1024 };
const makeId = (prefix) => `${prefix}_${randomUUID()}`;

function splitCells(line) {
  const result = [];
  let cell = "";
  let escaped = false;
  let code = false;
  for (const character of line.trim().replace(/^\|/, "").replace(/\|$/, "")) {
    if (escaped) { cell += character === "|" ? "|" : `\\${character}`; escaped = false; }
    else if (character === "\\") escaped = true;
    else if (character === "`") { code = !code; cell += character; }
    else if (character === "|" && !code) { result.push(cell.trim()); cell = ""; }
    else cell += character;
  }
  if (escaped) cell += "\\";
  result.push(cell.trim());
  return result;
}

function tableKind(title, columns) {
  const label = `${title} ${columns.join(" ")}`;
  if (/已写章|素材落位|偏差登记|覆盖度/.test(label)) return "alignment";
  if (/埋设章|揭露章|信息控制|真相/.test(label)) return "information";
  if (/世界钟|地区|^块\s/.test(label) || columns[0] === "块") return "clock";
  if (/POV|线程|视角人物/.test(label) && !columns.includes("章号")) return "threads";
  if (/章号|计划章|逐章排期/.test(label)) return "chapters";
  return "custom";
}

function checkedText(value, label, limit = LIMITS.cell) {
  if (typeof value !== "string") throw new Error(`${label}必须是文字。`);
  if (value.length > limit) throw new Error(`${label}超过长度上限，请拆分资料。`);
  return value;
}

function normalizeNetwork(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("小说网数据必须是对象。");
  if (!Array.isArray(input.tables) || input.tables.length > LIMITS.tables) throw new Error("小说网表格数量不合法或超过80张。 ");
  const ids = new Set();
  let rows = 0;
  const tables = input.tables.map((table) => {
    if (!table || !Array.isArray(table.columns) || !table.columns.length || table.columns.length > LIMITS.columns || !Array.isArray(table.rows)) throw new Error("表格需要1至32列及记录列表。");
    const id = checkedText(table.id || makeId("table"), "表标识", 120);
    if (ids.has(id)) throw new Error("小说网出现重复的表或记录标识。");
    ids.add(id);
    const columns = table.columns.map((column) => checkedText(column, "列标题", 200));
    return { id, title: checkedText(table.title || "未命名表", "表标题", 200), kind: KINDS.includes(table.kind) ? table.kind : "custom", columns,
      rows: table.rows.map((row) => {
        rows += 1;
        if (rows > LIMITS.rows) throw new Error("小说网记录超过10000条，请拆分网络。");
        if (!row || !Array.isArray(row.cells) || row.cells.length !== columns.length) throw new Error("记录与表格列数不一致。");
        const rowId = checkedText(row.id || makeId("row"), "记录标识", 120);
        if (ids.has(rowId)) throw new Error("小说网出现重复的表或记录标识。");
        ids.add(rowId);
        return { id: rowId, cells: row.cells.map((cell) => checkedText(cell, "表格内容")), chapterId: checkedText(row.chapterId || "", "正文链接", 120) };
      }),
    };
  });
  const documents = (Array.isArray(input.documents) ? input.documents : []).map((document) => ({
    name: path.basename(checkedText(document.name || "说明", "资料名", 250)),
    text: checkedText(document.text, "说明文档", LIMITS.document),
  }));
  if (documents.length > 30) throw new Error("导入说明超过30份，请拆分网络。");
  const network = { id: checkedText(input.id || "", "小说网标识", 120), title: checkedText(input.title || "未命名小说网", "小说网标题", 200), notes: checkedText(input.notes || "", "小说网说明", LIMITS.document), tables, documents,
    revision: checkedText(input.revision || "", "保存版本", 64), createdAt: checkedText(input.createdAt || "", "创建时间", 40), updatedAt: checkedText(input.updatedAt || "", "修改时间", 40) };
  if (Buffer.byteLength(JSON.stringify(network)) > LIMITS.bytes) throw new Error("小说网超过4MB，请按幕或卷拆分。");
  return network;
}

function parseDocuments(documents) {
  const tables = [];
  for (const document of documents) {
    const lines = document.text.replace(/^\uFEFF/, "").split(/\r?\n/);
    let heading = path.basename(document.name, path.extname(document.name));
    let chapterTable = null;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      const headingMatch = line.match(/^#{1,6}\s+(.+)/);
      if (headingMatch) { heading = headingMatch[1]; chapterTable = null; continue; }
      const hasSeparator = line.includes("|") && lines[index + 1] && splitCells(lines[index + 1]).every((cell) => /^:?-{3,}:?$/.test(cell));
      const flatTable = line.includes("|") && ["线", "块", "真相", "已写章", "编号"].includes(splitCells(line)[0]) && lines[index + 1]?.includes("|");
      if (hasSeparator || flatTable) {
        const columns = splitCells(line);
        const table = { id: makeId("table"), title: heading, kind: tableKind(heading, columns), columns, rows: [] };
        index += hasSeparator ? 2 : 1;
        while (index < lines.length && lines[index].trim().includes("|")) {
          const cells = splitCells(lines[index]);
          if (cells.length !== columns.length) throw new Error(`${document.name}第${index + 1}行的表格列数与标题不符。`);
          table.rows.push({ id: makeId("row"), cells, chapterId: "" });
          index += 1;
        }
        index -= 1;
        tables.push(table);
        continue;
      }
      if (/^\d{1,4}\s*[｜|]/.test(line)) {
        const parts = line.includes("｜") ? line.split("｜").map((part) => part.trim()) : splitCells(line);
        if (parts.length < 3) continue;
        if (!chapterTable) { chapterTable = { id: makeId("table"), title: heading, kind: "chapters", columns: ["章号", "线程", "事件", "标记", "分块"], rows: [] }; tables.push(chapterTable); }
        chapterTable.rows.push({ id: makeId("row"), cells: [parts[0], parts[1], parts[2], parts.slice(3).join("｜"), heading], chapterId: "" });
      }
    }
  }
  return normalizeNetwork({ title: documents[0]?.text.match(/^#\s+(.+)$/m)?.[1] || "导入小说网", tables, documents });
}

module.exports = { KINDS, LIMITS, makeId, normalizeNetwork, parseDocuments, splitCells };
