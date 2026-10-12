const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
function source(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}
const limits = {
  "src/App.tsx": 1150,
  "src/components/AnalysisPanel.tsx": 250,
  "src/types.ts": 30,
  "electron/ipc/handlers.cjs": 120,
  "electron/services/analysis-tools.cjs": 80,
  "electron/services/story-state.cjs": 80,
  "electron/services/task-runtime.cjs": 60,
};
for (const [file, limit] of Object.entries(limits))
  if (source(file).split("\n").length > limit)
    throw Error(`${file} 超过职责入口行数门槛 ${limit}`);
const domains = fs
  .readdirSync(path.join(root, "electron/ipc/domains"))
  .filter((f) => f.endsWith(".cjs"));
for (const file of domains)
  if (/ipcMain\s*\.\s*handle\s*\(/.test(source("electron/ipc/domains/" + file)))
    throw Error("IPC领域绕过统一来源/参数验证: " + file);
for (const directory of [
  "src/types",
  "electron/services/story",
  "electron/services/analysis",
  "electron/services/tasks",
]) {
  const files = fs
      .readdirSync(path.join(root, directory))
      .filter((f) => /\.(ts|cjs)$/.test(f)),
    graph = new Map();
  for (const file of files) {
    const text = source(directory + "/" + file),
      ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const deps = [];
    function visit(n) {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
        if (directory === "src/types" && !n.importClause?.isTypeOnly)
          throw Error("类型模块含运行时导入: " + file);
        deps.push(n.moduleSpecifier.text);
      }
      if (
        ts.isCallExpression(n) &&
        n.expression.getText(ast) === "require" &&
        ts.isStringLiteral(n.arguments[0])
      )
        deps.push(n.arguments[0].text);
      ts.forEachChild(n, visit);
    }
    visit(ast);
    graph.set(
      file,
      deps
        .filter((d) => d.startsWith("./"))
        .map((d) => path.basename(d) + (d.endsWith(".cjs") ? "" : ".ts")),
    );
  }
  // Type-only references may cross domains. Runtime service children must form
  // an acyclic graph so adding a helper cannot reintroduce initialization races.
  if (directory !== "src/types") {
    const done = new Set(),
      active = new Set();
    function visit(file) {
      if (done.has(file)) return;
      if (active.has(file))
        throw Error(`服务子模块循环依赖: ${directory}/${file}`);
      active.add(file);
      for (const next of graph.get(file) || []) visit(next);
      active.delete(file);
      done.add(file);
    }
    files.forEach(visit);
  }
}
console.log("PASS: 职责入口大小、统一IPC验证、类型导入及服务子模块依赖边界");
