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

async function writeFileAtomic(filePath, value, encoding = "utf8") {
  await ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`;
  await fs.writeFile(temporaryPath, value, encoding);
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

async function writeJsonAtomic(filePath, value) {
  return writeFileAtomic(filePath, JSON.stringify(value, null, 2), "utf8");
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
  writeFileAtomic,
  writeJsonAtomic,
};
