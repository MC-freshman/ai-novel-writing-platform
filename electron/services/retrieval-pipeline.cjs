// 本文件由 P2 重构自 electron/main.cjs 机械搬迁（scripts/refactor-split.cjs），逻辑未改动。
"use strict";

const { consumeChatStream } = require("./chat-stream.cjs");
const storyState = require("./story-state.cjs");
const vectorShards = require("./vector-shards.cjs");
const creativeWorkspace = require("./creative-workspace.cjs");
const retrievalPlanner = require("./retrieval-planner.cjs");
const { MAX_RETRIEVAL_TOP_K, MAX_RETRIEVAL_SCAN_K, DEFAULT_RETRIEVAL_SCAN_K, CHAT_CONTEXT_MIN_CHUNKS, CHAT_CONTEXT_CHAR_BUDGET, CHAT_API_TIMEOUT_MS, CHAT_HISTORY_MESSAGE_MAX_CHARS, CHAT_HISTORY_TOTAL_MAX_CHARS, USER_QUESTION_SYSTEM_PREVIEW_CHARS, SELECTED_TEXT_PROMPT_MAX_CHARS } = require("./constants.cjs");
const __dep0 = require("./project-files.cjs");
const __dep1 = require("./knowledge-index.cjs");
const __dep2 = require("./project-ops.cjs");

function normalizeCategory(...args) { return __dep0.normalizeCategory(...args); }
function clampNumber(...args) { return __dep0.clampNumber(...args); }
function formatBytes(...args) { return __dep0.formatBytes(...args); }
function loadCharacters(...args) { return __dep0.loadCharacters(...args); }
function loadWorldDocs(...args) { return __dep0.loadWorldDocs(...args); }
function getKnowledgeRole(...args) { return __dep0.getKnowledgeRole(...args); }
function knowledgeRoleLabel(...args) { return __dep0.knowledgeRoleLabel(...args); }
function characterToMarkdown(...args) { return __dep0.characterToMarkdown(...args); }
function ensureKnowledgeFreshnessForRetrieval(...args) { return __dep1.ensureKnowledgeFreshnessForRetrieval(...args); }
function compactSearchText(...args) { return __dep1.compactSearchText(...args); }
function lexicalRelevanceScore(...args) { return __dep1.lexicalRelevanceScore(...args); }
function loadKnowledgeSummaries(...args) { return __dep1.loadKnowledgeSummaries(...args); }
function searchRelevantChunks(...args) { return __dep1.searchRelevantChunks(...args); }
function loadConfig(...args) { return __dep2.loadConfig(...args); }

const RETRIEVAL_MODE_LABELS = {
  auto: "自动判断",
  inventory: "资料盘点",
  chapter: "指定章节",
  entity: "角色/设定聚焦",
  book: "全书分析",
  current: "当前文档",
  normal: "普通问答",
};


function safeEndpointLabel(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return String(url || "");
  }
}


function describeFetchError(error) {
  const parts = [];
  if (error?.name) parts.push(error.name);
  if (error?.message) parts.push(error.message);
  const cause = error?.cause;
  if (cause) {
    const causeParts = [cause.code, cause.name, cause.message].filter(Boolean);
    if (causeParts.length) parts.push(`底层原因：${causeParts.join(" / ")}`);
    const networkParts = [cause.syscall, cause.address, cause.port].filter(Boolean);
    if (networkParts.length) parts.push(`网络信息：${networkParts.join(" ")}`);
  }
  if (!parts.length) parts.push(String(error || "未知网络错误"));
  return [...new Set(parts)].join("；");
}


function compactChatHistory(history = []) {
  const compact = [];
  let usedChars = 0;
  for (const item of history.slice().reverse()) {
    if (item?.role !== "user" && item?.role !== "assistant") continue;
    if (usedChars >= CHAT_HISTORY_TOTAL_MAX_CHARS) break;
    const raw = String(item.content || "").trim();
    if (!raw) continue;
    const remaining = CHAT_HISTORY_TOTAL_MAX_CHARS - usedChars;
    const maxChars = Math.min(CHAT_HISTORY_MESSAGE_MAX_CHARS, remaining);
    const content = truncateForPrompt(raw, maxChars);
    compact.push({ role: item.role, content });
    usedChars += content.length;
  }
  return compact.reverse();
}


