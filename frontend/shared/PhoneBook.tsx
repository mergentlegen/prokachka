"use client";

import { createContext, useContext, type ReactNode } from "react";
import { formatPhone, whatsappLink } from "@/shared/domain/phone";
import styles from "./PhoneBook.module.css";

// Phones of the participants this mentor may see (the server decides who). Empty everywhere else.
const PhoneBookContext = createContext<Record<string, string>>({});

export function PhoneBookProvider({ phones, children }: { phones: Record<string, string>; children: ReactNode }) {
  return <PhoneBookContext.Provider value={phones}>{children}</PhoneBookContext.Provider>;
}

export function usePhone(userId: string | undefined) {
  const phones = useContext(PhoneBookContext);
  return userId ? phones[userId] : undefined;
}

/** The number with «Позвонить» and «WhatsApp»; nothing when there is no number or the viewer may not see it. */
export function PhoneLinks({ userId, compact = false }: { userId: string | undefined; compact?: boolean }) {
  const phone = usePhone(userId);
  if (!phone) return null;
  return <span className={`${styles.phone} ${compact ? styles.compact : ""}`}>
    {!compact && <span className={styles.number}>{formatPhone(phone)}</span>}
    <a className={styles.link} href={`tel:${phone}`} aria-label={`Позвонить ${formatPhone(phone)}`}>📞 {compact ? formatPhone(phone) : "Позвонить"}</a>
    <a className={styles.link} href={whatsappLink(phone)} target="_blank" rel="noopener noreferrer" aria-label={`Написать в WhatsApp ${formatPhone(phone)}`}>WhatsApp</a>
  </span>;
}
