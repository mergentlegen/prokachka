"use client";

import type { CSSProperties, ReactNode } from "react";
import styles from "./Drawer.module.css";

// A smooth fold: the content slides open to its own height and back. It stays in the page while closed
// (so closing can animate too) but cannot be reached by keyboard or screen readers until it opens.
export function Drawer({ open, id, className = "", children }: { open: boolean; id?: string; className?: string; children: ReactNode }) {
  return <div id={id} className={`${styles.drawer} ${open ? styles.open : ""}`} inert={!open} aria-hidden={!open}>
    <div className={`${styles.inner} ${className}`}>{children}</div>
  </div>;
}

/** Steps inside an open drawer appear one after another; pass the step's place in the list. */
export const staggerStyle = (index: number) => ({ "--stagger": Math.min(index, 12) } as CSSProperties);
