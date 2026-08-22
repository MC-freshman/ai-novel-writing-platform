const fs = require("node:fs");
const path = require("node:path");

const WORKSPACE = path.resolve(__dirname, "..");
const APP_PATH = path.join(WORKSPACE, "src", "App.tsx");
const PRELOAD_PATH = path.join(WORKSPACE, "electron", "preload.cjs");
const MAIN_PATH = path.join(WORKSPACE, "electron", "main.cjs");
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const REPORT_PATH = path.join(WORKSPACE, `UI按钮与功能入口审计报告_${RUN_ID}.md`);

const appSource = fs.readFileSync(APP_PATH, "utf8");
const preloadSource = fs.readFileSync(PRELOAD_PATH, "utf8");
const mainSource = fs.readFileSync(MAIN_PATH, "utf8");

const results = [];

function addResult(scope, name, status, detail = "") {
  results.push({ scope, name, status, detail });
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function statusText(status) {
  if (status === "PASS") return "通过";
  if (status === "FAIL") return "失败";
  if (status === "WARN") return "警告";
  return status;
}

function stripLabel(raw) {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[^{}]*\}/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isInsideForm(source, index) {
  const before = source.slice(0, index);
  return before.lastIndexOf("<form") > before.lastIndexOf("</form>");
}

function extractButtonElements(source) {
  const items = [];
  const regex = /<button\b/g;
  let match;
  while ((match = regex.exec(source))) {
    const start = match.index;
    const tagEnd = findTagEnd(source, start);
    const tag = source.slice(start, tagEnd + 1);
    regex.lastIndex = tagEnd + 1;
    const close = source.indexOf("</button>", regex.lastIndex);
    const body = close >= 0 ? source.slice(regex.lastIndex, close) : "";
    items.push({
      tag,
      body,
      index: start,
      line: lineOf(source, start),
      label: stripLabel(body),
      insideForm: isInsideForm(source, start),
    });
  }
  return items;
}

function findTagEnd(source, start) {
  let braceDepth = 0;
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    const previous = source[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === ">" && braceDepth === 0) return index;
  }
  return start;
}

function extractSummaryElements(source) {
  const items = [];
  const regex = /<summary\b[\s\S]*?>([\s\S]*?)<\/summary>/g;
  let match;
  while ((match = regex.exec(source))) {
    items.push({
      tag: match[0],
      body: match[1],
      index: match.index,
      line: lineOf(source, match.index),
      label: stripLabel(match[1]),
    });
  }
  return items;
}

