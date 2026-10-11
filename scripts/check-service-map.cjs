const fs = require("node:fs");
const path = require("node:path");
const workspace = path.resolve(__dirname, "..");
const map = JSON.parse(fs.readFileSync(path.join(__dirname, "test", "service-coverage-map.json"), "utf8"));
const modules = fs.readdirSync(path.join(workspace, "electron", "services")).filter((file) => file.endsWith(".cjs")).sort();
for (const module of modules) {
  if (!map[module]?.length) throw new Error("服务未登记测试证据: " + module);
  for (const file of map[module]) if (!fs.existsSync(path.join(workspace, file))) throw new Error("测试证据不存在: " + file);
}
for (const module of Object.keys(map)) if (!modules.includes(module)) throw new Error("覆盖登记含已不存在服务: " + module);
console.log(`PASS: ${modules.length}个服务均登记测试证据（登记不等于100%分支覆盖）`);
