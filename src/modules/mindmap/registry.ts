import { useSyncExternalStore } from "react";
import type { MindMapModule } from "./contract";

let registeredModule: MindMapModule | null = null;
let unloadGuard: (() => Promise<boolean>) | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function registerMindMapModule(module: MindMapModule | null) {
  registeredModule = module;
  emit();
}

export function getMindMapModule(): MindMapModule | null {
  return registeredModule;
}

export async function unregisterMindMapModule(): Promise<boolean> {
  if (unloadGuard && !(await unloadGuard())) return false;
  registerMindMapModule(null);
  return true;
}

export function setMindMapModuleUnloadGuard(guard: (() => Promise<boolean>) | null) {
  unloadGuard = guard;
}

export function subscribeMindMapModule(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMindMapModule(): MindMapModule | null {
  return useSyncExternalStore(subscribeMindMapModule, getMindMapModule, () => null);
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
