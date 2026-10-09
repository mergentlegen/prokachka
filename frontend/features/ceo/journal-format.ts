import type { CeoJournalEntry } from "@/frontend/shared/api/ceo-client";
import { plural } from "@/frontend/shared/lib/plural";

export type JournalFilter = "all" | "people" | "teams" | "content" | "stars" | "messages";
export type JournalTone = "good" | "danger" | "neutral";

const roleNames: Record<string, string> = { ceo: "CEO", admin: "Наставник", member: "Участник" };
const titles: Record<string, string> = {
  "user.access": "Изменён доступ", "user.delete": "Удалён пользователь", "user.network": "Изменены права в сети",
  "team.create": "Создана команда", "team.update": "Изменена команда", "team.disable": "Команда отключена", "team.enable": "Команда включена", "team.delete": "Удалена команда",
  "request.approve": "Заявка одобрена", "request.reject": "Заявка отклонена",
  "task.create": "Опубликовано задание", "task.delete": "Удалено задание", "task.nudge": "Напоминание по заданию", "task.video": "Загружено видео к заданию", "task.reward": "Изменена награда за задание",
  "program.create": "Опубликована программа", "program.delete": "Удалена программа",
  "announcement.create": "Опубликовано объявление", "announcement.delete": "Удалено объявление",
  "star.award": "Выданы звёзды", "star.revoke": "Отменена выдача звёзд",
};

export function roleName(role: string) { return roleNames[role] || role; }

/** Telegram mailings: task reminders and announcements sent to the bot. */
function isMessage(entry: CeoJournalEntry) {
  return entry.action === "task.nudge" || (entry.action === "announcement.create" && entry.details.telegram !== undefined);
}

export function journalCategory(entry: CeoJournalEntry): Exclude<JournalFilter, "all"> {
  if (isMessage(entry)) return "messages";
  const [scope] = entry.action.split(".");
  if (scope === "team") return "teams";
  if (scope === "user" || scope === "request") return "people";
  if (scope === "star") return "stars";
  return "content";
}

export function journalTone(action: string): JournalTone {
  if (/\.(delete|revoke|reject|disable)$/.test(action)) return "danger";
  if (/\.(create|approve|award|enable)$/.test(action)) return "good";
  return "neutral";
}

const pair = (value: unknown, empty: string) => {
  const [from, to] = Array.isArray(value) ? value : [];
  return `${from ? String(from) : empty} → ${to ? String(to) : empty}`;
};

/** Plain-language lines under the title: what exactly changed. */
export function journalDetails(entry: CeoJournalEntry): string[] {
  const d = entry.details;
  const lines: string[] = [];
  if (Array.isArray(d.role)) lines.push("Роль: " + (d.role as string[]).map(roleName).join(" → "));
  if (Array.isArray(d.team)) lines.push("Команда: " + pair(d.team, "без команды"));
  if (typeof d.canReview === "boolean") lines.push("Проверка работ: " + (d.canReview ? "разрешена" : "запрещена"));
  if (typeof d.canPublishTasks === "boolean") lines.push("Публикация заданий: " + (d.canPublishTasks ? "разрешена" : "запрещена"));
  if (Array.isArray(d.parent)) lines.push("Наставник: " + pair(d.parent, "нет"));
  if (Array.isArray(d.name)) lines.push("Название: " + pair(d.name, "—"));
  if (typeof d.miles === "number" && entry.action === "task.create") lines.push(d.programStep ? `Шаг программы · ${d.miles} ${plural(d.miles, "миля", "мили", "миль")}` : `${d.miles} ${plural(d.miles, "миля", "мили", "миль")}`);
  if (Array.isArray(d.reward)) { const [from, to] = (d.reward as unknown[]).map(Number); lines.push(`Награда: ${from} → ${to} ${plural(to, "миля", "мили", "миль")}`); }
  if (typeof d.recounted === "number") lines.push(`Пересчитано у ${d.recounted} ${plural(d.recounted, "участника", "участников", "участников")}, прошедших задание`);
  if (typeof d.steps === "number") lines.push(`${d.steps} ${plural(d.steps, "шаг", "шага", "шагов")}`);
  if (typeof d.stars === "number") lines.push(`${entry.action === "star.revoke" ? "−" : "+"}${d.stars} ★${typeof d.kind === "string" ? " · " + d.kind[0].toUpperCase() + d.kind.slice(1) : ""}`);
  if (typeof d.recipients === "number") lines.push(`В Telegram: ${d.recipients} ${plural(d.recipients, "участнику", "участникам", "участникам")}`);
  if (typeof d.telegram === "number") lines.push(d.telegram < 0 ? "В Telegram отправить не удалось" : `В Telegram: ${d.telegram} ${plural(d.telegram, "участнику", "участникам", "участникам")}`);
  return lines;
}

export function describeJournalEntry(entry: CeoJournalEntry) {
  return { title: titles[entry.action] || entry.action, target: entry.targetLabel || "", lines: journalDetails(entry), tone: journalTone(entry.action), category: journalCategory(entry) };
}

export function filterJournal(entries: CeoJournalEntry[], { query, filter, teamId }: { query: string; filter: JournalFilter; teamId: string }) {
  const search = query.trim().toLocaleLowerCase("ru");
  return entries.filter((entry) => {
    if (filter !== "all" && journalCategory(entry) !== filter) return false;
    if (teamId && entry.teamId !== teamId) return false;
    if (!search) return true;
    return [entry.actorName, entry.targetLabel, entry.teamLabel, titles[entry.action], ...journalDetails(entry)].join(" ").toLocaleLowerCase("ru").includes(search);
  });
}

const dayFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Asia/Almaty" });
const yearFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Almaty" });
const keyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" });
export const journalTime = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" });
const shortDay = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Asia/Almaty" });

/** Time for a row: just «14:20» inside a day group, «вчера, 14:20» or «2 окт.» on the overview. */
export function journalMoment(iso: string, withDay: boolean, now = Date.now()) {
  const date = new Date(iso);
  if (!withDay) return journalTime.format(date);
  const key = keyFormat.format(date);
  if (key === keyFormat.format(new Date(now))) return journalTime.format(date);
  if (key === keyFormat.format(new Date(now - 86_400_000))) return "вчера, " + journalTime.format(date);
  return shortDay.format(date);
}

/** Groups entries by Almaty day: «Сегодня», «Вчера», then dates. */
export function groupJournalByDay(entries: CeoJournalEntry[], now = Date.now()) {
  const today = keyFormat.format(new Date(now));
  const yesterday = keyFormat.format(new Date(now - 86_400_000));
  const thisYear = new Date(now).getFullYear();
  const groups: Array<{ key: string; label: string; entries: CeoJournalEntry[] }> = [];
  for (const entry of entries) {
    const date = new Date(entry.createdAt);
    const key = keyFormat.format(date);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      const label = key === today ? "Сегодня" : key === yesterday ? "Вчера" : date.getFullYear() === thisYear ? dayFormat.format(date) : yearFormat.format(date);
      group = { key, label, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}
