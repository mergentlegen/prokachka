import type { User } from "@/shared/domain/types";

export type NetworkEntry = { user: User; depth: number; parentId: string | null; childCount: number; descendantCount: number };

// Iterative traversal keeps each branch together and handles very deep networks.
export function buildNetworkTree(users: User[]): NetworkEntry[] {
  const byId = new Map(users.map((user) => [user.id, user]));
  const children = new Map<string, User[]>();
  const roots: User[] = [];
  for (const user of byId.values()) {
    if (user.parentUserId && user.parentUserId !== user.id && byId.has(user.parentUserId)) {
      const siblings = children.get(user.parentUserId) || [];
      siblings.push(user);
      children.set(user.parentUserId, siblings);
    } else roots.push(user);
  }
  const byName = (a: User, b: User) => a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id);
  roots.sort(byName);
  children.forEach((siblings) => siblings.sort(byName));
  const entries: NetworkEntry[] = [];
  const seen = new Set<string>();
  function visit(root: User) {
    const stack = [{ user: root, depth: 0, parentId: null as string | null }];
    while (stack.length) {
      const item = stack.pop()!;
      if (seen.has(item.user.id)) continue;
      seen.add(item.user.id);
      entries.push({ ...item, childCount: 0, descendantCount: 0 });
      const next = children.get(item.user.id) || [];
      for (let i = next.length - 1; i >= 0; i--) stack.push({ user: next[i], depth: item.depth + 1, parentId: item.user.id });
    }
  }
  roots.forEach(visit);
  // Display malformed legacy cycles once, without hanging or dropping people.
  [...byId.values()].sort(byName).forEach((user) => { if (!seen.has(user.id)) visit(user); });
  const entryById = new Map(entries.map((entry) => [entry.user.id, entry]));
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const parent = entry.parentId ? entryById.get(entry.parentId) : undefined;
    if (parent) { parent.childCount++; parent.descendantCount += entry.descendantCount + 1; }
  }
  return entries;
}

export function visibleNetworkEntries(entries: NetworkEntry[], collapsed: ReadonlySet<string>) {
  const result: NetworkEntry[] = [];
  let hiddenBelow: number | null = null;
  for (const entry of entries) {
    if (hiddenBelow !== null && entry.depth > hiddenBelow) continue;
    hiddenBelow = collapsed.has(entry.user.id) ? entry.depth : null;
    result.push(entry);
  }
  return result;
}

export function networkDescendantIds(entries: NetworkEntry[], id: string) {
  const index = entries.findIndex((entry) => entry.user.id === id);
  const result = new Set<string>([id]);
  if (index < 0) return result;
  for (let i = index + 1; i < entries.length && entries[i].depth > entries[index].depth; i++) result.add(entries[i].user.id);
  return result;
}
