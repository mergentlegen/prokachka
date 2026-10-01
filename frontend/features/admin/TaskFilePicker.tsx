"use client";

import { useState } from "react";
import type { TaskAttachment } from "@/shared/domain/types";
import { taskAttachmentUrl } from "@/frontend/shared/api/client";
import { FileDropZone } from "@/frontend/shared/FileDropZone";
import styles from "./TaskFilePicker.module.css";

const maxSize = 15 * 1024 * 1024;
export function TaskFilePicker({ taskId, attachments, files, disabled, onFilesChange, onRemove }: { taskId?: string; attachments: TaskAttachment[]; files: File[]; disabled: boolean; onFilesChange: (files: File[]) => void; onRemove: (attachment: TaskAttachment) => void }) {
  const [warning, setWarning] = useState("");
  function select(list: FileList | null) {
    if (!list) return;
    const incoming = [...list];
    const valid = incoming.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    const oversized = valid.some((file) => file.size > maxSize);
    if (valid.length !== incoming.length || oversized) setWarning("Прикрепляйте только PDF-файлы размером не больше 15 МБ.");
    else setWarning("");
    const withinLimit = valid.filter((file) => file.size <= maxSize);
    const next = [...files];
    for (const file of withinLimit) if (!next.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) next.push(file);
    if (attachments.length + next.length > 10) { setWarning("К одному заданию можно прикрепить не больше 10 PDF-файлов."); return; }
    onFilesChange(next);
  }
  const full = attachments.length + files.length >= 10;
  return <section className={styles.section}>
    <div className={styles.heading}><strong>PDF-материалы <span>необязательно</span></strong><small>{attachments.length + files.length} / 10</small></div>
    <FileDropZone accept="application/pdf,.pdf" disabled={disabled || full} onFiles={select}
      title={full ? "Прикреплено максимум файлов" : "Прикрепить PDF"} hint="Нажмите или перетащите сюда · до 15 МБ каждый" />
    {warning && <p className={styles.warning} role="alert">{warning}</p>}
    {(attachments.length > 0 || files.length > 0) && <ul className={styles.files}>
      {attachments.map((file) => <li key={file.id}><span><b>PDF</b><span><strong>{file.fileName}</strong><small>{(file.sizeBytes / 1048576).toFixed(1)} МБ · загружен</small></span></span>{taskId && <a className={styles.open} href={taskAttachmentUrl(taskId, file)} target="_blank" rel="noopener" aria-label={`Открыть ${file.fileName}`}>Открыть</a>}<button type="button" disabled={disabled} onClick={() => onRemove(file)} aria-label={`Удалить ${file.fileName}`}>×</button></li>)}
      {files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}><span><b>PDF</b><span><strong>{file.name}</strong><small>{(file.size / 1048576).toFixed(1)} МБ · загрузится при сохранении</small></span></span><button type="button" disabled={disabled} onClick={() => onFilesChange(files.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Убрать ${file.name}`}>×</button></li>)}
    </ul>}
  </section>;
}
