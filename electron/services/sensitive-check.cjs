"use strict";
// 敏感词自查（P77）：自研 Aho-Corasick 引擎（零依赖）+ 项目级词库管理 + 全书扫描报告。
// 许可纪律（C9）：不内置任何第三方版权词库；随包仅附自研合成示例（默认停用，明确标注非平台官方）。
// 定位：发布前自查辅助，仅提示不阻断，不代表任何平台审核结论。
const path = require("node:path");
const fs = require("node:fs/promises");
const { dialog } = require("electron");
const { readJson, writeJsonAtomic, withProjectTransaction, stableId } = require("./project-storage.cjs");
const { state } = require("./runtime-state.cjs");
const { getChapterPath, contentToPlainText } = require("./project-files.cjs");
const { loadConfig } = require("./project-ops.cjs");
const { callChatApi } = require("./ai-generate.cjs");

const MAX_DICTIONARIES = 20;
const MAX_WORDS_PER_DICTIONARY = 100000;
const MAX_WORD_LENGTH = 50;
const MAX_IGNORE = 2000;
const CONTEXT_RADIUS = 20;

// 自研合成示例词（非任何平台官方词库，仅演示用法；默认停用）。
const DEMO_WORDS = ["示例违禁词甲", "示例违禁词乙", "演示敏感短语丙"];

function storePath(projectPath) {
  return path.join(projectPath, "analysis", "sensitive-words.json");
}

function reportPath(projectPath) {
  return path.join(projectPath, "analysis", "sensitive-report.json");
}

function emptyStore() {
  return {
    version: 1,
    dictionaries: [{
      id: "builtin-demo",
      name: "自研示例词表（非平台官方，演示用）",
      enabled: false,
      builtin: true,
      words: DEMO_WORDS,
      updatedAt: new Date().toISOString(),
    }],
    ignoreList: [],
    updatedAt: "",
  };
}

function normalizeWords(values) {
  const seen = new Set();
  const words = [];
  for (const value of Array.isArray(values) ? values : []) {
    const word = String(value || "").trim().slice(0, MAX_WORD_LENGTH);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
    if (words.length >= MAX_WORDS_PER_DICTIONARY) break;
  }
  return words;
}

async function loadStore(projectPath) {
  const data = await readJson(storePath(projectPath), null);
  if (!data || typeof data !== "object" || !Array.isArray(data.dictionaries)) return emptyStore();
  const dictionaries = data.dictionaries
    .filter((item) => item && typeof item === "object" && typeof item.id === "string")
    .slice(0, MAX_DICTIONARIES)
    .map((item) => ({
      id: item.id,
      name: String(item.name || "未名词库").slice(0, 80),
      enabled: item.enabled === true,
      builtin: item.builtin === true,
      words: normalizeWords(item.words),
      updatedAt: String(item.updatedAt || ""),
    }));
  if (!dictionaries.some((item) => item.id === "builtin-demo")) dictionaries.unshift(emptyStore().dictionaries[0]);
  const ignoreList = normalizeWords(data.ignoreList).slice(0, MAX_IGNORE);
  return { version: 1, dictionaries, ignoreList, updatedAt: String(data.updatedAt || "") };
}

async function saveStore(projectPath, store) {
  store.updatedAt = new Date().toISOString();
  await writeJsonAtomic(storePath(projectPath), store);
  return store;
}

/** 构建 Aho-Corasick 自动机（trie + failure 链 + 输出合并）。 */
function buildAutomaton(words) {
  const makeNode = () => ({ children: new Map(), fail: null, outputs: [] });
  const root = makeNode();
  for (const word of words) {
    let node = root;
    for (const ch of word) {
      if (!node.children.has(ch)) node.children.set(ch, makeNode());
      node = node.children.get(ch);
    }
    node.outputs.push(word);
  }
  const queue = [];
  for (const child of root.children.values()) {
    child.fail = root;
    queue.push(child);
  }
  while (queue.length) {
    const node = queue.shift();
    for (const [ch, child] of node.children) {
      let fallback = node.fail;
      while (fallback && !fallback.children.has(ch)) fallback = fallback.fail;
      child.fail = fallback && fallback.children.has(ch) ? fallback.children.get(ch) : root;
      if (child.fail === child) child.fail = root;
      if (child.fail.outputs.length) child.outputs = child.outputs.concat(child.fail.outputs);
      queue.push(child);
    }
  }
  return root;
}

