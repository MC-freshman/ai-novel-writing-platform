const path = require("node:path");
const { scanReleaseInputs } = require("../electron/services/release-privacy.cjs");

(async () => {
  const report = await scanReleaseInputs(path.resolve(__dirname, ".."));
  if (!report.ok) {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(`PASS: 发布输入隐私扫描通过，共检查 ${report.scannedFiles} 个文件。`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
