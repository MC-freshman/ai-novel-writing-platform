// 本文件由 P2 重构自 electron/main.cjs 机械搬迁（scripts/refactor-split.cjs），逻辑未改动。
"use strict";

const creativeWorkspace = require("./creative-workspace.cjs");
const novelAgent = require("./novel-agent.cjs");
const { DEFAULT_CHAT_BASE_URL, MAX_CHAT_TOKENS, MAX_RETRIEVAL_TOP_K, STRUCTURING_CONTEXT_CHAR_BUDGET } = require("./constants.cjs");
const __dep0 = require("./project-files.cjs");
const __dep1 = require("./credentials.cjs");
const __dep2 = require("./knowledge-index.cjs");
const __dep3 = require("./retrieval-pipeline.cjs");
const __dep4 = require("./creative-agent.cjs");
const __dep5 = require("./project-ops.cjs");
const fs = require("node:fs/promises");

function nowIso(...args) { return __dep0.nowIso.apply(null, args); }
function makeId(...args) { return __dep0.makeId(...args); }
function normalizeCategory(...args) { return __dep0.normalizeCategory(...args); }
function clampNumber(...args) { return __dep0.clampNumber(...args); }
function writeJson(...args) { return __dep0.writeJson(...args); }
function getChapterPath(...args) { return __dep0.getChapterPath(...args); }
function uniqueContentFileName(...args) { return __dep0.uniqueContentFileName(...args); }
function contentToPlainText(...args) { return __dep0.contentToPlainText(...args); }
function getCharacterPath(...args) { return __dep0.getCharacterPath(...args); }
function writeWorldDoc(...args) { return __dep0.writeWorldDoc(...args); }
function loadProjectSources(...args) { return __dep0.loadProjectSources(...args); }
function stableHash(...args) { return __dep0.stableHash(...args); }
function formatBytes(...args) { return __dep0.formatBytes(...args); }
function loadCharacters(...args) { return __dep0.loadCharacters(...args); }
function loadWorldDocs(...args) { return __dep0.loadWorldDocs(...args); }
function getKnowledgeRole(...args) { return __dep0.getKnowledgeRole(...args); }
function knowledgeRoleLabel(...args) { return __dep0.knowledgeRoleLabel(...args); }
function characterToMarkdown(...args) { return __dep0.characterToMarkdown(...args); }
function runtimeSecret(...args) { return __dep1.runtimeSecret(...args); }
function indexSource(...args) { return __dep2.indexSource(...args); }
function searchRelevantChunks(...args) { return __dep2.searchRelevantChunks(...args); }
function safeEndpointLabel(...args) { return __dep3.safeEndpointLabel(...args); }
function compactChatHistory(...args) { return __dep3.compactChatHistory(...args); }
function fetchJsonWithDiagnostics(...args) { return __dep3.fetchJsonWithDiagnostics(...args); }
function fetchOpenAiCompatibleStream(...args) { return __dep3.fetchOpenAiCompatibleStream(...args); }
function truncateForPrompt(...args) { return __dep3.truncateForPrompt(...args); }
function forceIncludeSourceChunks(...args) { return __dep3.forceIncludeSourceChunks(...args); }
function collectCreativeAgentToolReport(...args) { return __dep4.collectCreativeAgentToolReport(...args); }
function buildAgentRetrievalContext(...args) { return __dep4.buildAgentRetrievalContext(...args); }
function loadConfig(...args) { return __dep5.loadConfig(...args); }
function buildAppState(...args) { return __dep5.buildAppState(...args); }

