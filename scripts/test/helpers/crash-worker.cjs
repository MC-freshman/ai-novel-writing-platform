const fs = require("node:fs/promises");
const path = require("node:path");
require("./service-fixture.cjs");
const storage = require("../../../electron/services/project-storage.cjs");
const snapshots = require("../../../electron/services/project-snapshots.cjs");
const [project, mode, stopAt, snapshotId] = process.argv.slice(2);
async function checkpoint(name) {
  if (stopAt !== name) return;
  process.send({ checkpoint: name });
  await new Promise(() => {});
}
const rename = fs.rename;
fs.rename = async (from, to) => {
  if (to === path.join(project, "chapters", "a.md")) await checkpoint("temporary:a.md");
  const result = await rename(from, to);
  const relative = path.relative(project, to).split(path.sep).join("/");
  if (mode === "exchange" && relative.startsWith("chapters/")) await checkpoint("exchange:chapter");
  if (mode === "exchange" && relative === "novel.config.json") await checkpoint("exchange:config");
  if (relative.includes(".novel-transactions/") && relative.endsWith("manifest.json")) {
    const manifest = JSON.parse(await fs.readFile(to, "utf8"));
    await checkpoint(manifest.phase === "committed" ? "committed" : "prepared");
  } else if (relative.startsWith("chapters/")) await checkpoint((mode === "recover" ? "recover:" : "write:") + path.basename(to));
  return result;
};
const remove = fs.rm;
fs.rm = async (target, options) => {
  const result = await remove(target, options);
  if (target === path.join(project, "chapters", "d.md")) await checkpoint("delete:d.md");
  return result;
};
async function main() {
  if (mode === "recover") await storage.withProjectTransaction(project, async () => {});
  else if (mode === "snapshot") await snapshots.restoreSnapshot(project, snapshotId);
  else if (mode === "exchange") {
    const platform = require("../../../electron/services/project-ops.cjs");
    const { state } = require("../../../electron/services/runtime-state.cjs");
    state.pendingExchangeImports.set("synthetic", { filePath: path.join(project, "exchange.zip"), projectPath: project, createdAt: Date.now() });
    await platform.importProjectExchange(project, "synthetic");
  }
  else await storage.writeProjectFiles(project, [
    { path: path.join(project, "chapters", "a.md"), content: "新稿A" },
    { path: path.join(project, "chapters", "b.md"), content: "新稿B" },
    { path: path.join(project, "chapters", "c.md"), content: "新增稿C" },
    { path: path.join(project, "chapters", "d.md"), content: null },
    { path: path.join(project, "novel.config.json"), content: '{"chapters":["a","b","c"]}' },
  ]);
  process.send({ done: true });
}
main().then(() => process.disconnect()).catch((error) => { process.send({ error: error.message }); process.exitCode = 1; process.disconnect(); });
