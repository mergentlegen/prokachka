import type { ReactNode } from "react";

type ConfirmModalProps = {
  title: string;
  description: ReactNode;
  eyebrow?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmModal({
  title,
  description,
  eyebrow = "Подтверждение действия",
  confirmLabel = "Удалить",
  cancelLabel = "Отмена",
  busy = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  function close() {
    if (!busy) onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
      <div className="editor-modal admin-form-modal danger-modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={close} aria-label="Закрыть">×</button>
        <span className="confirm-modal-icon" aria-hidden="true">!</span>
        <p className="eyebrow eyebrow-danger">{eyebrow}</p>
        <h2 id="confirm-modal-title">{title}</h2>
        <p className="modal-description">{description}</p>
        <div className="modal-actions">
          <button type="button" className="button button-muted" onClick={close} disabled={busy}>{cancelLabel}</button>
          <button type="button" className="button button-danger" onClick={onConfirm} disabled={busy}>{busy ? "Удаляем..." : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
