// Popular mailboxes in Kazakhstan and Russia; a near miss of one of them is almost always a typo.
const knownDomains = ["gmail.com", "mail.ru", "yandex.ru", "yandex.kz", "ya.ru", "inbox.ru", "list.ru", "bk.ru", "icloud.com", "outlook.com", "hotmail.com", "yahoo.com", "rambler.ru", "internet.ru", "mail.kz", "yandex.com", "live.com", "me.com", "proton.me"];

function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

/** "anna@gmail.con" → "anna@gmail.com"; null when the address looks fine or is unknown. */
export function suggestEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  const domain = email.slice(at + 1);
  if (knownDomains.includes(domain)) return null;
  let best: { domain: string; score: number } | null = null;
  for (const known of knownDomains) {
    const score = distance(domain, known);
    // Short domains (bk.ru, ya.ru) are close to many real ones, so they allow only one slip.
    const allowed = known.length <= 6 ? 1 : 2;
    if (score <= allowed && (!best || score < best.score)) best = { domain: known, score };
  }
  return best ? email.slice(0, at + 1) + best.domain : null;
}
