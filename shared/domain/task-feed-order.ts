import { comparePublications } from "./publication-order";
import type { Task } from "./types";

export type TaskOrderItem = { key: string; taskId: string; title: string; kind: string | null; isPinned: boolean; pinnedAt: string | null; createdAt: string; maxPoints: number; authorName: string | null };
export type TaskOrderSnapshot = { items: TaskOrderItem[]; revision: string; scope: "team" | "branch"; customized: boolean };

export function compareTaskFeed(a: Task, b: Task) {
  const pinned = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
  if (pinned) return pinned;
  if (a.feedOrder !== undefined || b.feedOrder !== undefined) {
    const order = (a.feedOrder ?? Number.MAX_SAFE_INTEGER) - (b.feedOrder ?? Number.MAX_SAFE_INTEGER);
    if (order) return order;
  }
  return comparePublications(a, b);
}

export function moveTaskOrder(items: TaskOrderItem[], key: string, targetKey: string) {
  const from = items.findIndex((item) => item.key === key), to = items.findIndex((item) => item.key === targetKey);
  if (from < 0 || to < 0 || from === to || items[from].isPinned !== items[to].isPinned) return items;
  const next = [...items]; next.splice(to, 0, ...next.splice(from, 1)); return next;
}
