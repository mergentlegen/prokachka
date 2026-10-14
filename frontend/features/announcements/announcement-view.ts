import type { Announcement } from "@/shared/domain/types";
import { comparePublications } from "@/shared/domain/publication-order";

const DAY = 24 * 60 * 60 * 1000;
/** Announcements older than this never count as new, so a newcomer does not get a whole month of "new" at once. */
export const FRESH_DAYS = 14;
/** How many latest announcements the home screen shows below the pinned ones. */
export const HOME_LATEST = 3;

/** Pinned first, in the order they were pinned; the rest newest first. */
export function sortAnnouncements(announcements: readonly Announcement[]) {
  return [...announcements].sort((a, b) => {
    if (a.isPinned || b.isPinned) return comparePublications(a, b);
    return Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id);
  });
}

/** The home screen: every pinned announcement plus the latest few. */
export function homeAnnouncements(sorted: readonly Announcement[], latest = HOME_LATEST) {
  let shown = 0;
  return sorted.filter((announcement) => announcement.isPinned || shown++ < latest);
}

export function searchAnnouncements(sorted: readonly Announcement[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...sorted];
  return sorted.filter((announcement) => {
    const text = (announcement.title + " " + announcement.content + " " + (announcement.authorName || "")).toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const dayMonth = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
const dayMonthYear = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" });

/** "сегодня в 9:30", "вчера в 21:00", "12 окт., 21:00"; another year also shows the year. */
export function friendlyTime(iso: string, now = Date.now()) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const day = new Date(date); day.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / DAY);
  if (days === 0) return "сегодня в " + time.format(date);
  if (days === 1) return "вчера в " + time.format(date);
  if (date.getFullYear() !== new Date(now).getFullYear()) return dayMonthYear.format(date);
  return dayMonth.format(date) + ", " + time.format(date);
}

export function isFresh(announcement: Announcement, now = Date.now()) {
  const created = Date.parse(announcement.createdAt);
  return Number.isFinite(created) && now - created < FRESH_DAYS * DAY;
}

// What the participant has already seen lives on their device: no database, nothing to sync.
const storageKey = (userId: string) => "prokachka-announcements-seen:" + userId;
const KEEP = 400;

export function readSeen(userId: string): Set<string> {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(storageKey(userId));
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch { return new Set(); }
}

export function markSeen(userId: string, ids: readonly string[]) {
  if (!ids.length) return;
  try {
    const seen = [...readSeen(userId)].filter((id) => !ids.includes(id));
    window.localStorage.setItem(storageKey(userId), JSON.stringify([...seen, ...ids].slice(-KEEP)));
  } catch { /* private mode or full storage: the marks simply stay */ }
}

export type TextPart = { kind: "text"; text: string } | { kind: "url"; text: string; href: string } | { kind: "phone"; text: string; href: string };

// Web addresses (with http(s):// or www.) and phone numbers: +7 / 8 and ten digits in any common spacing, or any +country number.
const pattern = /(https?:\/\/[^\s<>"«»]+|www\.[^\s<>"«»]+)|((?:\+7|\b8)[\s\-(]*\d{3}[\s\-)]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b|\+[1-9](?:[\s-]?\d){9,13}\b)/g;

/** Splits announcement text so addresses open and phone numbers call. Trailing punctuation stays text. */
export function textParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    let found = match[0];
    const start = match.index ?? 0;
    if (match[1]) found = found.replace(/[.,;:!?)\]»"']+$/, "");
    if (start > last) parts.push({ kind: "text", text: text.slice(last, start) });
    if (match[1]) parts.push({ kind: "url", text: found, href: found.startsWith("www.") ? "https://" + found : found });
    else parts.push({ kind: "phone", text: found, href: "tel:" + (found.startsWith("8") ? "+7" + found.replace(/\D/g, "").slice(1) : "+" + found.replace(/\D/g, "")) });
    last = start + found.length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts.length ? parts : [{ kind: "text", text }];
}
