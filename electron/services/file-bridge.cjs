"use strict";
// 外部软件文件桥（P74）：导出项目文件副本→外部程序编辑→侦测变化→预览确认回导。
// 沙箱/CSP 不允许嵌入外部窗口（C4），故采用文件级桥接；回导前 revision 校验，冲突即停。
// 导图双格式：.xmind（供 XMind 编辑，关系线/样式有损）+ .json（全保真，优先回导）。
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const AdmZip = require("adm-zip");
const { shell } = require("electron");
const { withProjectTransaction, sha256 } = require("./project-storage.cjs");
const { loadConfigUnlocked, getChapterPath, contentRevision, sanitizeFileName } = require("./project-files.cjs");
const { loadWorkspace, upsertItem } = require("./creative-workspace.cjs");
const { readXMindFile } = require("./mind-map-import.cjs");
const { saveChapterContent } = require("./project-content.cjs");

const BRIDGE_DIR = "bridge";

function bridgeDir(projectPath) {
  return path.join(projectPath, BRIDGE_DIR);
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function buildTopic(map, node) {
  const children = map.nodes.filter((item) => item.parentId === node.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return {
    id: node.id,
    title: node.text,
    ...(node.note ? { notes: { plain: { content: node.note } } } : {}),
    children: { attached: children.map((child) => buildTopic(map, child)) },
  };
}

function writeXMind(map, targetFile) {
  const root = map.nodes.find((node) => node.id === map.rootId) || map.nodes[0];
  const content = [{ id: map.id, class: "sheet", title: map.title, rootTopic: buildTopic(map, root) }];
  const zip = new AdmZip();
  zip.addFile("content.json", Buffer.from(JSON.stringify(content), "utf8"));
  zip.addFile("metadata.json", Buffer.from(JSON.stringify({ creator: { name: "AI小说创作平台", version: "0.4.2" } }), "utf8"));
  zip.addFile("manifest.json", Buffer.from(JSON.stringify({ "file-entries": { "content.json": {}, "metadata.json": {} } }), "utf8"));
  zip.writeZip(targetFile);
}

async function writeSidecar(filePath, meta) {
  const buffer = await fs.readFile(filePath);
  const sidecar = { ...meta, filePath: path.basename(filePath), sha256: sha256Buffer(buffer), exportedAt: new Date().toISOString() };
  await fs.writeFile(`${filePath}.bridge.json`, JSON.stringify(sidecar, null, 2), "utf8");
  return sidecar;
}

/** 导出副本到 bridge/（不修改项目内原文件）。 */
async function exportForBridge(projectPath, payload) {
  const kind = String(payload?.kind || "");
  const id = String(payload?.id || "");
  const dir = bridgeDir(projectPath);
  await fs.mkdir(dir, { recursive: true });
  if (kind === "mindmap") {
    const workspace = await loadWorkspace(projectPath);
    const map = (workspace.mindMaps || []).find((item) => item.id === id);
    if (!map) throw new Error("思维导图不存在。");
    const base = sanitizeFileName(map.title || "思维导图");
    const xmindFile = path.join(dir, `${base}.xmind`);
    const jsonFile = path.join(dir, `${base}.json`);
    writeXMind(map, xmindFile);
    await fs.writeFile(jsonFile, JSON.stringify(map, null, 2), "utf8");
    const revision = sha256(JSON.stringify(map));
    await writeSidecar(xmindFile, { kind: "mindmap", sourceId: map.id, sourceTitle: map.title, revision, lossy: "关系线/样式/位置不随 .xmind 往返；全保真请用同名 .json" });
    await writeSidecar(jsonFile, { kind: "mindmap-json", sourceId: map.id, sourceTitle: map.title, revision });
    return { files: [xmindFile, jsonFile], primary: xmindFile };
  }
  if (kind === "chapter") {
    const config = await loadConfigUnlocked(projectPath);
    const chapter = config.chapters.find((item) => item.id === id);
    if (!chapter) throw new Error("章节不存在。");
    const raw = await fs.readFile(getChapterPath(projectPath, chapter), "utf8");
    const extension = path.extname(chapter.fileName) || ".md";
    const target = path.join(dir, `${sanitizeFileName(chapter.title || chapter.fileName)}${extension}`);
    await fs.writeFile(target, raw, "utf8");
    await writeSidecar(target, { kind: "chapter", sourceId: chapter.id, sourceTitle: chapter.title, revision: contentRevision(raw) });
    return { files: [target], primary: target };
  }
  throw new Error("不支持的桥接类型（mindmap/chapter）。");
}

async function openExternal(projectPath, payload) {
  const filePath = String(payload?.filePath || "");
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(bridgeDir(projectPath)) + path.sep)) throw new Error("只能打开 bridge 目录内的导出文件。");
  const error = await shell.openPath(resolved);
  if (error) throw new Error(`无法打开外部程序：${error}。请确认已安装关联程序。`);
  return { opened: true };
}

