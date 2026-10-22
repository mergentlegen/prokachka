// Levels: 300 XP («Опыт», formerly «Звёздный курс») moves a participant up (1 → 2 → 3). Each level has its own tasks, miles, stars and rating;
// lower levels stay open as a read-only archive.
export const MAX_LEVEL = 3;
export type Level = 1 | 2 | 3;
export const LEVELS: readonly Level[] = [1, 2, 3];

export function parseLevel(value: unknown): Level | null {
  const level = Number(value);
  return level === 1 || level === 2 || level === 3 ? level : null;
}

/** Who the level is for: «Игрок», «Капитан», then just the number until level 3 gets its name. */
export function levelTitle(level: number) {
  return level === 2 ? "Капитан" : level === 3 ? "Уровень 3" : "Игрок";
}

export function levelLabel(level: number) {
  return level === 3 ? "Уровень 3" : `Уровень ${level} · ${levelTitle(level)}`;
}

/** The congratulation shown once after moving up. */
export function levelUpMessage(level: number) {
  if (level === 2) return { title: "Ты на безоплатном членстве", text: "Теперь ты не только игрок — ты капитан своей команды", action: "Посмотреть мою команду" };
  return { title: `Ты на уровне ${level}!`, text: "Новый уровень открыт: новые задания, новые мили и новый рейтинг", action: "Посмотреть мою команду" };
}

/** Profile badges earned by moving up: «Капитан» for level 2, then level 3. */
export function levelBadges(level: number) {
  return [
    ...(level >= 2 ? [{ key: "captain", icon: "⚓", title: "Капитан", note: "за 300 XP на уровне 1" }] : []),
    ...(level >= 3 ? [{ key: "level-3", icon: "★", title: "Уровень 3", note: "за 300 XP на уровне 2" }] : []),
  ];
}