/** 扫描文本，返回全部命中（含重叠与嵌套词）。 */
function scanText(automaton, text) {
  const hits = [];
  let node = automaton;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    while (node && !node.children.has(ch)) node = node.fail;
    if (!node) { node = automaton; continue; }
    node = node.children.get(ch);
    for (const word of node.outputs) hits.push({ word, start: index - word.length + 1, end: index + 1 });
  }
  return hits;
}

function activeWords(store) {
  const words = [];
  for (const dictionary of store.dictionaries)
    if (dictionary.enabled) words.push(...dictionary.words);
  return normalizeWords(words);
}

async function getState(projectPath) {
  const store = await loadStore(projectPath);
  const report = await readJson(reportPath(projectPath), null);
  return {
    dictionaries: store.dictionaries.map((item) => ({ id: item.id, name: item.name, enabled: item.enabled, builtin: item.builtin, wordCount: item.words.length, updatedAt: item.updatedAt })),
    ignoreList: store.ignoreList,
    limits: { maxDictionaries: MAX_DICTIONARIES, maxWordsPerDictionary: MAX_WORDS_PER_DICTIONARY, maxWordLength: MAX_WORD_LENGTH },
    report: report && typeof report === "object" ? report : null,
  };
}

async function importDictionary(projectPath) {
  const selected = await dialog.showOpenDialog(state.mainWindow, {
    title: "导入词库（TXT 每行一词，或本功能词库 JSON）",
    properties: ["openFile"],
    filters: [{ name: "词库", extensions: ["txt", "json"] }],
  });
  if (selected.canceled || !selected.filePaths.length) return { canceled: true };
  const filePath = selected.filePaths[0];
  const raw = await fs.readFile(filePath, "utf8");
  let words;
  let name = path.basename(filePath, path.extname(filePath));
  if (filePath.toLowerCase().endsWith(".json")) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error("词库 JSON 无法解析。"); }
    words = normalizeWords(Array.isArray(parsed) ? parsed : parsed?.words);
    if (parsed?.name) name = String(parsed.name).slice(0, 80);
  } else {
    words = normalizeWords(raw.split(/\r?\n/));
  }
  if (!words.length) throw new Error("文件中没有有效词条。");
  return withProjectTransaction(projectPath, async () => {
    const store = await loadStore(projectPath);
    if (store.dictionaries.length >= MAX_DICTIONARIES) throw new Error(`词库数量已达上限 ${MAX_DICTIONARIES}，请先整理。`);
    const dictionary = { id: stableId("dict", `${name}:${words.length}:${Date.now()}`), name, enabled: true, builtin: false, words, updatedAt: new Date().toISOString() };
    store.dictionaries.push(dictionary);
    await saveStore(projectPath, store);
    return { canceled: false, dictionary: { id: dictionary.id, name, wordCount: words.length } };
  });
}

async function toggleDictionary(projectPath, dictionaryId, enabled) {
  return withProjectTransaction(projectPath, async () => {
    const store = await loadStore(projectPath);
    const dictionary = store.dictionaries.find((item) => item.id === String(dictionaryId || ""));
    if (!dictionary) throw new Error("词库不存在。");
    dictionary.enabled = enabled === true;
    dictionary.updatedAt = new Date().toISOString();
    await saveStore(projectPath, store);
    return getState(projectPath);
  });
}

async function deleteDictionary(projectPath, dictionaryId) {
  return withProjectTransaction(projectPath, async () => {
    const store = await loadStore(projectPath);
    const dictionary = store.dictionaries.find((item) => item.id === String(dictionaryId || ""));
    if (!dictionary) throw new Error("词库不存在。");
    if (dictionary.builtin) throw new Error("内置示例词表不可删除，可停用。");
    store.dictionaries = store.dictionaries.filter((item) => item.id !== dictionary.id);
    await saveStore(projectPath, store);
    return getState(projectPath);
  });
}