async function callChatApi(config, systemPrompt, question, history = [], options = {}) {
  const api = config.api || {};
  const apiKey = runtimeSecret(api, "chat");
  const provider = api.provider || "custom";
  const baseUrl = (api.baseUrl || DEFAULT_CHAT_BASE_URL).replace(/\/$/, "");
  const model = api.chatModel || "deepseek-chat";
  const temperature = clampNumber(api.temperature ?? 0.7, 0, 2, 0.7);
  const maxTokens = Math.floor(clampNumber(api.maxTokens ?? 8000, 1, MAX_CHAT_TOKENS, 8000));

  if (!apiKey && provider !== "ollama" && !baseUrl.includes("localhost") && !baseUrl.includes("127.0.0.1")) {
    throw new Error("尚未配置可用的聊天接口密钥。请在“设置”中填写提供商、接口地址、模型名称和接口密钥。");
  }

  if (provider === "claude") {
    const safeHistory = compactChatHistory(history);
    const payload = {
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [...safeHistory, { role: "user", content: question }],
    };
    const { response, bodyBytes } = await fetchJsonWithDiagnostics(
      `${baseUrl || "https://api.anthropic.com"}/v1/messages`,
      payload,
      {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      "Claude API ",
      { signal: options.signal },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Claude API 请求失败：${response.status} ${detail.slice(0, 400)}\n请求体大小：${formatBytes(bodyBytes)}`);
    }
    const data = /** @type {any} */ (await response.json());
    const text = (data.content || []).map((item) => item.text || "").join("\n").trim();
    return text || "Claude 返回了空内容。";
  }

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const safeHistory = compactChatHistory(history);

  const payload = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [{ role: "system", content: systemPrompt }, ...safeHistory, { role: "user", content: question }],
  };
  if (options.stream && provider !== "claude") {
    return fetchOpenAiCompatibleStream(`${baseUrl}/chat/completions`, payload, headers, "聊天 API ", options.onToken, { signal: options.signal, onUsage: options.onUsage });
  }
  const { response, bodyBytes } = await fetchJsonWithDiagnostics(`${baseUrl}/chat/completions`, payload, headers, "聊天 API ", { signal: options.signal });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`聊天 API 请求失败：${response.status} ${detail.slice(0, 400)}\n请求地址：${safeEndpointLabel(`${baseUrl}/chat/completions`)}\n请求体大小：${formatBytes(bodyBytes)}`);
  }
  const data = /** @type {any} */ (await response.json());
  const answer = data?.choices?.[0]?.message?.content || data?.message?.content || "";
  return answer.trim() || "模型返回了空内容。";
}


function estimateTokenCount(value) {
  const text = String(value || "");
  const asciiLength = (text.match(/[\x00-\x7f]/g) || []).length;
  return Math.max(1, Math.ceil((text.length - asciiLength) / 1.6 + asciiLength / 4));
}


async function callStructuredChatWithProgress(config, systemPrompt, question, control = {}, phase = "AI 正在整理") {
  if (typeof control.update !== "function" && !control.signal) return callChatApi(config, systemPrompt, question, []);
  let partialOutput = "";
  let lastCheckpointAt = 0;
  const promptTokens = estimateTokenCount(`${systemPrompt}\n${question}`);
  await control.update?.({ phase, usage: { promptTokens, completionTokens: 0, totalTokens: promptTokens } });
  const answer = await callChatApi(config, systemPrompt, question, [], {
    stream: true,
    signal: control.signal,
    onToken: (token) => {
      partialOutput += token;
      if (Date.now() - lastCheckpointAt < 900) return;
      lastCheckpointAt = Date.now();
      const completionTokens = estimateTokenCount(partialOutput);
      void control.update?.({
        phase,
        partialOutput,
        usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      });
    },
  });
  const completionTokens = estimateTokenCount(answer);
  await control.update?.({ partialOutput: answer, usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens } });
  return answer;
}


function extractJsonFromModelText(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw.slice(Math.max(0, raw.indexOf("{")), raw.lastIndexOf("}") + 1).trim();
  if (!candidate) throw new Error("AI 没有返回可识别的 JSON。");
  try {
    return JSON.parse(candidate);
  } catch {
    const repaired = candidate.replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(repaired);
  }
}


function makeIdSet(values) {
  return new Set((Array.isArray(values) ? values : []).map((id) => String(id || "")).filter(Boolean));
}


async function collectOutlineCorpus(projectPath, maxChars = 80000, options = {}) {
  const config = await loadConfig(projectPath);
  const chapterIds = makeIdSet(options.chapterIds);
  const parts = [];
  for (const chapter of config.chapters.slice().sort((a, b) => a.order - b.order)) {
    if (chapterIds.size && !chapterIds.has(chapter.id)) continue;
    const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => "");
    const plain = contentToPlainText(content);
    if (!plain) continue;
    parts.push(`【${knowledgeRoleLabel(getKnowledgeRole(chapter))}｜${chapter.volume || "未分卷"}｜${chapter.title}】\n${plain}`);
  }
  const full = parts.join("\n\n");
  if (full.length <= maxChars) return full;
  const head = full.slice(0, Math.floor(maxChars * 0.7));
  const tail = full.slice(-Math.floor(maxChars * 0.3));
  return `${head}\n\n【中间内容过长，已截断，以下为文档后段】\n\n${tail}`;
}


async function collectKnowledgeSourceCorpus(projectPath, sourceIds, maxChars = 60000) {
  const selectedIds = makeIdSet(sourceIds);
  if (!selectedIds.size) return "";
  const { sources } = await loadProjectSources(projectPath);
  const parts = [];
  for (const source of sources) {
    if (!selectedIds.has(source.id)) continue;
    const typeLabel = source.sourceType === "chapter" ? knowledgeRoleLabel(source.knowledgeRole) : source.sourceType === "character" ? "角色卡" : "世界观";
    const group = source.volume || source.category || "未分类";
    const plain = contentToPlainText(source.rawContent || source.text || "");
    if (!plain) continue;
    parts.push(`【${typeLabel}｜${group}｜${source.title}】\n${plain}`);
  }
  const full = parts.join("\n\n");
  if (full.length <= maxChars) return full;
  return `${full.slice(0, Math.floor(maxChars * 0.7))}\n\n【参考资料过长，已截断，以下为后段】\n\n${full.slice(-Math.floor(maxChars * 0.3))}`;
}


async function buildStructuringMaterials(projectPath, query, options = {}) {
  const config = await loadConfig(projectPath);
  const topK = Math.floor(clampNumber(config.api.topK || 20, 1, MAX_RETRIEVAL_TOP_K, 20));
  const knowledgeSourceIds = Array.isArray(options.knowledgeSourceIds) ? options.knowledgeSourceIds : [];
  const search = await searchRelevantChunks(projectPath, query, topK, {
    sourceIds: knowledgeSourceIds,
    minKeep: Math.min(12, topK),
    maxChars: STRUCTURING_CONTEXT_CHAR_BUDGET,
  });
  const retrieved = search.chunks
    .map((item, index) => {
      const role = item.sourceType === "chapter" ? knowledgeRoleLabel(item.knowledgeRole) : item.sourceType === "character" ? "角色卡" : "世界观";
      const group = item.volume || item.category || "";
      return `【检索片段${index + 1}｜${role}${group ? `｜${group}` : ""}｜${item.title}】\n${item.text}`;
    })
    .join("\n\n");
  const inspectedCorpus = await collectOutlineCorpus(projectPath, 80000, { chapterIds: options.chapterIds });
  const knowledgeCorpus = await collectKnowledgeSourceCorpus(projectPath, knowledgeSourceIds, 60000);
  const corpus = [inspectedCorpus ? `【审查/整理对象】\n${inspectedCorpus}` : "", knowledgeCorpus ? `【指定参考资料】\n${knowledgeCorpus}` : ""].filter(Boolean).join("\n\n");
  return { config, search, retrieved, corpus };
}


function normalizeGeneratedCharacters(payload) {
  const items = Array.isArray(payload?.characters) ? payload.characters : [];
  return items
    .map((item) => ({
      name: String(item.name || "").trim(),
      category: String(item.category || "").replace(/\s+/g, " ").trim().slice(0, 40),
      appearance: String(item.appearance || "").trim(),
      personality: String(item.personality || "").trim(),
      background: String(item.background || "").trim(),
      relationships: String(item.relationships || "").trim(),
      notes: String(item.notes || "").trim(),
    }))
    .filter((item) => item.name)
    .slice(0, 40);
}


function normalizeGeneratedWorldDocs(payload) {
  const items = Array.isArray(payload?.worldDocs) ? payload.worldDocs : Array.isArray(payload?.worldbuilding) ? payload.worldbuilding : [];
  return items
    .map((item) => {
      const title = String(item.title || "").trim();
      const content = String(item.content || "").trim();
      return {
        title,
        category: String(item.category || "").replace(/\s+/g, " ").trim().slice(0, 40),
        content: content.startsWith("#") ? content : `# ${title}\n\n${content}`,
      };
    })
    .filter((item) => item.title && item.content.replace(/^#.+/m, "").trim())
    .slice(0, 20);
}


async function generateCharactersFromOutline(projectPath) {
  const materials = await buildStructuringMaterials(projectPath, "角色 人物 主角 配角 英雄 反派 关系 外貌 性格 背景");
  const existing = await loadCharacters(projectPath);
  const existingNames = existing.map((item) => item.name).filter(Boolean).join("、") || "暂无";
  const systemPrompt = `你是小说资料整理助手。请只基于用户提供的大纲和检索片段，整理角色卡片。只输出 JSON，不要 Markdown，不要解释。
JSON 格式必须是：
{"characters":[{"name":"","category":"","appearance":"","personality":"","background":"","relationships":"","notes":""}]}
字段要求：
1. name 为角色名称。
2. category 为分类，优先使用：主角团、十二英雄、反派、重要配角、势力人物、神明/超凡、未分类；也可按大纲里的阵营自拟短分类。
3. appearance 写外貌、身份标识或可识别特征；没有就留空字符串。
4. personality 写性格、价值观、行为倾向；没有就留空字符串。
5. background 写身世、阵营、能力、剧情位置。
6. relationships 写与其他角色、势力或神明的关系。
7. notes 写道、权柄、命运、伏笔、牺牲、风险等补充信息。
8. 不要编造大纲没有的角色。已有角色名：${existingNames}`;
  const question = `请从下面的大纲材料中生成角色卡片，优先整理主角、十二英雄、重要配角和关键势力人物。最多 30 张。

【检索片段】
${materials.retrieved || "无"}

【大纲材料】
${materials.corpus}`;
  const answer = await callChatApi(materials.config, systemPrompt, question, []);
  const generated = normalizeGeneratedCharacters(extractJsonFromModelText(answer));
  if (!generated.length) throw new Error("AI 没有生成可写入的角色卡片。");

  let created = 0;
  let updated = 0;
  const existingByName = new Map(existing.map((item) => [item.name, item]));
  for (const item of generated) {
    const previous = existingByName.get(item.name);
    const fileName = previous?.fileName || (await uniqueContentFileName(projectPath, "characters", item.name, ".json"));
    const card = {
      id: previous?.id || makeId("character"),
      name: item.name,
      category: normalizeCategory(item.category || previous?.category),
      appearance: item.appearance || previous?.appearance || "",
      personality: item.personality || previous?.personality || "",
      background: item.background || previous?.background || "",
      relationships: item.relationships || previous?.relationships || "",
      notes: item.notes || previous?.notes || "",
      fileName,
      updatedAt: nowIso(),
    };
    await writeJson(getCharacterPath(projectPath, card), card);
    await indexSource(projectPath, {
      id: card.id,
      type: "character",
      title: card.name,
      content: characterToMarkdown(card),
    });
    if (previous) updated += 1;
    else created += 1;
  }

  return {
    state: await buildAppState(projectPath),
    created,
    updated,
    count: generated.length,
    names: generated.map((item) => item.name),
    contextCount: materials.search.chunks.length,
  };
}


async function generateWorldDocsFromOutline(projectPath) {
  const materials = await buildStructuringMaterials(projectPath, "世界观 设定 地理 大陆 势力 神明 腐化 规则 权柄 时间线 历史");
  const existing = await loadWorldDocs(projectPath);
  const existingTitles = existing.map((item) => item.title).filter(Boolean).join("、") || "暂无";
  const systemPrompt = `你是小说世界观资料整理助手。请只基于用户提供的大纲和检索片段，把设定整理成软件可保存的世界观文档。只输出 JSON，不要 Markdown 解释。
JSON 格式必须是：
{"worldDocs":[{"title":"","category":"","content":""}]}
字段要求：
1. title 是清晰的世界观条目标题。
2. category 为分类，优先使用：世界规则、地理、势力、神明/权柄、历史时间线、物品材料、种族/生物、未分类；也可按大纲里的体系自拟短分类。
3. content 使用 Markdown，第一行用 # 标题，下面按小标题和要点整理。
4. 优先整理：世界基础规则、地理大陆、腐化机制、神明/权柄、十二英雄、主要势力、六幕时间线、关键物品或材料。
5. 不要编造大纲没有的信息。
6. 已有世界观标题：${existingTitles}`;
  const question = `请从下面的大纲材料中生成世界观设定条目，建议 6 到 12 个条目。

【检索片段】
${materials.retrieved || "无"}

【大纲材料】
${materials.corpus}`;
  const answer = await callChatApi(materials.config, systemPrompt, question, []);
  const generated = normalizeGeneratedWorldDocs(extractJsonFromModelText(answer));
  if (!generated.length) throw new Error("AI 没有生成可写入的世界观条目。");

  let created = 0;
  let updated = 0;
  const existingByTitle = new Map(existing.map((item) => [item.title, item]));
  for (const item of generated) {
    const previous = existingByTitle.get(item.title);
    const fileName = previous?.fileName || (await uniqueContentFileName(projectPath, "worldbuilding", item.title, ".md"));
    const doc = {
      id: previous?.id || fileName.replace(/\.md$/i, ""),
      title: item.title,
      category: normalizeCategory(item.category || previous?.category),
      fileName,
      content: item.content,
      updatedAt: nowIso(),
    };
    await writeWorldDoc(projectPath, doc);
    await indexSource(projectPath, {
      id: doc.id,
      type: "world",
      title: doc.title,
      content: doc.content,
    });
    if (previous) updated += 1;
    else created += 1;
  }

  return {
    state: await buildAppState(projectPath),
    created,
    updated,
    count: generated.length,
    titles: generated.map((item) => item.title),
    contextCount: materials.search.chunks.length,
  };
}


function normalizeCreativeAdviceMode(value) {
  return ["next", "plot", "foreshadow"].includes(String(value || "")) ? String(value) : "next";
}


function creativeAdviceTypeForMode(mode) {
  if (mode === "plot") return "剧情推进";
  if (mode === "foreshadow") return "伏笔建议";
  return "下一章建议";
}


function normalizeStringArray(value, maxItems = 6) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, maxItems);
  const text = String(value || "").trim();
  return text ? [text].slice(0, maxItems) : [];
}


