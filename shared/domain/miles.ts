// PostgreSQL stores task and review miles as signed 32-bit integers.
// There is no product-level 100-mile limit; this is the storage type's bound.
export const MAX_MILES = 2_147_483_647;

export function validMiles(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_MILES;
}

export function milesUnit(value: number) {
  const absolute = Math.abs(Math.trunc(value));
  const lastTwo = absolute % 100;
  const last = absolute % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "миль";
  if (last === 1) return "миля";
  if (last >= 2 && last <= 4) return "мили";
  return "миль";
}
