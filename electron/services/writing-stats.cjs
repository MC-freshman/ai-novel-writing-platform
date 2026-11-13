"use strict";
// 写作统计（P75）：按日聚合保存增量，提供目标/连续天数/趋势概览。
// 口径与 config.stats.todayWords 一致：每次保存的净增字数（max(0, 新字数-旧字数)），日期用 todayKey（UTC，与既有统计一致）。
// 数据文件 analysis/writing-stats.json 随项目快照/备份/交换保存；recordSave 在保存事务内调用时自动纳入事务日志。
const path = require("node:path");
const { readJson, writeJsonAtomic } = require("./project-storage.cjs");
const { todayKey } = require("./project-files.cjs");

const MAX_DAYS = 730;
const SERIES_DAYS = 30;

function statsPath(projectPath) {
  return path.join(projectPath, "analysis", "writing-stats.json");
}

function emptyStats() {
  return { version: 1, days: {}, updatedAt: "" };
}

async function loadWritingStats(projectPath) {
  const data = await readJson(statsPath(projectPath), null);
  if (!data || typeof data !== "object" || !data.days || typeof data.days !== "object") return emptyStats();
  /** @type {Record<string, {netWords:number,saves:number,firstSaveAt:string,lastSaveAt:string}>} */
  const days = {};
  for (const [date, value] of Object.entries(data.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !value || typeof value !== "object") continue;
    days[date] = {
      netWords: Math.max(0, Math.floor(Number(value.netWords) || 0)),
      saves: Math.max(0, Math.floor(Number(value.saves) || 0)),
      firstSaveAt: String(value.firstSaveAt || ""),
      lastSaveAt: String(value.lastSaveAt || ""),
    };
  }
  return { version: 1, days, updatedAt: String(data.updatedAt || "") };
}

/** 记录一次保存的净增量。调用方负责串行化（保存管线在项目事务内调用）。失败不得阻断正文保存。 */
async function recordSave(projectPath, { date, netWords, at }) {
  const dayKey = String(date || todayKey());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) throw new Error("写作统计日期格式非法。");
  const timestamp = String(at || new Date().toISOString());
  const stats = await loadWritingStats(projectPath);
  const day = stats.days[dayKey] || { netWords: 0, saves: 0, firstSaveAt: timestamp, lastSaveAt: timestamp };
  day.netWords += Math.max(0, Math.floor(Number(netWords) || 0));
  day.saves += 1;
  day.lastSaveAt = timestamp;
  stats.days[dayKey] = day;
  const keys = Object.keys(stats.days).sort();
  while (keys.length > MAX_DAYS) delete stats.days[keys.shift()];
  stats.updatedAt = timestamp;
  await writeJsonAtomic(statsPath(projectPath), stats);
  return stats;
}

function shiftDate(dateKey, deltaDays) {
  const cursor = new Date(`${dateKey}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + deltaDays);
  return cursor.toISOString().slice(0, 10);
}

/** 连续达标天数：今天未达标时从昨天起算（今天仍有机会，不打断连续）。目标<=0 时返回 0。 */
function computeStreak(days, dailyGoal, today = todayKey()) {
  const goal = Math.floor(Number(dailyGoal) || 0);
  if (goal <= 0) return 0;
  let cursor = today;
  if ((days[cursor]?.netWords || 0) < goal) cursor = shiftDate(cursor, -1);
  let streak = 0;
  while ((days[cursor]?.netWords || 0) >= goal) {
    streak += 1;
    cursor = shiftDate(cursor, -1);
  }
  return streak;
}

async function getWritingOverview(projectPath, { dailyGoal = 0, seriesDays = SERIES_DAYS } = {}) {
  const stats = await loadWritingStats(projectPath);
  const goal = Math.max(0, Math.floor(Number(dailyGoal) || 0));
  const today = todayKey();
  const count = Math.min(Math.max(1, Math.floor(Number(seriesDays) || SERIES_DAYS)), MAX_DAYS);
  const series = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = shiftDate(today, -offset);
    const day = stats.days[date];
    series.push({ date, netWords: day?.netWords || 0, saves: day?.saves || 0, metGoal: goal > 0 && (day?.netWords || 0) >= goal });
  }
  const allDays = Object.entries(stats.days);
  const totalRecorded = allDays.reduce((sum, [, day]) => sum + day.netWords, 0);
  /** @type {{date:string,netWords:number}|null} */
  let bestDay = null;
  for (const [date, day] of allDays) {
    if (!bestDay || day.netWords > bestDay.netWords) bestDay = { date, netWords: day.netWords };
  }
  return {
    goal,
    today: { date: today, netWords: stats.days[today]?.netWords || 0, saves: stats.days[today]?.saves || 0, metGoal: goal > 0 && (stats.days[today]?.netWords || 0) >= goal },
    streak: computeStreak(stats.days, goal, today),
    series,
    totalRecorded,
    activeDays: allDays.length,
    bestDay,
    updatedAt: stats.updatedAt,
  };
}

module.exports = {
  MAX_DAYS,
  statsPath,
  loadWritingStats,
  recordSave,
  computeStreak,
  getWritingOverview,
};