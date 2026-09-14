"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import styles from "./MobileDrawer.module.css";

export function MobileDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const media = window.matchMedia("(max-width: 850px)");
    if (!media.matches) { onClose(); return; }
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    const onResize = () => { if (!media.matches) onClose(); };
    media.addEventListener("change", onResize);
    return () => {
      media.removeEventListener("change", onResize);
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  return <dialog ref={dialogRef} id="mentor-mobile-menu" className={styles.drawer} aria-labelledby="mentor-menu-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <div className={styles.heading}><div><p className="eyebrow">Управление</p><strong id="mentor-menu-title">Панель наставника</strong></div><button type="button" className={styles.close} onClick={onClose} aria-label="Закрыть меню">×</button></div>
    {children}
  </dialog>;
}
