"use client";

import * as tus from "tus-js-client";
import { request } from "@/frontend/shared/api/client";
import { describeTusError } from "@/frontend/shared/api/welcome-video-client";
import { taskVideoContentType, type TaskVideoView } from "@/shared/domain/task-video";

type Api<T> = { ok: boolean; message?: string } & T;
const base = (taskId: string) => `/api/tasks/${encodeURIComponent(taskId)}/video`;

export async function loadTaskVideo(taskId: string): Promise<TaskVideoView> {
  return (await request<Api<{ video: TaskVideoView }>>(base(taskId), { cache: "no-store" })).video;
}

export async function reportTaskVideoProgress(taskId: string, position: number) {
  return (await request<Api<{ progress: { watchedSeconds: number; completed: boolean } | null }>>(`${base(taskId)}/progress`, {
    method: "POST", body: JSON.stringify({ position: Math.max(0, Math.round(position * 10) / 10) }),
  })).progress;
}

export async function removeTaskVideo(taskId: string) {
  await request<Api<Record<string, never>>>(base(taskId), { method: "DELETE" });
}

/** Sends the original straight to Storage (resumable, survives a flaky connection), then registers it for compression. */
export async function uploadTaskVideo(taskId: string, file: File, onProgress: (percentage: number) => void) {
  const contentType = taskVideoContentType(file.name, file.type);
  const { upload } = await request<Api<{ upload: { path: string; token: string; bucket: string; endpoint: string; apiKey: string; contentType: string } }>>(`${base(taskId)}/upload`, {
    method: "POST", body: JSON.stringify({ fileName: file.name, sizeBytes: file.size, contentType }),
  });
  await new Promise<void>((resolve, reject) => {
    const transfer = new tus.Upload(file, {
      endpoint: upload.endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        // Publishable keys are not JWTs and must never go into a Bearer header.
        ...(upload.apiKey.startsWith("sb_publishable_") ? {} : { authorization: `Bearer ${upload.apiKey}` }),
        apikey: upload.apiKey,
        "x-signature": upload.token,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: { bucketName: upload.bucket, objectName: upload.path, contentType: upload.contentType, cacheControl: "3600" },
      chunkSize: 6 * 1024 * 1024,
      onProgress: (sent, total) => onProgress(Math.min(99, Math.round((sent / total) * 100))),
      onError: (cause) => reject(describeTusError(cause)),
      onSuccess: () => resolve(),
    });
    transfer.start();
  });
  await request<Api<{ saved: boolean }>>(base(taskId), { method: "POST", body: JSON.stringify({ path: upload.path, fileName: file.name, sizeBytes: file.size }) });
  onProgress(100);
}
