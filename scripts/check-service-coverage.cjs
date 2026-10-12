const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "..");
const directory = path.join(root, ".test-runs", "services");
fs.mkdirSync(directory, { recursive: true });
const raw = path.join(directory, "coverage-raw.json");
const tests = fs
  .readdirSync(path.join(__dirname, "test/services"))
  .filter((file) => file.endsWith(".test.cjs"))
  .map((file) => "scripts/test/services/" + file);
const result = spawnSync(
  process.execPath,
  [
    "--test",
    "--experimental-test-coverage",
    "--test-coverage-include=electron/services/**",
    "--test-concurrency=1",
    "--test-reporter=spec",
    "--test-reporter=" +
      pathToFileURL(path.join(__dirname, "test/helpers/coverage-reporter.cjs"))
        .href,
    "--test-reporter-destination=stdout",
    "--test-reporter-destination=" + raw,
    ...tests,
  ],
  { cwd: root, stdio: "inherit", windowsHide: true },
);
if (result.status !== 0) process.exit(result.status || 1);
const summary = JSON.parse(fs.readFileSync(raw, "utf8").trim());
const domains = {
  analysis: ["analysis-tools.cjs", "analysis/"],
  story: ["story-state.cjs", "story/"],
  tasks: ["task-runtime.cjs", "tasks/"],
};
const reports = Object.fromEntries(
  Object.entries(domains).map(([name, prefixes]) => {
    const files = summary.files.filter((f) => {
      const relative = path
        .relative(path.join(root, "electron/services"), f.path)
        .replaceAll("\\", "/");
      return prefixes.some((p) =>
        p.endsWith("/") ? relative.startsWith(p) : relative === p,
      );
    });
    if (!files.length) throw Error("未测量服务域: " + name);
    const totalLines = files.reduce((sum, f) => sum + f.totalLineCount, 0);
    const coveredLines = files.reduce((sum, f) => sum + f.coveredLineCount, 0);
    return [
      name,
      {
        files: files.map((f) =>
          path.relative(root, f.path).replaceAll("\\", "/"),
        ),
        totalLines,
        coveredLines,
        linePercent: Math.round((coveredLines / totalLines) * 10000) / 100,
      },
    ];
  }),
);
const report = {
  generatedAt: new Date().toISOString(),
  runtime: process.version,
  minimumDomainLinePercent: 80,
  domains: reports,
  totals: summary.totals,
};
fs.writeFileSync(
  path.join(directory, "coverage.json"),
  JSON.stringify(report, null, 2) + "\n",
);
for (const [name, domain] of Object.entries(reports)) {
  console.log(
    `${name}: ${domain.coveredLines}/${domain.totalLines} lines (${domain.linePercent}%)`,
  );
  if (domain.linePercent < 80) throw Error(`${name} 服务域行覆盖未达到80%`);
}
