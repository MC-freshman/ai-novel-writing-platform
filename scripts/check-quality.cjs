const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

async function main() {
  const { ESLint } = await import("eslint");
  const eslint = new ESLint();
  const results = await eslint.lintFiles(["."]);
  const rules = {};
  for (const result of results) for (const message of result.messages) {
    const key = message.ruleId || "parse";
    rules[key] = (rules[key] || 0) + 1;
  }
  const report = {
    generatedAt: new Date().toISOString(),
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    workingTreeDirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()),
    errors: results.reduce((sum, item) => sum + item.errorCount, 0),
    warnings: results.reduce((sum, item) => sum + item.warningCount, 0),
    rules,
  };
  const output = path.resolve(process.argv[2] || ".test-runs/quality/latest.json");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
  if (report.errors || report.warnings) console.log((await eslint.loadFormatter("stylish")).format(results));
  console.log(JSON.stringify(report));
  process.exitCode = report.errors || report.warnings ? 1 : 0;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
