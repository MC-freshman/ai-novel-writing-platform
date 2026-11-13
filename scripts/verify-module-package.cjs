"use strict";
// 模块包完整性校验（P102）：构建期替换前的 SHA256 校验/清单生成。
// 安全纪律：运行时加载外部 JS 仍被 CSP script-src 'self' 禁止（审计 A1），本工具不放宽 CSP；
// 仅服务于「构建期源码替换」路径——替换前校验模块包完整性，防止被篡改的模块进入构建。
// 用法：
//   node scripts/verify-module-package.cjs <module-dir>            # 有 SHA256SUMS 则校验，无则生成
//   node scripts/verify-module-package.cjs <module-dir> --generate # 强制重新生成清单
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MANIFEST = "SHA256SUMS";
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

function walk(directory, base = directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...walk(path.join(directory, entry.name), base));
    } else if (entry.isFile() && entry.name !== MANIFEST) {
      files.push(path.relative(base, path.join(directory, entry.name)).replace(/\\/g, "/"));
    }
  }
  return files.sort();
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function generateManifest(directory) {
  const files = walk(directory);
  if (!files.length) throw new Error("模块目录为空。");
  const lines = files.map((file) => `${sha256(path.join(directory, file))}  ${file}`);
  fs.writeFileSync(path.join(directory, MANIFEST), lines.join("\n") + "\n", "utf8");
  return { generated: true, files: files.length };
}

function verifyManifest(directory) {
  const manifestPath = path.join(directory, MANIFEST);
  if (!fs.existsSync(manifestPath)) return { verified: false, reason: "缺少 SHA256SUMS 清单（先用 --generate 生成）。" };
  const lines = fs.readFileSync(manifestPath, "utf8").split(/\r?\n/).filter(Boolean);
  const mismatches = [];
  const missing = [];
  let checked = 0;
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})\s\s(.+)$/);
    if (!match) continue;
    const [, expected, file] = match;
    const filePath = path.join(directory, file);
    if (!fs.existsSync(filePath)) { missing.push(file); continue; }
    checked += 1;
    if (sha256(filePath) !== expected) mismatches.push(file);
  }
  const currentFiles = walk(directory);
  const listed = new Set(lines.map((line) => (line.match(/^([0-9a-f]{64})\s\s(.+)$/) || [])[2]).filter(Boolean));
  const unlisted = currentFiles.filter((file) => !listed.has(file));
  const ok = !mismatches.length && !missing.length && !unlisted.length;
  return { verified: ok, checked, mismatches, missing, unlisted };
}

function main(argv) {
  const directory = path.resolve(argv[0] || "");
  if (!argv[0] || !fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    console.error("用法: node scripts/verify-module-package.cjs <module-dir> [--generate]");
    process.exit(2);
  }
  if (argv.includes("--generate") || !fs.existsSync(path.join(directory, MANIFEST))) {
    const result = generateManifest(directory);
    console.log(`OK: 已生成清单（${result.files} 个文件）→ ${path.join(directory, MANIFEST)}`);
    return;
  }
  const result = verifyManifest(directory);
  if (result.verified) {
    console.log(`PASS: 模块包完整性校验通过（${result.checked} 个文件）。`);
    return;
  }
  console.error(`FAIL: 模块包完整性校验未通过。`);
  if (result.mismatches?.length) console.error(`  哈希不符: ${result.mismatches.join(", ")}`);
  if (result.missing?.length) console.error(`  清单文件缺失: ${result.missing.join(", ")}`);
  if (result.unlisted?.length) console.error(`  未登记文件: ${result.unlisted.join(", ")}`);
  if (result.reason) console.error(`  ${result.reason}`);
  process.exit(1);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { walk, sha256, generateManifest, verifyManifest };