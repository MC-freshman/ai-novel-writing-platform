// 本文件由 P2 重构自 electron/main.cjs 机械搬迁（scripts/refactor-split.cjs），逻辑未改动。
"use strict";

const { writeFileAtomic, writeJsonAtomic, withProjectTransaction, writeProjectFiles } = require("./project-storage.cjs");
const storyState = require("./story-state.cjs");
const { DEFAULT_CATEGORY } = require("./constants.cjs");
const __dep0 = require("./project-files.cjs");
const __dep1 = require("./credentials.cjs");
const __dep2 = require("./knowledge-index.cjs");
const __dep3 = require("./retrieval-pipeline.cjs");
const __dep4 = require("./ai-generate.cjs");
const __dep5 = require("./project-ops.cjs");
const fs = require("node:fs/promises");

function nowIso(...args) { return __dep0.nowIso.apply(null, args); }
function sanitizeFileName(...args) { return __dep0.sanitizeFileName(...args); }
function normalizeCategory(...args) { return __dep0.normalizeCategory(...args); }
function mapWithConcurrency(...args) { return __dep0.mapWithConcurrency(...args); }
function readJson(...args) { return __dep0.readJson(...args); }
function writeJson(...args) { return __dep0.writeJson(...args); }
function getAnalysisStatePath(...args) { return __dep0.getAnalysisStatePath(...args); }
function getIssueStatusPath(...args) { return __dep0.getIssueStatusPath(...args); }
function getChapterPath(...args) { return __dep0.getChapterPath(...args); }
function cachedChapterRevision(...args) { return __dep0.cachedChapterRevision(...args); }
function uniqueContentFileName(...args) { return __dep0.uniqueContentFileName(...args); }
function contentToPlainText(...args) { return __dep0.contentToPlainText(...args); }
function stripWorldDocFrontMatter(...args) { return __dep0.stripWorldDocFrontMatter(...args); }
function writeWorldDoc(...args) { return __dep0.writeWorldDoc(...args); }
function loadProjectSources(...args) { return __dep0.loadProjectSources(...args); }
function stableHash(...args) { return __dep0.stableHash(...args); }
function loadCharacters(...args) { return __dep0.loadCharacters(...args); }
function loadWorldDocs(...args) { return __dep0.loadWorldDocs(...args); }
function runtimeSecret(...args) { return __dep1.runtimeSecret(...args); }
function extractMetadata(...args) { return __dep2.extractMetadata(...args); }
function truncateForPrompt(...args) { return __dep3.truncateForPrompt(...args); }
function callChatApi(...args) { return __dep4.callChatApi(...args); }
function estimateTokenCount(...args) { return __dep4.estimateTokenCount(...args); }
function callStructuredChatWithProgress(...args) { return __dep4.callStructuredChatWithProgress(...args); }
function extractJsonFromModelText(...args) { return __dep4.extractJsonFromModelText(...args); }
function makeIdSet(...args) { return __dep4.makeIdSet(...args); }
function buildStructuringMaterials(...args) { return __dep4.buildStructuringMaterials(...args); }
function loadConfig(...args) { return __dep5.loadConfig(...args); }
function buildAppState(...args) { return __dep5.buildAppState(...args); }
function indexSources(...args) { return __dep5.indexSources(...args); }

function normalizeComparableTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[《》“”"'：:，,。.\s·_-]/g, "")
    .replace(/^(圣城|古城|王城|帝都|组织|势力|神器|物品|地点)/, "")
    .trim();
}


function findSimilarWorldDoc(title, docs) {
  const target = normalizeComparableTitle(title);
  if (!target) return null;
  let best = null;
  for (const doc of docs) {
    const candidate = normalizeComparableTitle(doc.title);
    if (!candidate) continue;
    const exact = candidate === target;
    const contains = candidate.includes(target) || target.includes(candidate);
    const score = exact ? 1 : contains ? Math.min(candidate.length, target.length) / Math.max(candidate.length, target.length) : 0;
    if (score > (best?.score || 0)) best = { doc, score };
  }
  return best && best.score >= 0.55 ? best.doc : null;
}


async function loadIssueStatuses(projectPath) {
  const data = await readJson(getIssueStatusPath(projectPath), {});
  return data && typeof data === "object" ? data : {};
}


