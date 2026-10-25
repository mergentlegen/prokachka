// Unsent editor content is kept in this browser, so closing a long form by mistake loses nothing.
// Files and videos cannot be kept: only their names are, to remind the mentor to pick them again.

export function readDraft<T>(key: string): T | null {
  try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; }
  catch { return null; }
}
export function writeDraft(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* full or blocked storage: the form still works */ }
}
export function clearDraft(key: string) {
  try { window.localStorage.removeItem(key); } catch { /* nothing to clear */ }
}

/** «сегодня в 14:05», «вчера в 09:30», «23 окт. в 18:00». */
export function savedAtText(iso: string, now = Date.now()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const day = (value: number) => new Date(value).toDateString();
  if (day(date.getTime()) === day(now)) return `сегодня в ${time}`;
  if (day(date.getTime()) === day(now - 86_400_000)) return `вчера в ${time}`;
  return `${date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })} в ${time}`;
}

export const taskDraftKey = (userId: string) => `prokachka-task-draft:${userId}`;
export const programDraftKey = (userId: string) => `prokachka-program-draft:${userId}`;
