"use strict";
// 全书搜索与批量替换（P76 + P92）。
// P92：安全正则（嵌套量词启发式拒绝+编译校验+零宽防护+命中上限）；角色卡/世界卡字段替换。
// 替换前强制快照；逐章 revision 校验，冲突即停（事务回滚）；替换走统一保存路径。
const fs = require("node:fs/promises");
const { withProjectTransaction } = require("./project-storage.cjs");
const { loadConfigUnlocked, getChapterPath, getCharacterPath, contentToPlainText, contentRevision, loadCharacters, loadWorldDocs, characterToMarkdown, writeWorldDoc, writeJson } = require("./project-files.cjs");
const { saveChapterContent } = require("./project-content.cjs");
const { indexSource } = require("./knowledge-index.cjs");
const projectSnapshots = require("./project-snapshots.cjs");

const MAX_QUERY_LENGTH = 200;
const MAX_REPLACEMENT_LENGTH = 2000;
const MAX_MATCHES_TOTAL = 5000;
const MAX_MATCHES_PER_CHAPTER = 500;
const CONTEXT_RADIUS = 30;
const CHARACTER_FIELDS = ["name", "appearance", "personality", "background", "relationships", "notes"];

function normalizeOptions(options = {}) {
  return {
    caseSensitive: options.caseSensitive === true,
    wholeWord: options.wholeWord === true,
    useRegex: options.useRegex === true,
    scope: ["chapters", "cards", "all"].includes(options.scope) ? options.scope : "chapters",
  };
}

function isWordChar(ch) {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

/** 安全正则编译：拒绝嵌套量词（灾难性回溯启发式），编译失败明确报错。 */
function compileSafeRegex(query, caseSensitive) {
  if (/\([^)]*[+*}][^)]*\)\s*[+*{]/.test(query) || /(\.\*){2,}/.test(query) || /\([^)]*\|[^)]*\)\s*[+*{]/.test(query))
    throw new Error("正则含嵌套量词/重叠分支，可能导致灾难性回溯，已拒绝。请简化表达式。");
  try {
    return new RegExp(query, caseSensitive ? "g" : "gi");
  } catch (error) {
    throw new Error(`正则无效：${error.message}`, { cause: error });
  }
}

function findMatchesRegex(text, regex, cap) {
  const matches = [];
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push({ index: matches.length, start: match.index, end: match.index + match[0].length });
    if (match[0].length === 0) {
      regex.lastIndex += 1;
      if (regex.lastIndex > text.length) break;
    }
    if (matches.length >= cap) break;
  }
  return matches;
}

/** 字面匹配（可选大小写/整词）；整词按 ASCII 词字符边界判定。 */
function findMatchesLiteral(text, query, options) {
  const matches = [];
  if (!query) return matches;
  const haystack = options.caseSensitive ? text : text.toLowerCase();
  const needle = options.caseSensitive ? query : query.toLowerCase();
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    const end = index + needle.length;
    const boundaryOk = !options.wholeWord || (!isWordChar(text[index - 1]) && !isWordChar(text[end]));
    if (boundaryOk) matches.push({ index: matches.length, start: index, end });
    from = index + Math.max(1, needle.length);
    if (matches.length >= MAX_MATCHES_PER_CHAPTER) break;
  }
  return matches;
}

function findMatches(text, query, options) {
  if (options.useRegex) return findMatchesRegex(text, compileSafeRegex(query, options.caseSensitive), MAX_MATCHES_PER_CHAPTER);
  return findMatchesLiteral(text, query, options);
}

function withContext(text, matches) {
  return matches.map((match) => ({
    ...match,
    context: text.slice(Math.max(0, match.start - CONTEXT_RADIUS), match.end + CONTEXT_RADIUS),
  }));
}

/** 展开替换模板：$$、$&、$1-$9（正则模式）。 */
function expandReplacement(template, matchArgs) {
  return String(template).replace(/\$(\$|&|[1-9])/g, (whole, token) => {
    if (token === "$") return "$";
    if (token === "&") return matchArgs[0];
    const group = matchArgs[Number(token)];
    return group === undefined ? whole : group;
  });
}