async function saveIssueStatuses(projectPath, statuses) {
  await writeJson(getIssueStatusPath(projectPath), statuses || {});
}


async function loadAnalysisState(projectPath) {
  const data = await readJson(getAnalysisStatePath(projectPath), {});
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}


async function saveAnalysisState(projectPath, patch) {
  return withProjectTransaction(projectPath, async () => {
    const previous = await loadAnalysisState(projectPath);
    const next = { ...previous, ...(patch || {}), updatedAt: nowIso() };
    await writeJson(getAnalysisStatePath(projectPath), next);
    return next;
  });
}


function applyIssueStatuses(issues, statuses) {
  return issues.map((issue) => ({
    ...issue,
    status: statuses[issue.id]?.status || "待处理",
    statusUpdatedAt: statuses[issue.id]?.updatedAt || "",
  }));
}


function queryTokens(query) {
  const normalized = String(query || "").toLowerCase().trim();
  if (!normalized) return [];
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.includes(normalized)) tokens.unshift(normalized);
  return [...new Set(tokens)].slice(0, 8);
}


function makeSearchSnippet(text, tokens) {
  const content = String(text || "").replace(/\s+/g, " ").trim();
  if (!content) return "";
  const lower = content.toLowerCase();
  let index = -1;
  for (const token of tokens) {
    const found = lower.indexOf(token);
    if (found >= 0 && (index < 0 || found < index)) index = found;
  }
  if (index < 0) index = 0;
  const start = Math.max(0, index - 70);
  const end = Math.min(content.length, index + 150);
  return `${start > 0 ? "..." : ""}${content.slice(start, end)}${end < content.length ? "..." : ""}`;
}


