import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./AuthScreen.module.css";

/** `homeHref` adds a «На главную» link above the logo (the member app passes the landing page). */
export function AuthLayout({ children, homeHref }: { children: ReactNode; homeHref?: string }) {
  return <main className={styles.screen}>
    <div className={styles.panel}>
      {homeHref && <Link className={styles.home} href={homeHref}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></svg>На главную</Link>}
      <div className={styles.brand}>
        <Image src="/brand/logo-light.svg" alt="Прокачка" width={180} height={60} unoptimized />
      </div>
      <div className={styles.card}>{children}</div>
    </div>
  </main>;
}
