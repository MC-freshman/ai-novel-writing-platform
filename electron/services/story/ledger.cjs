"use strict";
const {
  FACT_STATUSES,
  FORESHADOW_STATUSES,
  STORY_STATE_VERSION,
  ensureStoryState,
  fs,
  getBoardsDir,
  getCharacterStateDir,
  getForeshadowsPath,
  getLedgerPath,
  getManualFactsPath,
  getStoryIndexPath,
  ledgerReadCache,
  nowIso,
  path,
  readJson,
  readLedgerCached,
  removeProjectFile,
  safeFileSegment,
  writeJsonAtomic,
  transactionalStoryMutation,
} = require("./dependencies.cjs");

function mergePreservingStatus(
  nextItems,
  previousItems,
  allowedStatuses,
  defaultStatus,
) {
  const previousById = new Map(
    (previousItems || []).map((item) => [item.id, item]),
  );
  const previousByEvidence = new Map(
    (previousItems || []).map((item) => [
      `${item.type || ""}\u0000${item.evidence?.[0]?.quote || item.plantedAt?.[0]?.quote || ""}`,
      item,
    ]),
  );
  return nextItems.map((item) => {
    const signature = `${item.type || ""}\u0000${item.evidence?.[0]?.quote || item.plantedAt?.[0]?.quote || ""}`;
    const previous =
      previousById.get(item.id) || previousByEvidence.get(signature);
    const status = allowedStatuses.has(previous?.status)
      ? previous.status
      : defaultStatus;
    const userEditedFields = Array.isArray(previous?.userEditedFields)
      ? previous.userEditedFields
      : [];
    const preservedEdits = Object.fromEntries(
      userEditedFields
        .filter((field) => Object.hasOwn(previous || {}, field))
        .map((field) => [field, previous[field]]),
    );
    return {
      ...item,
      ...preservedEdits,
      status,
      stale: false,
      userNote: previous?.userNote || item.userNote || "",
      userEditedFields,
    };
  });
}

