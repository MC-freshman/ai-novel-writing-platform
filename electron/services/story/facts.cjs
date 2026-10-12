"use strict";
const {
  FACT_STATUSES,
  FORESHADOW_STATUSES,
  STORY_STATE_VERSION,
  ensureStoryState,
  getForeshadowsPath,
  getLedgerPath,
  getManualFactsPath,
  getStoryIndexPath,
  ledgerReadCache,
  nowIso,
  readJson,
  stableId,
  writeJsonAtomic,
  transactionalStoryMutation,
} = require("./dependencies.cjs");
const { mergeEvidence } = require("./ledger.cjs");

async function updateFact(projectPath, factId, patch = {}) {
  await ensureStoryState(projectPath);
  const manualData = await readJson(getManualFactsPath(projectPath), {
    version: STORY_STATE_VERSION,
    items: [],
  });
  const manualIndex = manualData.items.findIndex((item) => item.id === factId);
  if (manualIndex >= 0) {
    const current = manualData.items[manualIndex];
    manualData.items[manualIndex] = {
      ...current,
      type: String(patch.type ?? current.type).slice(0, 30),
      subject: String(patch.subject ?? current.subject).slice(0, 100),
      predicate: String(patch.predicate ?? current.predicate).slice(0, 100),
      object: String(patch.object ?? current.object).slice(0, 2000),
      status: FACT_STATUSES.has(patch.status) ? patch.status : current.status,
      userNote: String(patch.userNote ?? current.userNote ?? "").slice(0, 2000),
      updatedAt: nowIso(),
    };
    manualData.updatedAt = nowIso();
    await writeJsonAtomic(getManualFactsPath(projectPath), manualData);
    return manualData.items[manualIndex];
  }
  const index = await readJson(getStoryIndexPath(projectPath), {
    chapters: [],
  });
  for (const chapter of index.chapters || []) {
    const filePath = getLedgerPath(projectPath, chapter.chapterId);
    const ledger = await readJson(filePath, null);
    const itemIndex =
      ledger?.facts?.findIndex((item) => item.id === factId) ?? -1;
    if (itemIndex < 0) continue;
    const current = ledger.facts[itemIndex];
    const status = FACT_STATUSES.has(patch.status)
      ? patch.status
      : current.status;
    const editedFields = ["type", "subject", "predicate", "object"].filter(
      (field) => patch[field] !== undefined,
    );
    ledger.facts[itemIndex] = {
      ...current,
      type: String(patch.type ?? current.type).slice(0, 30),
      subject: String(patch.subject ?? current.subject).slice(0, 100),
      predicate: String(patch.predicate ?? current.predicate).slice(0, 100),
      object: String(patch.object ?? current.object).slice(0, 2000),
      status,
      userNote: String(patch.userNote ?? current.userNote ?? "").slice(0, 2000),
      userEditedFields: [
        ...new Set([...(current.userEditedFields || []), ...editedFields]),
      ],
      updatedAt: nowIso(),
    };
    await writeJsonAtomic(filePath, ledger);
    ledgerReadCache.delete(filePath);
    return ledger.facts[itemIndex];
  }
  throw new Error("没有找到这条剧情事实。它可能已经随章节重新分析而更新。");
}