async function fetchJsonWithDiagnostics(url, payload, headers, label, options = {}) {
  const body = JSON.stringify(payload);
  const bodyBytes = Buffer.byteLength(body, "utf8");
  const timeoutMs = Math.max(0, Number(CHAT_API_TIMEOUT_MS) || 0);
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: options.signal || controller?.signal,
    });
    return { response, bodyBytes };
  } catch (error) {
    const timeoutHint = error?.name === "AbortError" && timeoutMs > 0 ? `请求超过 ${Math.round(timeoutMs / 1000)} 秒未完成，已自动中断。` : "";
    const sizeHint = bodyBytes > 1024 * 1024 ? "请求体超过 1MB，可能被本地代理、网关或安全软件中断。" : "如果问题很长，可减少引用片段上限或拆成几次提问。";
    throw new Error(`${label}本地连接失败：${describeFetchError(error)}\n请求地址：${safeEndpointLabel(url)}\n请求体大小：${formatBytes(bodyBytes)}。${timeoutHint}${sizeHint}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}


function extractOpenAiCompatibleAnswer(data) {
  return String(data?.choices?.[0]?.message?.content || data?.message?.content || data?.output_text || "").trim();
}




async function fetchOpenAiCompatibleStream(url, payload, headers, label, onToken, options = {}) {
  const body = JSON.stringify({ ...payload, stream: true });
  const bodyBytes = Buffer.byteLength(body, "utf8");
  const timeoutMs = Math.max(0, Number(CHAT_API_TIMEOUT_MS) || 0);
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(new Error("timeout")), timeoutMs) : null;
  let answer = "";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`${label}请求失败：${response.status} ${detail.slice(0, 400)}\n请求地址：${safeEndpointLabel(url)}\n请求体大小：${formatBytes(bodyBytes)}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!response.body || contentType.includes("application/json")) {
      const data = /** @type {any} */ (await response.json());
      if (data.error) throw new Error(`提供商错误：${data.error.message || data.error.type || "未知错误"}`);
      options.onUsage?.(data.usage);
      answer = extractOpenAiCompatibleAnswer(data);
      if (answer) onToken?.(answer);
      return answer || "模型返回了空内容。";
    }

    return await consumeChatStream(response, onToken, { ...options, signal: externalSignal });
  } catch (error) {
    if (externalSignal?.aborted) return answer.trim() || "【已停止生成，停止前尚未收到模型输出。】";
    if (String(error?.message || "").includes(`${label}请求失败`)) throw error;
    const timeoutHint = error?.name === "AbortError" && timeoutMs > 0 ? `请求超过 ${Math.round(timeoutMs / 1000)} 秒未完成，已自动中断。` : "";
    throw new Error(`${label}本地连接失败：${describeFetchError(error)}\n请求地址：${safeEndpointLabel(url)}\n请求体大小：${formatBytes(bodyBytes)}。${timeoutHint}如果网络中断，但模型已经开始输出，软件会保留已经收到的内容。`);
  } finally {
    if (timer) clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}


function truncateForPrompt(value, maxChars) {
  const text = String(value || "").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n【内容过长，已截断】`;
}


function buildProjectSourceCatalog(config, characters, worldDocs) {
  const chapters = (config.chapters || [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((chapter) => `- ${knowledgeRoleLabel(getKnowledgeRole(chapter))}｜${chapter.volume || "未分卷"}｜${chapter.title}`)
    .join("\n");
  const characterLines = (characters || [])
    .map((card) => `- ${card.name}｜${normalizeCategory(card.category)}`)
    .join("\n");
  const worldLines = (worldDocs || [])
    .map((doc) => `- ${doc.title}｜${normalizeCategory(doc.category)}`)
    .join("\n");
  return [
    "【章节与资料文档】",
    chapters || "- 暂无章节或资料文档",
    "【角色卡】",
    characterLines || "- 暂无角色卡",
    "【世界观条目】",
    worldLines || "- 暂无世界观条目",
  ].join("\n");
}


async function collectPromptMaterials(projectPath, retrievedChunks, question = "") {
  const config = await loadConfig(projectPath);
  const characters = await loadCharacters(projectPath);
  const worldDocs = await loadWorldDocs(projectPath);
  const sourceCatalog = buildProjectSourceCatalog(config, characters, worldDocs);
  const characterNames = new Set();
  const worldIds = new Set();
  const questionText = String(question || "");
  for (const chunk of retrievedChunks || []) {
    if (chunk.sourceType === "character") characterNames.add(chunk.title);
    if (chunk.sourceType === "world") worldIds.add(chunk.sourceId);
    for (const name of chunk.metadata?.characters || []) characterNames.add(name);
  }
  for (const card of characters) {
    if (card.name && questionText.includes(card.name)) characterNames.add(card.name);
  }
  for (const doc of worldDocs) {
    if (doc.title && questionText.includes(doc.title)) worldIds.add(doc.id);
  }
  const relevantCharacters = characters.filter((card) => characterNames.has(card.name)).slice(0, 12);
  const relevantWorldDocs = worldDocs.filter((doc) => worldIds.has(doc.id)).slice(0, 10);
  const characterIndex = characters.map((card) => `${card.name}（${normalizeCategory(card.category)}）`).slice(0, 80).join("；");
  const worldIndex = worldDocs.map((doc) => `${doc.title}（${normalizeCategory(doc.category)}）`).slice(0, 80).join("；");
  const characterCards = relevantCharacters.length
    ? relevantCharacters.map((card) => truncateForPrompt(characterToMarkdown(card), 900)).join("\n\n")
    : `角色索引：${characterIndex || "暂无角色卡"}`;
  const worldbuilding = relevantWorldDocs.length
    ? relevantWorldDocs.map((doc) => truncateForPrompt(`# ${doc.title}\n分类：${normalizeCategory(doc.category)}\n${doc.content}`, 1000)).join("\n\n")
    : `世界观索引：${worldIndex || "暂无世界观条目"}`;
  const retrievedContext = retrievedChunks
    .map((item, index) => {
      const sourceName = item.sourceType === "chapter" ? "章节" : item.sourceType === "character" ? "角色卡" : "世界观";
      return `【片段${index + 1}｜${sourceName}｜${item.title}｜相关度 ${item.score.toFixed(3)}】\n${item.text}`;
    })
    .join("\n\n");
  return { characterCards, worldbuilding, retrievedContext, sourceCatalog };
}