function normalizeCreativeAdvicePayload(payload, mode, chapter) {
  const fallbackType = creativeAdviceTypeForMode(mode);
  const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.advice) ? payload.advice : [];
  return items
    .map((item, index) => {
      const title = String(item.title || item.name || "").trim();
      const summary = String(item.summary || item.detail || item.description || "").trim();
      const type = ["下一章建议", "剧情推进", "伏笔建议"].includes(String(item.type)) ? String(item.type) : fallbackType;
      const priority = ["高", "中", "低"].includes(String(item.priority)) ? String(item.priority) : index < 2 ? "高" : "中";
      return {
        id: `advice_${stableHash(`${mode}_${chapter?.id || ""}_${index}_${title}_${summary}`)}`,
        type,
        title: title || `${fallbackType} ${index + 1}`,
        priority,
        summary,
        rationale: String(item.rationale || item.reason || item.why || "").trim(),
        benefits: normalizeStringArray(item.benefits || item.value || item.effect),
        risks: normalizeStringArray(item.risks || item.risk || item.warning),
        relatedCharacters: normalizeStringArray(item.relatedCharacters || item.characters),
        relatedSettings: normalizeStringArray(item.relatedSettings || item.settings || item.worldbuilding),
        targetChapter: String(item.targetChapter || item.chapter || chapter?.title || "").trim(),
        suggestedUse: String(item.suggestedUse || item.use || item.action || "").trim(),
      };
    })
    .filter((item) => item.title && item.summary)
    .slice(0, 12);
}


