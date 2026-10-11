import { useRef } from "react";
import { useStore } from "zustand";
import { createAppStores, type AppStores, type Domain } from "./app-stores";

export function useAppStores() {
  const ref = useRef<AppStores | null>(null);
  if (!ref.current) ref.current = createAppStores(window.innerWidth);
  return ref.current;
}
export function useStoreField<T extends object, K extends keyof T>(domain: Domain<T>, key: K): [T[K], Domain<T>["setters"][K]] {
  const value = useStore(domain.store, (current) => current[key]);
  return [value, domain.setters[key]];
}