function mergeEvidence(...groups) {
  const seen = new Set();
  const merged = [];
  for (const item of groups.flat()) {
    if (!item?.quote) continue;
    const key = `${item.chapterId || ""}\u0000${item.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.slice(0, 120);
}

function foreshadowMergeKey(item) {
  const title = String(item?.title || "")
    .replace(/[\s，。！？、,.!?：:；;“”"'《》()（）[\]]/g, "")
    .toLowerCase();
  return title.length >= 4
    ? title
    : `${title}|${String(item?.description || "").slice(0, 28)}`;
}

function collapseForeshadowLifecycle(items) {
  const merged = new Map();
  for (const item of items) {
    const key = foreshadowMergeKey(item);
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, {
        ...item,
        plantedAt: mergeEvidence(item.plantedAt || []),
        reinforcedAt: mergeEvidence(item.reinforcedAt || []),
        payoffAt: mergeEvidence(item.payoffAt || []),
      });
      continue;
    }
    const manualWins = previous.origin === "manual" || item.origin !== "manual";
    const combined = {
      ...(manualWins ? item : previous),
      ...(manualWins ? previous : item),
      id: manualWins ? previous.id : item.id,
      status: previous.status !== "AI候选" ? previous.status : item.status,
      plantedAt: mergeEvidence(previous.plantedAt || [], item.plantedAt || []),
      reinforcedAt: mergeEvidence(
        previous.reinforcedAt || [],
        item.reinforcedAt || [],
      ),
      payoffAt: mergeEvidence(previous.payoffAt || [], item.payoffAt || []),
      relatedCharacters: [
        ...new Set([
          ...(previous.relatedCharacters || []),
          ...(item.relatedCharacters || []),
        ]),
      ].slice(0, 40),
      updatedAt: nowIso(),
    };
    if (combined.payoffAt.length && combined.status === "AI候选")
      combined.status = "已经回收";
    else if (combined.reinforcedAt.length && combined.status === "AI候选")
      combined.status = "持续强化";
    merged.set(key, combined);
  }
  return [...merged.values()];
}

async function saveChapterLedger(projectPath, ledger) {
  await ensureStoryState(projectPath);
  const ledgerPath = getLedgerPath(projectPath, ledger.chapterId);
  const previous = await readJson(ledgerPath, null);
  const mergedFacts = mergePreservingStatus(
    ledger.facts || [],
    previous?.facts,
    FACT_STATUSES,
    "AI识别",
  );
  const mergedFactSignatures = new Set(
    mergedFacts.map(
      (item) => `${item.type || ""}\u0000${item.evidence?.[0]?.quote || ""}`,
    ),
  );
  const preservedFacts = (previous?.facts || [])
    .filter((item) => ["已确认", "已忽略"].includes(item.status))
    .filter(
      (item) =>
        !mergedFactSignatures.has(
          `${item.type || ""}\u0000${item.evidence?.[0]?.quote || ""}`,
        ),
    )
    .filter(
      (item) =>
        item.status === "已确认" ||
        item.sourceRevision === ledger.sourceRevision,
    )
    .map((item) => ({
      ...item,
      stale:
        item.origin === "manual"
          ? false
          : item.sourceRevision !== ledger.sourceRevision,
      updatedAt: nowIso(),
    }));
  const nextLedger = {
    ...ledger,
    facts: [...preservedFacts, ...mergedFacts],
  };
  await writeJsonAtomic(ledgerPath, nextLedger);
  ledgerReadCache.delete(ledgerPath);

  const foreshadowData = await readJson(getForeshadowsPath(projectPath), {
    version: STORY_STATE_VERSION,
    items: [],
  });
  const retainedForeshadows = (foreshadowData.items || []).filter(
    (item) => item.plantedAt?.[0]?.chapterId !== ledger.chapterId,
  );
  const mergedForeshadows = mergePreservingStatus(
    ledger.foreshadows || [],
    foreshadowData.items,
    FORESHADOW_STATUSES,
    "AI候选",
  );
  const mergedForeshadowEvidence = new Set(
    mergedForeshadows.map((item) => item.plantedAt?.[0]?.quote || item.id),
  );
  const preservedForeshadows = (foreshadowData.items || [])
    .filter((item) => item.plantedAt?.[0]?.chapterId === ledger.chapterId)
    .filter((item) => item.status !== "AI候选")
    .filter(
      (item) =>
        !mergedForeshadowEvidence.has(item.plantedAt?.[0]?.quote || item.id),
    )
    .map((item) => ({
      ...item,
      stale:
        item.origin === "manual"
          ? false
          : item.sourceRevision !== ledger.sourceRevision,
      updatedAt: nowIso(),
    }));
  const allForeshadows = collapseForeshadowLifecycle([
    ...retainedForeshadows,
    ...preservedForeshadows,
    ...mergedForeshadows,
  ]);
  await writeJsonAtomic(getForeshadowsPath(projectPath), {
    version: STORY_STATE_VERSION,
    updatedAt: nowIso(),
    items: allForeshadows,
  });

  const affectedCharacterIds = new Set(
    [
      ...(previous?.characterStates || []).map((item) => item.characterId),
      ...(nextLedger.characterStates || []).map((item) => item.characterId),
    ].filter(Boolean),
  );
  for (const characterId of affectedCharacterIds) {
    const statePath = path.join(
      getCharacterStateDir(projectPath),
      `${safeFileSegment(characterId, "character")}.json`,
    );
    const data = await readJson(statePath, null);
    if (!data?.states?.some((item) => item.chapterId === ledger.chapterId))
      continue;
    const states = data.states.filter(
      (item) => item.chapterId !== ledger.chapterId,
    );
    if (!states.length) await removeProjectFile(projectPath, statePath);
    else
      await writeJsonAtomic(statePath, {
        ...data,
        updatedAt: nowIso(),
        states,
      });
  }
  for (const state of nextLedger.characterStates || []) {
    const statePath = path.join(
      getCharacterStateDir(projectPath),
      `${safeFileSegment(state.characterId, "character")}.json`,
    );
    const data = await readJson(statePath, {
      version: STORY_STATE_VERSION,
      characterId: state.characterId,
      characterName: state.characterName,
      states: [],
    });
    const states = [
      ...(data.states || []).filter(
        (item) => item.chapterId !== ledger.chapterId,
      ),
      state,
    ].sort(
      (a, b) =>
        Number(a.chapterOrder || 0) - Number(b.chapterOrder || 0) ||
        String(a.updatedAt).localeCompare(String(b.updatedAt)),
    );
    await writeJsonAtomic(statePath, {
      ...data,
      characterName: state.characterName,
      updatedAt: nowIso(),
      states,
    });
  }

  const index = await readJson(getStoryIndexPath(projectPath), {
    version: STORY_STATE_VERSION,
    chapters: [],
  });
  const chapterEntry = {
    chapterId: ledger.chapterId,
    chapterTitle: ledger.chapterTitle,
    volume: ledger.volume,
    sourceRevision: ledger.sourceRevision,
    analysisMode: ledger.analysisMode,
    analyzedAt: ledger.analyzedAt,
    factCount: nextLedger.facts.length,
    characterStateCount: nextLedger.characterStates.length,
    foreshadowCount: mergedForeshadows.length,
  };
  const chapters = [
    ...(index.chapters || []).filter(
      (item) => item.chapterId !== ledger.chapterId,
    ),
    chapterEntry,
  ];
  await writeJsonAtomic(getStoryIndexPath(projectPath), {
    version: STORY_STATE_VERSION,
    updatedAt: nowIso(),
    chapters,
    factCount: chapters.reduce(
      (sum, item) => sum + Number(item.factCount || 0),
      0,
    ),
    characterStateCount: chapters.reduce(
      (sum, item) => sum + Number(item.characterStateCount || 0),
      0,
    ),
    foreshadowCount: allForeshadows.length,
  });
  return nextLedger;
}

async function removeChapterLedger(projectPath, chapterId) {
  await ensureStoryState(projectPath);
  const ledger = await readJson(getLedgerPath(projectPath, chapterId), null);
  await removeProjectFile(projectPath, getLedgerPath(projectPath, chapterId));
  ledgerReadCache.delete(getLedgerPath(projectPath, chapterId));
  const foreshadowData = await readJson(getForeshadowsPath(projectPath), {
    version: STORY_STATE_VERSION,
    items: [],
  });
  const items = (foreshadowData.items || []).filter(
    (item) => item.plantedAt?.[0]?.chapterId !== chapterId,
  );
  await writeJsonAtomic(getForeshadowsPath(projectPath), {
    ...foreshadowData,
    updatedAt: nowIso(),
    items,
  });
  const manualFacts = await readJson(getManualFactsPath(projectPath), {
    version: STORY_STATE_VERSION,
    items: [],
  });
  const retainedManualFacts = (manualFacts.items || []).filter(
    (item) => item.chapterId !== chapterId,
  );
  if (retainedManualFacts.length !== (manualFacts.items || []).length) {
    await writeJsonAtomic(getManualFactsPath(projectPath), {
      ...manualFacts,
      updatedAt: nowIso(),
      items: retainedManualFacts,
    });
  }
  const index = await readJson(getStoryIndexPath(projectPath), {
    version: STORY_STATE_VERSION,
    chapters: [],
  });
  const chapters = (index.chapters || []).filter(
    (item) => item.chapterId !== chapterId,
  );
  await writeJsonAtomic(getStoryIndexPath(projectPath), {
    ...index,
    updatedAt: nowIso(),
    chapters,
    factCount: chapters.reduce(
      (sum, item) => sum + Number(item.factCount || 0),
      0,
    ),
    characterStateCount: chapters.reduce(
      (sum, item) => sum + Number(item.characterStateCount || 0),
      0,
    ),
    foreshadowCount: items.length,
  });
  const knownCharacterIds = new Set(
    (ledger?.characterStates || [])
      .map((item) => item.characterId)
      .filter(Boolean),
  );
  const stateFiles = knownCharacterIds.size
    ? [...knownCharacterIds].map(
        (characterId) => `${safeFileSegment(characterId, "character")}.json`,
      )
    : (
        await fs.readdir(getCharacterStateDir(projectPath)).catch(() => [])
      ).filter((item) => item.endsWith(".json"));
  for (const file of stateFiles) {
    const statePath = path.join(getCharacterStateDir(projectPath), file);
    const data = await readJson(statePath, null);
    if (!data?.states?.some((item) => item.chapterId === chapterId)) continue;
    const states = data.states.filter((item) => item.chapterId !== chapterId);
    if (!states.length) await removeProjectFile(projectPath, statePath);
    else
      await writeJsonAtomic(statePath, {
        ...data,
        updatedAt: nowIso(),
        states,
      });
  }
}

async function listCharacterStates(projectPath) {
  await ensureStoryState(projectPath);
  const files = (
    await fs.readdir(getCharacterStateDir(projectPath)).catch(() => [])
  ).filter((item) => item.endsWith(".json"));
  const records = await Promise.all(
    files.map((file) =>
      readJson(path.join(getCharacterStateDir(projectPath), file), null),
    ),
  );
  return records.filter(Boolean).map((record) => {
    const states = (Array.isArray(record.states) ? record.states : []).map(
      (item) => ({
        ...item,
        route: Array.isArray(item.route) ? item.route : [],
        physical: Array.isArray(item.physical) ? item.physical : [],
        mental: Array.isArray(item.mental) ? item.mental : [],
        abilities: Array.isArray(item.abilities) ? item.abilities : [],
        goals: Array.isArray(item.goals) ? item.goals : [],
        obstacles: Array.isArray(item.obstacles) ? item.obstacles : [],
        knowledge: Array.isArray(item.knowledge) ? item.knowledge : [],
        knowledgeSources: Array.isArray(item.knowledgeSources)
          ? item.knowledgeSources
          : [],
        possessions: Array.isArray(item.possessions) ? item.possessions : [],
        relationships: Array.isArray(item.relationships)
          ? item.relationships
          : [],
        relationshipChanges: Array.isArray(item.relationshipChanges)
          ? item.relationshipChanges
          : Array.isArray(item.relationships)
            ? item.relationships
            : [],
      }),
    );
    return {
      characterId: record.characterId,
      characterName: record.characterName,
      states,
      latest: states.length ? states[states.length - 1] : null,
    };
  });
}

async function getStoryOverview(projectPath, options = {}) {
  await ensureStoryState(projectPath);
  const index = await readJson(getStoryIndexPath(projectPath), {
    version: STORY_STATE_VERSION,
    chapters: [],
  });
  const selectedChapterIds = new Set((options.chapterIds || []).map(String));
  const chapterEntries = selectedChapterIds.size
    ? (index.chapters || []).filter((item) =>
        selectedChapterIds.has(item.chapterId),
      )
    : index.chapters || [];
  const ledgerLimit = Math.max(
    1,
    Math.min(500, Number(options.chapterLimit) || 120),
  );
  const ledgers = (
    await Promise.all(
      chapterEntries
        .slice(-ledgerLimit)
        .map((item) => readLedgerCached(projectPath, item.chapterId)),
    )
  ).filter(Boolean);
  const manualFacts =
    (await readJson(getManualFactsPath(projectPath), { items: [] })).items ||
    [];
  let facts = [...ledgers.flatMap((item) => item.facts || []), ...manualFacts];
  if (selectedChapterIds.size)
    facts = facts.filter((item) => selectedChapterIds.has(item.chapterId));
  if (options.volume)
    facts = facts.filter((item) => item.volume === options.volume);
  if (options.factStatus)
    facts = facts.filter((item) => item.status === options.factStatus);
  if (options.query) {
    const query = String(options.query).toLowerCase();
    facts = facts.filter((item) =>
      `${item.subject} ${item.predicate} ${item.object} ${item.chapterTitle}`
        .toLowerCase()
        .includes(query),
    );
  }
  const allForeshadows =
    (await readJson(getForeshadowsPath(projectPath), { items: [] })).items ||
    [];
  let foreshadows = allForeshadows;
  if (selectedChapterIds.size)
    foreshadows = foreshadows.filter((item) =>
      [
        ...(item.plantedAt || []),
        ...(item.reinforcedAt || []),
        ...(item.payoffAt || []),
      ].some((evidence) => selectedChapterIds.has(evidence.chapterId)),
    );
  if (options.volume)
    foreshadows = foreshadows.filter((item) =>
      [
        ...(item.plantedAt || []),
        ...(item.reinforcedAt || []),
        ...(item.payoffAt || []),
      ].some((evidence) => evidence.volume === options.volume),
    );
  if (options.foreshadowStatus)
    foreshadows = foreshadows.filter(
      (item) => item.status === options.foreshadowStatus,
    );
  if (options.query) {
    const query = String(options.query).toLowerCase();
    foreshadows = foreshadows.filter((item) =>
      `${item.title} ${item.description} ${item.userNote || ""}`
        .toLowerCase()
        .includes(query),
    );
  }
  let characters = await listCharacterStates(projectPath);
  characters = characters
    .map((record) => {
      let states = record.states || [];
      if (selectedChapterIds.size)
        states = states.filter((item) =>
          selectedChapterIds.has(item.chapterId),
        );
      if (options.volume)
        states = states.filter((item) => item.volume === options.volume);
      return {
        ...record,
        states,
        latest: states.length ? states[states.length - 1] : null,
      };
    })
    .filter((record) => record.states.length);
  if (options.query) {
    const query = String(options.query).toLowerCase();
    characters = characters.filter((record) =>
      `${record.characterName} ${record.states.map((item) => `${item.location} ${item.route?.join(" ")} ${item.physical?.join(" ")} ${item.mental?.join(" ")} ${item.abilities?.join(" ")} ${item.goals?.join(" ")} ${item.obstacles?.join(" ")} ${item.knowledge?.join(" ")} ${item.relationshipChanges?.join(" ")}`).join(" ")}`
        .toLowerCase()
        .includes(query),
    );
  }
  const covered = new Set((index.chapters || []).map((item) => item.chapterId));
  const projectChapterIds = (options.projectChapters || []).map(
    (item) => item.id,
  );
  return {
    updatedAt: index.updatedAt || "",
    counts: {
      chapters: (index.chapters || []).length,
      facts: Number(index.factCount || 0) + manualFacts.length,
      characterStates: Number(index.characterStateCount || 0),
      foreshadows: allForeshadows.length,
      boards: (
        await fs.readdir(getBoardsDir(projectPath)).catch(() => [])
      ).filter((item) => item.endsWith(".json")).length,
    },
    coverage: {
      total: projectChapterIds.length,
      analyzed: projectChapterIds.filter((id) => covered.has(id)).length,
      stale: (index.chapters || [])
        .filter((entry) => {
          const chapter = (options.projectChapters || []).find(
            (item) => item.id === entry.chapterId,
          );
          return chapter?.revision && chapter.revision !== entry.sourceRevision;
        })
        .map((item) => item.chapterId),
      missing: projectChapterIds.filter((id) => !covered.has(id)),
    },
    chapterEntries: index.chapters || [],
    facts: facts.slice(
      Math.max(0, Number(options.factOffset) || 0),
      Math.max(0, Number(options.factOffset) || 0) +
        Math.max(20, Math.min(2000, Number(options.factLimit) || 400)),
    ),
    characterStates: characters.slice(
      Math.max(0, Number(options.characterOffset) || 0),
      Math.max(0, Number(options.characterOffset) || 0) +
        Math.max(20, Math.min(500, Number(options.characterLimit) || 200)),
    ),
    foreshadows: foreshadows.slice(
      Math.max(0, Number(options.foreshadowOffset) || 0),
      Math.max(0, Number(options.foreshadowOffset) || 0) +
        Math.max(20, Math.min(1000, Number(options.foreshadowLimit) || 300)),
    ),
    pageInfo: {
      facts: {
        total: facts.length,
        offset: Math.max(0, Number(options.factOffset) || 0),
        limit: Math.max(20, Math.min(2000, Number(options.factLimit) || 400)),
      },
      characters: {
        total: characters.length,
        offset: Math.max(0, Number(options.characterOffset) || 0),
        limit: Math.max(
          20,
          Math.min(500, Number(options.characterLimit) || 200),
        ),
      },
      foreshadows: {
        total: foreshadows.length,
        offset: Math.max(0, Number(options.foreshadowOffset) || 0),
        limit: Math.max(
          20,
          Math.min(1000, Number(options.foreshadowLimit) || 300),
        ),
      },
    },
  };
}

module.exports = {
  mergePreservingStatus,
  mergeEvidence,
  foreshadowMergeKey,
  collapseForeshadowLifecycle,
  saveChapterLedger: transactionalStoryMutation(saveChapterLedger),
  removeChapterLedger: transactionalStoryMutation(removeChapterLedger),
  listCharacterStates,
  getStoryOverview,
};
