const { spawnSync } = require("node:child_process");
const path = require("node:path");

const workspace = path.resolve(__dirname, "..");
const npmExecutable = process.env.npm_execpath
  ? [process.execPath, [process.env.npm_execpath]]
  : [process.platform === "win32" ? "npm.cmd" : "npm", []];
const checks = [
  ["构建检查", npmExecutable[0], [...npmExecutable[1], "run", "build"]],
  ["核心数据与 AI 回归", process.execPath, [path.join(__dirname, "test-core-regression.cjs")]],
  ["创作 Agent 与数据保护", process.execPath, [path.join(__dirname, "test-agent-platform.cjs")]],
  ["逐篇 Word 导出", process.execPath, [path.join(__dirname, "test-batch-docx-export.cjs")]],
  ["UI 按钮与入口", process.execPath, [path.join(__dirname, "run-ui-button-audit.cjs")]],
];

for (const [name, command, args] of checks) {
  console.log(`\n[${name}]`);
  const result = spawnSync(command, args, { cwd: workspace, stdio: "inherit", env: { ...process.env, NOVEL_PLATFORM_TEST: "1", NOVEL_CHAT_TIMEOUT_MS: "0" } });
  if (result.status !== 0) {
    if (result.error) console.error(result.error);
    console.error(`\nFAIL: ${name}`);
    process.exit(result.status || 1);
  }
}

console.log("\nPASS: 软件全功能自动回归套件全部通过。");