function buildProjectMemorySummary(snapshot, extraMemory = "") {
  const manualMemory = [String(snapshot?.aiProjectMemory || "").trim(), String(extraMemory || "").trim()].filter(Boolean).join("\n").slice(0, 3000);
  const sessions = Array.isArray(snapshot?.chatSessions) ? snapshot.chatSessions : [];
  const sessionLines = sessions
    .slice()
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, 10)
    .map((session) => {
      const messages = Array.isArray(session.messages) ? session.messages : [];
      const recentUserMessages = messages
        .filter((message) => message.role === "user")
        .slice(-3)
        .map((message) => String(message.content || "").replace(/\s+/g, " ").slice(0, 120))
        .filter(Boolean);
      if (!recentUserMessages.length) return "";
      return `- ${String(session.title || "会话").slice(0, 40)}：${recentUserMessages.join("；")}`;
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 2500);
  return [manualMemory ? `【手动项目记忆】\n${manualMemory}` : "", sessionLines ? `【最近会话摘要】\n${sessionLines}` : ""].filter(Boolean).join("\n\n");
}


function buildSystemPrompt({ retrievedContext, characterCards, worldbuilding, sourceCatalog, hierarchicalContext, projectMemory, userQuestion, selectedText, retrieval, inventorySummary }) {
  const questionPreview = truncateForPrompt(userQuestion, USER_QUESTION_SYSTEM_PREVIEW_CHARS);
  const selected = selectedText
    ? `\n【用户选中的文本】\n"""\n${truncateForPrompt(selectedText, SELECTED_TEXT_PROMPT_MAX_CHARS)}\n"""\n`
    : "";
  const memory = projectMemory
    ? `\n【项目内 AI 记忆】\n${projectMemory}\n`
    : "";
  return `你是一位专业的小说创作助手。用户正在创作一部小说，你将基于小说的已有内容为其提供建议。

【本次检索模式】
${retrieval ? `${retrieval.modeLabel || retrieval.mode}；候选扫描 ${retrieval.candidateCount || 0}/${retrieval.scannedCount || 0} 片段；实际发送 ${retrieval.contextCount || 0} 片段。${retrieval.catalogUsed ? "已使用项目资料目录兜底。" : ""}` : "普通检索。"}
${retrieval?.notes?.length ? retrieval.notes.map((note) => `- ${note}`).join("\n") : ""}

【项目资料目录】
${sourceCatalog || "暂无项目资料目录。"}

【项目资料盘点清单】
${inventorySummary || "未生成资料盘点清单。"}

【分层知识库摘要】
${hierarchicalContext || "暂无分层摘要；请以原始检索片段为准。"}

【检索到的小说内容】
${retrievedContext || "没有检索到相关片段。"}

【角色设定】
${characterCards || "暂无角色设定。"}

【世界观设定】
${worldbuilding || "暂无世界观设定。"}
${memory}
${selected}
规则：
1. 你的回答必须基于上述提供的小说内容，不要编造未出现的信息。
2. 如果用户的问题在提供的内容中没有答案，请明确说明“根据已有内容，暂时无法回答这个问题”。
3. 回答时可以引用具体的章节或段落。
4. 如果用户要求创作建议，请结合小说的风格、角色性格和已有情节给出建议。
5. “项目内 AI 记忆”只用于承接用户偏好、已确认方向和跨会话沟通，不可替代检索片段中的事实设定；涉及具体剧情和设定时优先以检索片段、角色卡和世界观为准。
6. 如果“项目资料目录”列出了某个章节或资料，但“检索到的小说内容”没有对应片段，不要说该资料不存在；应说明“目录中存在，但本次未检索到具体片段”。
7. 当用户询问“有哪些资料、有哪些章节、有哪些角色卡、知识库里有什么”时，优先依据“项目资料目录”给出完整清单，再说明哪些资料在本次检索片段中出现。
8. 保持专业、鼓励性的语气。

用户问题预览：${questionPreview || "见用户消息"}`;
}


