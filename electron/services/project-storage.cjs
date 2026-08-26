const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

async function ensureDir(directory) {
  await fs.mkdir(directory, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`;
  const body = JSON.stringify(value, null, 2);
  await fs.writeFile(temporaryPath, body, "utf8");
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes(error?.code)) {
      await fs.rm(temporaryPath, { force: true }).catch(() => null);
      throw error;
    }
    await fs.copyFile(temporaryPath, filePath);
    await fs.rm(temporaryPath, { force: true });
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableId(prefix, value) {
  return `${prefix}_${sha256(String(value || "")).slice(0, 20)}`;
}

function safeFileSegment(value, fallback = "item") {
  const normalized = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

module.exports = {
  ensureDir,
  readJson,
  safeFileSegment,
  sha256,
  stableId,
  writeJsonAtomic,
};
