const fs = require("node:fs");
const path = require("node:path");
const workspace = path.resolve(__dirname, "..");
const map = JSON.parse(fs.readFileSync(path.join(__dirname, "test", "service-coverage-map.json"), "utf8"));
function listModules(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? listModules(path.join(directory, entry.name), prefix + entry.name + "/")
    : entry.name.endsWith(".cjs") ? [prefix + entry.name] : []);
}
const modules = listModules(path.join(workspace, "electron", "services")).sort();
for (const module of modules) {
  if (!map[module]?.length) throw new Error("服务未登记测试证据: " + module);
  for (const file of map[module]) if (!fs.existsSync(path.join(workspace, file))) throw new Error("测试证据不存在: " + file);
}
for (const module of Object.keys(map)) if (!modules.includes(module)) throw new Error("覆盖登记含已不存在服务: " + module);
console.log(`PASS: ${modules.length}个服务均登记测试证据（登记不等于100%分支覆盖）`);
