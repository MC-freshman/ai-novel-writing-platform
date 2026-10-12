"use strict";
const {
  contentToPlainText,
  creativeStatistics,
  creativeWorkspace,
  fs,
  getChapterPath,
  getCreativeWorkspaceView,
  loadCharacters,
  loadConfig,
  loadProjectSources,
  loadWorldDocs,
  normalizeCategory,
  storyState,
} = require("./dependencies.cjs");

async function buildCreativeStatistics(
  projectPath,
  label = "",
  control = null,
) {
  const config = await loadConfig(projectPath);
  const workspace = await creativeWorkspace.loadWorkspace(projectPath);
  const overview = await storyState.getStoryOverview(projectPath, {
    projectChapters: config.chapters,
    factLimit: 2000,
    characterLimit: 1000,
    foreshadowLimit: 2000,
  });
  const characters = await loadCharacters(projectPath);
  const contents = /** @type {Record<string, string>} */ ({});
  const chapters = config.chapters
    .slice()
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  for (let index = 0; index < chapters.length; index += 1) {
    control?.throwIfCanceled?.();
    const chapter = chapters[index];
    contents[chapter.id] = await fs
      .readFile(getChapterPath(projectPath, chapter), "utf8")
      .catch(() => "");
    if (control?.update && (index % 10 === 0 || index === chapters.length - 1))
      await control.update({
        phase: "正在统计章节",
        current: index + 1,
        total: chapters.length,
        detail: chapter.title,
      });
  }
  const snapshot = creativeStatistics.analyzeProjectStatistics({
    chapters,
    contents,
    characters,
    workspace,
    storyOverview: /** @type {any} */ (overview),
    label,
  });
  await creativeWorkspace.upsertItem(
    projectPath,
    "statisticsHistory",
    snapshot,
  );
  return { snapshot, workspace: await getCreativeWorkspaceView(projectPath) };
}

async function buildAppearanceStats(projectPath) {
  const { chapters, characters } = await loadProjectSources(projectPath);
  const stats = characters.map((card) => {
    const appearances = [];
    const total = 0;
    return { card, appearances, total };
  });
  for (const stat of stats) {
    for (const chapter of chapters) {
      const rawContent = await fs
        .readFile(getChapterPath(projectPath, chapter), "utf8")
        .catch(() => "");
      const content = contentToPlainText(rawContent);
      const count = stat.card.name
        ? (
            content.match(
              new RegExp(
                stat.card.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                "g",
              ),
            ) || []
          ).length
        : 0;
      if (count > 0)
        stat.appearances.push({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          volume: chapter.volume || "未分卷",
          count,
        });
      stat.total += count;
    }
  }
  const result = stats.map(({ card, appearances, total }) => ({
    id: card.id,
    name: card.name,
    category: normalizeCategory(card.category),
    total,
    chapters: appearances,
  }));
  return {
    stats: result.sort(
      (a, b) => b.total - a.total || a.name.localeCompare(b.name, "zh-CN"),
    ),
  };
}

async function buildWorldMap(projectPath) {
  const worldDocs = await loadWorldDocs(projectPath);
  const nodes = [];
  const edges = [];
  const byTitle = new Map(worldDocs.map((doc) => [doc.title, doc]));
  for (const doc of worldDocs) {
    const category = normalizeCategory(doc.category);
    const type = category.includes("地点")
      ? "地点"
      : category.includes("势力")
        ? "势力"
        : category.includes("物品")
          ? "物品"
          : "设定";
    nodes.push({
      id: doc.id,
      title: doc.title,
      category,
      type,
      summary: contentToPlainText(doc.content).slice(0, 160),
    });
  }
  for (const doc of worldDocs) {
    const text = contentToPlainText(doc.content);
    for (const [title, target] of byTitle.entries()) {
      if (target.id !== doc.id && text.includes(title)) {
        edges.push({
          id: `${doc.id}_${target.id}`,
          source: doc.id,
          target: target.id,
          label: "提及",
        });
      }
    }
  }
  return { nodes, edges: edges.slice(0, 200) };
}

module.exports = {
  buildCreativeStatistics,
  buildAppearanceStats,
  buildWorldMap,
};