function normalizeRetrievalMode(value) {
  return Object.prototype.hasOwnProperty.call(RETRIEVAL_MODE_LABELS, String(value || "")) ? String(value) : "auto";
}


function classifyRetrievalMode(question, requestedMode = "auto", config = {}, selectedChapterId = "") {
  const manual = normalizeRetrievalMode(requestedMode);
  if (manual !== "auto") return manual;
  const text = String(question || "");
  if (/当前(章节|文档|正文)|这[一这]章|本章/.test(text) && selectedChapterId) return "current";
  if (/(有哪些|知识库|资料|清单|列表|盘点|已导入|已有).*(章节|正文|资料|文档|角色|世界观|设定)|章节.*(有哪些|清单|列表|缺少|统计)|知识库里有什么/.test(text)) return "inventory";
  if (/第[零〇一二三四五六七八九十百千万\d]+章|序章|终章|\d+\s*[.、]\s*第/.test(text)) return "chapter";
  if (/(全书|全文|整体|全部|所有|整本|长篇|五百万|500万|全局).*(分析|检查|梳理|整理|时间线|一致性|节奏|伏笔|人物|设定)|检查.*(全书|全文|整体|全部|所有)/.test(text)) return "book";
  const chapters = Array.isArray(config.chapters) ? config.chapters : [];
  if (chapters.some((chapter) => chapter.title && text.includes(chapter.title))) return "chapter";
  return "normal";
}


function normalizeTitleForMatch(value) {
  return compactSearchText(value)
    .replace(/^\d+/, "")
    .replace(/^第[零〇一二三四五六七八九十百千万\d]+章/, "");
}


