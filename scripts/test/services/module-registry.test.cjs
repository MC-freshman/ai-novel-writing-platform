"use strict";
// 通用模块框架契约测试（P73）：注册表泛化后的 API 兼容、宿主边界、配置合并。
// 运行时行为由既有 CDP 回归覆盖（test-ui-plan 导图开关、test-ui-no-mindmap 降级）。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fixture, electron } = require("../helpers/service-fixture.cjs");
const projectConfig = require("../../../electron/services/project-config.cjs");

const root = path.resolve(__dirname, "../../..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("通用注册表存在且导出约定 API", () => {
  const core = source("src/modules/core/registry.ts");
  for (const name of ["createModuleRegistry", "declareModuleSlot", "listModuleSlots", "ModuleRegistry", "ModuleSlotInfo"])
    assert.ok(core.includes(name), `core/registry 缺少 ${name}`);
  assert.ok(core.includes("useSyncExternalStore"), "注册表须用 useSyncExternalStore 订阅");
  assert.ok(core.includes("unloadGuard"), "注册表须保留卸载守卫");
});

test("mindmap 注册表委托通用注册表且对外 API 不变", () => {
  const registry = source("src/modules/mindmap/registry.ts");
  assert.ok(registry.includes('from "../core/registry"'), "mindmap 注册表须委托通用注册表");
  for (const name of ["registerMindMapModule", "getMindMapModule", "unregisterMindMapModule", "setMindMapModuleUnloadGuard", "subscribeMindMapModule", "useMindMapModule"])
    assert.ok(registry.includes(`export function ${name}`) || registry.includes(`export async function ${name}`), `缺少导出 ${name}`);
  assert.ok(registry.includes("window.novelModules"), "window.novelModules 注入须保留");
  assert.ok(registry.includes("toggleLabel"), "mindmap 槽须固定既有开关文案");
  const contract = source("src/modules/mindmap/contract.ts");
  assert.ok(contract.includes("MIND_MAP_CONTRACT_VERSION = 1"), "mindmap 契约版本须保持 v1");
});

test("启动注册与构建开关保留，宿主不静态导入内置实现", () => {
  const main = source("src/main.tsx");
  assert.ok(main.includes("registerMindMapModule(builtinMindMapModule)"), "内置模块须经注册表显式注册");
  assert.ok(main.includes("VITE_DISABLE_MINDMAP_MODULE"), "未注册构建开关须保留");
  const workspace = source("src/components/planning/ProgressWorkspace.tsx");
  assert.ok(!/modules\/mindmap\/builtin/.test(workspace), "宿主不得静态导入内置实现");
  assert.ok(workspace.includes("isModuleEnabled"), "宿主启用判定须走统一 helper");
});

test("模块启用判定兼容旧字段", () => {
  const helper = source("src/lib/modules.ts");
  assert.ok(helper.includes("mindMapEnabled"), "mindmap 槽须兼容 ui.mindMapEnabled");
  const configType = source("src/types/config.ts");
  assert.ok(configType.includes("modules?: Record<string, { enabled?: boolean }>"), "NovelConfig 须含 modules 开关字段");
  const settings = source("src/components/shell/SettingsModal.tsx");
  assert.ok(settings.includes("listModuleSlots()"), "设置须数据驱动渲染模块列表");
  assert.ok(settings.includes("updateModule"), "设置须经统一 updateModule 写开关");
});

test("configFromRenderer 合并 modules 开关（增量、校验、兼容）", async (t) => {
  const dir = await fixture(t);
  electron.app.getPath = () => dir;
  const existing = {
    title: "旧项目", author: "a",
    api: { temperature: 0.7, maxTokens: 8000, topK: 5, scanK: 50, apiKey: "k", embeddingApiKey: "e" },
    ui: { mindMapEnabled: true }, agent: { permissionLevel: "只读分析" },
    modules: { mindmap: { enabled: true } },
  };
  const merged = projectConfig.configFromRenderer(existing, { modules: { mindmap: { enabled: false }, "export-provider": { enabled: true } } });
  assert.equal(merged.modules.mindmap.enabled, false);
  assert.equal(merged.modules["export-provider"].enabled, true);
  assert.equal(merged.ui.mindMapEnabled, true, "ui 旧字段不被 modules 合并误改");
  const filtered = projectConfig.configFromRenderer(existing, { modules: { "Bad Slot": { enabled: false }, ok: { enabled: "yes" }, good: { enabled: true } } });
  assert.equal(filtered.modules["Bad Slot"], undefined, "非法槽位名须过滤");
  assert.equal(filtered.modules.ok, undefined, "非布尔 enabled 须过滤");
  assert.equal(filtered.modules.good.enabled, true);
  const legacy = projectConfig.configFromRenderer({ ...existing, modules: undefined }, {});
  assert.equal(legacy.modules, undefined, "无 modules 的旧项目保存后不引入新字段");
  assert.equal(legacy.api.apiKey, "k", "密钥保留规则不变");
});