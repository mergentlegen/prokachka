import { cloneSeed } from "@/frontend/shared/demo-data";
import type { Store } from "@/shared/domain/types";

export const STORE_STORAGE_KEY = "incruises-prokachka-store";

export function loadClientStore(): Store {
  if (typeof window === "undefined") return cloneSeed();
  const value = window.localStorage.getItem(STORE_STORAGE_KEY);
  if (!value) return cloneSeed();
  try { return JSON.parse(value) as Store; } catch { return cloneSeed(); }
}

export function saveClientStore(store: Store) {
  window.localStorage.setItem(STORE_STORAGE_KEY, JSON.stringify(store));
}
