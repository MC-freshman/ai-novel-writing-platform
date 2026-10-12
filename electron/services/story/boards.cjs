"use strict";
const {
  STORY_STATE_VERSION,
  ensureStoryState,
  fs,
  getBoardPath,
  getBoardsDir,
  getForeshadowsPath,
  getLedgerPath,
  getManualFactsPath,
  getStoryIndexPath,
  nowIso,
  path,
  readJson,
  readLedgerCached,
  stableId,
  writeJsonAtomic,
  transactionalStoryMutation,
} = require("./dependencies.cjs");
const { listCharacterStates } = require("./ledger.cjs");

function boardItemsFromContext(chapter, nextChapter, ledger, foreshadows) {
  const characterNames = [
    ...new Set(
      (ledger?.characterStates || []).map((item) => item.characterName),
    ),
  ].slice(0, 8);
  const openForeshadows = (foreshadows || [])
    .filter((item) => !["已经回收", "已废弃"].includes(item.status))
    .slice(0, 5);
  const target = nextChapter?.title || `${chapter.title}之后`;
  const rawItems = [
    [
      "章节目标",
      `明确《${target}》要改变什么局面，避免只重复上一章信息。`,
      "目标",
    ],
    [
      "承接结果",
      `用一个短场景承接《${chapter.title}》造成的直接后果。`,
      "节奏",
    ],
    [
      "人物表现",
      characterNames.length
        ? `让${characterNames.join("、")}至少一人的选择推动事件。`
        : "让主要人物通过选择推动事件，而不是只被动听取信息。",
      "人物",
    ],
    [
      "冲突升级",
      "增加一个与主线目标直接相关的新阻碍，并让角色付出明确代价。",
      "冲突",
    ],
    [
      "信息释放",
      "只释放完成本章目标所需的信息，其余设定继续保留悬念。",
      "信息",
    ],
    [
      "伏笔处理",
      openForeshadows.length
        ? `考虑强化或回收：${openForeshadows.map((item) => item.title).join("、")}`
        : "检查是否需要埋下一处可在后文验证的异常细节。",
      "伏笔",
    ],
    [
      "结尾钩子",
      "以新决定、新发现或迫近危险结束，让下一章目标自然成立。",
      "结尾",
    ],
  ];
  return rawItems.map(([title, detail, type], index) => ({
    id: stableId("beat", `${chapter.id}|${index}|${title}`),
    type,
    title,
    detail,
    order: index,
    locked: false,
    completed: false,
    sourceRefs: [],
  }));
}

async function getBoard(projectPath, chapterId) {
  await ensureStoryState(projectPath);
  return readJson(getBoardPath(projectPath, chapterId), null);
}

async function listBoards(projectPath) {
  await ensureStoryState(projectPath);
  const entries = await fs.readdir(getBoardsDir(projectPath)).catch(() => []);
  const boards = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const board = await readJson(
      path.join(getBoardsDir(projectPath), entry),
      null,
    );
    if (board?.id) boards.push(board);
  }
  return boards;
}

async function saveBoard(projectPath, board) {
  if (!board?.chapterId) throw new Error("筹备板缺少来源章节。");
  const items = (Array.isArray(board.items) ? board.items : [])
    .slice(0, 80)
    .map((item, index) => ({
      id: String(
        item.id ||
          stableId("beat", `${board.chapterId}|${index}|${item.title}`),
      ),
      type: String(item.type || "事件").slice(0, 20),
      title: String(item.title || `筹备项 ${index + 1}`).slice(0, 100),
      detail: String(item.detail || "").slice(0, 2000),
      order: index,
      locked: Boolean(item.locked),
      completed: Boolean(item.completed),
      sourceRefs: Array.isArray(item.sourceRefs)
        ? item.sourceRefs.slice(0, 20)
        : [],
    }));
  const next = {
    ...board,
    version: STORY_STATE_VERSION,
    items,
    updatedAt: nowIso(),
  };
  await writeJsonAtomic(getBoardPath(projectPath, board.chapterId), next);
  return next;
}

