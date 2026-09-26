const PREFIX = "prokachka:welcome-progress:";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
type Progress = { position: number; ended: boolean; updatedAt: number };

// Store seconds, never private playback URLs. Optional browser persistence only:
// the database remains authoritative for the one-time onboarding completion.
export function readWelcomeProgress(key: string, duration: number): Progress | null {
  try {
    const value = JSON.parse(localStorage.getItem(PREFIX + key) || "null") as Progress | null;
    if (!value || !Number.isFinite(value.position) || value.position < 0 || value.position > duration + 1 ||
      !Number.isFinite(value.updatedAt) || value.updatedAt > Date.now() + 60_000 || Date.now() - value.updatedAt > MAX_AGE_MS ||
      typeof value.ended !== "boolean" || (value.ended && value.position < duration - 1)) return null;
    return value;
  } catch { return null; }
}
export function saveWelcomeProgress(key: string, position: number, ended: boolean) {
  if (!Number.isFinite(position) || position < 0) return;
  try {
    const entries = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((item): item is string => Boolean(item?.startsWith(PREFIX)));
    for (const item of entries) {
      try {
        const saved = JSON.parse(localStorage.getItem(item) || "null");
        if (!saved || Date.now() - saved.updatedAt > MAX_AGE_MS) localStorage.removeItem(item);
      } catch { localStorage.removeItem(item); }
    }
    // Small upper bound, even on a shared test computer with many accounts.
    while (entries.length >= 32) localStorage.removeItem(entries.shift()!);
    localStorage.setItem(PREFIX + key, JSON.stringify({ position, ended, updatedAt: Date.now() }));
  } catch { /* private mode/quota failure must not interrupt viewing */ }
}
export function clearWelcomeProgress(key: string) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* optional persistence */ }
}