function buildLocalCreativeAdvice(mode, chapter, nextChapter, focus = "") {
  const type = creativeAdviceTypeForMode(mode);
  const focusText = String(focus || "").trim();
  const target = nextChapter?.title || chapter?.title || "下一章";
  const shared = {
    type,
    priority: "中",
    relatedCharacters: [],
    relatedSettings: [],
    targetChapter: target,
  };
  if (mode === "foreshadow") {
    return [
      {
        ...shared,
        id: `advice_${stableHash(`${chapter?.id || ""}_foreshadow_1`)}`,
        title: "用一个异常细节提前露出后续冲突",
        summary: `围绕《${chapter?.title || "当前章节"}》刚出现的线索，埋一个看似无关的小异常。`,
        rationale: "本地兜底无法调用模型，但伏笔最稳的做法是先给读者一个可记住的细节，暂时不解释。",
        benefits: ["增强后续回收的满足感", "让设定显得不是临时出现"],
        risks: ["异常太明显会破坏悬念", "细节如果后续不回收会变成噪音"],
        suggestedUse: focusText ? `结合你的关注点“${focusText}”，把伏笔藏在人物反应、物品状态或环境变化里。` : "优先藏在人物反应、物品状态或环境变化里。",
      },
    ];
  }
  if (mode === "plot") {
    return [
      {
        ...shared,
        id: `advice_${stableHash(`${chapter?.id || ""}_plot_1`)}`,
        title: "用一个选择题推动剧情，而不是只用信息推动剧情",
        summary: `下一步可以让角色面对一个必须取舍的事件，把线索推进和人物塑造绑在一起。`,
        rationale: "长篇剧情推进最怕只靠说明信息。让人物做选择，可以同时推进事件、关系和主题。",
        benefits: ["角色主动性更强", "读者更容易记住本章作用"],
        risks: ["选择代价需要明确", "不要让选择和主线目标脱节"],
        suggestedUse: focusText ? `围绕“${focusText}”设计一个短期选择：追线索、救人、隐瞒、交易或冒险。` : "设计一个短期选择：追线索、救人、隐瞒、交易或冒险。",
      },
    ];
  }
  return [
    {
      ...shared,
      id: `advice_${stableHash(`${chapter?.id || ""}_next_1`)}`,
      title: "下一章先承接上一章结果，再给出新的麻烦",
      summary: `从《${chapter?.title || "当前章节"}》的后果开场，随后引出一个更具体的目标或阻碍。`,
      rationale: "先承接能保持因果连续，再抛出新麻烦能让章节有推进感。",
      benefits: ["节奏自然", "读者不会觉得转场突兀"],
      risks: ["承接过长会拖慢开篇", "新麻烦需要和主线或人物目标有关"],
      suggestedUse: focusText ? `结合“${focusText}”，把开场控制在一到两个场景内。` : "把开场控制在一到两个场景内，尽快给出本章目标。",
    },
  ];
}


