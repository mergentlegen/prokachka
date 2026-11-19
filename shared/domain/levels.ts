// Levels: 100 miles move a participant from level 1 to level 2 (Капитан) automatically; level 3 is given by a mentor.
// Each level has its own tasks; lower levels stay open as a read-only archive.
export const MAX_LEVEL = 3;
/** Miles on level 1 that move a participant to level 2 (the same number in app_check_member_level). */
export const LEVEL_UP_MILES = 100;
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
  const note = "Задания нового уровня уже открыты на сайте. Прошлые задания остались в архиве, их можно пересмотреть в любой момент.";
  if (level === 2) return { title: "🎉 Ты на уровне 2!", note, action: "Посмотреть мою команду", lines: [
    "Теперь ты партнёр inCruises — не только путешественник, но и предприниматель.",
    "Твоя цель на этом уровне — безоплатное членство: твой клуб будет оплачиваться за счёт твоей команды.",
  ] };
  return { title: `🎉 Ты на уровне ${level}!`, note, action: "Посмотреть мою команду", lines: ["Новый уровень открыт: новые задания."] };
}

/** Profile badges earned by moving up: «Капитан» for level 2, then level 3. */
export function levelBadges(level: number) {
  return [
    ...(level >= 2 ? [{ key: "captain", icon: "⚓", title: "Капитан", note: `за ${LEVEL_UP_MILES} миль на уровне 1` }] : []),
    ...(level >= 3 ? [{ key: "level-3", icon: "★", title: "Уровень 3", note: "за переход на уровень 3" }] : []),
  ];
}

/** What waits on level 2 for a player: program names with their steps and how many separate tasks and games. */
/** From level 2 on a level has programs only: no separate tasks, no ready games, no «Задания» tab for participants. */
export function levelHasOnlyPrograms(level: number | null | undefined) {
  return Number(level) > 1;
}

export type LevelPreview = { level: number; programs: { title: string; steps: number }[] };

const count = (value: number, one: string, few: string, many: string) => {
  const tens = value % 100, units = value % 10;
  return `${value} ${tens > 10 && tens < 20 ? many : units === 1 ? one : units >= 2 && units <= 4 ? few : many}`;
};

/** «программа «Х» · 6 шагов и ещё 2 программы» — names and numbers only; the content opens with the level. */
export function levelPreviewText(preview: LevelPreview | null | undefined) {
  if (!preview) return "";
  const [first, ...others] = preview.programs;
  const parts = [
    ...(first ? [`программа «${first.title}» · ${count(first.steps, "шаг", "шага", "шагов")}`] : []),
    ...(others.length ? [`ещё ${count(others.length, "программа", "программы", "программ")}`] : []),
  ];
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} и ${parts[parts.length - 1]}` : parts[0] || "";
}
