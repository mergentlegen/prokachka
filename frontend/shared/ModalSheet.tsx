"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import styles from "./ModalSheet.module.css";

type ModalSheetProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  variant?: "default" | "immersive";
  /** Pinned below the scrolling body, so form actions stay reachable on phones. */
  footer?: ReactNode;
  /** Taller sheet for forms with many fields. */
  tall?: boolean;
  /** A wide sheet for an editor with a preview beside it. */
  wide?: boolean;
};

/** The root of the app the sheet belongs to: its styles still apply, but no card around the opener can move the sheet. */
const SHEET_ROOT = ".member-shell, .admin-shell, .ceo-shell";

/**
 * A sheet over the whole screen. It is moved to the app's root element: a card that animates or is lifted with
 * `transform` would otherwise become the frame of the fixed sheet and squeeze it inside that card.
 */
export function ModalSheet(props: ModalSheetProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [root, setRoot] = useState<Element | null>(null);
  useLayoutEffect(() => {
    setRoot(anchor.current?.closest(SHEET_ROOT) || document.body);
  }, []);
  // Rendered on the server (and in tests) in place; in the browser always in the app root.
  if (typeof document === "undefined") return <Sheet {...props} />;
  return root ? createPortal(<Sheet {...props} />, root) : <span ref={anchor} hidden />;
}

function Sheet({ title, children, onClose, variant = "default", footer, tall = false, wide = false }: ModalSheetProps) {
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
    <section ref={panel} className={`${styles.panel} ${immersive ? styles.immersivePanel : ""} ${tall ? styles.tallPanel : ""} ${wide ? styles.widePanel : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href], textarea:not(:disabled), select:not(:disabled), summary, [tabindex='0']") || []).filter((item) => item.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header className={`${styles.header} ${immersive ? styles.immersiveHeader : ""}`}><h2 id={titleId}>{title}</h2><button ref={closeButton} type="button" onClick={onClose} aria-label="Закрыть окно">Закрыть <span aria-hidden="true">×</span></button></header>
      <div ref={body} data-modal-scroll className={`${styles.body} ${immersive ? styles.immersiveBody : ""}`}>{children}</div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </section>
  </div>;
}
