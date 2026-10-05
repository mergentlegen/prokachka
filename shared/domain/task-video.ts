// Keep browser checks, server checks and the Storage bucket limits aligned.
export const TASK_VIDEO_MAX_BYTES = 1024 * 1024 * 1024;
export const TASK_VIDEO_MAX_SECONDS = 20 * 60;
export const TASK_VIDEO_TYPES: Record<string, "mp4" | "mov" | "webm"> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

export type TaskVideoStatus = "processing" | "ready" | "failed";
/** What a task list says about its video: members only ever see playable ones. */
export type TaskVideoSummary = { status: TaskVideoStatus; playable: boolean; durationSeconds?: number; error?: string };
export type TaskVideoView = TaskVideoSummary & { url?: string; watchedSeconds: number; completed: boolean; fileName?: string };

/** The browser's MIME type for phone videos is sometimes empty; fall back to the extension. */
export function taskVideoContentType(fileName: string, type: string) {
  if (TASK_VIDEO_TYPES[type]) return type;
  const extension = fileName.toLowerCase().split(".").pop();
  return extension === "mp4" || extension === "m4v" ? "video/mp4" : extension === "mov" ? "video/quicktime" : extension === "webm" ? "video/webm" : "";
}

/** The author's mark that stays in the corner of every protected video. */
export const VIDEO_AUTHOR_MARK = "Асель Баялинова";

export function formatVideoTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
