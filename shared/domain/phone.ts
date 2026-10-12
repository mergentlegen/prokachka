// A phone typed any usual way ("8 701 234-56-78", "+7 (701) 234 56 78") is kept as +77012345678.
export const PHONE_HINT = "Например, +7 701 234 56 78";

export function normalizePhone(value: unknown): { phone: string | null } | { error: string } {
  if (value === null || value === undefined) return { phone: null };
  if (typeof value !== "string" || value.length > 40) return { error: "Проверьте номер телефона." };
  const text = value.trim();
  if (!text) return { phone: null };
  if (/[^\d\s()+\-.]/.test(text) || text.indexOf("+") > 0) return { error: "В номере могут быть только цифры, пробелы, скобки, дефисы и «+» в начале." };
  const digits = text.replace(/\D/g, "");
  const phone = text.startsWith("+") ? "+" + digits
    : digits.length === 11 && digits.startsWith("8") ? "+7" + digits.slice(1)
    : digits.length === 11 && digits.startsWith("7") ? "+" + digits
    : digits.length === 10 ? "+7" + digits
    : "";
  return /^\+\d{10,15}$/.test(phone) ? { phone } : { error: "Проверьте номер телефона. " + PHONE_HINT + "." };
}

/** +77012345678 → +7 701 234 56 78; other countries are shown as stored. */
export function formatPhone(phone: string) {
  const match = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return match ? `+7 ${match[1]} ${match[2]} ${match[3]} ${match[4]}` : phone;
}

/** A link that opens a WhatsApp chat with this number. */
export function whatsappLink(phone: string) { return "https://wa.me/" + phone.replace(/\D/g, ""); }
