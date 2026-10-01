import type { NetworkMember, User } from "@/shared/domain/types";

export type NetworkEntry<T extends User = User> = { user: T; depth: number; parentId: string | null; childCount: number; descendantCount: number };
export type NetworkSort = "name" | "miles";
export type NetworkActivity = "active" | "quiet" | "inactive";

const DAY = 86_400_000;
export const NEW_MEMBER_DAYS = 7;
export const QUIET_AFTER_DAYS = 14;

// Iterative traversal keeps each branch together and handles very deep networks.
export function buildNetworkTree<T extends User>(users: T[], sort: NetworkSort = "name"): NetworkEntry<T>[] {
  const byId = new Map(users.map((user) => [user.id, user]));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const user of byId.values()) {
    if (user.parentUserId && user.parentUserId !== user.id && byId.has(user.parentUserId)) {
      const siblings = children.get(user.parentUserId) || [];
      siblings.push(user);
      children.set(user.parentUserId, siblings);
    } else roots.push(user);
  }
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id);
  const miles = (user: T) => (user as NetworkMember).points ?? -1;
  const order = sort === "miles" ? (a: T, b: T) => miles(b) - miles(a) || byName(a, b) : byName;
  roots.sort(order);
  children.forEach((siblings) => siblings.sort(order));
  const entries: NetworkEntry<T>[] = [];
  const seen = new Set<string>();
  function visit(root: T) {
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

export function visibleNetworkEntries<T extends User>(entries: NetworkEntry<T>[], collapsed: ReadonlySet<string>) {
  const result: NetworkEntry<T>[] = [];
  let hiddenBelow: number | null = null;
  for (const entry of entries) {
    if (hiddenBelow !== null && entry.depth > hiddenBelow) continue;
    hiddenBelow = collapsed.has(entry.user.id) ? entry.depth : null;
    result.push(entry);
  }
  return result;
}

export function networkDescendantIds<T extends User>(entries: NetworkEntry<T>[], id: string) {
  const index = entries.findIndex((entry) => entry.user.id === id);
  const result = new Set<string>([id]);
  if (index < 0) return result;
  for (let i = index + 1; i < entries.length && entries[i].depth > entries[index].depth; i++) result.add(entries[i].user.id);
  return result;
}

// From the top of the visible structure down to the person's direct leader.
export function networkAncestors<T extends User>(byId: ReadonlyMap<string, T>, user: T): T[] {
  const chain: T[] = [];
  const seen = new Set([user.id]);
  for (let parent = user.parentUserId ? byId.get(user.parentUserId) : undefined; parent && !seen.has(parent.id); parent = parent.parentUserId ? byId.get(parent.parentUserId) : undefined) {
    seen.add(parent.id);
    chain.unshift(parent);
  }
  return chain;
}

export function isNewMember(user: User, now = Date.now()) {
  const joined = Date.parse(user.teamJoinedAt || user.createdAt);
  return user.role === "member" && Number.isFinite(joined) && now - joined < NEW_MEMBER_DAYS * DAY;
}

// Undefined when the viewer has no access to activity or the person is not a participant.
export function networkActivity(user: NetworkMember, now = Date.now()): NetworkActivity | undefined {
  if (user.role !== "member" || user.recentSubmissions === undefined) return undefined;
  const last = user.lastSubmittedAt ? Date.parse(user.lastSubmittedAt) : NaN;
  if (!Number.isFinite(last)) return "inactive";
  return now - last <= QUIET_AFTER_DAYS * DAY ? "active" : "quiet";
}
