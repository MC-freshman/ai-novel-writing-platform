"use strict";
// 文风自查（P85）：本地启发式质量指标（零依赖、透明可复核）。
// 定位纪律（审计 A11/T3）：仅质量辅助参考，不代表任何平台 AI 检测结论，不承诺过审/规避检测。
// 润色闭环复用既有正文右键「润色」候选制（作者逐句采纳），本服务不改正文。
const path = require("node:path");
const fs = require("node:fs/promises");
const { readJson, writeJsonAtomic } = require("./project-storage.cjs");
const { loadConfigUnlocked, getChapterPath, contentToPlainText } = require("./project-files.cjs");

// 自研常见模板化短语示例（启发式，非任何平台检测规则；可由用户阈值调节敏感度）。
const TEMPLATE_PHRASES = [
  "嘴角勾起一抹弧度", "眼中闪过一丝", "深吸一口气", "缓缓说道", "不由得", "不禁",
  "一抹弧度", "一丝笑意", "点了点头", "沉声道", "淡淡地说道", "眉头微皱",
  "心中暗道", "与此同时", "就在这时", "刹那间", "一瞬间", "空气仿佛凝固",
];
const CONNECTIVES = ["然而", "但是", "因此", "于是", "紧接着", "随后", "顿时", "不过", "只是", "却见"];

const DEFAULT_THRESHOLDS = {
  sentenceLenCVLow: 0.35,   // 句长变异系数低于此值=句式过于均匀
  templatePer1000: 8,       // 模板短语每千字命中上限
  connectivePer1000: 30,    // 连接词每千字上限
  repeatRate: 0.12,         // 6 字重复片段占比上限
};

function reportPath(projectPath) {
  return path.join(projectPath, "analysis", "style-report.json");
}

function splitSentences(text) {
  return text.split(/[。！？!?…]+/).map((item) => item.trim()).filter((item) => item.length > 0);
}

function countOccurrences(text, phrase) {
  let count = 0;
  let from = 0;
  for (;;) {
    const index = text.indexOf(phrase, from);
    if (index < 0) break;
    count += 1;
    from = index + phrase.length;
  }
  return count;
}

/** 6 字滑窗重复率：出现≥2 次的窗口覆盖字符占比（近似）。 */
function repeatRate(text) {
  const size = 6;
  if (text.length < size * 2) return 0;
  const counts = new Map();
  for (let index = 0; index <= text.length - size; index += 1) {
    const gram = text.slice(index, index + size);
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }
  let repeated = 0;
  for (const count of counts.values()) if (count >= 2) repeated += count;
  const total = text.length - size + 1;
  return total > 0 ? Math.min(1, repeated / total) : 0;
}

function analyzeText(text, thresholds) {
  const chars = text.length;
  const sentences = splitSentences(text);
  const lengths = sentences.map((sentence) => sentence.length);
  const mean = lengths.length ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length : 0;
  const variance = lengths.length ? lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length : 0;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const templateHits = TEMPLATE_PHRASES.reduce((sum, phrase) => sum + countOccurrences(text, phrase), 0);
  const connectiveHits = CONNECTIVES.reduce((sum, phrase) => sum + countOccurrences(text, phrase), 0);
  const per1000 = (count) => (chars > 0 ? (count / chars) * 1000 : 0);
  const repeat = repeatRate(text.replace(/\s+/g, ""));
  const metrics = {
    chars,
    sentenceCount: sentences.length,
    avgSentenceLen: Math.round(mean * 10) / 10,
    sentenceLenCV: Math.round(cv * 1000) / 1000,
    templateHits,
    templatePer1000: Math.round(per1000(templateHits) * 100) / 100,
    connectiveHits,
    connectivePer1000: Math.round(per1000(connectiveHits) * 100) / 100,
    repeatRate: Math.round(repeat * 1000) / 1000,
  };
  const flags = [];
  if (sentences.length >= 5 && cv < thresholds.sentenceLenCVLow) flags.push({ key: "sentenceUniform", label: "句式过于均匀", detail: `句长变异系数 ${metrics.sentenceLenCV} < ${thresholds.sentenceLenCVLow}` });
  if (metrics.templatePer1000 > thresholds.templatePer1000) flags.push({ key: "template", label: "模板短语偏多", detail: `每千字 ${metrics.templatePer1000} > ${thresholds.templatePer1000}` });
  if (metrics.connectivePer1000 > thresholds.connectivePer1000) flags.push({ key: "connective", label: "连接词偏密", detail: `每千字 ${metrics.connectivePer1000} > ${thresholds.connectivePer1000}` });
  if (metrics.repeatRate > thresholds.repeatRate) flags.push({ key: "repeat", label: "重复片段偏多", detail: `6 字重复占比 ${metrics.repeatRate} > ${thresholds.repeatRate}` });
  // 段落定位：模板命中最多的前 5 段
  const paragraphs = text.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const topParagraphs = paragraphs
    .map((paragraph) => ({ text: paragraph.slice(0, 120), hits: TEMPLATE_PHRASES.reduce((sum, phrase) => sum + countOccurrences(paragraph, phrase), 0) }))
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 5);
  return { metrics, flags, topParagraphs };
}

async function analyzeBook(projectPath, payload = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(payload?.thresholds && typeof payload.thresholds === "object" ? payload.thresholds : {}) };
  const config = await loadConfigUnlocked(projectPath);
  const requested = Array.isArray(payload?.chapterIds) && payload.chapterIds.length ? new Set(payload.chapterIds.map(String)) : null;
  const chapters = config.chapters.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).filter((chapter) => !requested || requested.has(chapter.id));
  const results = [];
  for (const chapter of chapters) {
    const raw = await fs.readFile(getChapterPath(projectPath, chapter), "utf8").catch(() => null);
    if (raw === null) continue;
    const text = contentToPlainText(raw);
    if (!text.trim()) continue;
    const analysis = analyzeText(text, thresholds);
    results.push({ chapterId: chapter.id, title: chapter.title || "", fileName: chapter.fileName, ...analysis });
  }
  const flagged = results.filter((item) => item.flags.length > 0);
  const report = {
    version: 1,
    updatedAt: new Date().toISOString(),
    thresholds,
    scannedChapters: results.length,
    flaggedChapters: flagged.length,
    chapters: results,
    note: "本地启发式质量参考，指标透明可复核；不代表任何平台 AI 检测结论，不承诺过审。润色请用正文右键「润色」（候选制，逐句采纳）。",
  };
  await writeJsonAtomic(reportPath(projectPath), report);
  return report;
}

async function getReport(projectPath) {
  const report = await readJson(reportPath(projectPath), null);
  return report && typeof report === "object" && Array.isArray(report.chapters) ? report : null;
}

module.exports = { DEFAULT_THRESHOLDS, TEMPLATE_PHRASES, reportPath, analyzeText, analyzeBook, getReport };