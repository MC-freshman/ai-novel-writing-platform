"use strict";
const {
  buildStructuringMaterials,
  callStructuredChatWithProgress,
  contentToPlainText,
  extractJsonFromModelText,
  loadProjectSources,
  makeIdSet,
  normalizeCategory,
  sanitizeFileName,
  stableHash,
} = require("./dependencies.cjs");
const { applyIssueStatuses, loadIssueStatuses } = require("./state.cjs");

function normalizeConsistencyIssues(payload) {
  const items = Array.isArray(payload?.issues) ? payload.issues : [];
  return items
    .map((item, index) => ({
      id: `issue_${stableHash(`${item.category || ""}_${item.title || ""}_${item.detail || ""}_${index}`)}`,
      severity: ["高", "中", "低"].includes(String(item.severity))
        ? String(item.severity)
        : "中",
      category: String(item.category || "其他").trim() || "其他",
      title: String(item.title || "未命名问题").trim(),
      detail: String(item.detail || "").trim(),
      suggestion: String(item.suggestion || "").trim(),
      evidence: Array.isArray(item.evidence)
        ? item.evidence
            .map((text) => String(text).trim())
            .filter(Boolean)
            .slice(0, 4)
        : [],
    }))
    .filter((item) => item.title && item.detail)
    .slice(0, 30);
}

async function buildLocalConsistencyIssues(projectPath, options = {}) {
  const { chapters, characters, worldDocs } =
    await loadProjectSources(projectPath);
  const chapterIds = makeIdSet(options.chapterIds);
  const sourceIds = makeIdSet(options.knowledgeSourceIds);
  const visibleChapters = chapterIds.size
    ? chapters.filter((chapter) => chapterIds.has(chapter.id))
    : chapters;
  const visibleCharacters = sourceIds.size
    ? characters.filter((card) => sourceIds.has(card.id))
    : characters;
  const visibleWorldDocs = sourceIds.size
    ? worldDocs.filter((doc) => sourceIds.has(doc.id))
    : worldDocs;
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
        detail:
          "这个章节或导入文档的字数很少，可能是空章节、占位章节或导入不完整。",
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
        detail:
          "同一分组下出现重复章节标题，后续整书导出或检索时可能不容易分辨。",
        suggestion: "给重复条目补充编号、用途或版本说明。",
        evidence: items.map(
          (item) => `${item.volume || "未分卷"} / ${item.title}`,
        ),
      });
    }
  }
  for (const card of visibleCharacters) {
    if (
      !String(
        card.background || card.personality || card.relationships || "",
      ).trim()
    ) {
      issues.push({
        id: `local_empty_character_${card.id}`,
        severity: "低",
        category: "角色",
        title: `${card.name} 的角色卡信息较少`,
        detail:
          "这个角色缺少背景、性格和关系说明，后续 AI 检索时能利用的信息有限。",
        suggestion: "补充角色目标、秘密、阵营和关键关系。",
        evidence: [normalizeCategory(card.category)],
      });
    }
  }
  const worldTitleMap = new Map();
  for (const doc of visibleWorldDocs) {
    worldTitleMap.set(doc.title, [
      ...(worldTitleMap.get(doc.title) || []),
      doc,
    ]);
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
  const materials = await buildStructuringMaterials(
    projectPath,
    "设定矛盾 时间线 冲突 角色 动机 世界规则 前后不一致",
    options,
  );
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
    const answer = await callStructuredChatWithProgress(
      materials.config,
      systemPrompt,
      question,
      control,
      "AI 正在核对一致性问题",
    );
    const aiIssues = normalizeConsistencyIssues(
      extractJsonFromModelText(answer),
    );
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
        knowledgeSourceIds: Array.isArray(options.knowledgeSourceIds)
          ? options.knowledgeSourceIds
          : [],
      },
    };
  } catch (error) {
    if (error?.name === "AbortError" || control.signal?.aborted) throw error;
    return {
      issues: applyIssueStatuses(localIssues, statuses),
      contextCount: materials.search.chunks.length,
      apiError: error.message || String(error),
      options: {
        chapterIds: Array.isArray(options.chapterIds) ? options.chapterIds : [],
        knowledgeSourceIds: Array.isArray(options.knowledgeSourceIds)
          ? options.knowledgeSourceIds
          : [],
      },
    };
  }
}

module.exports = {
  normalizeConsistencyIssues,
  buildLocalConsistencyIssues,
  analyzeConsistency,
};