/** 侦测 bridge 内导出文件的外部修改（哈希对比 sidecar）。 */
async function checkChanges(projectPath) {
  const dir = bridgeDir(projectPath);
  const entries = await fs.readdir(dir).catch(() => []);
  const changed = [];
  for (const entry of entries) {
    if (!entry.endsWith(".bridge.json")) continue;
    const sidecar = JSON.parse(await fs.readFile(path.join(dir, entry), "utf8").catch(() => "null"));
    if (!sidecar?.filePath) continue;
    const filePath = path.join(dir, sidecar.filePath);
    const buffer = await fs.readFile(filePath).catch(() => null);
    if (!buffer) continue;
    if (sha256Buffer(buffer) !== sidecar.sha256) changed.push({ ...sidecar, filePath });
  }
  return { changed };
}

async function readSidecar(projectPath, bridgeFile) {
  const resolved = path.resolve(String(bridgeFile || ""));
  if (!resolved.startsWith(path.resolve(bridgeDir(projectPath)) + path.sep)) throw new Error("非法的桥接文件路径。");
  const sidecar = JSON.parse(await fs.readFile(`${resolved}.bridge.json`, "utf8").catch(() => "null"));
  if (!sidecar) throw new Error("缺少桥接元数据，请重新导出。");
  return { resolved, sidecar };
}

/** 回导预览：xmind 解析画布；json/章节校验冲突。 */
async function reimportPreview(projectPath, payload) {
  const { resolved, sidecar } = await readSidecar(projectPath, payload?.bridgeFile);
  if (sidecar.kind === "mindmap") {
    const parsed = readXMindFile(resolved);
    return { kind: "mindmap", sourceId: sidecar.sourceId, sourceTitle: sidecar.sourceTitle, sheets: parsed.sheets.map((sheet) => ({ title: sheet.title, rootText: sheet.rootText, nodeCount: sheet.nodeCount, truncated: sheet.truncated })), lossy: sidecar.lossy || "" };
  }
  if (sidecar.kind === "mindmap-json") {
    const map = JSON.parse(await fs.readFile(resolved, "utf8"));
    if (!map?.id || !Array.isArray(map?.nodes)) throw new Error("JSON 导图格式无效。");
    return { kind: "mindmap-json", sourceId: sidecar.sourceId, sourceTitle: sidecar.sourceTitle, nodeCount: map.nodes.length };
  }
  if (sidecar.kind === "chapter") {
    const config = await loadConfigUnlocked(projectPath);
    const chapter = config.chapters.find((item) => item.id === sidecar.sourceId);
    if (!chapter) throw new Error("原章节已不存在，无法回导。");
    const current = await fs.readFile(getChapterPath(projectPath, chapter), "utf8");
    const conflict = contentRevision(current) !== sidecar.revision;
    const next = await fs.readFile(resolved, "utf8");
    return { kind: "chapter", sourceId: sidecar.sourceId, sourceTitle: chapter.title, conflict, preview: next.slice(0, 500) };
  }
  throw new Error("未知桥接类型。");
}

/** 确认回导：事务内写入；章节冲突即停。 */
async function reimportConfirm(projectPath, payload) {
  const { resolved, sidecar } = await readSidecar(projectPath, payload?.bridgeFile);
  return withProjectTransaction(projectPath, async () => {
    if (sidecar.kind === "mindmap" || sidecar.kind === "mindmap-json") {
      let map;
      if (sidecar.kind === "mindmap") {
        const parsed = readXMindFile(resolved);
        const sheetIndex = Number(payload?.sheetIndex) || 0;
        const sheet = parsed.sheets[sheetIndex];
        if (!sheet) throw new Error("画布序号无效。");
        map = sheet.map;
      } else {
        map = JSON.parse(await fs.readFile(resolved, "utf8"));
      }
      const workspace = await loadWorkspace(projectPath);
      const existing = (workspace.mindMaps || []).find((item) => item.id === sidecar.sourceId);
      const saved = await upsertItem(projectPath, "mindMaps", { ...map, id: sidecar.sourceId, title: existing?.title || map.title, createdAt: existing?.createdAt || map.createdAt, updatedAt: new Date().toISOString() });
      // 回导后更新 sidecar 哈希，避免重复提示
      await writeSidecar(resolved, { ...sidecar, revision: sha256(JSON.stringify(saved)) });
      return { kind: sidecar.kind, id: saved.id, nodeCount: (saved.nodes || []).length };
    }
    if (sidecar.kind === "chapter") {
      const config = await loadConfigUnlocked(projectPath);
      const chapter = config.chapters.find((item) => item.id === sidecar.sourceId);
      if (!chapter) throw new Error("原章节已不存在。");
      const current = await fs.readFile(getChapterPath(projectPath, chapter), "utf8");
      if (contentRevision(current) !== sidecar.revision) throw new Error("章节在导出后被修改，已停止回导。请在平台内合并后重新导出。");
      const next = await fs.readFile(resolved, "utf8");
      const result = await saveChapterContent(projectPath, { chapterId: chapter.id, content: next, expectedRevision: sidecar.revision });
      await writeSidecar(resolved, { ...sidecar, revision: contentRevision(next) });
      return { kind: "chapter", id: chapter.id, wordCount: result?.chapter?.wordCount };
    }
    throw new Error("未知桥接类型。");
  });
}

module.exports = { BRIDGE_DIR, bridgeDir, exportForBridge, openExternal, checkChanges, reimportPreview, reimportConfirm, writeXMind };