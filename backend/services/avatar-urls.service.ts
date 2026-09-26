import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { AVATAR_BUCKET, isAvatarPath } from "@/shared/domain/profile";

// Reuse signed URLs across views/users so private objects can hit Smart CDN.
// Only call after the surrounding dataset has passed its access checks.
const urlLifetimeSeconds = 24 * 60 * 60;
const cache = new Map<string, { refreshAt: number; value: Promise<string | undefined> }>();
const maxEntries = 5000;
let signing = 0;
const waiting: Array<() => void> = [];
async function boundedSigning<T>(operation: () => Promise<T>) {
  if (signing >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
  else signing++;
  try { return await operation(); }
  finally { const next = waiting.shift(); if (next) next(); else signing--; }
}

export async function withAvatarUrls<T extends object>(rows: readonly T[]): Promise<Array<T & { avatar_url?: string }>> {
  const paths = [...new Set(rows.map((row) => (row as Record<string, unknown>).avatar_path).filter(isAvatarPath))];
  const now = Date.now();
  const missing = paths.filter((path) => !cache.has(path) || cache.get(path)!.refreshAt <= now);
  const values = new Map(paths.filter((path) => cache.has(path)).map((path) => [path, cache.get(path)!.value]));
  const supabase = missing.length ? getSupabaseAdmin() : null;
  if (supabase) {
    for (let start = 0; start < missing.length; start += 100) {
      const batch = missing.slice(start, start + 100);
      const pending = boundedSigning(async () => supabase.storage.from(AVATAR_BUCKET).createSignedUrls(batch, urlLifetimeSeconds))
        .then(({ data, error }) => error ? [] : data || []).catch(() => []);
      for (const path of batch) {
        const value = pending.then((data) => data.find((item) => item.path === path)?.signedUrl || undefined);
        const entry = { refreshAt: now + (urlLifetimeSeconds - 3600) * 1000, value };
        cache.set(path, entry);
        values.set(path, value);
        void value.then((url) => { if (!url && cache.get(path) === entry) entry.refreshAt = Date.now() + 30_000; });
      }
    }
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
  }
  const urls = new Map(await Promise.all(paths.map(async (path) => [path, await values.get(path)] as const)));
  return rows.map((row) => {
    const { avatar_path: path, ...rest } = row as T & { avatar_path?: string };
    return { ...rest, avatar_url: path ? urls.get(path) : undefined } as T & { avatar_url?: string };
  });
}
