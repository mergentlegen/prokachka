"use client";

import { useId, type FormEvent, type ReactNode } from "react";
import { ModalSheet } from "./ModalSheet";

type Tone = "primary" | "success" | "warning" | "danger";

// One look for every create/edit form: fields scroll, Cancel and Save stay pinned at the bottom.
export function FormSheet({ title, intro, busy = false, submitLabel, busyLabel = "Сохраняем…", tone = "primary", submitDisabled = false, cancelLabel = "Отмена", onSubmit, onClose, children }: {
  title: string; intro?: ReactNode; busy?: boolean; submitLabel: string; busyLabel?: string; tone?: Tone; submitDisabled?: boolean; cancelLabel?: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void; children: ReactNode;
}) {
  const formId = useId();
  const close = () => { if (!busy) onClose(); };
  return <ModalSheet title={title} tall onClose={close} footer={<>
    <button type="button" className="button button-muted" disabled={busy} onClick={close}>{cancelLabel}</button>
    <button type="submit" form={formId} className={`button button-${tone}`} disabled={busy || submitDisabled}>{busy ? busyLabel : submitLabel}</button>
  </>}>
    <form id={formId} className="form-sheet" onSubmit={(event) => { event.preventDefault(); if (!busy) onSubmit(event); }}>
      {intro && <p className="form-sheet-intro">{intro}</p>}
      {children}
    </form>
  </ModalSheet>;
}