/** 在原文上按选中命中位置替换（字面/正则统一）。返回新文本与替换数。 */
function applyReplacement(raw, query, replacement, options, indices) {
  const selected = new Set(indices);
  if (options.useRegex) {
    const regex = compileSafeRegex(query, options.caseSensitive);
    let counter = 0;
    let replaced = 0;
    const next = raw.replace(regex, (...args) => {
      const matchIndex = counter++;
      if (!selected.has(matchIndex)) return args[0];
      replaced += 1;
      return expandReplacement(replacement, args);
    });
    return { next, replaced, total: counter };
  }
  const matches = findMatchesLiteral(raw, query, options);
  const chosen = indices.filter((index) => index >= 0 && index < matches.length).sort((a, b) => b - a);
  let next = raw;
  for (const index of chosen) {
    const position = matches[index];
    next = next.slice(0, position.start) + replacement + next.slice(position.end);
  }
  return { next, replaced: chosen.length, total: matches.length };
}

async function readChapterText(projectPath, chapter) {
  const raw = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => null);
  if (raw === null) return null;
  return { raw, text: contentToPlainText(raw) };
}

async function collectCards(projectPath) {
  const characters = await loadCharacters(projectPath);
  const worldDocs = await loadWorldDocs(projectPath);
  return { characters, worldDocs };
}

function cardFieldText(card, field) {
  return String(card[field] || "");
}

async function searchBook(projectPath, payload = {}) {
  const query = String(payload?.query || "").trim().slice(0, MAX_QUERY_LENGTH);
  if (!query) throw new Error("请输入搜索词。");
  const options = normalizeOptions(payload);
  if (options.useRegex) compileSafeRegex(query, options.caseSensitive);
  const config = await loadConfigUnlocked(projectPath);
  const chapters = config.chapters.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const results = [];
  let totalMatches = 0;
  let truncated = false;
  if (options.scope !== "cards") {
    for (const chapter of chapters) {
      const data = await readChapterText(projectPath, chapter);
      if (!data) continue;
      const matches = findMatches(data.text, query, options);
      if (!matches.length) continue;
      if (totalMatches + matches.length > MAX_MATCHES_TOTAL) truncated = true;
      const allowed = Math.max(0, Math.min(matches.length, MAX_MATCHES_TOTAL - totalMatches));
      totalMatches += allowed;
      results.push({ chapterId: chapter.id, title: chapter.title || "", fileName: chapter.fileName, matchCount: matches.length, matches: withContext(data.text, matches.slice(0, allowed)) });
      if (totalMatches >= MAX_MATCHES_TOTAL) break;
    }
  }
  const cardResults = [];
  if (options.scope !== "chapters") {
    const { characters, worldDocs } = await collectCards(projectPath);
    for (const card of characters) {
      const hits = [];
      for (const field of CHARACTER_FIELDS) {
        const matches = findMatches(cardFieldText(card, field), query, options);
        for (const match of matches) hits.push({ field, ...match, context: withContext(cardFieldText(card, field), [match])[0].context });
      }
      if (hits.length) { totalMatches += hits.length; cardResults.push({ cardType: "character", cardId: card.id, title: card.name || "", matchCount: hits.length, hits }); }
    }
    for (const doc of worldDocs) {
      const hits = [];
      for (const field of ["title", "content"]) {
        const matches = findMatches(cardFieldText(doc, field), query, options);
        for (const match of matches) hits.push({ field, ...match, context: withContext(cardFieldText(doc, field), [match])[0].context });
      }
      if (hits.length) { totalMatches += hits.length; cardResults.push({ cardType: "world", cardId: doc.id, title: doc.title || "", matchCount: hits.length, hits }); }
    }
  }
  return { query, options, scannedChapters: chapters.length, totalMatches, truncated, chapters: results, cards: cardResults };
}