async function createManualFact(projectPath, payload = {}) {
  await ensureStoryState(projectPath);
  const createdAt = nowIso();
  const item = {
    id: stableId(
      "fact-manual",
      `${createdAt}|${Math.random()}|${payload.chapterId}|${payload.subject}|${payload.object}`,
    ),
    type: String(payload.type || "剧情事件").slice(0, 30),
    subject:
      String(payload.subject || "未明确")
        .trim()
        .slice(0, 100) || "未明确",
    predicate:
      String(payload.predicate || payload.type || "发生")
        .trim()
        .slice(0, 100) || "发生",
    object: String(payload.object || "")
      .trim()
      .slice(0, 2000),
    chapterId: String(payload.chapterId || ""),
    chapterTitle: String(payload.chapterTitle || "未关联章节").slice(0, 120),
    volume: String(payload.volume || "未分卷").slice(0, 120),
    confidence: 1,
    status: "已确认",
    evidence:
      Array.isArray(payload.evidence) && payload.evidence.length
        ? payload.evidence.slice(0, 8)
        : [
            {
              chapterId: String(payload.chapterId || ""),
              chapterTitle: String(payload.chapterTitle || "未关联章节").slice(
                0,
                120,
              ),
              volume: String(payload.volume || "未分卷").slice(0, 120),
              heading: "人工记录",
              quote: String(payload.object || "人工记录").slice(0, 360),
              start: -1,
              end: -1,
            },
          ],
    sourceRevision: "manual",
    origin: "manual",
    userNote: String(payload.userNote || "").slice(0, 2000),
    stale: false,
    updatedAt: createdAt,
  };
  if (!item.object) throw new Error("请填写剧情事实内容。");
  const data = await readJson(getManualFactsPath(projectPath), {
    version: STORY_STATE_VERSION,
    items: [],
  });
  data.items = [item, ...(data.items || [])].slice(0, 20000);
  data.updatedAt = createdAt;
  await writeJsonAtomic(getManualFactsPath(projectPath), data);
  return item;
}

async function deleteFact(projectPath, factId) {
  await ensureStoryState(projectPath);
  const data = await readJson(getManualFactsPath(projectPath), {
    version: STORY_STATE_VERSION,
    items: [],
  });
  const item = (data.items || []).find((candidate) => candidate.id === factId);
  if (!item)
    throw new Error(
      "自动识别的事实不能直接删除，请改为“已忽略”；只有人工新增的事实可以删除。",
    );
  data.items = data.items.filter((candidate) => candidate.id !== factId);
  data.updatedAt = nowIso();
  await writeJsonAtomic(getManualFactsPath(projectPath), data);
  return { removed: true, factId };
}

async function updateForeshadow(projectPath, foreshadowId, patch = {}) {
  await ensureStoryState(projectPath);
  const data = await readJson(getForeshadowsPath(projectPath), {
    version: STORY_STATE_VERSION,
    items: [],
  });
  const index = data.items.findIndex((item) => item.id === foreshadowId);
  if (index < 0)
    throw new Error("没有找到这条伏笔。它可能已经随章节重新分析而更新。");
  const current = data.items[index];
  const editedFields = [
    "title",
    "description",
    "plannedPayoff",
    "plantedAt",
    "reinforcedAt",
    "payoffAt",
    "relatedCharacters",
  ].filter((field) => patch[field] !== undefined);
  const normalizePatchedEvidence = (field) =>
    Array.isArray(patch[field])
      ? mergeEvidence(
          patch[field].map((item) => ({
            chapterId: String(item?.chapterId || ""),
            chapterTitle: String(item?.chapterTitle || "").slice(0, 120),
            volume: String(item?.volume || "未分卷").slice(0, 120),
            heading: String(item?.heading || "").slice(0, 80),
            quote: String(item?.quote || "").slice(0, 360),
            start: Number.isFinite(Number(item?.start))
              ? Number(item.start)
              : -1,
            end: Number.isFinite(Number(item?.end)) ? Number(item.end) : -1,
          })),
        )
      : current[field] || [];
  data.items[index] = {
    ...current,
    status: FORESHADOW_STATUSES.has(patch.status)
      ? patch.status
      : current.status,
    title: String(patch.title ?? current.title).slice(0, 80),
    description: String(patch.description ?? current.description).slice(
      0,
      1000,
    ),
    plannedPayoff: String(
      patch.plannedPayoff ?? current.plannedPayoff ?? "",
    ).slice(0, 1000),
    plantedAt: normalizePatchedEvidence("plantedAt"),
    reinforcedAt: normalizePatchedEvidence("reinforcedAt"),
    payoffAt: normalizePatchedEvidence("payoffAt"),
    relatedCharacters: Array.isArray(patch.relatedCharacters)
      ? patch.relatedCharacters.map(String).slice(0, 40)
      : current.relatedCharacters || [],
    userNote: String(patch.userNote ?? current.userNote ?? "").slice(0, 1000),
    userEditedFields: [
      ...new Set([...(current.userEditedFields || []), ...editedFields]),
    ],
    updatedAt: nowIso(),
  };
  data.updatedAt = nowIso();
  await writeJsonAtomic(getForeshadowsPath(projectPath), data);
  return data.items[index];
}

