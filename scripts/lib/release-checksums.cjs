const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

function releaseNames(version, documents = false) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("无效发布版本");
  const setup = `AI-Novel-Writing-Platform-Setup-${version}-x64.exe`;
  return [setup, `AI-Novel-Writing-Platform-Portable-${version}-x64.exe`, `${setup}.blockmap`, "latest.yml", ...(documents ? ["README.md", "USER-GUIDE.zh-CN.md"] : [])];
}
async function digest(directory, name) {
  return crypto.createHash("sha256").update(await fs.readFile(path.join(directory, name))).digest("hex");
}
async function createManifest(directory, version, documents = false) {
  const names = releaseNames(version, documents);
  const latest = await fs.readFile(path.join(directory, "latest.yml"), "utf8");
  if (!new RegExp(`^version: ['"]?${version.replaceAll(".", "\\.")}['"]?\\s*$`, "m").test(latest)) throw new Error("latest.yml版本不一致");
  return (await Promise.all(names.map(async (name) => `${await digest(directory, name)}  ${name}`))).join("\n") + "\n";
}
async function verifyManifest(directory, version, body, documents = false) {
  const expected = await createManifest(directory, version, documents);
  const normalize = (text) => text.trim().split(/\r?\n/).map((line) => line.replace(/\s+\*?/, "  ").toLowerCase()).sort().join("\n");
  if (normalize(body) !== normalize(expected)) throw new Error("校验表缺项、含多余资产或哈希不一致");
  return releaseNames(version, documents).length;
}
module.exports = { releaseNames, createManifest, verifyManifest };