async function globalSearch(projectPath, query) {
  const tokens = queryTokens(query);
  if (!tokens.length) return { query: "", results: [] };
  const { sources } = await loadProjectSources(projectPath);
  const results = sources
    .map((source) => {
      const haystack = `${source.title}\n${source.category || ""}\n${source.text}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        let index = haystack.indexOf(token);
        while (index >= 0) {
          score += token.length >= 4 ? 4 : 2;
          index = haystack.indexOf(token, index + token.length);
        }
        if (String(source.title || "").toLowerCase().includes(token)) score += 12;
        if (String(source.category || "").toLowerCase().includes(token)) score += 6;
      }
      return {
        id: `${source.sourceType}_${source.id}`,
        sourceId: source.id,
        sourceType: source.sourceType,
        title: source.title,
        volume: source.volume || "",
        category: source.category || "",
        updatedAt: source.updatedAt || "",
        score,
        snippet: makeSearchSnippet(source.text, tokens),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title), "zh-CN"))
    .slice(0, 80);
  return { query, results };
}


function extractTimeHints(text) {
  const matches = String(text || "").match(
    /(?:第[一二三四五六七八九十百千万零\d]+(?:年|月|日|天|夜|幕|卷|章)|[一二三四五六七八九十百千万零\d]+(?:年前|年后|个月前|个月后|日后|天后)|多年后|多年以前|很久以前|彼时|此后|后来|此前|清晨|黎明|上午|正午|午后|黄昏|傍晚|深夜|午夜|今日|昨日|明日|当天|当夜|同年|次年|翌日|\d{1,4}年(?:\d{1,2}月)?(?:\d{1,2}日)?)/g,
  );
  return [...new Set(matches || [])].slice(0, 4);
}


async function buildTimelineEvents(projectPath, options = {}) {
  const { chapters, characters } = await loadProjectSources(projectPath);
  const chapterIds = makeIdSet(options.chapterIds);
  const visibleChapters = chapterIds.size ? chapters.filter((chapter) => chapterIds.has(chapter.id)) : chapters;
  const characterNames = characters.map((item) => item.name).filter(Boolean);
  const events = [];
  let order = 0;

  for (const chapter of visibleChapters) {
    const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
    const plain = contentToPlainText(content);
    const paragraphs = plain
      .split(/\n+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 8);
    const candidates = [];
    for (const paragraph of paragraphs) {
      const timeHints = extractTimeHints(paragraph);
      if (timeHints.length) candidates.push({ title: timeHints[0], summary: paragraph, timeHint: timeHints.join("、") });
      if (candidates.length >= 5) break;
    }

    if (!candidates.length && Array.isArray(chapter.outline) && chapter.outline.length > 1) {
      for (const outline of chapter.outline.slice(1, 6)) {
        candidates.push({ title: outline.title, summary: `章节小标题：${outline.title}`, timeHint: "" });
      }
    }

    if (!candidates.length && paragraphs[0]) {
      candidates.push({ title: chapter.title, summary: paragraphs[0], timeHint: "" });
    }

    for (const candidate of candidates) {
      const metadata = extractMetadata(candidate.summary, characterNames);
      events.push({
        id: `event_${chapter.id}_${order}`,
        order,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        volume: chapter.volume || "未分卷",
        title: candidate.title || chapter.title,
        timeHint: candidate.timeHint,
        summary: candidate.summary.slice(0, 220),
        characters: metadata.characters.slice(0, 8),
      });
      order += 1;
    }
  }

  return { events: events.slice(0, 300), options: { mode: "local", chapterIds: [...chapterIds], knowledgeSourceIds: Array.isArray(options.knowledgeSourceIds) ? options.knowledgeSourceIds : [] } };
}


function normalizeTimelinePayload(payload, chapters, characterNames) {
  const items = Array.isArray(payload?.events) ? payload.events : [];
  return items
    .map((item, index) => {
      const chapterTitle = String(item.chapterTitle || "").trim();
      const chapter =
        chapters.find((chapter) => chapter.title === chapterTitle) ||
        chapters.find((chapter) => chapterTitle && chapter.title.includes(chapterTitle)) ||
        chapters[Math.min(index, Math.max(0, chapters.length - 1))];
      const summary = String(item.summary || item.detail || "").trim();
      const characters = Array.isArray(item.characters)
        ? item.characters.map((name) => String(name || "").trim()).filter(Boolean)
        : characterNames.filter((name) => summary.includes(name)).slice(0, 8);
      return {
        id: `ai_event_${stableHash(`${index}_${item.title}_${summary}`)}`,
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
        chapterId: chapter?.id || "",
        chapterTitle: chapter?.title || chapterTitle || "未指定章节",
        volume: chapter?.volume || String(item.volume || "未分卷"),
        title: String(item.title || item.timeHint || chapter?.title || "剧情事件").trim(),
        timeHint: String(item.timeHint || "").trim(),
        summary: summary.slice(0, 260),
        characters: characters.slice(0, 8),
      };
    })
    .filter((item) => item.summary)
    .sort((a, b) => a.order - b.order)
    .slice(0, 300)
    .map((item, index) => ({ ...item, order: index }));
}


async function buildAiTimelineEvents(projectPath, options = {}, control = {}) {
  const materials = await buildStructuringMaterials(projectPath, "时间线 事件 起因 结果 转折 冲突 章节顺序", options);
  const { chapters, characters } = await loadProjectSources(projectPath);
  const characterNames = characters.map((item) => item.name).filter(Boolean);
  const systemPrompt = `你是长篇小说剧情时间线整理助手。请只基于用户提供的材料，提取真实剧情事件，不要把目录标题当作事件。只输出 JSON，不要解释。
JSON 格式必须是：
{"events":[{"order":0,"title":"","timeHint":"","chapterTitle":"","volume":"","summary":"","characters":[""]}]}
要求：
1. 按剧情发生顺序排序。
2. title 写事件名，不要只写章节名。
3. summary 写起因、行动、结果，尽量具体。
4. timeHint 没有明确时间就留空。
5. 不要编造材料中没有的事件。`;
  const question = `请从下面材料整理小说真实剧情时间线，最多 120 个事件。

【检索片段】
${materials.retrieved || "无"}

【大纲与正文】
${materials.corpus}`;
  const answer = await callStructuredChatWithProgress(materials.config, systemPrompt, question, control, "AI 正在识别剧情事件");
  const events = normalizeTimelinePayload(extractJsonFromModelText(answer), chapters, characterNames);
  if (!events.length) throw new Error("AI 没有返回可识别的剧情事件。");
  return { events, contextCount: materials.search.chunks.length, apiError: "", options: { mode: "ai", chapterIds: Array.isArray(options.chapterIds) ? options.chapterIds : [], knowledgeSourceIds: Array.isArray(options.knowledgeSourceIds) ? options.knowledgeSourceIds : [] } };
}


function addRelationEdge(edgeMap, source, target, weight, label, evidence) {
  if (!source || !target || source === target) return;
  const ordered = [source, target].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const key = `${ordered[0]}__${ordered[1]}`;
  const current = edgeMap.get(key) || { id: key, source: ordered[0], target: ordered[1], label, weight: 0, evidence: [] };
  current.weight += weight;
  if (label && !current.label.includes(label)) current.label = current.label ? `${current.label}、${label}` : label;
  if (evidence && current.evidence.length < 3) current.evidence.push(evidence);
  edgeMap.set(key, current);
}


async function buildRelationshipGraph(projectPath, options = {}) {
  const { chapters, characters } = await loadProjectSources(projectPath);
  const selectedNames = new Set(Array.isArray(options.characterNames) ? options.characterNames.filter(Boolean) : []);
  const categoryFilter = normalizeCategory(options.categoryFilter || "");
  const customTypes = (Array.isArray(options.relationTypes) ? options.relationTypes : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 30);
  const categoryCharacters =
    categoryFilter && categoryFilter !== DEFAULT_CATEGORY
      ? characters.filter((item) => {
          const category = normalizeCategory(item.category);
          return category === categoryFilter || category.startsWith(`${categoryFilter}/`);
        })
      : characters;
  const visibleCharacters = selectedNames.size ? categoryCharacters.filter((item) => selectedNames.has(item.name)) : categoryCharacters;
  const names = visibleCharacters.map((item) => item.name).filter(Boolean);
  const mentionCounts = new Map(names.map((name) => [name, 0]));
  const edgeMap = new Map();

  function labelsFromText(text, fallback) {
    const matched = customTypes.filter((type) => String(text || "").includes(type));
    return matched.length ? matched.join("、") : fallback;
  }

  for (const card of visibleCharacters) {
    const relationshipText = String(card.relationships || "");
    for (const target of names) {
      if (target !== card.name && relationshipText.includes(target)) {
        addRelationEdge(edgeMap, card.name, target, 4, labelsFromText(relationshipText, "关系设定"), relationshipText.slice(0, 120));
      }
    }
  }

  for (const chapter of chapters) {
    const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
    const paragraphs = contentToPlainText(content)
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
    for (const paragraph of paragraphs) {
      const present = names.filter((name) => paragraph.includes(name)).slice(0, 8);
      present.forEach((name) => mentionCounts.set(name, (mentionCounts.get(name) || 0) + 1));
      for (let i = 0; i < present.length; i += 1) {
        for (let j = i + 1; j < present.length; j += 1) {
          addRelationEdge(edgeMap, present[i], present[j], 1, labelsFromText(paragraph, "同场"), `《${chapter.title}》：${paragraph.slice(0, 120)}`);
        }
      }
    }
  }

  const nodes = visibleCharacters.map((card) => ({
    id: card.name,
    name: card.name,
    category: normalizeCategory(card.category),
    size: Math.min(26, 10 + Math.sqrt(mentionCounts.get(card.name) || 0) * 3),
    notes: card.notes || "",
  }));
  const edges = [...edgeMap.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 120)
    .map((edge) => ({ ...edge, weight: Math.min(12, edge.weight) }));
  return { nodes, edges, options: { characterNames: [...selectedNames], categoryFilter: categoryFilter === DEFAULT_CATEGORY ? "" : categoryFilter, relationTypes: customTypes } };
}


function normalizeConsistencyIssues(payload) {
  const items = Array.isArray(payload?.issues) ? payload.issues : [];
  return items
    .map((item, index) => ({
      id: `issue_${stableHash(`${item.category || ""}_${item.title || ""}_${item.detail || ""}_${index}`)}`,
      severity: ["高", "中", "低"].includes(String(item.severity)) ? String(item.severity) : "中",
      category: String(item.category || "其他").trim() || "其他",
      title: String(item.title || "未命名问题").trim(),
      detail: String(item.detail || "").trim(),
      suggestion: String(item.suggestion || "").trim(),
      evidence: Array.isArray(item.evidence) ? item.evidence.map((text) => String(text).trim()).filter(Boolean).slice(0, 4) : [],
    }))
    .filter((item) => item.title && item.detail)
    .slice(0, 30);
}


async function buildLocalConsistencyIssues(projectPath, options = {}) {
  const { chapters, characters, worldDocs } = await loadProjectSources(projectPath);
  const chapterIds = makeIdSet(options.chapterIds);
  const sourceIds = makeIdSet(options.knowledgeSourceIds);
  const visibleChapters = chapterIds.size ? chapters.filter((chapter) => chapterIds.has(chapter.id)) : chapters;
  const visibleCharacters = sourceIds.size ? characters.filter((card) => sourceIds.has(card.id)) : characters;
  const visibleWorldDocs = sourceIds.size ? worldDocs.filter((doc) => sourceIds.has(doc.id)) : worldDocs;
  const issues = [];
  const titleMap = new Map();
  for (const chapter of visibleChapters) {
    const key = `${chapter.volume || ""}/${chapter.title || ""}`;
    titleMap.set(key, [...(titleMap.get(key) || []), chapter]);
    if ((chapter.wordCount || 0) < 20) {
      issues.push({
        id: `local_short_${chapter.id}`,
        severity: "低",
        category: "章节",
        title: `《${chapter.title}》内容较少`,
        detail: "这个章节或导入文档的字数很少，可能是空章节、占位章节或导入不完整。",
        suggestion: "检查该章节正文是否已经写入，或重新导入原文档。",
        evidence: [`${chapter.volume || "未分卷"} / ${chapter.title}`],
      });
    }
  }
  for (const [key, items] of titleMap.entries()) {
    if (items.length > 1) {
      issues.push({
        id: `local_duplicate_${sanitizeFileName(key)}`,
        severity: "中",
        category: "章节",
        title: `重复章节标题：${items[0].title}`,
        detail: "同一分组下出现重复章节标题，后续整书导出或检索时可能不容易分辨。",
        suggestion: "给重复条目补充编号、用途或版本说明。",
        evidence: items.map((item) => `${item.volume || "未分卷"} / ${item.title}`),
      });
    }
  }
  for (const card of visibleCharacters) {
    if (!String(card.background || card.personality || card.relationships || "").trim()) {
      issues.push({
        id: `local_empty_character_${card.id}`,
        severity: "低",
        category: "角色",
        title: `${card.name} 的角色卡信息较少`,
        detail: "这个角色缺少背景、性格和关系说明，后续 AI 检索时能利用的信息有限。",
        suggestion: "补充角色目标、秘密、阵营和关键关系。",
        evidence: [normalizeCategory(card.category)],
      });
    }
  }
  const worldTitleMap = new Map();
  for (const doc of visibleWorldDocs) {
    worldTitleMap.set(doc.title, [...(worldTitleMap.get(doc.title) || []), doc]);
    if (contentToPlainText(doc.content).length < 20) {
      issues.push({
        id: `local_short_world_${doc.id}`,
        severity: "低",
        category: "世界观",
        title: `世界观条目《${doc.title}》内容较少`,
        detail: "该设定条目几乎没有正文，AI 检索时能提供的信息有限。",
        suggestion: "补充规则、限制、关联角色或剧情作用。",
        evidence: [doc.category || "未分类"],
      });
    }
  }
  for (const [title, items] of worldTitleMap.entries()) {
    if (items.length > 1) {
      issues.push({
        id: `local_duplicate_world_${sanitizeFileName(title)}`,
        severity: "中",
        category: "世界观",
        title: `重复世界观标题：${title}`,
        detail: "多个世界观条目使用了相同标题，后续维护时容易混淆。",
        suggestion: "合并重复条目，或用更具体的标题区分。",
        evidence: items.map((item) => item.category || "未分类"),
      });
    }
  }
  return issues.slice(0, 40);
}


async function analyzeConsistency(projectPath, options = {}, control = {}) {
  const localIssues = await buildLocalConsistencyIssues(projectPath, options);
  const statuses = await loadIssueStatuses(projectPath);
  const materials = await buildStructuringMaterials(projectPath, "设定矛盾 时间线 冲突 角色 动机 世界规则 前后不一致", options);
  const systemPrompt = `你是长篇小说设定校对助手。请只基于用户提供的大纲、正文和检索片段，找出可能的前后矛盾、设定冲突、角色动机断裂、时间线问题。只输出 JSON，不要 Markdown，不要解释。
JSON 格式必须是：
{"issues":[{"severity":"高","category":"时间线","title":"","detail":"","evidence":[""],"suggestion":""}]}
要求：
1. severity 只能是 高、中、低。
2. category 可用：时间线、角色、世界观、剧情、章节、其他。
3. evidence 写引用到的章节名、设定名或简短原文。
4. 不确定的问题标为低，不要把风格建议当矛盾。`;
  const question = `请检查下面材料中的设定一致性问题，最多返回 20 条最值得处理的问题。

【检索片段】
${materials.retrieved || "无"}

【大纲与正文】
${materials.corpus}`;

  try {
    const answer = await callStructuredChatWithProgress(materials.config, systemPrompt, question, control, "AI 正在核对一致性问题");
    const aiIssues = normalizeConsistencyIssues(extractJsonFromModelText(answer));
    const seen = new Set();
    const issues = [...aiIssues, ...localIssues].filter((item) => {
      const key = `${item.category}_${item.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      issues: applyIssueStatuses(issues, statuses),
      contextCount: materials.search.chunks.length,
      apiError: "",
      options: {
        chapterIds: Array.isArray(options.chapterIds) ? options.chapterIds : [],
        knowledgeSourceIds: Array.isArray(options.knowledgeSourceIds) ? options.knowledgeSourceIds : [],
      },
    };
  } catch (error) {
    return {
      issues: applyIssueStatuses(localIssues, statuses),
      contextCount: materials.search.chunks.length,
      apiError: error.message || String(error),
      options: {
        chapterIds: Array.isArray(options.chapterIds) ? options.chapterIds : [],
        knowledgeSourceIds: Array.isArray(options.knowledgeSourceIds) ? options.knowledgeSourceIds : [],
      },
    };
  }
}


function normalizeExtractedWorldCards(payload) {
  const items = Array.isArray(payload?.worldDocs) ? payload.worldDocs : Array.isArray(payload?.cards) ? payload.cards : [];
  return items
    .map((item) => {
      const title = String(item.title || item.name || "").trim();
      const type = ["地点", "势力", "物品"].includes(String(item.type)) ? String(item.type) : "设定";
      const rawCategory = String(item.category || type).replace(/\s+/g, " ").trim();
      const category = rawCategory.startsWith(type) ? rawCategory : `${type}/${rawCategory}`;
      const content = String(item.content || item.description || "").trim();
      return {
        title,
        category,
        content: content.startsWith("#") ? content : `# ${title}\n\n${content}`,
      };
    })
    .filter((item) => item.title && item.content.replace(/^#.+/m, "").trim())
    .slice(0, 60);
}


async function buildExtractionMaterials(projectPath, options = {}) {
  const selectedText = contentToPlainText(String(options.text || "")).trim();
  if (selectedText) {
    const config = await loadConfig(projectPath);
    return {
      config,
      search: { chunks: [], embeddingSource: "selection", embeddingWarning: "" },
      retrieved: "",
      corpus: `【选中文字】\n${truncateForPrompt(selectedText, 20000)}`,
    };
  }
  const scope = options.scope === "chapter" ? "chapter" : "book";
  if (scope !== "chapter") {
    return buildStructuringMaterials(projectPath, "地点 城市 国家 大陆 势力 组织 家族 教会 物品 神器 道具 材料");
  }
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === options.chapterId);
  if (!chapter) throw new Error("请选择要提取资料的当前文档。");
  const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
  return {
    config,
    search: { chunks: [], embeddingSource: "local", embeddingWarning: "" },
    retrieved: "",
    corpus: `【${chapter.volume || "未分卷"}｜${chapter.title}】\n${contentToPlainText(content)}`,
  };
}


async function prepareWorldCardCandidates(projectPath, options = {}) {
  const materials = await buildExtractionMaterials(projectPath, options);
  const existing = await loadWorldDocs(projectPath);
  const existingTitles = existing.map((item) => item.title).filter(Boolean).join("、") || "暂无";
  const systemPrompt = `你是小说资料拆分助手。请只基于用户提供的大纲和检索片段，提取地点、势力、物品三类资料，并整理成世界观条目。只输出 JSON，不要 Markdown 解释。
JSON 格式必须是：
{"worldDocs":[{"type":"地点","title":"","category":"","content":""}]}
要求：
1. type 只能是 地点、势力、物品。
2. category 用分级分类，例如 地点/城市、地点/大陆、势力/教会、势力/家族、物品/神器、物品/材料。
3. content 使用 Markdown，第一行 # 标题，后面写来源、作用、相关角色、剧情功能、限制或疑点。
4. 不要编造材料中没有的信息。
5. 已有世界观标题：${existingTitles}`;
  const question = `请从下面材料中提取地点、势力、物品条目，最多 45 条，优先选择后续写作和检索会反复用到的资料。

【检索片段】
${materials.retrieved || "无"}

【大纲材料】
${materials.corpus}`;
  const answer = await callChatApi(materials.config, systemPrompt, question, []);
  const generated = normalizeExtractedWorldCards(extractJsonFromModelText(answer));
  if (!generated.length) throw new Error("AI 没有生成可识别的地点、势力或物品候选。");
  const candidates = generated.map((item, index) => {
    const matched = findSimilarWorldDoc(item.title, existing);
    return {
      id: `candidate_${stableHash(`${index}_${item.title}_${item.category}`)}`,
      title: item.title,
      category: item.category,
      content: item.content,
      selected: true,
      action: matched ? "merge" : "create",
      matchedDocId: matched?.id || "",
      matchedTitle: matched?.title || "",
    };
  });
  return { candidates, contextCount: materials.search.chunks.length, scope: options.scope === "chapter" ? "chapter" : "book" };
}


async function saveWorldCardCandidates(projectPath, candidates) {
  const selected = (Array.isArray(candidates) ? candidates : []).filter((item) => item?.selected !== false);
  if (!selected.length) throw new Error("请至少勾选一个要写入的资料条目。");
  const existing = await loadWorldDocs(projectPath);
  let created = 0;
  let updated = 0;
  const indexedSources = [];
  for (const item of selected) {
    const previous = existing.find((doc) => doc.id === item.matchedDocId) || findSimilarWorldDoc(item.title, existing);
    const fileName = previous?.fileName || (await uniqueContentFileName(projectPath, "worldbuilding", item.title, ".md"));
    const mergedContent =
      previous && item.action === "merge"
        ? `${stripWorldDocFrontMatter(previous.content).trim()}\n\n## 新提取资料 ${new Date().toLocaleDateString("zh-CN")}\n\n${stripWorldDocFrontMatter(item.content).replace(/^#.+\n?/, "").trim()}`
        : item.content;
    const doc = {
      id: previous?.id || fileName.replace(/\.md$/i, ""),
      title: item.title,
      category: normalizeCategory(item.category || previous?.category),
      fileName,
      content: mergedContent,
      updatedAt: nowIso(),
    };
    await writeWorldDoc(projectPath, doc);
    indexedSources.push({ id: doc.id, type: "world", title: doc.title, content: doc.content });
    if (previous) updated += 1;
    else created += 1;
  }
  await indexSources(projectPath, indexedSources);
  return {
    state: await buildAppState(projectPath),
    created,
    updated,
    count: selected.length,
    titles: selected.map((item) => item.title),
  };
}


async function refreshLocalStoryState(projectPath, chapterId, contentOverride = null, context = {}) {
  const config = context.config || await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error("章节不存在，无法更新创作状态。");
  const content = contentOverride === null ? await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "") : String(contentOverride || "");
  const characters = context.characters || await loadCharacters(projectPath);
  const ledger = storyState.analyzeChapterLocally({ chapter, content, characters });
  return storyState.saveChapterLedger(projectPath, ledger);
}


async function getStoryOverviewForProject(projectPath, options = {}) {
  const config = await loadConfig(projectPath);
  const projectChapters = await mapWithConcurrency(config.chapters, 8, async (chapter) => {
    return { id: chapter.id, title: chapter.title, volume: chapter.volume || "未分卷", revision: await cachedChapterRevision(projectPath, chapter) };
  });
  return storyState.getStoryOverview(projectPath, { chapterLimit: 500, ...options, projectChapters });
}


function storyAnalysisSystemPrompt() {
  return `你是小说项目的剧情事实整理工具。只记录输入正文中可以直接找到证据的事实，不要补写、推测或完善设定。
输出 JSON，不要 Markdown，不要解释。格式：
{"facts":[{"type":"剧情事件","subject":"","predicate":"","object":"","confidence":0.8,"evidence":[{"quote":"原文短句"}]}],"characterStates":[{"characterName":"","location":"","route":["行动路线"],"physical":["身体状态"],"mental":["精神状态"],"abilities":["能力变化"],"goals":["当前目标"],"obstacles":["当前阻碍"],"knowledge":["已知信息"],"knowledgeSources":["信息来源"],"possessions":["携带物品"],"relationships":["当前关系"],"relationshipChanges":["关系变化"],"lastAppearance":"最近一次出场原句","confidence":0.8,"evidence":[{"quote":"原文短句"}]}],"foreshadows":[{"title":"","description":"","stage":"埋设|强化|回收","plannedPayoff":"","relatedCharacters":[""],"confidence":0.7,"evidence":[{"quote":"原文短句"}]}]}
事实类型优先使用：剧情事件、地点变化、物品变化、知情变化、关系变化、状态变化。
每一条都必须带正文中的原句证据；没有证据就不要输出。角色“知道什么”必须严格区分叙述者信息与角色知情范围，并在 knowledgeSources 中写清得知渠道。伏笔如果是既有线索的强化或回收，沿用同一简洁标题并准确填写 stage。`;
}


async function analyzeStoryStateWithAI(projectPath, chapterId, control = {}) {
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error("章节不存在，无法执行 AI 剧情分析。");
  const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
  const characters = await loadCharacters(projectPath);
  const localLedger = storyState.analyzeChapterLocally({ chapter, content, characters });
  if (!runtimeSecret(config.api, "chat")) {
    const saved = await storyState.saveChapterLedger(projectPath, localLedger);
    return { ledger: saved, apiError: "未配置聊天 API，已完成本地基础分析。" };
  }
  const characterCatalog = characters.slice(0, 120).map((item) => `${item.name}${item.category ? `（${item.category}）` : ""}`).join("、");
  const question = `【章节】${chapter.volume || "未分卷"} / ${chapter.title}
【已有角色卡】${characterCatalog || "无"}
【正文】
${truncateForPrompt(contentToPlainText(content), 70000)}`;
  let partialOutput = "";
  let lastCheckpointAt = 0;
  const promptTokens = estimateTokenCount(`${storyAnalysisSystemPrompt()}\n${question}`);
  await control.update?.({ usage: { promptTokens, completionTokens: 0, totalTokens: promptTokens } });
  const answer = await callChatApi(config, storyAnalysisSystemPrompt(), question, [], {
    stream: true,
    signal: control.signal,
    onToken: (token) => {
      partialOutput += token;
      if (Date.now() - lastCheckpointAt < 900) return;
      lastCheckpointAt = Date.now();
      if (typeof control.update === "function") {
        const completionTokens = estimateTokenCount(partialOutput);
        void control.update({
          phase: `正在分析《${chapter.title}》`,
          partialOutput,
          usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
        });
      }
    },
  });
  const completionTokens = estimateTokenCount(answer);
  await control.update?.({ partialOutput: answer, usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens } });
  const normalized = storyState.normalizeAiChapterAnalysis(extractJsonFromModelText(answer), chapter, localLedger.sourceRevision, characters);
  const usefulLedger = normalized.facts.length || normalized.characterStates.length || normalized.foreshadows.length ? normalized : localLedger;
  const saved = await storyState.saveChapterLedger(projectPath, usefulLedger);
  return { ledger: saved, partialOutput: answer, apiError: usefulLedger === localLedger ? "AI 返回结构无法识别，已保留本地分析结果。" : "" };
}


const __moduleExports = {
  normalizeComparableTitle,
  findSimilarWorldDoc,
  loadIssueStatuses,
  saveIssueStatuses,
  loadAnalysisState,
  saveAnalysisState,
  applyIssueStatuses,
  queryTokens,
  makeSearchSnippet,
  globalSearch,
  extractTimeHints,
  buildTimelineEvents,
  normalizeTimelinePayload,
  buildAiTimelineEvents,
  addRelationEdge,
  buildRelationshipGraph,
  normalizeConsistencyIssues,
  buildLocalConsistencyIssues,
  analyzeConsistency,
  normalizeExtractedWorldCards,
  buildExtractionMaterials,
  prepareWorldCardCandidates,
  saveWorldCardCandidates,
  refreshLocalStoryState,
  getStoryOverviewForProject,
  storyAnalysisSystemPrompt,
  analyzeStoryStateWithAI,
};

// Augment the original exports object so cyclic requires (whose captured
// reference may be a Proxy over the pre-assignment exports) see every key.
Object.assign(module.exports, __moduleExports);
module.exports = __moduleExports;