async function createManualForeshadow(projectPath, payload = {}) {
  await ensureStoryState(projectPath);
  const createdAt = nowIso();
  const evidence = {
    chapterId: String(payload.chapterId || ""),
    chapterTitle: String(payload.chapterTitle || "未关联章节").slice(0, 120),
    volume: String(payload.volume || "未分卷").slice(0, 120),
    heading: "人工记录",
    quote: String(
      payload.evidenceQuote || payload.description || "人工记录",
    ).slice(0, 360),
    start: -1,
    end: -1,
  };
  const item = {
    id: stableId(
      "foreshadow-manual",
      `${createdAt}|${Math.random()}|${payload.chapterId}|${payload.title}`,
    ),
    title: String(payload.title || "")
      .trim()
      .slice(0, 80),
    description: String(payload.description || "")
      .trim()
      .slice(0, 1000),
    status: FORESHADOW_STATUSES.has(payload.status)
      ? payload.status
      : "已确认埋下",
    plantedAt: [evidence],
    reinforcedAt: [],
    payoffAt: [],
    plannedPayoff: String(payload.plannedPayoff || "").slice(0, 1000),
    relatedCharacters: Array.isArray(payload.relatedCharacters)
      ? payload.relatedCharacters.map(String).slice(0, 20)
      : [],
    sourceRevision: "manual",
    origin: "manual",
    confidence: 1,
    userNote: String(payload.userNote || "").slice(0, 2000),
    stale: false,
    updatedAt: createdAt,
  };
  if (!item.title || !item.description)
    throw new Error("请填写伏笔标题和内容。");
  const data = await readJson(getForeshadowsPath(projectPath), {
    version: STORY_STATE_VERSION,
    items: [],
  });
  data.items = [item, ...(data.items || [])].slice(0, 20000);
  data.updatedAt = createdAt;
  await writeJsonAtomic(getForeshadowsPath(projectPath), data);
  return item;
}

async function deleteForeshadow(projectPath, foreshadowId) {
  await ensureStoryState(projectPath);
  const data = await readJson(getForeshadowsPath(projectPath), {
    version: STORY_STATE_VERSION,
    items: [],
  });
  const item = (data.items || []).find(
    (candidate) => candidate.id === foreshadowId,
  );
  if (!item) return { removed: false, foreshadowId };
  if (item.origin !== "manual")
    throw new Error(
      "自动识别的伏笔不能直接删除，请改为“已废弃”；只有人工新增的伏笔可以删除。",
    );
  data.items = data.items.filter((candidate) => candidate.id !== foreshadowId);
  data.updatedAt = nowIso();
  await writeJsonAtomic(getForeshadowsPath(projectPath), data);
  return { removed: true, foreshadowId };
}

module.exports = {
  updateFact: transactionalStoryMutation(updateFact),
  createManualFact: transactionalStoryMutation(createManualFact),
  deleteFact: transactionalStoryMutation(deleteFact),
  updateForeshadow: transactionalStoryMutation(updateForeshadow),
  createManualForeshadow: transactionalStoryMutation(createManualForeshadow),
  deleteForeshadow: transactionalStoryMutation(deleteForeshadow),
};
