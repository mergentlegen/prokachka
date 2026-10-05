"use client";

import { useState } from "react";
import type { Task } from "@/shared/domain/types";
import { formatVideoTime, TASK_VIDEO_MAX_BYTES, taskVideoContentType } from "@/shared/domain/task-video";
import { FileDropZone } from "@/frontend/shared/FileDropZone";
import { ProtectedVideo } from "@/frontend/shared/ProtectedVideo";
import styles from "./TaskVideoField.module.css";

const videoIcon = <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2.5" /><path d="m16 10.5 5-3v9l-5-3z" /></svg>;
const megabytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024 / 1024))} МБ`;

/** Checks a picked file before anything is uploaded; returns a problem in plain words, or "". */
export function taskVideoProblem(file: File) {
  if (!taskVideoContentType(file.name, file.type)) return "Подходят видео MP4, MOV или WebM.";
  if (file.size > TASK_VIDEO_MAX_BYTES) return "Видео больше 1 ГБ. Сократите его или запишите в меньшем качестве.";
  if (file.size < 1024) return "Файл пустой.";
  return "";
}

// The video block of the task editor: the file is uploaded after "Сохранить", then compressed on the server.
export function TaskVideoField({ task, file, removing, disabled, onFile, onRemove, onError }: {
  task?: Task; file: File | null; removing: boolean; disabled: boolean;
  onFile: (file: File | null) => void; onRemove: (removing: boolean) => void; onError: (message: string) => void;
}) {
  const [preview, setPreview] = useState(false);
  const video = task?.video;
  function pick(files: FileList) {
    const chosen = files[0];
    if (!chosen) return;
    const problem = taskVideoProblem(chosen);
    if (problem) { onError(problem); return; }
    onFile(chosen); onRemove(false);
  }
  const picker = (title: string) => <FileDropZone accept="video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm" multiple={false} disabled={disabled} onFiles={pick}
    title={title} hint="MP4, MOV или WebM до 1 ГБ и 20 минут · сожмём автоматически, участники смотрят только внутри кабинета" icon={videoIcon} />;

  return <div className={styles.field}>
    <div className={styles.heading}><strong>Видео к заданию <span className="field-hint">необязательно</span></strong></div>
    {file ? <div className={styles.row}>
      <span className={styles.icon}>{videoIcon}</span>
      <div className={styles.text}><strong>{file.name}</strong><small>{megabytes(file.size)} · загрузится после сохранения, затем сожмётся за несколько минут</small></div>
      <button type="button" className={styles.link} disabled={disabled} onClick={() => onFile(null)}>Убрать</button>
    </div>
    : video && removing ? <div className={styles.row}>
      <span className={styles.icon}>{videoIcon}</span>
      <div className={styles.text}><strong>Видео будет удалено</strong><small>после сохранения задания</small></div>
      <button type="button" className={styles.link} disabled={disabled} onClick={() => onRemove(false)}>Отменить</button>
    </div>
    : video ? <>
      <div className={styles.row}>
        <span className={`${styles.icon} ${video.status === "failed" ? styles.bad : video.status === "processing" ? styles.wait : styles.good}`}>{videoIcon}</span>
        <div className={styles.text}>
          {video.status === "ready" && <><strong>Видео готово{video.durationSeconds ? ` · ${formatVideoTime(video.durationSeconds)}` : ""}</strong><small>Участники смотрят его в карточке задания</small></>}
          {video.status === "processing" && <><strong>Видео обрабатывается</strong><small>{video.playable ? "Пока показываем прежнее видео" : "Обычно несколько минут — участники увидят его сразу после"}</small></>}
          {video.status === "failed" && <><strong>Видео не удалось обработать</strong><small>{video.error || "Загрузите другой файл"}</small></>}
          {video.status === "ready" && video.error && <small className={styles.warn}>Новое видео не подошло: {video.error}</small>}
        </div>
        {video.playable && <button type="button" className={styles.link} onClick={() => setPreview((value) => !value)}>{preview ? "Скрыть" : "Посмотреть"}</button>}
        <button type="button" className={`${styles.link} ${styles.danger}`} disabled={disabled} onClick={() => onRemove(true)}>Удалить</button>
      </div>
      {preview && task && <ProtectedVideo taskId={task.id} trackProgress={false} />}
      {picker("Заменить видео")}
    </>
    : picker("Добавить видео")}
  </div>;
}
