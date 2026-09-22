import { QueryCache } from "@/frontend/shared/lib/query-cache";
import { resourceTopics, type ChangeTopic } from "@/shared/domain/live-updates";

export const dataCache = new QueryCache();
export const localChangeEvent = "prokachka:data-change";
export function invalidateData(topics: readonly ChangeTopic[]) {
  if (topics.includes("session")) { dataCache.clear(); return; }
  dataCache.invalidate((key) => topics.includes("resync") || resourceTopics(key).some((topic) => topics.includes(topic)));
}
export function announceMutation(topics: ChangeTopic[]) {
  if (!topics.length) return;
  invalidateData(topics);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(localChangeEvent, { detail: topics }));
}
