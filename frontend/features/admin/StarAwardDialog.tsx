"use client";

import { useId, useState } from "react";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import { STAR_AWARD_OPTIONS, starAwardOption, type StarAwardKind } from "@/shared/domain/star-awards";
import styles from "./StarAwardDialog.module.css";

export function StarAwardDialog({ name, total, busy, error, onClose, onAward }: {
  name: string; total: number; busy: boolean; error: string;
  onClose: () => void;
  onAward: (kind: StarAwardKind, comment: string) => void;
}) {
  const [kind, setKind] = useState<StarAwardKind>("starter");
  const [comment, setComment] = useState("");
  const groupName = useId();
  const selected = starAwardOption(kind)!;
  return <ModalSheet title="Наградить участника" onClose={onClose}>
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (!busy) onAward(kind, comment.trim()); }}>
      <div className={styles.recipient}><span className={styles.emblem} aria-hidden="true">★</span><div><strong>{name}</strong><span>Сейчас: {total} ★</span></div></div>
      <fieldset className={styles.options} disabled={busy}>
        <legend>Выберите награду</legend>
        <div className={styles.grid}>{STAR_AWARD_OPTIONS.map((option) => <label className={styles.option} key={option.kind}>
          <input type="radio" name={groupName} value={option.kind} checked={kind === option.kind} onChange={() => setKind(option.kind)} />
          <span className={styles.optionFace}>
            <span className={styles.stars} aria-hidden="true">{"★".repeat(option.stars)}</span>
            <strong>{option.label}</strong><span className={styles.count}>+{option.stars} {option.stars === 1 ? "звезда" : "звезды"}</span>
            <span className={styles.check} aria-hidden="true">✓</span>
          </span>
        </label>)}</div>
      </fieldset>
      <div className={styles.result} aria-live="polite"><span>После награждения</span><strong>{total} + {selected.stars} = {total + selected.stars} ★</strong></div>
      <label className={styles.comment}>Комментарий <span>необязательно</span>
        <textarea value={comment} disabled={busy} onChange={(event) => setComment(event.target.value)} maxLength={500} rows={3} placeholder="За что награждаем участника?" />
      </label>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.cancel} disabled={busy} onClick={onClose}>Отмена</button>
        <button type="submit" className={styles.submit} disabled={busy}>{busy ? "Сохраняем…" : `Выдать ${selected.label} · +${selected.stars} ★`}</button>
      </div>
    </form>
  </ModalSheet>;
}