async function buildReplacePlan(projectPath, payload = {}) {
  const query = String(payload?.query || "").trim().slice(0, MAX_QUERY_LENGTH);
  const replacement = String(payload?.replacement ?? "").slice(0, MAX_REPLACEMENT_LENGTH);
  if (!query) throw new Error("请输入搜索词。");
  const options = normalizeOptions(payload);
  if (options.useRegex) compileSafeRegex(query, options.caseSensitive);
  const requested = Array.isArray(payload?.chapterIds) && payload.chapterIds.length ? new Set(payload.chapterIds.map(String)) : null;
  const requestedCards = Array.isArray(payload?.cardIds) && payload.cardIds.length ? new Set(payload.cardIds.map(String)) : null;
  const config = await loadConfigUnlocked(projectPath);
  const chapters = config.chapters.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const plan = [];
  const cardPlan = [];
  let totalOccurrences = 0;
  if (options.scope !== "cards") {
    for (const chapter of chapters) {
      if (requested && !requested.has(chapter.id)) continue;
      const data = await readChapterText(projectPath, chapter);
      if (!data) continue;
      const matches = findMatches(data.text, query, options);
      if (!matches.length) continue;
      totalOccurrences += matches.length;
      plan.push({ chapterId: chapter.id, title: chapter.title || "", fileName: chapter.fileName, revision: contentRevision(data.raw), count: matches.length, occurrences: withContext(data.text, matches) });
    }
  }
  if (options.scope !== "chapters") {
    const { characters, worldDocs } = await collectCards(projectPath);
    for (const card of [...characters.map((item) => ({ ...item, cardType: "character" })), ...worldDocs.map((item) => ({ ...item, cardType: "world" }))]) {
      if (requestedCards && !requestedCards.has(card.id)) continue;
      const fields = card.cardType === "character" ? CHARACTER_FIELDS : ["title", "content"];
      const fieldHits = [];
      for (const field of fields) {
        const matches = findMatches(cardFieldText(card, field), query, options);
        if (matches.length) fieldHits.push({ field, count: matches.length, occurrences: withContext(cardFieldText(card, field), matches) });
      }
      if (!fieldHits.length) continue;
      const count = fieldHits.reduce((sum, item) => sum + item.count, 0);
      totalOccurrences += count;
      cardPlan.push({ cardType: card.cardType, cardId: card.id, title: card.cardType === "character" ? card.name : card.title, count, fields: fieldHits });
    }
  }
  if (!plan.length && !cardPlan.length) throw new Error("没有可替换的命中。");
  return { query, replacement, options, totalOccurrences, chapters: plan, cards: cardPlan };
}

