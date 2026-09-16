export type ResourcePreview = {
  href: string; host: string; label: string; action: string;
  type: "video" | "test" | "meeting" | "website"; thumbnail?: string;
};

// No arbitrary server-side URL fetch: private links and sites without public
// metadata still have a useful card. Only a validated YouTube ID builds an image URL.
export function resourcePreview(value?: string | null): ResourcePreview | undefined {
  if (!value || value.trim().length > 2000) return;
  let url: URL;
  try { url = new URL(value.trim()); } catch { return; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const result: ResourcePreview = { href: url.href, host, label: "Материал по ссылке", action: "Открыть материал", type: "website" };
  const youtubeHost = ["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host);
  let videoId: string | null = null;
  if (host === "youtu.be") videoId = url.pathname.split("/")[1];
  else if (youtubeHost) {
    const parts = url.pathname.split("/");
    videoId = parts[1] === "watch" ? url.searchParams.get("v") : ["embed", "shorts", "live"].includes(parts[1]) ? parts[2] : null;
  }
  if (videoId && /^[\w-]{11}$/.test(videoId)) return {
    ...result, type: "video", label: "Видео на YouTube", action: "Смотреть видео",
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
  if (["vimeo.com", "player.vimeo.com", "rutube.ru", "vkvideo.ru"].includes(host)) return { ...result, type: "video", label: "Видеоматериал", action: "Смотреть видео" };
  if (host === "forms.gle" || (host === "docs.google.com" && url.pathname.startsWith("/forms/")) || host === "forms.yandex.ru") return { ...result, type: "test", label: "Тест или анкета", action: "Открыть тест" };
  if (host === "zoom.us" || host.endsWith(".zoom.us") || host === "meet.google.com") return { ...result, type: "meeting", label: "Онлайн-встреча", action: "Перейти к встрече" };
  return result;
}
