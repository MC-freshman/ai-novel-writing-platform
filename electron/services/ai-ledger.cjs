"use strict";
// AI 辅助台账与创作证据导出（P78）。
// 台账：记录平台内安全修订的采纳事件（整体/逐句），估算 AI 辅助占比——只统计平台内记录的采纳，
// 外部粘贴的 AI 文本无法识别，UI 须明示局限；不构成任何法律或平台审核保证。
// 证据包：编辑日志/版本痕迹/字数增长/台账的时间线 + SHA256 清单，本地导出，排除接口设置与密钥。
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const AdmZip = require("adm-zip");
const { dialog } = require("electron");
const { readJson, writeJsonAtomic } = require("./project-storage.cjs");
const { state } = require("./runtime-state.cjs");
const { getChapterPath, getChapterVersionDir, loadConfigUnlocked } = require("./project-files.cjs");
const operationJournal = require("./operation-journal.cjs");

const MAX_ENTRIES = 5000;
const MAX_VERSION_CONTENT_BYTES = 20 * 1024 * 1024;

function ledgerPath(projectPath) {
  return path.join(projectPath, "analysis", "ai-ledger.json");
}

async function loadLedger(projectPath) {
  const data = await readJson(ledgerPath(projectPath), null);
  const entries = Array.isArray(data?.entries)
    ? data.entries.filter((item) => item && typeof item === "object" && typeof item.chapterId === "string").slice(-MAX_ENTRIES)
    : [];
  return { version: 1, entries, updatedAt: String(data?.updatedAt || "") };
}

/** 记录一次采纳。调用方在采纳事务内 fire-and-forget；失败不得阻断采纳。 */
async function recordAdoption(projectPath, entry) {
  const ledger = await loadLedger(projectPath);
  ledger.entries.push({
    id: `led_${crypto.randomUUID()}`,
    chapterId: String(entry.chapterId || ""),
    chapterTitle: String(entry.chapterTitle || ""),
    revisionId: String(entry.revisionId || ""),
    mode: entry.mode === "part" ? "part" : "full",
    adoptedWords: Math.max(0, Math.floor(Number(entry.adoptedWords) || 0)),
    at: String(entry.at || new Date().toISOString()),
  });
  if (ledger.entries.length > MAX_ENTRIES) ledger.entries = ledger.entries.slice(-MAX_ENTRIES);
  ledger.updatedAt = new Date().toISOString();
  await writeJsonAtomic(ledgerPath(projectPath), ledger);
}