function auditButtons() {
  const buttons = extractButtonElements(appSource);
  const missingAction = [];
  const missingAccessibleName = [];

  for (const button of buttons) {
    const hasDirectAction = /\bonClick=|\bonMouseDown=|\bonSubmit=/.test(button.tag);
    const isSubmit = /\btype=["']submit["']/.test(button.tag) || (!/\btype=/.test(button.tag) && button.insideForm);
    if (!hasDirectAction && !isSubmit) {
      missingAction.push(`第 ${button.line} 行：${button.label || button.tag.slice(0, 120)}`);
    }

    const hasTitle = /\btitle=|\baria-label=/.test(button.tag);
    const hasTextLabel = button.label.length > 0;
    const hasDynamicLabel = /\{\s*(action|prompt|status|item\.label|mode\.label|group\.category|card\.name|doc\.title)\s*\}/.test(button.body) || /\{\s*saving\s*\?/.test(button.body);
    if (!hasTitle && !hasTextLabel && !hasDynamicLabel) {
      missingAccessibleName.push(`第 ${button.line} 行：${button.tag.slice(0, 120)}`);
    }
  }

  addResult("一、按钮动作", "按钮总数", "PASS", `共发现 ${buttons.length} 个按钮元素。`);
  addResult("一、按钮动作", "无动作按钮", missingAction.length ? "FAIL" : "PASS", missingAction.length ? missingAction.join("\n") : "未发现没有点击动作或提交语义的按钮。");
  addResult(
    "一、按钮动作",
    "按钮名称/提示",
    missingAccessibleName.length ? "WARN" : "PASS",
    missingAccessibleName.length ? missingAccessibleName.join("\n") : "所有图标按钮都有标题或可见文字。",
  );
}

function auditSummaries() {
  const summaries = extractSummaryElements(appSource);
  const empty = summaries.filter((item) => !item.label).map((item) => `第 ${item.line} 行`);
  addResult("二、折叠入口", "折叠入口总数", "PASS", `共发现 ${summaries.length} 个 details/summary 折叠入口。`);
  addResult("二、折叠入口", "折叠入口文字", empty.length ? "FAIL" : "PASS", empty.length ? empty.join("\n") : "所有折叠入口都有可见文字。");
}

function auditApiBindings() {
  const usedApiNames = [...new Set([...appSource.matchAll(/window\.novelAPI\.([A-Za-z0-9_]+)/g)].map((match) => match[1]))].sort();
  const exposedApiNames = [...new Set([...preloadSource.matchAll(/\n\s*([A-Za-z0-9_]+):\s*\([^)]*\)\s*=>/g)].map((match) => match[1]))].sort();
  const invokePairs = [...preloadSource.matchAll(/\n\s*([A-Za-z0-9_]+):\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\(["']([^"']+)["']/g)].map((match) => ({
    name: match[1],
    channel: match[2],
  }));
  const handledChannels = new Set([...mainSource.matchAll(/ipcMain\.handle\(["']([^"']+)["']/g)].map((match) => match[1]));

  const exposedSet = new Set(exposedApiNames);
  const missingPreload = usedApiNames.filter((name) => !exposedSet.has(name));
  const missingHandlers = invokePairs.filter((item) => !handledChannels.has(item.channel));

  addResult("三、前后端连接", "前端调用接口", missingPreload.length ? "FAIL" : "PASS", missingPreload.length ? `前端调用但 preload 未暴露：${missingPreload.join("、")}` : `前端调用的 ${usedApiNames.length} 个 novelAPI 方法均已暴露。`);
  addResult("三、前后端连接", "后端处理入口", missingHandlers.length ? "FAIL" : "PASS", missingHandlers.length ? missingHandlers.map((item) => `${item.name} -> ${item.channel}`).join("\n") : `preload 中 ${invokePairs.length} 个 invoke 接口均有后端处理。`);
}

function auditFeatureCoverage() {
  const required = [
    ["项目新建", /新建小说项目|createProject/],
    ["打开项目", /打开小说项目|openProject/],
    ["导入文档", /导入文档|importDocument/],
    ["保存当前文档", /保存当前章节|saveChapter/],
    ["导出当前 DOCX", /导出当前章节|exportChapterDocx/],
    ["导出正文/整书", /导出正文|exportBookDocx/],
    ["备份", /导出压缩备份|exportBackup/],
    ["重建索引", /重建知识库索引|rebuildIndex/],
    ["章节管理", /<ChapterTree|章节/],
    ["富文档编辑", /<RichDocumentEditor|富文档/],
    ["查找替换", /findNextInChapter|replaceAllInChapter|查找替换/],
    ["角色卡片", /<CharacterManager|角色卡片/],
    ["世界观", /<WorldManager|世界观/],
    ["知识库整理", /<KnowledgeOrganizer|知识库整理/],
    ["AI 对话", /<ChatPanel|AI 助手|askAI/],
    ["创作参谋", /创作参谋|getCreativeAdvice/],
    ["全局搜索", /全局搜索|globalSearch/],
    ["时间线", /时间线|buildTimeline/],
    ["关系网", /关系网|buildRelationshipGraph/],
    ["一致性检查", /一致性|analyzeConsistency/],
    ["历史版本", /历史版本|listChapterVersions|compareChapterVersion/],
    ["导出选项", /includeOutline|includeCharacters|includeWorld/],
    ["候选提取", /extractWorldCardsFromOutline|生成候选/],
    ["试验功能", /试验功能|ExperimentalTools/],
    ["设置", /<SettingsModal|模型和项目设置/],
  ];
  const missing = required.filter(([, pattern]) => !pattern.test(appSource)).map(([name]) => name);
  addResult("四、功能入口覆盖", "核心功能入口", missing.length ? "FAIL" : "PASS", missing.length ? `缺少入口：${missing.join("、")}` : `已覆盖 ${required.length} 类核心功能入口。`);
}

function auditDuplicateLabels() {
  const buttons = extractButtonElements(appSource).filter((button) => button.label);
  const map = new Map();
  for (const button of buttons) {
    const key = button.label.replace(/\s+/g, "");
    if (!key) continue;
    map.set(key, [...(map.get(key) || []), button.line]);
  }
  const allowed = new Set(["关闭", "删除", "取消", "全选", "导出正文", "导出当前DOCX", "备份", "重建索引", "设置", "导入文档", "保存素材", "开始检查", "刷新关系网", "保存并加入知识库"]);
  const duplicates = [...map.entries()]
    .filter(([label, lines]) => lines.length > 1 && !allowed.has(label))
    .map(([label, lines]) => `${label}：第 ${lines.join("、")} 行`);
  addResult("五、重复入口", "重复按钮文案", duplicates.length ? "WARN" : "PASS", duplicates.length ? duplicates.join("\n") : "未发现明显多余的重复按钮文案；允许的重复项属于顶部/功能面板快捷入口或列表内批量操作。");
}

function writeReport() {
  const counts = results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const lines = [
    "# UI按钮与功能入口审计报告",
    "",
    `生成时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    "",
    "## 结果汇总",
    "",
    `- 通过：${counts.PASS || 0}`,
    `- 警告：${counts.WARN || 0}`,
    `- 失败：${counts.FAIL || 0}`,
    "",
    "## 明细",
    "",
  ];
  let currentScope = "";
  for (const item of results) {
    if (item.scope !== currentScope) {
      currentScope = item.scope;
      lines.push(`### ${currentScope}`, "");
    }
    lines.push(`- ${statusText(item.status)}：${item.name}`);
    if (item.detail) {
      lines.push("");
      lines.push("```text");
      lines.push(item.detail);
      lines.push("```");
      lines.push("");
    }
  }
  fs.writeFileSync(REPORT_PATH, `${lines.join("\n")}\n`, "utf8");
  return { reportPath: REPORT_PATH, counts };
}

auditButtons();
auditSummaries();
auditApiBindings();
auditFeatureCoverage();
auditDuplicateLabels();

const output = writeReport();
console.log(JSON.stringify(output, null, 2));
if ((output.counts.FAIL || 0) > 0) process.exit(1);
