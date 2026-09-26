// Keep browser validation, server validation and Storage metadata aligned.
export const WELCOME_VIDEO_MAX_BYTES = 200 * 1024 * 1024;
export const WELCOME_VIDEO_MAX_SECONDS = 180;
export const WELCOME_VIDEO_BROWSER_CACHE_SECONDS = 3600;

export type WelcomeVideo = {
  id: string; fileName: string; sizeBytes: number; durationSeconds: number;
  width: number; height: number; url: string;
};
export type WelcomeVideoMetadata = Pick<WelcomeVideo, "fileName" | "sizeBytes" | "durationSeconds" | "width" | "height">;
