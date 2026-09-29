// PostgreSQL stores task and review miles as signed 32-bit integers.
// There is no product-level 100-mile limit; this is the storage type's bound.
export const MAX_MILES = 2_147_483_647;

export function validMiles(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_MILES;
}
