export const STAR_AWARD_OPTIONS = [
  { kind: "starter", label: "Starter", stars: 1 },
  { kind: "classic", label: "Classic", stars: 2 },
  { kind: "premium", label: "Premium", stars: 5 },
] as const;

export type StarAwardKind = typeof STAR_AWARD_OPTIONS[number]["kind"];

export function starAwardOption(kind: unknown) {
  return STAR_AWARD_OPTIONS.find((option) => option.kind === kind);
}
