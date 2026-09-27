import Image from "next/image";
import type { ReactNode } from "react";
import styles from "./AuthScreen.module.css";

export function AuthLayout({ children }: { children: ReactNode }) {
  return <main className={styles.screen}>
    <div className={styles.panel}>
      <div className={styles.brand}>
        <Image src="/brand/logo-light.svg" alt="Прокачка" width={180} height={60} unoptimized />
      </div>
      <div className={styles.card}>{children}</div>
    </div>
  </main>;
}
