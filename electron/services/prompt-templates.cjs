"use strict";
// 自定义 AI 指令模板库（P82）：项目级存储 analysis/prompt-templates.json。
// 模板正文支持变量占位（{{书名}}/{{章节标题}}/{{分卷}}/{{选区文本}}），替换在渲染层完成；
// 服务只负责 CRUD 与导入导出校验。写操作走项目事务；上限拒绝不截断。
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { dialog } = require("electron");
const { readJson, writeJsonAtomic, withProjectTransaction } = require("./project-storage.cjs");
const { state } = require("./runtime-state.cjs");

const MAX_TEMPLATES = 200;
const MAX_TITLE = 80;
const MAX_BODY = 8000;
const KNOWN_VARIABLES = ["{{书名}}", "{{章节标题}}", "{{分卷}}", "{{选区文本}}"];

function templatesPath(projectPath) {
  return path.join(projectPath, "analysis", "prompt-templates.json");
}

function normalizeTemplate(value) {
  if (!value || typeof value !== "object") return null;
  const title = String(value.title || "").trim().slice(0, MAX_TITLE);
  const body = String(value.body || "").trim().slice(0, MAX_BODY);
  if (!title || !body) return null;
  return {
    id: String(value.id || `tpl_${randomUUID()}`),
    title,
    body,
    createdAt: String(value.createdAt || new Date().toISOString()),
    updatedAt: String(value.updatedAt || new Date().toISOString()),
  };
}

async function loadTemplates(projectPath) {
  const data = await readJson(templatesPath(projectPath), null);
  const templates = Array.isArray(data?.templates) ? data.templates.map(normalizeTemplate).filter(Boolean) : [];
  return { version: 1, templates: templates.slice(0, MAX_TEMPLATES), updatedAt: String(data?.updatedAt || "") };
}

async function listTemplates(projectPath) {
  return loadTemplates(projectPath);
}

async function saveTemplate(projectPath, payload) {
  return withProjectTransaction(projectPath, async () => {
    const data = await loadTemplates(projectPath);
    const incoming = normalizeTemplate({ ...payload, updatedAt: new Date().toISOString() });
    if (!incoming) throw new Error("模板标题和正文不能为空。");
    if (String(payload?.title || "").trim().length > MAX_TITLE) throw new Error(`模板标题最长 ${MAX_TITLE} 字。`);
    if (String(payload?.body || "").trim().length > MAX_BODY) throw new Error(`模板正文最长 ${MAX_BODY} 字。`);
    const index = data.templates.findIndex((item) => item.id === incoming.id);
    if (index >= 0) {
      incoming.createdAt = data.templates[index].createdAt;
      data.templates[index] = incoming;
    } else {
      if (data.templates.length >= MAX_TEMPLATES) throw new Error(`模板数量已达上限 ${MAX_TEMPLATES}，请先整理。`);
      incoming.createdAt = new Date().toISOString();
      data.templates.push(incoming);
    }
    data.updatedAt = new Date().toISOString();
    await writeJsonAtomic(templatesPath(projectPath), data);
    return data;
  });
}

async function deleteTemplate(projectPath, templateId) {
  return withProjectTransaction(projectPath, async () => {
    const data = await loadTemplates(projectPath);
    const next = data.templates.filter((item) => item.id !== String(templateId || ""));
    if (next.length === data.templates.length) throw new Error("模板不存在或已删除。");
    data.templates = next;
    data.updatedAt = new Date().toISOString();
    await writeJsonAtomic(templatesPath(projectPath), data);
    return data;
  });
}

async function exportTemplates(projectPath) {
  const data = await loadTemplates(projectPath);
  const selected = await dialog.showSaveDialog(state.mainWindow, {
    title: "导出指令模板",
    defaultPath: `指令模板-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (selected.canceled || !selected.filePath) return { canceled: true };
  await writeJsonAtomic(selected.filePath, { schema: "novel-prompt-templates/v1", exportedAt: new Date().toISOString(), templates: data.templates });
  return { canceled: false, filePath: selected.filePath, count: data.templates.length };
}

async function importTemplates(projectPath) {
  const selected = await dialog.showOpenDialog(state.mainWindow, {
    title: "导入指令模板",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (selected.canceled || !selected.filePaths.length) return { canceled: true };
  let parsed;
  try {
    parsed = JSON.parse(await require("node:fs/promises").readFile(selected.filePaths[0], "utf8"));
  } catch {
    throw new Error("模板文件无法解析，请选择本功能导出的 JSON。");
  }
  const incoming = (Array.isArray(parsed?.templates) ? parsed.templates : []).map(normalizeTemplate).filter(Boolean);
  if (!incoming.length) throw new Error("文件中没有可导入的模板。");
  return withProjectTransaction(projectPath, async () => {
    const data = await loadTemplates(projectPath);
    let added = 0;
    let skipped = 0;
    for (const template of incoming) {
      if (data.templates.some((item) => item.title === template.title && item.body === template.body)) { skipped += 1; continue; }
      if (data.templates.length >= MAX_TEMPLATES) throw new Error(`模板数量已达上限 ${MAX_TEMPLATES}，导入中止（已导入 ${added} 条）。`);
      data.templates.push({ ...template, id: `tpl_${randomUUID()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      added += 1;
    }
    data.updatedAt = new Date().toISOString();
    await writeJsonAtomic(templatesPath(projectPath), data);
    return { canceled: false, added, skipped, total: data.templates.length };
  });
}

module.exports = {
  MAX_TEMPLATES,
  KNOWN_VARIABLES,
  templatesPath,
  listTemplates,
  saveTemplate,
  deleteTemplate,
  exportTemplates,
  importTemplates,
};