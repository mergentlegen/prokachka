type Entry = { data?: unknown; expires: number; version: number; pending?: Promise<unknown> };
export class ScopeChangedError extends Error {
  constructor() { super("Account scope changed"); }
}

// Memory only: never persist private API responses across logins or browser sessions.
export class QueryCache {
  private entries = new Map<string, Entry>();
  private scope = "";
  private listeners = new Set<() => void>();
  epoch = 0;
  constructor(private ttlMs = 30_000, private now = () => Date.now()) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getEpoch = () => this.epoch;
  activate(scope: string) { if (scope !== this.scope) { this.scope = scope; this.clear(); } }
  clear() { this.epoch++; this.entries.clear(); this.listeners.forEach((listener) => listener()); }
  peek<T>(key: string): T | undefined { return this.entries.get(key)?.data as T | undefined; }
  has(key: string) { return this.entries.get(key)?.data !== undefined; }
  invalidate(matches: (key: string) => boolean) {
    for (const [key, entry] of this.entries) if (matches(key)) { entry.expires = 0; entry.version++; }
  }
  async read<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    let entry = this.entries.get(key);
    if (!entry) { entry = { expires: 0, version: 0 }; this.entries.set(key, entry); }
    if (entry.data !== undefined && entry.expires > this.now()) return entry.data as T;
    if (entry.pending) return entry.pending as Promise<T>;
    const epoch = this.epoch;
    const current = entry;
    const pending = (async () => {
      // An invalidation during a request cannot reintroduce the old response.
      for (;;) {
        const version = current.version;
        const data = await fetcher();
        if (epoch !== this.epoch) throw new ScopeChangedError();
        if (version !== current.version) continue;
        current.data = data;
        current.expires = this.now() + this.ttlMs;
        return data;
      }
    })();
    current.pending = pending;
    try { return await pending; } finally { if (current.pending === pending) current.pending = undefined; }
  }
}
