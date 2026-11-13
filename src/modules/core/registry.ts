// 通用模块注册表（P73）：泛化自 mindmap 注册表，供各功能槽位复用。
// 约定：宿主只经注册表挂载模块，不得静态导入内置实现；卸载守卫保护未落盘数据；
// 停用/未注册时数据保留，由宿主渲染降级提示。
import { useSyncExternalStore } from "react";

export interface ModuleDescriptorBase {
  id: string;
  name: string;
  contractVersion: number;
  capabilities: readonly string[];
}

export interface SlotModule {
  descriptor: ModuleDescriptorBase;
}

export interface ModuleRegistry<TModule extends SlotModule> {
  register: (module: TModule | null) => void;
  get: () => TModule | null;
  unregister: () => Promise<boolean>;
  setUnloadGuard: (guard: (() => Promise<boolean>) | null) => void;
  subscribe: (listener: () => void) => () => void;
  useModule: () => TModule | null;
}

export function createModuleRegistry<TModule extends SlotModule>(): ModuleRegistry<TModule> {
  let registered: TModule | null = null;
  let unloadGuard: (() => Promise<boolean>) | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const registry: ModuleRegistry<TModule> = {
    register(module) {
      registered = module;
      emit();
    },
    get() {
      return registered;
    },
    async unregister() {
      if (unloadGuard && !(await unloadGuard())) return false;
      registered = null;
      emit();
      return true;
    },
    setUnloadGuard(guard) {
      unloadGuard = guard;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    useModule() {
      return useSyncExternalStore(registry.subscribe, registry.get, () => null);
    },
  };
  return registry;
}

/** 槽位目录：供设置「模块管理」数据驱动渲染；新增槽位时在此登记。 */
export interface ModuleSlotInfo {
  id: string;
  label: string;
  description: string;
  /** 设置开关文案；缺省为「启用{label}模块」。既有文案被 UI 回归断言时在此固定。 */
  toggleLabel?: string;
}

const slots = new Map<string, ModuleSlotInfo>();

export function declareModuleSlot(info: ModuleSlotInfo) {
  slots.set(info.id, info);
}

export function listModuleSlots(): ModuleSlotInfo[] {
  return [...slots.values()];
}