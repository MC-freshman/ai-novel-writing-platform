"use strict";
// 写作统计服务测试（P75）：聚合口径/连续天数/概览/裁剪/事务内写入。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture } = require("../helpers/service-fixture.cjs");
const writingStats = require("../../../electron/services/writing-stats.cjs");
const { withProjectTransaction } = require("../../../electron/services/project-storage.cjs");

test("recordSave 按日聚合净增量并拒绝非法日期", async (t) => {
  const root = await fixture(t);
  await writingStats.recordSave(root, { date: "2026-11-10", netWords: 300, at: "2026-11-10T08:00:00Z" });
  await writingStats.recordSave(root, { date: "2026-11-10", netWords: 200, at: "2026-11-10T09:00:00Z" });
  await writingStats.recordSave(root, { date: "2026-11-10", netWords: -50, at: "2026-11-10T10:00:00Z" });
  const stats = await writingStats.loadWritingStats(root);
  assert.equal(stats.days["2026-11-10"].netWords, 500, "负增量按 0 计，与 todayWords 口径一致");
  assert.equal(stats.days["2026-11-10"].saves, 3);
  assert.equal(stats.days["2026-11-10"].firstSaveAt, "2026-11-10T08:00:00Z");
  await assert.rejects(() => writingStats.recordSave(root, { date: "非法", netWords: 1 }), /日期/);
});

test("loadWritingStats 清洗损坏数据", async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, "analysis"), { recursive: true });
  await fs.writeFile(writingStats.statsPath(root), JSON.stringify({ version: 1, days: { "2026-11-10": { netWords: "12", saves: 2 }, "bad-date": { netWords: 5 }, "2026-11-11": null }, updatedAt: "x" }));
  const stats = await writingStats.loadWritingStats(root);
  assert.equal(stats.days["2026-11-10"].netWords, 12);
  assert.equal(stats.days["bad-date"], undefined);
  assert.equal(stats.days["2026-11-11"], undefined);
  const missing = await writingStats.loadWritingStats(path.join(root, "missing"));
  assert.deepEqual(missing.days, {});
});

test("computeStreak 连续达标口径", () => {
  const days = {
    "2026-11-08": { netWords: 600 },
    "2026-11-09": { netWords: 500 },
    "2026-11-10": { netWords: 400 },
  };
  assert.equal(writingStats.computeStreak(days, 500, "2026-11-10"), 2, "今天未达标从昨天起算");
  assert.equal(writingStats.computeStreak({ ...days, "2026-11-10": { netWords: 500 } }, 500, "2026-11-10"), 3);
  assert.equal(writingStats.computeStreak(days, 0, "2026-11-10"), 0, "无目标不计算");
  assert.equal(writingStats.computeStreak({ "2026-11-09": { netWords: 500 }, "2026-11-07": { netWords: 900 } }, 500, "2026-11-10"), 1, "缺口打断连续");
});

test("getWritingOverview 概览与序列", async (t) => {
  const root = await fixture(t);
  await writingStats.recordSave(root, { date: "2026-11-09", netWords: 800, at: "2026-11-09T08:00:00Z" });
  await writingStats.recordSave(root, { date: "2026-11-10", netWords: 600, at: "2026-11-10T08:00:00Z" });
  const overview = await writingStats.getWritingOverview(root, { dailyGoal: 500, seriesDays: 7 });
  assert.equal(overview.series.length, 7);
  assert.equal(overview.series[6].date, overview.today.date);
  assert.equal(overview.totalRecorded, 1400);
  assert.equal(overview.activeDays, 2);
  assert.equal(overview.bestDay.netWords, 800);
  assert.equal(overview.goal, 500);
  assert.equal(typeof overview.streak, "number");
});

test("超过 MAX_DAYS 裁剪最旧日期", async (t) => {
  const root = await fixture(t);
  const days = {};
  for (let i = 0; i < writingStats.MAX_DAYS; i++) {
    const date = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    days[date] = { netWords: 10, saves: 1, firstSaveAt: "", lastSaveAt: "" };
  }
  await fs.mkdir(path.join(root, "analysis"), { recursive: true });
  await fs.writeFile(writingStats.statsPath(root), JSON.stringify({ version: 1, days, updatedAt: "" }));
  await writingStats.recordSave(root, { date: "2026-11-10", netWords: 100, at: "2026-11-10T08:00:00Z" });
  const stats = await writingStats.loadWritingStats(root);
  assert.equal(Object.keys(stats.days).length, writingStats.MAX_DAYS);
  assert.equal(stats.days["2024-01-01"], undefined, "最旧日期被裁剪");
  assert.equal(stats.days["2026-11-10"].netWords, 100);
});

test("保存事务内写入统计（纳入事务上下文）", async (t) => {
  const root = await fixture(t);
  await withProjectTransaction(root, async () => {
    await writingStats.recordSave(root, { date: "2026-11-10", netWords: 123, at: "2026-11-10T08:00:00Z" });
  });
  const stats = await writingStats.loadWritingStats(root);
  assert.equal(stats.days["2026-11-10"].netWords, 123);
});