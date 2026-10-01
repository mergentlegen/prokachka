"use client";

import { useState } from "react";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import styles from "./ReviewTemplatesEditor.module.css";

const LIMIT = 12, MAX_LENGTH = 300;

// The team leader edits the shared comments every reviewer of the team sees in the review window.
export function ReviewTemplatesEditor({ initial, onSave, onClose }: { initial: string[]; onSave: (templates: string[]) => Promise<boolean>; onClose: () => void }) {
  const [rows, setRows] = useState(() => initial.length ? initial : [""]);
  const [busy, setBusy] = useState(false);
  const update = (index: number, value: string) => setRows((current) => current.map((row, position) => position === index ? value : row));

  async function save() {
    setBusy(true);
    const saved = await onSave(rows.map((row) => row.trim()).filter(Boolean));
    setBusy(false);
    if (saved) onClose();
  }

  return <ModalSheet title="Готовые комментарии" onClose={() => { if (!busy) onClose(); }}>
    <div className={styles.editor}>
      <p className={styles.intro}>Эти фразы видят все проверяющие вашей команды и вставляют в комментарий одним нажатием.</p>
      <ol className={styles.rows}>
        {rows.map((row, index) => <li key={index}>
          <textarea rows={2} maxLength={MAX_LENGTH} value={row} placeholder="Например: «Отличная работа, так держать!»" aria-label={`Комментарий ${index + 1}`} onChange={(event) => update(index, event.target.value)} />
          <button type="button" aria-label={`Удалить комментарий ${index + 1}`} onClick={() => setRows((current) => current.length > 1 ? current.filter((_, position) => position !== index) : [""])}>×</button>
        </li>)}
      </ol>
      {rows.length < LIMIT && <button type="button" className={styles.add} onClick={() => setRows((current) => [...current, ""])}>+ Добавить комментарий</button>}
      <div className={styles.actions}>
        <button type="button" className="button button-muted" disabled={busy} onClick={onClose}>Отмена</button>
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void save()}>{busy ? "Сохраняем..." : "Сохранить"}</button>
      </div>
    </div>
  </ModalSheet>;
}