function findMentionedChapters(config, question, selectedChapterId = "", mode = "normal") {
  const chapters = (config.chapters || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (mode === "current" && selectedChapterId) return chapters.filter((chapter) => chapter.id === selectedChapterId);
  const text = String(question || "");
  const compactQuestion = compactSearchText(text);
  const matches = [];
  for (const chapter of chapters) {
    const title = String(chapter.title || "");
    const compactTitle = compactSearchText(title);
    if (!compactTitle) continue;
    const titleNoPrefix = normalizeTitleForMatch(title);
    const orderNumber = (chapter.order ?? -1) + 1;
    const patterns = [
      title,
      compactTitle,
      titleNoPrefix,
      `第${orderNumber}章`,
      `${orderNumber}.`,
      `${orderNumber}、`,
    ].filter(Boolean);
    const matched = patterns.some((pattern) => {
      const raw = String(pattern || "");
      return raw && (text.includes(raw) || compactQuestion.includes(compactSearchText(raw)));
    });
    if (matched) matches.push(chapter);
  }
  return matches;
}


function findMentionedSourceIds(question, characters, worldDocs) {
  const text = String(question || "");
  const compactQuestion = compactSearchText(text);
  const ids = [];
  for (const card of characters || []) {
    const name = String(card.name || "");
    if (name && (text.includes(name) || compactQuestion.includes(compactSearchText(name)))) ids.push(card.id);
  }
  for (const doc of worldDocs || []) {
    const title = String(doc.title || "");
    if (title && (text.includes(title) || compactQuestion.includes(compactSearchText(title)))) ids.push(doc.id);
  }
  return [...new Set(ids)];
}


function buildInventorySummary(config, characters, worldDocs, manifest) {
  const chunkCounts = new Map((manifest?.sources || []).map((entry) => [entry.sourceId, Number(entry.chunkCount || 0)]));
  const chapters = (config.chapters || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const chapterLines = (role) =>
    chapters
      .filter((chapter) => getKnowledgeRole(chapter) === role)
      .map((chapter) => `- ${chapter.volume || "未分卷"}｜${chapter.title}｜${chunkCounts.get(chapter.id) || 0} 片段`)
      .join("\n") || "- 无";
  const characterLines = (characters || []).map((card) => `- ${card.name}｜${normalizeCategory(card.category)}｜${chunkCounts.get(card.id) || 0} 片段`).join("\n") || "- 无";
  const worldLines = (worldDocs || []).map((doc) => `- ${doc.title}｜${normalizeCategory(doc.category)}｜${chunkCounts.get(doc.id) || 0} 片段`).join("\n") || "- 无";
  return [
    `知识库总片段：${Number(manifest?.totalChunks || 0)}`,
    "【正文章节】",
    chapterLines("正文"),
    "【大纲】",
    chapterLines("大纲"),
    "【补充材料】",
    chapterLines("补充材料"),
    "【角色卡】",
    characterLines,
    "【世界观】",
    worldLines,
  ].join("\n");
}




function appendCoverageChunks(chunks, store, sourceIds, maxChunks, maxChars = Number.POSITIVE_INFINITY) {
  const selected = Array.isArray(chunks) ? chunks.slice() : [];
  const existingChunkIds = new Set(selected.map((item) => item.id));
  const existingSourceIds = new Set(selected.map((item) => item.sourceId));
  let totalChars = selected.reduce((sum, item) => sum + String(item.text || "").length, 0);
  for (const sourceId of sourceIds) {
    if (selected.length >= maxChunks) break;
    if (existingSourceIds.has(sourceId)) continue;
    const entry = (store.vectors || []).find((item) => item.sourceId === sourceId && !existingChunkIds.has(item.id));
    if (!entry) continue;
    const entryChars = String(entry.text || "").length;
    if (totalChars + entryChars > maxChars) continue;
    selected.push({
      ...entry,
      score: Number(entry.score || 0.001),
      vectorScore: Number(entry.vectorScore || 0),
      keywordScore: Number(entry.keywordScore || 0),
    });
    existingChunkIds.add(entry.id);
    existingSourceIds.add(sourceId);
    totalChars += entryChars;
  }
  return selected;
}


function forceIncludeSourceChunks(chunks, store, sourceIds, maxChunks) {
  const selected = Array.isArray(chunks) ? chunks.slice(0, maxChunks) : [];
  const included = new Set(selected.map((item) => item.sourceId));
  for (const sourceId of sourceIds) {
    if (included.has(sourceId)) continue;
    const entry = (store.vectors || []).find((item) => item.sourceId === sourceId);
    if (!entry) continue;
    if (selected.length >= maxChunks) selected.pop();
    selected.push({ ...entry, score: Math.max(Number(entry.score || 0), 2), vectorScore: Number(entry.vectorScore || 0), keywordScore: Number(entry.keywordScore || 0) });
    included.add(sourceId);
  }
  return selected.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}


function summarizeRetrieval(chunks, config, characters, worldDocs, mode, requestedMode, search, options = {}) {
  const chaptersById = new Map((config.chapters || []).map((chapter) => [chapter.id, chapter]));
  const characterIds = new Set((characters || []).map((item) => item.id));
  const worldIds = new Set((worldDocs || []).map((item) => item.id));
  const includedTitles = [];
  const includedSet = new Set();
  const categoryCounts = {};
  for (const chunk of chunks || []) {
    const chapter = chaptersById.get(chunk.sourceId);
    const sourceLabel = chapter ? knowledgeRoleLabel(getKnowledgeRole(chapter)) : characterIds.has(chunk.sourceId) ? "角色卡" : worldIds.has(chunk.sourceId) ? "世界观" : "其他";
    categoryCounts[sourceLabel] = (categoryCounts[sourceLabel] || 0) + 1;
    const key = `${sourceLabel}_${chunk.title}`;
    if (!includedSet.has(key)) {
      includedSet.add(key);
      includedTitles.push(`${sourceLabel}｜${chunk.title}`);
    }
  }
  const allChapterTitles = (config.chapters || []).map((chapter) => chapter.title);
  const includedChapterTitles = new Set((chunks || []).filter((chunk) => chaptersById.has(chunk.sourceId)).map((chunk) => chunk.title));
  const existingButNotRead = allChapterTitles.filter((title) => !includedChapterTitles.has(title));
  const existingButNotReadSources = (config.chapters || [])
    .filter((chapter) => !includedChapterTitles.has(chapter.title))
    .map((chapter) => ({ sourceId: chapter.id, title: chapter.title, group: chapter.volume || "未分卷" }));
  return {
    requestedMode,
    mode,
    modeLabel: RETRIEVAL_MODE_LABELS[mode] || mode,
    catalogUsed: Boolean(options.catalogUsed),
    inventoryUsed: Boolean(options.inventoryUsed),
    scanLimit: options.scanLimit || 0,
    sendLimit: options.sendLimit || 0,
    scannedCount: search?.scannedCount || 0,
    candidateCount: search?.candidateCount || 0,
    contextCount: chunks?.length || 0,
    documentCount: includedTitles.length,
    includedTitles: includedTitles.slice(0, 80),
    existingButNotRead: existingButNotRead.slice(0, 120),
    existingButNotReadSources: existingButNotReadSources.slice(0, 500),
    categoryCounts,
    notes: options.notes || [],
    plannedTitles: options.plannedTitles || [],
    layersUsed: options.layersUsed || [],
    additionalSourceIds: options.additionalSourceIds || [],
    subQueries: options.subQueries || [],
    routedVolumes: options.routedVolumes || [],
    coverageByVolume: options.coverageByVolume || [],
    rawChapterCoverage: options.rawChapterCoverage || { selected: 0, total: 0 },
    coverageWarnings: options.coverageWarnings || [],
    selectedSourceReasons: options.selectedSourceReasons || [],
    skippedSourceReasons: options.skippedSourceReasons || [],
    firstPassCount: Number(search?.coveragePass?.firstPassCount || chunks?.length || 0),
    secondPassCount: Number(search?.coveragePass?.secondPassCount || 0),
    evidenceTargets: search?.coveragePass?.targets || [],
    uncoveredTargets: search?.coveragePass?.uncoveredTargets || [],
    addedSources: search?.coveragePass?.addedSources || [],
    evidenceConfidence: search?.coveragePass?.evidenceConfidence || (chunks?.length ? "中" : "低"),
    evidenceCoverageRatio: Number(search?.coveragePass?.coverageRatio || 0),
    freshness: search?.freshness || null,
  };
}


function contextFromChunks(chunks) {
  return (chunks || []).map((item) => ({
    id: item.id,
    title: item.title,
    sourceType: item.sourceType,
    score: item.score,
    vectorScore: item.vectorScore,
    keywordScore: item.keywordScore,
    entityScore: item.entityScore,
    adjacencyScore: item.adjacencyScore,
    storyScore: item.storyScore,
    subQueryScore: item.subQueryScore,
    matchedSubQuery: item.matchedSubQuery,
    knowledgeRole: item.knowledgeRole,
    volume: item.volume,
    category: item.category,
    text: item.text,
    metadata: item.metadata,
  }));
}


function planHierarchicalRetrieval(question, summaries, mode) {
  const rankedSources = (summaries.sources || [])
    .map((item) => ({
      ...item,
      score: lexicalRelevanceScore(
        { title: item.title, volume: item.volume, category: item.category, knowledgeRole: item.knowledgeRole, text: item.summary },
        question,
      ),
    }))
    .sort((a, b) => b.score - a.score);
  const sourceLimit = mode === "book" ? 240 : mode === "inventory" ? 120 : 80;
  const routedSources = rankedSources.filter((item) => item.score > 0).slice(0, sourceLimit);
  const fallbackSources = routedSources.length ? routedSources : rankedSources.slice(0, Math.min(24, sourceLimit));
  const relevantGroups = new Set(fallbackSources.map((item) => item.volume || item.category).filter(Boolean));
  const volumes = (summaries.volumes || []).filter((item) => mode === "book" || relevantGroups.has(item.title)).slice(0, mode === "book" ? 80 : 12);
  const hierarchyContext = [
    summaries.book?.summary ? `【全书结构摘要｜${summaries.book.documentCount || 0} 份资料】\n${truncateForPrompt(summaries.book.summary, mode === "book" ? 8000 : 3000)}` : "",
    volumes.length
      ? `【分卷/分类摘要】\n${volumes.map((item) => `【${item.title}｜${item.documentCount} 份】${truncateForPrompt(item.summary, 1600)}`).join("\n")}`
      : "",
    fallbackSources.length
      ? `【候选文档摘要】\n${fallbackSources.slice(0, mode === "book" ? 60 : 24).map((item) => `- ${item.title}：${truncateForPrompt(item.summary, 420)}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, mode === "book" ? 30000 : 14000);
  return {
    sourceIds: fallbackSources.map((item) => item.sourceId),
    plannedTitles: fallbackSources.map((item) => item.title).slice(0, 80),
    hierarchyContext,
    layersUsed: [summaries.book?.summary ? "全书" : "", volumes.length ? "分卷" : "", fallbackSources.length ? "文档" : "", "原始片段"].filter(Boolean),
  };
}


async function buildChatRetrievalPackage(projectPath, config, payload, question) {
  const requestedMode = normalizeRetrievalMode(payload?.retrievalMode || "auto");
  const selectedChapterId = String(payload?.selectedChapterId || "");
  const characters = await loadCharacters(projectPath);
  const worldDocs = await loadWorldDocs(projectPath);
  let mode = classifyRetrievalMode(question, requestedMode, config, selectedChapterId);
  const mentionedEntityIds = findMentionedSourceIds(question, characters, worldDocs);
  if (mode === "normal" && requestedMode === "auto" && mentionedEntityIds.length) mode = "entity";
  const preliminaryChapters = findMentionedChapters(config, question, selectedChapterId, mode === "current" ? "current" : "chapter");
  const freshness = await ensureKnowledgeFreshnessForRetrieval(projectPath, {
    config,
    characters,
    worldDocs,
    question,
    mode,
    sourceIds: [...preliminaryChapters.map((item) => item.id), ...mentionedEntityIds],
    repairAll: mode === "book" || mode === "inventory",
  });
  const manifest = await vectorShards.migrateLegacyIfNeeded(projectPath);
  const summaries = await loadKnowledgeSummaries(projectPath);
  const sendLimit = Math.floor(clampNumber(config.api.topK || 120, 1, MAX_RETRIEVAL_TOP_K, 120));
  const scanLimit = Math.floor(clampNumber(config.api.scanK || DEFAULT_RETRIEVAL_SCAN_K, sendLimit, MAX_RETRIEVAL_SCAN_K, DEFAULT_RETRIEVAL_SCAN_K));
  const notes = [];
  if (freshness.repairedSourceCount) notes.push(`检索前自动更新了 ${freshness.repairedSourceCount} 份过期资料。`);
  if (freshness.deferredSourceCount) notes.push(`另有 ${freshness.deferredSourceCount} 份过期资料与本次问题无直接关联，未作为“不存在”处理。`);
  let sourceIds = [];
  let searchQuestion = question;
  let minKeep = Math.min(CHAT_CONTEXT_MIN_CHUNKS, sendLimit);
  let maxChars = CHAT_CONTEXT_CHAR_BUDGET;
  let catalogUsed = true;
  let inventoryUsed = false;
  const additionalSourceIds = [...new Set((Array.isArray(payload?.additionalSourceIds) ? payload.additionalSourceIds : []).map((item) => String(item || "")).filter(Boolean))];
  const subQueries = retrievalPlanner.decomposeQuery(question, mode);
  const querySignals = retrievalPlanner.extractQuerySignals(question, characters, worldDocs);

  if (mode === "inventory") {
    inventoryUsed = true;
    minKeep = Math.min(20, sendLimit);
    maxChars = Math.min(50000, CHAT_CONTEXT_CHAR_BUDGET);
    searchQuestion = `${question}\n资料 章节 正文 大纲 补充材料 角色卡 世界观 清单`;
    notes.push("资料盘点模式：完整清单来自项目配置与知识库索引，引用片段只作补充。");
  }

  if (mode === "current") {
    const current = findMentionedChapters(config, question, selectedChapterId, "current");
    sourceIds = current.map((chapter) => chapter.id);
    minKeep = Math.min(12, sendLimit);
    notes.push(sourceIds.length ? "当前文档模式：优先只读取当前打开文档。" : "当前文档模式未找到当前文档，已回退到普通检索。");
  }

  if (mode === "chapter") {
    const matched = findMentionedChapters(config, question, selectedChapterId, "chapter");
    sourceIds = matched.map((chapter) => chapter.id);
    minKeep = Math.min(24, sendLimit);
    notes.push(sourceIds.length ? `指定章节模式：已锁定 ${matched.map((item) => item.title).join("、")}。` : "指定章节模式未锁定章节，已回退到混合检索。");
  }

  if (mode === "entity") {
    sourceIds = mentionedEntityIds;
    minKeep = Math.min(18, sendLimit);
    notes.push(sourceIds.length ? "角色/设定聚焦模式：优先读取点名角色卡或世界观。" : "角色/设定聚焦模式未锁定资料，已回退到混合检索。");
  }

  if (mode === "book") {
    minKeep = Math.min(120, sendLimit);
    maxChars = CHAT_CONTEXT_CHAR_BUDGET;
    searchQuestion = `${question}\n全书 正文 大纲 角色 世界观 时间线 一致性 节奏 伏笔`;
    notes.push("全书分析模式：扩大候选扫描，并尽量补足正文章节覆盖。");
  }

  const mentionedChapters = findMentionedChapters(config, question, selectedChapterId, mode === "current" ? "current" : "chapter");
  const anchorChapterIds = [...new Set([selectedChapterId, ...mentionedChapters.map((item) => item.id)].filter(Boolean))];
  const adjacencyScores = retrievalPlanner.buildChapterAdjacency(config.chapters || [], anchorChapterIds);
  const workspaceState = await creativeWorkspace.loadWorkspace(projectPath).catch(() => ({}));
  const storyContext = anchorChapterIds[0]
    ? await storyState.getAgentContext(projectPath, anchorChapterIds[0], querySignals.characters, []).catch(() => ({}))
    : {};
  const storyScores = retrievalPlanner.buildStoryBoosts(workspaceState, storyContext, subQueries);
  const volumeCache = await retrievalPlanner.ensureVolumeCache(projectPath, { manifest, summaries, config });
  const routedVolumes = retrievalPlanner.rankVolumeCache(volumeCache, subQueries, mode, lexicalRelevanceScore);
  if (volumeCache.reused) notes.push("已复用分卷检索缓存。");
  if (subQueries.length > 1) notes.push(`已拆分为 ${subQueries.length} 个检索子问题。`);

  const hierarchyPlan = planHierarchicalRetrieval(searchQuestion, summaries, mode);
  const bodyIds = (config.chapters || []).filter((chapter) => getKnowledgeRole(chapter) === "正文").map((chapter) => chapter.id);
  const candidateSourceIds = mode === "book"
    ? [...(config.chapters || []).map((chapter) => chapter.id), ...characters.map((item) => item.id), ...worldDocs.map((item) => item.id)]
    : [...sourceIds, ...hierarchyPlan.sourceIds, ...routedVolumes.flatMap((item) => item.sourceIds || []), ...additionalSourceIds];
  const searchResult = await searchRelevantChunks(projectPath, searchQuestion, sendLimit, {
    sourceIds,
    candidateSourceIds,
    boostSourceIds: [...hierarchyPlan.sourceIds, ...routedVolumes.flatMap((item) => item.sourceIds || []), ...additionalSourceIds],
    scanLimit,
    minKeep,
    maxChars,
    retrievalContext: {
      subQueries,
      signals: querySignals,
      adjacencyScores,
      storyScores,
      routedVolumes: routedVolumes.map((item) => item.title),
      requiredSourceIds: [...sourceIds, ...additionalSourceIds],
    },
    mode,
    freshness,
    skipFreshnessCheck: true,
  });
  const { _store: store, ...search } = searchResult;
  let chunks = search.chunks;
  if (mode === "book") {
    chunks = appendCoverageChunks(chunks, store, bodyIds, sendLimit, maxChars);
  }
  if (mode === "chapter" || mode === "current") {
    chunks = appendCoverageChunks(chunks, store, sourceIds, sendLimit, maxChars);
  }
  if (additionalSourceIds.length) {
    chunks = forceIncludeSourceChunks(chunks, store, additionalSourceIds, sendLimit);
    notes.push(`用户补选了 ${additionalSourceIds.length} 份资料。`);
  }
  const materials = { ...(await collectPromptMaterials(projectPath, chunks, question)), hierarchicalContext: hierarchyPlan.hierarchyContext };
  const inventorySummary = buildInventorySummary(config, characters, worldDocs, manifest);
  const coverage = retrievalPlanner.buildCoverageAudit(chunks, config, summaries, manifest);
  const sourceReasons = retrievalPlanner.buildSourceReasons(chunks, manifest, config);
  if (mode === "book" && coverage.rawChapterCoverage.selected < coverage.rawChapterCoverage.total) {
    notes.push(`正文原始证据覆盖 ${coverage.rawChapterCoverage.selected}/${coverage.rawChapterCoverage.total} 章，其余章节通过分卷与文档摘要参与结构判断。`);
  }
  const retrieval = summarizeRetrieval(chunks, config, characters, worldDocs, mode, requestedMode, search, {
    scanLimit,
    sendLimit,
    catalogUsed,
    inventoryUsed,
    notes,
    plannedTitles: hierarchyPlan.plannedTitles,
    layersUsed: hierarchyPlan.layersUsed,
    additionalSourceIds,
    subQueries: subQueries.map((item) => ({ id: item.id, label: item.label, query: item.query, kind: item.kind })),
    routedVolumes: routedVolumes.map((item) => item.title),
    ...coverage,
    ...sourceReasons,
  });
  return { search: { ...search, chunks }, materials, retrieval, inventorySummary };
}


const __moduleExports = {
  RETRIEVAL_MODE_LABELS,
  safeEndpointLabel,
  describeFetchError,
  compactChatHistory,
  fetchJsonWithDiagnostics,
  extractOpenAiCompatibleAnswer,
  fetchOpenAiCompatibleStream,
  truncateForPrompt,
  buildProjectSourceCatalog,
  collectPromptMaterials,
  buildProjectMemorySummary,
  buildSystemPrompt,
  normalizeRetrievalMode,
  classifyRetrievalMode,
  normalizeTitleForMatch,
  findMentionedChapters,
  findMentionedSourceIds,
  buildInventorySummary,
  appendCoverageChunks,
  forceIncludeSourceChunks,
  summarizeRetrieval,
  contextFromChunks,
  planHierarchicalRetrieval,
  buildChatRetrievalPackage,
};

// Augment the original exports object so cyclic requires (whose captured
// reference may be a Proxy over the pre-assignment exports) see every key.
Object.assign(module.exports, __moduleExports);
module.exports = __moduleExports;
