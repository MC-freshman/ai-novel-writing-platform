"use strict";
const {
  buildAppState,
  buildStructuringMaterials,
  callChatApi,
  contentToPlainText,
  extractJsonFromModelText,
  fs,
  getChapterPath,
  indexSources,
  loadConfig,
  loadWorldDocs,
  normalizeCategory,
  nowIso,
  stableHash,
  stripWorldDocFrontMatter,
  truncateForPrompt,
  uniqueContentFileName,
  writeWorldDoc,
} = require("./dependencies.cjs");

function normalizeComparableTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[《》“”"'：:，,。.\s·_-]/g, "")
    .replace(/^(圣城|古城|王城|帝都|组织|势力|神器|物品|地点)(?=.+)/, "")
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
    const score = exact
      ? 1
      : contains
        ? Math.min(candidate.length, target.length) /
          Math.max(candidate.length, target.length)
        : 0;
    if (score > (best?.score || 0)) best = { doc, score };
  }
  return best && best.score >= 0.55 ? best.doc : null;
}

function normalizeExtractedWorldCards(payload) {
  const items = Array.isArray(payload?.worldDocs)
    ? payload.worldDocs
    : Array.isArray(payload?.cards)
      ? payload.cards
      : [];
  return items
    .map((item) => {
      const title = String(item.title || item.name || "").trim();
      const type = ["地点", "势力", "物品"].includes(String(item.type))
        ? String(item.type)
        : "设定";
      const rawCategory = String(item.category || type)
        .replace(/\s+/g, " ")
        .trim();
      const category = rawCategory.startsWith(type)
        ? rawCategory
        : `${type}/${rawCategory}`;
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
      search: {
        chunks: [],
        embeddingSource: "selection",
        embeddingWarning: "",
      },
      retrieved: "",
      corpus: `【选中文字】\n${truncateForPrompt(selectedText, 20000)}`,
    };
  }
  const scope = options.scope === "chapter" ? "chapter" : "book";
  if (scope !== "chapter") {
    return buildStructuringMaterials(
      projectPath,
      "地点 城市 国家 大陆 势力 组织 家族 教会 物品 神器 道具 材料",
    );
  }
  const config = await loadConfig(projectPath);
  const chapter = config.chapters.find((item) => item.id === options.chapterId);
  if (!chapter) throw new Error("请选择要提取资料的当前文档。");
  const content = await fs
    .readFile(getChapterPath(projectPath, chapter), "utf8")
    .catch(() => "");
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
  const existingTitles =
    existing
      .map((item) => item.title)
      .filter(Boolean)
      .join("、") || "暂无";
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
  const answer = await callChatApi(
    materials.config,
    systemPrompt,
    question,
    [],
  );
  const generated = normalizeExtractedWorldCards(
    extractJsonFromModelText(answer),
  );
  if (!generated.length)
    throw new Error("AI 没有生成可识别的地点、势力或物品候选。");
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
  return {
    candidates,
    contextCount: materials.search.chunks.length,
    scope: options.scope === "chapter" ? "chapter" : "book",
  };
}

async function saveWorldCardCandidates(projectPath, candidates) {
  const selected = (Array.isArray(candidates) ? candidates : []).filter(
    (item) => item?.selected !== false,
  );
  if (!selected.length) throw new Error("请至少勾选一个要写入的资料条目。");
  const existing = await loadWorldDocs(projectPath);
  let created = 0;
  let updated = 0;
  const indexedSources = [];
  for (const item of selected) {
    const previous =
      existing.find((doc) => doc.id === item.matchedDocId) ||
      findSimilarWorldDoc(item.title, existing);
    const fileName =
      previous?.fileName ||
      (await uniqueContentFileName(
        projectPath,
        "worldbuilding",
        item.title,
        ".md",
      ));
    const mergedContent =
      previous && item.action === "merge"
        ? `${stripWorldDocFrontMatter(previous.content).trim()}\n\n## 新提取资料 ${new Date().toLocaleDateString("zh-CN")}\n\n${stripWorldDocFrontMatter(
            item.content,
          )
            .replace(/^#.+\n?/, "")
            .trim()}`
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
    indexedSources.push({
      id: doc.id,
      type: "world",
      title: doc.title,
      content: doc.content,
    });
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

module.exports = {
  normalizeComparableTitle,
  findSimilarWorldDoc,
  normalizeExtractedWorldCards,
  buildExtractionMaterials,
  prepareWorldCardCandidates,
  saveWorldCardCandidates,
};
