// 思维导图模块注册表：委托通用注册表（P73），对外 API 与 window.novelModules 契约保持不变。
import { createModuleRegistry, declareModuleSlot } from "../core/registry";
import type { MindMapModule } from "./contract";

const registry = createModuleRegistry<MindMapModule>();

declareModuleSlot({
  id: "mindmap",
  label: "思维导图",
  description: "规划与进度中的思维导图视图；停用后入口显示提示，导图数据保留。",
  toggleLabel: "启用内置思维导图模块",
});

export function registerMindMapModule(module: MindMapModule | null) {
  registry.register(module);
}

export function getMindMapModule(): MindMapModule | null {
  return registry.get();
}

export async function unregisterMindMapModule(): Promise<boolean> {
  return registry.unregister();
}

export function setMindMapModuleUnloadGuard(guard: (() => Promise<boolean>) | null) {
  registry.setUnloadGuard(guard);
}

export function subscribeMindMapModule(listener: () => void) {
  return registry.subscribe(listener);
}

export function useMindMapModule(): MindMapModule | null {
  return registry.useModule();
}

declare global {
  interface Window {
    novelModules?: {
      registerMindMapModule: typeof registerMindMapModule;
      unregisterMindMapModule: typeof unregisterMindMapModule;
      setMindMapModuleUnloadGuard: typeof setMindMapModuleUnloadGuard;
      registerBuiltinMindMapModule?: () => void;
    };
  }
}

if (typeof window !== "undefined") {
  window.novelModules = {
    registerMindMapModule,
    unregisterMindMapModule,
    setMindMapModuleUnloadGuard,
  };
}