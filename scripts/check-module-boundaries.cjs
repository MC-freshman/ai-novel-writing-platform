const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
function source(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}
const limits = {
  "src/App.tsx": 650,
  "src/components/analysis/AnalysisPanel.tsx": 150,
  "src/types.ts": 30,
  "electron/ipc/handlers.cjs": 120,
  "electron/services/analysis-tools.cjs": 80,
  "electron/services/story-state.cjs": 80,
  "electron/services/task-runtime.cjs": 60,
};
for (const [file, limit] of Object.entries(limits))
  if (source(file).split("\n").length > limit)
    throw Error(`${file} 超过职责入口行数门槛 ${limit}`);
if (/require\(["']\.\/project-ops\.cjs["']\)/.test(source("electron/services/project-config.cjs")))
  throw Error("project-config 不得反向依赖事务编排 project-ops");
for (const file of fs.readdirSync(path.join(root, "electron/ipc/domains")).filter((name) => name.endsWith(".cjs")))
  if (/require\(["']\.\.\/dependencies\.cjs["']\)/.test(source(`electron/ipc/domains/${file}`)))
    throw Error(`IPC域必须使用逐域依赖，不得回退共享依赖桶: ${file}`);
if (/modules\/mindmap\/builtin/.test(source("src/components/planning/ProgressWorkspace.tsx")))
  throw Error("导图宿主不得静态依赖内置模块，必须通过注册表挂载");
if (!/registerMindMapModule\(builtinMindMapModule\)/.test(source("src/main.tsx")))
  throw Error("内置导图模块必须通过注册表显式注册");
// P73 泛化模块边界：任何宿主组件不得静态导入任何槽位的内置实现；通用注册表必须存在。
function walkComponents(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walkComponents(`${directory}/${entry.name}`) : /\.(tsx|ts)$/.test(entry.name) ? [`${directory}/${entry.name}`] : []);
}
for (const file of walkComponents("src/components"))
  if (/modules\/[a-z0-9-]+\/builtin/.test(source(file)))
    throw Error(`模块宿主不得静态依赖内置实现，必须通过注册表挂载: ${file}`);
if (!fs.existsSync(path.join(root, "src/modules/core/registry.ts")))
  throw Error("缺少通用模块注册表 src/modules/core/registry.ts");
const domains = fs
  .readdirSync(path.join(root, "electron/ipc/domains"))
  .filter((f) => f.endsWith(".cjs"));
for (const file of domains)
  if (/ipcMain\s*\.\s*handle\s*\(/.test(source("electron/ipc/domains/" + file)))
    throw Error("IPC领域绕过统一来源/参数验证: " + file);
for (const directory of [
  "src/types",
  "electron/services",
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
  if (directory !== "src/types" && directory !== "electron/services") {
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
// 顶层服务必须保持单向；子目录仍由原有局部无环检查兜底。
{
  const serviceDirectory = "electron/services";
  const serviceFiles = fs.readdirSync(path.join(root, serviceDirectory)).filter((file) => file.endsWith(".cjs"));
  const serviceGraph = new Map();
  for (const file of serviceFiles) {
    const deps = [...source(`${serviceDirectory}/${file}`).matchAll(/require\(["']\.\/([^"']+)["']\)/g)]
      .map((match) => `${match[1].endsWith(".cjs") ? match[1] : `${match[1]}.cjs`}`)
      .filter((dep) => serviceFiles.includes(dep));
    serviceGraph.set(file, deps);
  }
  const done = new Set();
  const active = new Set();
  const visit = (file, trail = []) => {
    if (done.has(file)) return;
    if (active.has(file)) throw Error(`顶层服务循环依赖: ${[...trail, file].join(" -> ")}`);
    active.add(file);
    for (const next of serviceGraph.get(file) || []) visit(next, [...trail, file]);
    active.delete(file);
    done.add(file);
  };
  serviceFiles.forEach((file) => visit(file));
}
console.log("PASS: 职责入口大小、统一IPC验证、类型导入、顶层及子目录服务依赖边界");
