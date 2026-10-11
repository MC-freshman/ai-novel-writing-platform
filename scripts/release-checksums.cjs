const fs = require("node:fs/promises");
const path = require("node:path");
const { createManifest, verifyManifest } = require("./lib/release-checksums.cjs");

async function main() {
  const [mode, directory, version, flag] = process.argv.slice(2);
  if (!["generate", "verify"].includes(mode) || !directory || !version) throw new Error("用法: node scripts/release-checksums.cjs generate|verify <目录> <版本> [--documents]");
  const file = path.join(directory, "SHA256SUMS.txt");
  const documents = flag === "--documents";
  if (mode === "generate") {
    const body = await createManifest(directory, version, documents);
    await fs.writeFile(file, body);
    await fs.writeFile(path.join(directory, `SHA256SUMS-${version}.txt`), body);
  }
  const count = await verifyManifest(directory, version, await fs.readFile(file, "utf8"), documents);
  console.log(`PASS: ${version} ${count}项资产校验一致`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