async function generateLocalBoard(projectPath, chapter, nextChapter) {
  await ensureStoryState(projectPath);
  const previous = await getBoard(projectPath, chapter.id);
  const ledger = await readJson(getLedgerPath(projectPath, chapter.id), null);
  const foreshadows =
    (await readJson(getForeshadowsPath(projectPath), { items: [] })).items ||
    [];
  const generated = boardItemsFromContext(
    chapter,
    nextChapter,
    ledger,
    foreshadows,
  );
  const locked = (previous?.items || []).filter((item) => item.locked);
  const lockedIds = new Set(locked.map((item) => item.id));
  const items = [
    ...locked,
    ...generated.filter((item) => !lockedIds.has(item.id)),
  ];
  return saveBoard(projectPath, {
    id: previous?.id || stableId("board", chapter.id),
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    targetChapterId: nextChapter?.id || "",
    targetChapterTitle: nextChapter?.title || "下一章",
    status: previous?.status || "筹备中",
    generatedAt: nowIso(),
    items,
  });
}

async function getAgentContext(
  projectPath,
  chapterId,
  characterNames = [],
  contextIds = [],
) {
  await ensureStoryState(projectPath);
  const ledger = await readLedgerCached(projectPath, chapterId);
  const foreshadows =
    (await readJson(getForeshadowsPath(projectPath), { items: [] })).items ||
    [];
  const manualFacts =
    (await readJson(getManualFactsPath(projectPath), { items: [] })).items ||
    [];
  const characterStates = await listCharacterStates(projectPath);
  const selectedCharacters = characterStates.filter(
    (item) =>
      !characterNames.length || characterNames.includes(item.characterName),
  );
  const selectedIds = new Set((contextIds || []).map(String));
  let selectedFacts = [];
  if (selectedIds.size) {
    const index = await readJson(getStoryIndexPath(projectPath), {
      chapters: [],
    });
    const ledgers = (
      await Promise.all(
        (index.chapters || []).map((item) =>
          readLedgerCached(projectPath, item.chapterId),
        ),
      )
    ).filter(Boolean);
    selectedFacts = [
      ...ledgers.flatMap((item) => item.facts || []),
      ...manualFacts,
    ].filter((item) => selectedIds.has(item.id));
  }
  const baseFacts = [
    ...(ledger?.facts || []),
    ...manualFacts.filter((item) => item.chapterId === chapterId),
  ].filter((item) => item.status !== "已忽略");
  const facts = [
    ...selectedFacts,
    ...baseFacts.filter(
      (item) => !selectedFacts.some((selected) => selected.id === item.id),
    ),
  ];
  const prioritizedCharacters = selectedIds.size
    ? characterStates.filter(
        (record) =>
          selectedIds.has(record.characterId) ||
          record.states.some((state) => selectedIds.has(state.id)),
      )
    : [];
  const characterContext = [
    ...prioritizedCharacters,
    ...selectedCharacters.filter(
      (record) =>
        !prioritizedCharacters.some(
          (selected) => selected.characterId === record.characterId,
        ),
    ),
  ];
  const openForeshadows = foreshadows.filter(
    (item) => !["已经回收", "已废弃"].includes(item.status),
  );
  const prioritizedForeshadows = selectedIds.size
    ? foreshadows.filter((item) => selectedIds.has(item.id))
    : [];
  return {
    ledger,
    facts: facts.slice(0, 120),
    characterStates: characterContext
      .map(
        (item) =>
          item.states.find((state) => selectedIds.has(state.id)) || item.latest,
      )
      .filter(Boolean)
      .slice(0, 50),
    foreshadows: [
      ...prioritizedForeshadows,
      ...openForeshadows.filter(
        (item) =>
          !prioritizedForeshadows.some((selected) => selected.id === item.id),
      ),
    ].slice(0, 60),
  };
}

module.exports = {
  boardItemsFromContext,
  getBoard,
  listBoards,
  saveBoard: transactionalStoryMutation(saveBoard),
  generateLocalBoard: transactionalStoryMutation(generateLocalBoard),
  getAgentContext,
};
