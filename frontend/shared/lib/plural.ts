// Russian plural form for a count: plural(1, "звезда", "звезды", "звёзд") → "звезда".
export function plural(value: number, one: string, few: string, many: string) {
  const lastTwo = Math.abs(value) % 100, last = Math.abs(value) % 10;
  return lastTwo >= 11 && lastTwo <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}
