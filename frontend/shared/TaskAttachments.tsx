"use client";

import type { TaskAttachment } from "@/shared/domain/types";
import { taskAttachmentUrl } from "@/frontend/shared/api/client";
import styles from "./TaskAttachments.module.css";

function formatFileSize(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / (1024 * 1024)).toFixed(1)} МБ`; }

/** Plain links: the browser opens the PDF in its own viewer or saves it, with no JavaScript download in between. */
export function TaskAttachmentOpenButton({ taskId, file }: { taskId: string; file: TaskAttachment }) {
  return <div className={styles.actions}>
    <a href={taskAttachmentUrl(taskId, file)} target="_blank" rel="noopener" aria-label={`Открыть ${file.fileName}`}>Открыть PDF</a>
    <a href={taskAttachmentUrl(taskId, file, { download: true })} download={file.fileName} aria-label={`Скачать ${file.fileName}`}>Скачать</a>
  </div>;
}

export function TaskAttachments({ taskId, attachments }: { taskId: string; attachments?: TaskAttachment[] }) {
  if (!attachments?.length) return null;
  return <section className={styles.list} aria-label="Файлы задания">
    <h4>Материалы к заданию</h4>
    {attachments.map((file) => {
      return <article className={styles.file} key={file.id}>
        <span className={styles.icon} aria-hidden="true">PDF</span>
        <div className={styles.info}><strong title={file.fileName}>{file.fileName}</strong><span>{formatFileSize(file.sizeBytes)}</span></div>
        <TaskAttachmentOpenButton taskId={taskId} file={file} />
      </article>;
    })}
  </section>;
}
