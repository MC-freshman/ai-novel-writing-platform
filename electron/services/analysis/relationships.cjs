"use strict";
const {
  DEFAULT_CATEGORY,
  contentToPlainText,
  fs,
  getChapterPath,
  loadProjectSources,
  normalizeCategory,
} = require("./dependencies.cjs");

function addRelationEdge(edgeMap, source, target, weight, label, evidence) {
  if (!source || !target || source === target) return;
  const ordered = [source, target].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const key = `${ordered[0]}__${ordered[1]}`;
  const current = edgeMap.get(key) || {
    id: key,
    source: ordered[0],
    target: ordered[1],
    label,
    weight: 0,
    evidence: [],
  };
  current.weight += weight;
  if (label && !current.label.includes(label))
    current.label = current.label ? `${current.label}、${label}` : label;
  if (evidence && current.evidence.length < 3) current.evidence.push(evidence);
  edgeMap.set(key, current);
}

async function buildRelationshipGraph(projectPath, options = {}) {
  const { chapters, characters } = await loadProjectSources(projectPath);
  const selectedNames = new Set(
    Array.isArray(options.characterNames)
      ? options.characterNames.filter(Boolean)
      : [],
  );
  const categoryFilter = normalizeCategory(options.categoryFilter || "");
  const customTypes = (
    Array.isArray(options.relationTypes) ? options.relationTypes : []
  )
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 30);
  const categoryCharacters =
    categoryFilter && categoryFilter !== DEFAULT_CATEGORY
      ? characters.filter((item) => {
          const category = normalizeCategory(item.category);
          return (
            category === categoryFilter ||
            category.startsWith(`${categoryFilter}/`)
          );
        })
      : characters;
  const visibleCharacters = selectedNames.size
    ? categoryCharacters.filter((item) => selectedNames.has(item.name))
    : categoryCharacters;
  const names = visibleCharacters.map((item) => item.name).filter(Boolean);
  const mentionCounts = new Map(names.map((name) => [name, 0]));
  const edgeMap = new Map();

  function labelsFromText(text, fallback) {
    const matched = customTypes.filter((type) =>
      String(text || "").includes(type),
    );
    return matched.length ? matched.join("、") : fallback;
  }

  for (const card of visibleCharacters) {
    const relationshipText = String(card.relationships || "");
    for (const target of names) {
      if (target !== card.name && relationshipText.includes(target)) {
        addRelationEdge(
          edgeMap,
          card.name,
          target,
          4,
          labelsFromText(relationshipText, "关系设定"),
          relationshipText.slice(0, 120),
        );
      }
    }
  }

  for (const chapter of chapters) {
    const content = await fs
      .readFile(getChapterPath(projectPath, chapter), "utf8")
      .catch(() => "");
    const paragraphs = contentToPlainText(content)
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
    for (const paragraph of paragraphs) {
      const present = names
        .filter((name) => paragraph.includes(name))
        .slice(0, 8);
      present.forEach((name) =>
        mentionCounts.set(name, (mentionCounts.get(name) || 0) + 1),
      );
      for (let i = 0; i < present.length; i += 1) {
        for (let j = i + 1; j < present.length; j += 1) {
          addRelationEdge(
            edgeMap,
            present[i],
            present[j],
            1,
            labelsFromText(paragraph, "同场"),
            `《${chapter.title}》：${paragraph.slice(0, 120)}`,
          );
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
  return {
    nodes,
    edges,
    options: {
      characterNames: [...selectedNames],
      categoryFilter: categoryFilter === DEFAULT_CATEGORY ? "" : categoryFilter,
      relationTypes: customTypes,
    },
  };
}

module.exports = { addRelationEdge, buildRelationshipGraph };
