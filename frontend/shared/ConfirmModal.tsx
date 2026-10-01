"use client";

import type { ReactNode } from "react";
import { ModalSheet } from "./ModalSheet";

type ConfirmModalProps = {
  title: string;
  description: ReactNode;
  eyebrow?: string;
  confirmLabel?: string;
  busyLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

// One confirmation look for every dangerous action: what happens, and a clearly red button.
export function ConfirmModal({
  title,
  description,
  eyebrow = "Подтверждение действия",
  confirmLabel = "Удалить",
  busyLabel = "Удаляем…",
  cancelLabel = "Отмена",
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const close = () => { if (!busy) onClose(); };
  return <ModalSheet title={title} onClose={close} footer={<>
    <button type="button" className="button button-muted" onClick={close} disabled={busy}>{cancelLabel}</button>
    <button type="button" className="button button-danger" onClick={onConfirm} disabled={busy || confirmDisabled}>{busy ? busyLabel : confirmLabel}</button>
  </>}>
    <div className="confirm-sheet">
      <span className="confirm-sheet-icon" aria-hidden="true">!</span>
      <div><p className="eyebrow eyebrow-danger">{eyebrow}</p><p className="confirm-sheet-text">{description}</p></div>
    </div>
  </ModalSheet>;
}
