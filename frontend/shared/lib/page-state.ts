// "Where am I" lives in the address bar (?tab=ranking, ?section=programs), so a page reload opens
// the same screen. Changing it never reloads the page or adds a step to the browser history.

export function readPageParam(name: string) {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

/** Sets (or removes, for null) one parameter and keeps all the others, such as Telegram deep links. */
export function writePageParam(name: string, value: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (value === null || value === "") url.searchParams.delete(name); else url.searchParams.set(name, value);
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

/** True when this page load is the person pressing "reload", not following a link. */
export function isPageReload() {
  if (typeof performance === "undefined") return false;
  const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return entry?.type === "reload";
}
