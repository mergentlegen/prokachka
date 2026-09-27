// Per-process resource budget; the reverse proxy must also limit connections.
const users = new Map<string, number>();
let total = 0;

export function acquireLiveConnection(userId: string): (() => void) | null {
  const count = users.get(userId) || 0;
  if (count >= 5 || total >= 2_000) return null;
  users.set(userId, count + 1);
  total++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (users.get(userId) || 1) - 1;
    if (remaining) users.set(userId, remaining); else users.delete(userId);
    total--;
  };
}
