"use client";

import * as tus from "tus-js-client";
import { ApiError, authFetch } from "@/frontend/shared/api/client";

export type WelcomeVideo = { fileName: string; sizeBytes: number; durationSeconds: number; width: number; height: number; url: string };
export type VideoMetadata = Pick<WelcomeVideo, "fileName" | "sizeBytes" | "durationSeconds" | "width" | "height">;
type Api<T> = { ok: boolean; message?: string } & T;

function describeTusError(cause: unknown): Error {
  if (!(cause instanceof tus.DetailedError)) {
    return new Error("Не удалось связаться с Supabase Storage. Проверьте подключение и попробуйте ещё раз.");
  }
  const response = cause.originalResponse;
  const status = response?.getStatus();
  const raw = response?.getBody() || "";
  let detail = "";
  try {
    const body = JSON.parse(raw) as { message?: unknown; error?: unknown; error_description?: unknown };
    const value = body.message ?? body.error_description ?? body.error;
    if (typeof value === "string") detail = value;
  } catch {
    detail = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  detail = detail.slice(0, 240);
  const statusText = status ? `HTTP ${status}` : "без HTTP-статуса";
  return new Error(`Supabase Storage отклонил загрузку (${statusText})${detail ? `: ${detail}` : ". Проверьте настройки бакета и лимит файла."}`);
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({})) as Api<T>;
  if (!response.ok) throw new ApiError(body.message || "Не удалось выполнить запрос.", response.status);
  return body;
}

export async function loadWelcomeVideo() {
  return call<{ required: boolean; reason?: string; video?: WelcomeVideo }>("/api/welcome-video");
}
export async function completeWelcomeVideo() {
  await call<{ completed: boolean }>("/api/welcome-video/complete", { method: "POST", body: "{}" });
}
export async function loadWelcomeVideoSettings() {
  return call<{ video: WelcomeVideo | null }>("/api/welcome-video/settings");
}
export async function removeWelcomeVideo() {
  return call<{ storageCleanupWarning: boolean }>("/api/welcome-video/settings", { method: "DELETE", body: "{}" });
}

export async function uploadWelcomeVideo(file: File, metadata: VideoMetadata, onProgress: (percentage: number) => void, onUpload: (abort: () => void) => void) {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error("Не настроен публичный ключ Supabase для загрузки.");
  const intent = await call<{ path: string; token: string; bucket: string; endpoint: string }>("/api/welcome-video/upload", {
    method: "POST", body: JSON.stringify({ metadata }),
  });
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: intent.endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
        "x-signature": intent.token,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: { bucketName: intent.bucket, objectName: intent.path, contentType: "video/mp4", cacheControl: "3600" },
      chunkSize: 6 * 1024 * 1024,
      onProgress: (sent, total) => onProgress(Math.round((sent / total) * 100)),
      onError: (cause) => reject(describeTusError(cause)),
      onSuccess: () => resolve(),
    });
    onUpload(() => { void upload.abort(true); reject(new Error("Загрузка отменена.")); });
    void upload.start();
  });
  await call<{ ok: boolean }>("/api/welcome-video/finish", {
    method: "POST", body: JSON.stringify({ path: intent.path, metadata }),
  });
}