async function updateIgnore(projectPath, word, remove = false) {
  return withProjectTransaction(projectPath, async () => {
    const store = await loadStore(projectPath);
    const normalized = String(word || "").trim().slice(0, MAX_WORD_LENGTH);
    if (!normalized) throw new Error("忽略词不能为空。");
    if (remove) {
      store.ignoreList = store.ignoreList.filter((item) => item !== normalized);
    } else {
      if (store.ignoreList.includes(normalized)) return getState(projectPath);
      if (store.ignoreList.length >= MAX_IGNORE) throw new Error(`忽略名单已达上限 ${MAX_IGNORE}。`);
      store.ignoreList.push(normalized);
    }
    await saveStore(projectPath, store);
    return getState(projectPath);
  });
}

/** 全书/指定章节扫描；报告落盘 analysis/sensitive-report.json。仅提示不阻断。 */
async function scan(projectPath, payload = {}) {
  const store = await loadStore(projectPath);
  const words = activeWords(store);
  const config = await loadConfig(projectPath);
  const requested = Array.isArray(payload?.chapterIds) && payload.chapterIds.length ? new Set(payload.chapterIds.map(String)) : null;
  const chapters = config.chapters
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter((chapter) => !requested || requested.has(chapter.id));
  const ignore = new Set(store.ignoreList);
  const automaton = words.length ? buildAutomaton(words) : null;
  const results = [];
  let totalHits = 0;
  for (const chapter of chapters) {
    const content = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => null);
    if (content === null) continue;
    const text = contentToPlainText(content);
    const hits = automaton ? scanText(automaton, text).filter((hit) => !ignore.has(hit.word)) : [];
    const withContext = hits.slice(0, 500).map((hit) => ({
      word: hit.word,
      start: hit.start,
      end: hit.end,
      context: text.slice(Math.max(0, hit.start - CONTEXT_RADIUS), hit.end + CONTEXT_RADIUS),
    }));
    totalHits += hits.length;
    if (withContext.length) results.push({ chapterId: chapter.id, title: chapter.title || "", fileName: chapter.fileName, hitCount: hits.length, hits: withContext, truncated: hits.length > 500 });
  }
  const report = {
    version: 1,
    updatedAt: new Date().toISOString(),
    activeWordCount: words.length,
    scannedChapters: chapters.length,
    totalHits,
    results,
    note: "自查辅助结果，仅提示不阻断；不代表任何平台审核结论。",
  };
  await writeJsonAtomic(reportPath(projectPath), report);
  return report;
}

/** AI 复核（P97）：对命中词+上下文做误报判断，仅建议，不自动改稿/忽略。 */
async function aiReview(projectPath, payload) {
  const hits = (Array.isArray(payload?.hits) ? payload.hits : []).filter((hit) => hit?.word).slice(0, 30);
  if (!hits.length) throw new Error("没有可复核的命中。");
  const config = await loadConfig(projectPath);
  const systemPrompt = "你是网文合规自查助手。判断下列词语在给定上下文中是否属于平台违规敏感词。仅输出 JSON 数组，格式 [{\"word\":\"词\",\"verdict\":\"误报|确认|存疑\",\"reason\":\"简短理由\"}]，不要输出其他内容。判断保守：拿不准时给\"存疑\"。";
  const question = hits.map((hit, index) => `${index + 1}. 词：${hit.word}\n上下文：${String(hit.context || "").slice(0, 200)}`).join("\n");
  const answer = await callChatApi(config, systemPrompt, question, [], { stream: false });
  const text = String(answer || "");
  const match = text.match(/\[[\s\S]*\]/);
  let verdicts = [];
  if (match) {
    try { verdicts = JSON.parse(match[0]); } catch { verdicts = []; }
  }
  return { verdicts: Array.isArray(verdicts) ? verdicts.slice(0, 30) : [], raw: text.slice(0, 2000) };
}

module.exports = {
  MAX_DICTIONARIES,
  MAX_WORDS_PER_DICTIONARY,
  DEMO_WORDS,
  storePath,
  reportPath,
  buildAutomaton,
  scanText,
  loadStore,
  getState,
  importDictionary,
  toggleDictionary,
  deleteDictionary,
  updateIgnore,
  scan,
  aiReview,
};