async function buildCreativeAdvice(projectPath, options = {}, control = {}) {
  const mode = normalizeCreativeAdviceMode(options.mode);
  const focus = String(options.focus || "").trim().slice(0, 1200);
  const contextIds = Array.isArray(options.contextIds) ? options.contextIds.map(String).slice(0, 60) : [];
  const includeSourceIds = [...new Set((Array.isArray(options.includeSourceIds) ? options.includeSourceIds : []).map(String).filter(Boolean))].slice(0, 500);
  const excludeSourceIds = [...new Set((Array.isArray(options.excludeSourceIds) ? options.excludeSourceIds : []).map(String).filter(Boolean))].filter((id) => !includeSourceIds.includes(id)).slice(0, 500);
  const config = await loadConfig(projectPath);
  const ordered = config.chapters.slice().sort((a, b) => a.order - b.order);
  const requestedIndex = ordered.findIndex((chapter) => chapter.id === options.chapterId);
  if (options.chapterId && requestedIndex < 0) throw new Error("创作参谋对应的章节已不存在，请重新选择章节。");
  const selectedIndex = requestedIndex >= 0 ? requestedIndex : 0;
  const chapter = ordered[selectedIndex];
  if (!chapter) throw new Error("当前项目还没有可分析的章节。");
  const resolvedScope = novelAgent.resolveScope(config, chapter, options.scopeType || "chapter", focus, mode);
  const suppliedScopeIds = Array.isArray(options.scopeIds) ? options.scopeIds.map(String).filter((id) => ordered.some((item) => item.id === id)) : [];
  const scope = suppliedScopeIds.length
    ? { ...resolvedScope, ids: suppliedScopeIds, label: String(options.scopeLabel || resolvedScope.label) }
    : resolvedScope;
  const previousChapter = ordered[selectedIndex - 1] || null;
  const nextChapter = ordered[selectedIndex + 1] || null;
  const readPlain = async (item, maxChars) => {
    if (!item) return "";
    const content = await fs.readFile(getChapterPath(projectPath, item), "utf8").catch(() => "");
    return truncateForPrompt(contentToPlainText(content), maxChars);
  };
  const currentText = await readPlain(chapter, 12000);
  const previousText = await readPlain(previousChapter, 5000);
  const nextText = await readPlain(nextChapter, 5000);
  const toolReport = await collectCreativeAgentToolReport(projectPath, ordered, selectedIndex, currentText, contextIds);
  toolReport.tools.unshift({ name: "分析范围", detail: scope.label });
  toolReport.prompt = `- 分析范围：${scope.label}\n${toolReport.prompt}`;
  const workflowToolReports = Array.isArray(options.workflowToolReports) ? options.workflowToolReports.slice(0, 20) : [];
  if (workflowToolReports.length) {
    toolReport.tools.push(...workflowToolReports.map((item) => ({ name: item.name || item.label || "Agent 工具", detail: item.detail || "已完成检查" })));
    toolReport.prompt += `\n\n【本次工作流工具结果】\n${workflowToolReports.map((item) => `- ${item.name || item.label}：${item.detail || "已完成检查"}`).join("\n")}`;
  }
  const workspaceState = await creativeWorkspace.loadWorkspace(projectPath);
  const memories = creativeWorkspace.relevantMemories(workspaceState, chapter);
  if (memories.length) {
    toolReport.tools.push({ name: "分层项目记忆", detail: memories.slice(0, 12).map((item) => `${item.scope}：${item.title}`).join("；") });
    toolReport.prompt += `\n\n【作者确认的分层记忆】\n${memories.slice(0, 30).map((item) => `- [${item.scope}] ${item.title}：${item.content}`).join("\n")}`;
  }
  const outlineTitles = ordered
    .filter((item) => getKnowledgeRole(item) === "大纲")
    .slice(0, 8)
    .map((item) => `${item.volume || "未分卷"} / ${item.title}`)
    .join("；");
  const modeQuestion =
    mode === "plot"
      ? "剧情推进 合理化 冲突 动机 节奏 事件 选择"
      : mode === "foreshadow"
        ? "伏笔 埋设 回收 线索 异常 预兆 悬念"
        : "下一章 建议 节奏 人物 事件 主线 转场";
  const query = [modeQuestion, scope.label, chapter.title, nextChapter?.title || "", focus].filter(Boolean).join(" ");
  const topK = Math.floor(clampNumber(config.api.topK || 40, 1, MAX_RETRIEVAL_TOP_K, 40));
  const retrievalContext = await buildAgentRetrievalContext(projectPath, config, query, chapter.id, contextIds);
  retrievalContext.routedVolumes = [...new Set(ordered.filter((item) => scope.ids.includes(item.id)).map((item) => item.volume || "未分卷"))];
  retrievalContext.requiredSourceIds = [...(scope.ids.length <= 60 ? scope.ids.filter((id) => !excludeSourceIds.includes(id)) : []), ...includeSourceIds];
  const search = await searchRelevantChunks(projectPath, query, topK, {
    minKeep: Math.min(24, topK),
    maxChars: STRUCTURING_CONTEXT_CHAR_BUDGET,
    retrievalContext,
    mode: scope.type === "book" ? "book" : "normal",
    additionalLoadSourceIds: includeSourceIds,
    boostSourceIds: includeSourceIds,
    excludeSourceIds,
  });
  if (includeSourceIds.length) search.chunks = forceIncludeSourceChunks(search.chunks, search._store, includeSourceIds, topK);
  const retrieved = search.chunks
    .map((item, index) => {
      const role = item.sourceType === "chapter" ? knowledgeRoleLabel(item.knowledgeRole) : item.sourceType === "character" ? "角色卡" : "世界观";
      const group = item.volume || item.category || "";
      return `【检索片段${index + 1}｜${role}${group ? `｜${group}` : ""}｜${item.title}】\n${item.text}`;
    })
    .join("\n\n");
  const retrievalAudit = {
    query,
    requestedTopK: topK,
    selectedChunks: search.chunks.length,
    selectedSources: [...new Set(search.chunks.map((item) => item.title))],
    knowledgeRoles: search.chunks.reduce((counts, item) => {
      const role = item.sourceType === "chapter" ? knowledgeRoleLabel(item.knowledgeRole) : item.sourceType === "character" ? "角色卡" : "世界观";
      counts[role] = (counts[role] || 0) + 1;
      return counts;
    }, {}),
    memoryCount: memories.length,
    estimatedPromptTokens: 0,
    warnings: [
      ...(search.chunks.length < Math.min(12, topK) ? ["命中的原始片段较少，请确认知识库已同步。"] : []),
      ...(search.coveragePass?.uncoveredTargets?.length ? [`${search.coveragePass.uncoveredTargets.length} 个证据目标尚未覆盖。`] : []),
      ...(includeSourceIds.length ? [`作者强制纳入 ${includeSourceIds.length} 份资料。`] : []),
      ...(excludeSourceIds.length ? [`作者排除 ${excludeSourceIds.length} 份资料。`] : []),
    ],
    firstPassCount: search.coveragePass?.firstPassCount || search.chunks.length,
    secondPassCount: search.coveragePass?.secondPassCount || 0,
    evidenceConfidence: search.coveragePass?.evidenceConfidence || "低",
    uncoveredTargets: search.coveragePass?.uncoveredTargets || [],
  };
  const systemPrompt = `你是一个“小说创作参谋 Agent”，不是代写机器。你的任务是辅助作者判断下一步怎么写，而不是替作者完成正文。
必须只基于提供的大纲、正文、角色卡、世界观和检索片段提出建议；不确定就写风险，不要硬编事实。
请输出 JSON，不要 Markdown，不要解释。JSON 格式必须是：
{"items":[{"type":"下一章建议","priority":"高","title":"","summary":"","rationale":"","benefits":[""],"risks":[""],"relatedCharacters":[""],"relatedSettings":[""],"targetChapter":"","suggestedUse":""}]}

字段要求：
1. type 只能是：下一章建议、剧情推进、伏笔建议。
2. priority 只能是：高、中、低。
3. summary 写具体建议，不要空泛。
4. rationale 写为什么它适合当前文本和大纲。
5. benefits 写收益，risks 写风险或注意事项。
6. suggestedUse 写作者可以怎样使用这个建议，但不要写完整正文。
7. 每条建议尽量能被作者采纳、改造或存为素材。`;
  const task =
    mode === "plot"
      ? "请给出 5 到 8 个剧情推进/合理化方案，重点是事件因果、角色动机、冲突升级和节奏控制。"
      : mode === "foreshadow"
        ? "请给出 5 到 8 个伏笔建议，包含现在怎么轻轻埋下、未来如何回收、风险是什么。"
        : "请给出 5 到 8 个下一章创作建议，重点是可用事件、章节目标、节奏、人物表现和自然转场。";
  const question = `${task}

【当前关注点】
${focus || "无"}

【本次分析范围】
${scope.label}

【当前章节】
${chapter.volume || "未分卷"} / ${chapter.title}
${currentText || "暂无正文"}

【上一章参考】
${previousChapter ? `${previousChapter.volume || "未分卷"} / ${previousChapter.title}\n${previousText}` : "无"}

【下一条目录参考】
${nextChapter ? `${nextChapter.volume || "未分卷"} / ${nextChapter.title}\n${nextText}` : "无"}

【项目大纲文档】
${outlineTitles || "未显式标记大纲文档"}

【Agent 工具检查结果】
${toolReport.prompt}

【检索片段】
${retrieved || "无"}`;
  retrievalAudit.estimatedPromptTokens = estimateTokenCount(`${systemPrompt}\n${question}`);
  try {
    const answer = await callStructuredChatWithProgress(config, systemPrompt, question, control, "创作参谋正在整理建议");
    const items = normalizeCreativeAdvicePayload(extractJsonFromModelText(answer), mode, chapter)
      .map((item) => ({ ...item, sourceRefs: toolReport.contextRefs }));
    if (!items.length) throw new Error("AI 没有返回可识别的建议卡片。");
    return {
      mode,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      generatedAt: nowIso(),
      contextCount: search.chunks.length,
      apiError: "",
      toolReport: toolReport.tools,
      retrievalAudit,
      items,
    };
  } catch (error) {
    return {
      mode,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      generatedAt: nowIso(),
      contextCount: search.chunks.length,
      apiError: error.message || String(error),
      toolReport: toolReport.tools,
      retrievalAudit,
      items: buildLocalCreativeAdvice(mode, chapter, nextChapter, focus).map((item) => ({ ...item, sourceRefs: toolReport.contextRefs })),
    };
  }
}


const __moduleExports = {
  callChatApi,
  estimateTokenCount,
  callStructuredChatWithProgress,
  extractJsonFromModelText,
  makeIdSet,
  collectOutlineCorpus,
  collectKnowledgeSourceCorpus,
  buildStructuringMaterials,
  normalizeGeneratedCharacters,
  normalizeGeneratedWorldDocs,
  generateCharactersFromOutline,
  generateWorldDocsFromOutline,
  normalizeCreativeAdviceMode,
  creativeAdviceTypeForMode,
  normalizeStringArray,
  normalizeCreativeAdvicePayload,
  buildLocalCreativeAdvice,
  buildCreativeAdvice,
};

// Augment the original exports object so cyclic requires (whose captured
// reference may be a Proxy over the pre-assignment exports) see every key.
Object.assign(module.exports, __moduleExports);
module.exports = __moduleExports;