async function executeReplace(projectPath, payload = {}, onProgress = null) {
  const query = String(payload?.query || "").trim().slice(0, MAX_QUERY_LENGTH);
  const replacement = String(payload?.replacement ?? "").slice(0, MAX_REPLACEMENT_LENGTH);
  if (!query) throw new Error("请输入搜索词。");
  const options = normalizeOptions(payload);
  if (options.useRegex) compileSafeRegex(query, options.caseSensitive);
  const selections = Array.isArray(payload?.selections) ? payload.selections : [];
  const cardSelections = Array.isArray(payload?.cardSelections) ? payload.cardSelections : [];
  if (!selections.length && !cardSelections.length) throw new Error("没有选择要替换的章节或卡片。");
  const expectedRevisions = payload?.expectedRevisions && typeof payload.expectedRevisions === "object" ? payload.expectedRevisions : {};
  return withProjectTransaction(projectPath, async () => {
    const snapshot = await projectSnapshots.createSnapshot(projectPath, { name: "全书替换前快照", reason: `全书替换「${query}」→「${replacement.slice(0, 40)}」` });
    const config = await loadConfigUnlocked(projectPath);
    const results = [];
    let totalReplaced = 0;
    for (let selectionIndex = 0; selectionIndex < selections.length; selectionIndex += 1) {
      const selection = selections[selectionIndex];
      if (typeof onProgress === "function") await onProgress({ current: selectionIndex, total: selections.length, chapterId: selection?.chapterId });
      const chapterId = String(selection?.chapterId || "");
      const chapter = config.chapters.find((item) => item.id === chapterId);
      if (!chapter) throw new Error(`章节不存在：${chapterId}`);
      const data = await readChapterText(projectPath, chapter);
      if (!data) throw new Error(`章节读取失败：${chapter.title || chapterId}`);
      const expected = String(expectedRevisions[chapterId] || "");
      if (expected && contentRevision(data.raw) !== expected)
        throw new Error(`《${chapter.title || chapterId}》在预览后被修改，已停止替换。请重新生成预览。（此前章节已由快照保护）`);
      const previewMatches = findMatches(data.text, query, options);
      const indices = Array.isArray(selection?.occurrenceIndices)
        ? selection.occurrenceIndices.map(Number).filter((index) => Number.isInteger(index) && index >= 0)
        : previewMatches.map((match) => match.index);
      if (!indices.length) continue;
      const applied = applyReplacement(data.raw, query, replacement, options, indices);
      if (applied.total !== previewMatches.length)
        throw new Error(`《${chapter.title || chapterId}》原文与预览口径不一致，已停止替换。请重新生成预览。`);
      await saveChapterContent(projectPath, { chapterId, content: applied.next, expectedRevision: contentRevision(data.raw) });
      totalReplaced += applied.replaced;
      results.push({ chapterId, title: chapter.title || "", replaced: applied.replaced });
    }
    // 卡片替换（P92）
    const cardResults = [];
    if (cardSelections.length) {
      const { characters, worldDocs } = await collectCards(projectPath);
      for (const selection of cardSelections) {
        const cardId = String(selection?.cardId || "");
        const cardType = selection?.cardType === "world" ? "world" : "character";
        if (cardType === "character") {
          const card = characters.find((item) => item.id === cardId);
          if (!card) throw new Error(`角色卡不存在：${cardId}`);
          const next = { ...card, updatedAt: new Date().toISOString() };
          let replaced = 0;
          for (const field of CHARACTER_FIELDS) {
            const text = cardFieldText(card, field);
            const matches = findMatches(text, query, options);
            if (!matches.length) continue;
            const indices = matches.map((match) => match.index);
            const applied = applyReplacement(text, query, replacement, options, indices);
            next[field] = applied.next;
            replaced += applied.replaced;
          }
          if (!replaced) continue;
          await writeJson(getCharacterPath(projectPath, next), next);
          await indexSource(projectPath, { id: next.id, type: "character", title: next.name, content: characterToMarkdown(next) });
          totalReplaced += replaced;
          cardResults.push({ cardType, cardId, title: next.name, replaced });
        } else {
          const doc = worldDocs.find((item) => item.id === cardId);
          if (!doc) throw new Error(`世界设定不存在：${cardId}`);
          const next = { ...doc, updatedAt: new Date().toISOString() };
          let replaced = 0;
          for (const field of ["title", "content"]) {
            const text = cardFieldText(doc, field);
            const matches = findMatches(text, query, options);
            if (!matches.length) continue;
            const applied = applyReplacement(text, query, replacement, options, matches.map((match) => match.index));
            next[field] = applied.next;
            replaced += applied.replaced;
          }
          if (!replaced) continue;
          await writeWorldDoc(projectPath, next);
          await indexSource(projectPath, { id: next.id, type: "world", title: next.title, content: next.content });
          totalReplaced += replaced;
          cardResults.push({ cardType, cardId, title: next.title, replaced });
        }
      }
    }
    return { snapshotId: snapshot?.id || "", totalReplaced, results, cardResults };
  });
}

module.exports = { MAX_MATCHES_TOTAL, MAX_MATCHES_PER_CHAPTER, findMatches, compileSafeRegex, applyReplacement, searchBook, buildReplacePlan, executeReplace };