async function getOverview(projectPath) {
  const ledger = await loadLedger(projectPath);
  const config = await loadConfigUnlocked(projectPath);
  const byChapter = new Map();
  for (const entry of ledger.entries) {
    const aggregate = byChapter.get(entry.chapterId) || { adoptedWords: 0, adoptions: 0, lastAt: "" };
    aggregate.adoptedWords += entry.adoptedWords;
    aggregate.adoptions += 1;
    if (entry.at > aggregate.lastAt) aggregate.lastAt = entry.at;
    byChapter.set(entry.chapterId, aggregate);
  }
  const chapters = config.chapters
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((chapter) => {
      const aggregate = byChapter.get(chapter.id);
      const wordCount = Number(chapter.wordCount || 0);
      return {
        chapterId: chapter.id,
        title: chapter.title || "",
        volume: chapter.volume || "",
        wordCount,
        adoptedWords: aggregate?.adoptedWords || 0,
        adoptions: aggregate?.adoptions || 0,
        lastAt: aggregate?.lastAt || "",
        // 估算口径：平台内采纳字数 / 当前章节字数；无记录=null（不是 0）。
        estimatedRatio: aggregate && wordCount > 0 ? Math.min(1, aggregate.adoptedWords / wordCount) : null,
      };
    });
  const totalAdoptedWords = ledger.entries.reduce((sum, entry) => sum + entry.adoptedWords, 0);
  return {
    chapters,
    totalAdoptedWords,
    totalAdoptions: ledger.entries.length,
    recordedChapters: byChapter.size,
    updatedAt: ledger.updatedAt,
    note: "估算仅统计平台内安全修订的采纳记录；外部粘贴文本无法识别。辅助申报参考，不构成法律或平台审核保证。",
  };
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** 导出创作过程证据包（zip）：时间线 JSON + 人读 Markdown + SHA256 清单；可选版本原文（20MB 上限）。 */
async function exportEvidence(projectPath, payload = {}) {
  const config = await loadConfigUnlocked(projectPath);
  const ledger = await loadLedger(projectPath);
  const journal = await operationJournal.loadJournal(projectPath).catch(() => ({ operations: [], sessions: [] }));
  const writingStats = await readJson(path.join(projectPath, "analysis", "writing-stats.json"), null);
  const includeVersionContent = payload?.includeVersionContent === true;

  const chapters = [];
  const versionFiles = [];
  let versionBytes = 0;
  let versionTruncated = false;
  for (const chapter of config.chapters.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const versionDir = getChapterVersionDir(projectPath, chapter.id);
    const files = await fs.readdir(versionDir).catch(() => []);
    const versions = [];
    for (const file of files.filter((item) => item.endsWith(".json"))) {
      const meta = await readJson(path.join(versionDir, file), null);
      if (!meta?.id) continue;
      const contentFile = meta.fileName ? path.join(versionDir, meta.fileName) : null;
      let contentHash = "";
      let contentSize = 0;
      if (contentFile) {
        const buffer = await fs.readFile(contentFile).catch(() => null);
        if (buffer) {
          contentHash = sha256Buffer(buffer);
          contentSize = buffer.length;
          if (includeVersionContent && !versionTruncated) {
            if (versionBytes + buffer.length > MAX_VERSION_CONTENT_BYTES) {
              versionTruncated = true;
            } else {
              versionBytes += buffer.length;
              versionFiles.push({ name: `versions/${chapter.id}/${meta.fileName}`, buffer });
            }
          }
        }
      }
      versions.push({ id: meta.id, createdAt: meta.createdAt || "", reason: meta.reason || "", contentRevision: meta.contentRevision || "", contentHash, contentSize });
    }
    let currentHash = "";
    const currentBuffer = await fs.readFile(getChapterPath(projectPath, chapter)).catch(() => null);
    if (currentBuffer) currentHash = sha256Buffer(currentBuffer);
    chapters.push({
      chapterId: chapter.id,
      title: chapter.title || "",
      volume: chapter.volume || "",
      wordCount: Number(chapter.wordCount || 0),
      contentRevision: chapter.contentRevision || "",
      currentHash,
      updatedAt: chapter.updatedAt || "",
      versions: versions.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    });
  }

  const evidence = {
    schema: "novel-creation-evidence/v1",
    generatedAt: new Date().toISOString(),
    project: {
      title: config.title || "",
      author: config.author || "",
      createdAt: config.createdAt || "",
      updatedAt: config.updatedAt || "",
      stats: config.stats || {},
      // 明确排除：api 设置、密钥、凭据引用一律不入包。
    },
    timeline: {
      operations: (journal.operations || []).slice(-2000).map((item) => ({ at: item.at || item.createdAt || "", kind: item.kind || item.type || "", detail: item.summary || item.label || "" })),
      sessions: (journal.sessions || []).slice(-200),
      adoptions: ledger.entries,
      writingStats: writingStats && typeof writingStats === "object" ? writingStats : null,
    },
    chapters,
    limitations: [
      "仅包含平台内记录的创作痕迹；外部编辑与粘贴不在其中。",
      "AI 占比为采纳记录估算，非检测结论。",
      "本包为辅助举证材料，不构成法律或平台审核保证。",
    ],
  };
  const evidenceJson = JSON.stringify(evidence, null, 2);
  const manifest = [
    { file: "evidence.json", sha256: sha256Buffer(Buffer.from(evidenceJson, "utf8")) },
    ...versionFiles.map((item) => ({ file: item.name, sha256: sha256Buffer(item.buffer) })),
  ];
  const lines = [
    `# 创作过程证据包 · ${evidence.project.title}`,
    "",
    `生成时间：${evidence.generatedAt}`,
    `作者：${evidence.project.author || "（未填写）"}`,
    `总字数：${evidence.project.stats?.totalWords ?? "?"}；章节数：${chapters.length}`,
    `AI 采纳记录：${ledger.entries.length} 次，合计 ${ledger.entries.reduce((sum, entry) => sum + entry.adoptedWords, 0)} 字（估算口径见 limitations）`,
    "",
    "## 章节版本痕迹",
    ...chapters.map((chapter) => `- 《${chapter.title}》${chapter.wordCount} 字，当前哈希 ${chapter.currentHash.slice(0, 16)}…，历史版本 ${chapter.versions.length} 个${chapter.versions.length ? `（${chapter.versions[0].createdAt} → ${chapter.versions[chapter.versions.length - 1].createdAt}）` : ""}`),
    "",
    "## 声明",
    ...evidence.limitations.map((item) => `- ${item}`),
    "",
    "## 文件清单（SHA256）",
    ...manifest.map((item) => `- ${item.file}: ${item.sha256}`),
  ];
  const markdown = lines.join("\n");

  const selected = await dialog.showSaveDialog(state.mainWindow, {
    title: "导出创作过程证据包",
    defaultPath: `${(config.title || "小说").replace(/[\\/:*?"<>|]/g, "_")}_创作证据_${new Date().toISOString().slice(0, 10)}.zip`,
    filters: [{ name: "ZIP", extensions: ["zip"] }],
  });
  if (selected.canceled || !selected.filePath) return { canceled: true };
  const zip = new AdmZip();
  zip.addFile("evidence.json", Buffer.from(evidenceJson, "utf8"));
  zip.addFile("evidence.md", Buffer.from(markdown, "utf8"));
  zip.addFile("SHA256SUMS.txt", Buffer.from(manifest.map((item) => `${item.sha256}  ${item.file}`).join("\n") + "\n", "utf8"));
  for (const item of versionFiles) zip.addFile(item.name, item.buffer);
  zip.writeZip(selected.filePath);
  const stat = await fs.stat(selected.filePath);
  return {
    canceled: false,
    filePath: selected.filePath,
    sizeBytes: stat.size,
    counts: { chapters: chapters.length, adoptions: ledger.entries.length, versionFiles: versionFiles.length },
    versionTruncated,
  };
}

module.exports = { MAX_ENTRIES, ledgerPath, loadLedger, recordAdoption, getOverview, exportEvidence };