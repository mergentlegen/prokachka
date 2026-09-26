"use client";

import { useState } from "react";
import type { TaskAttachment } from "@/shared/domain/types";
import { fetchTaskAttachmentFile } from "@/frontend/shared/api/client";
import styles from "./TaskAttachments.module.css";

function formatFileSize(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / (1024 * 1024)).toFixed(1)} МБ`; }

export function TaskAttachmentOpenButton({ taskId, file }: { taskId: string; file: TaskAttachment }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function openFile() {
    if (busy) return;
    setBusy(true); setError("");
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const blob = await fetchTaskAttachmentFile(taskId, file.id);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    } catch (cause) {
      tab?.close();
      setError(cause instanceof Error ? cause.message : "Не удалось открыть PDF.");
    } finally { setBusy(false); }
  }
  async function downloadFile() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const blob = await fetchTaskAttachmentFile(taskId, file.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = file.fileName; document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось скачать PDF."); }
    finally { setBusy(false); }
  }
  return <>
    <div className={styles.actions}>
      <button type="button" disabled={busy} onClick={() => void openFile()}>{busy ? "Открываем…" : "Открыть PDF"}</button>
      <button type="button" disabled={busy} onClick={() => void downloadFile()}>Скачать</button>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </>;
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
