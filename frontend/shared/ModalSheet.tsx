"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import styles from "./ModalSheet.module.css";

type ModalSheetProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  variant?: "default" | "immersive";
};

export function ModalSheet({ title, children, onClose, variant = "default" }: ModalSheetProps) {
  const panel = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const immersive = variant === "immersive";
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    body.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    closeButton.current?.focus({ preventScroll: true });
    return () => { document.body.style.overflow = overflow; if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, []);
  return <div className={`${styles.backdrop} ${immersive ? styles.immersiveBackdrop : ""}`} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} className={`${styles.panel} ${immersive ? styles.immersivePanel : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href], textarea:not(:disabled), select:not(:disabled), summary, [tabindex='0']") || []).filter((item) => item.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header className={`${styles.header} ${immersive ? styles.immersiveHeader : ""}`}><h2 id={titleId}>{title}</h2><button ref={closeButton} type="button" onClick={onClose} aria-label="Закрыть окно">Закрыть <span aria-hidden="true">×</span></button></header>
      <div ref={body} data-modal-scroll className={`${styles.body} ${immersive ? styles.immersiveBody : ""}`}>{children}</div>
    </section>
  </div>;
}
