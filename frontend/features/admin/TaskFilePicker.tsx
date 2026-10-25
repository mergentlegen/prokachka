"use client";

import type { TaskAttachment } from "@/shared/domain/types";
import { taskAttachmentUrl } from "@/frontend/shared/api/client";
import styles from "./TaskFilePicker.module.css";

const maxSize = 15 * 1024 * 1024;
export const MAX_TASK_PDFS = 10;

/** Adds picked files to the list: only PDFs up to 15 MB, no doubles, at most ten per task. */
export function addPdfFiles(list: FileList | File[], attachments: TaskAttachment[], files: File[]): { files: File[]; warning: string } {
  const incoming = [...list];
  const valid = incoming.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
  let warning = valid.length !== incoming.length || valid.some((file) => file.size > maxSize) ? "Прикрепляйте только PDF-файлы размером не больше 15 МБ." : "";
  const next = [...files];
  for (const file of valid.filter((item) => item.size <= maxSize)) if (!next.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) next.push(file);
  if (attachments.length + next.length > MAX_TASK_PDFS) return { files, warning: `К одному заданию можно прикрепить не больше ${MAX_TASK_PDFS} PDF-файлов.` };
  return { files: next, warning };
}

/** Uploaded PDFs and the ones waiting for «Сохранить», each with a way to take it off. */
export function PdfFileList({ taskId, attachments, files, disabled, onFilesChange, onRemove }: { taskId?: string; attachments: TaskAttachment[]; files: File[]; disabled: boolean; onFilesChange: (files: File[]) => void; onRemove: (attachment: TaskAttachment) => void }) {
  if (!attachments.length && !files.length) return null;
  return <ul className={styles.files} aria-label="PDF-материалы">
    {attachments.map((file) => <li key={file.id}><span><b>PDF</b><span><strong>{file.fileName}</strong><small>{(file.sizeBytes / 1048576).toFixed(1)} МБ · загружен</small></span></span>{taskId && <a className={styles.open} href={taskAttachmentUrl(taskId, file)} target="_blank" rel="noopener" aria-label={`Открыть ${file.fileName}`}>Открыть</a>}<button type="button" disabled={disabled} onClick={() => onRemove(file)} aria-label={`Удалить ${file.fileName}`}>×</button></li>)}
    {files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}><span><b>PDF</b><span><strong>{file.name}</strong><small>{(file.size / 1048576).toFixed(1)} МБ · загрузится при сохранении</small></span></span><button type="button" disabled={disabled} onClick={() => onFilesChange(files.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Убрать ${file.name}`}>×</button></li>)}
  </ul>;
}
