import { liveEvents } from "@/backend/services/live-events.service";
import type { ChangeTopic } from "@/shared/domain/live-updates";

// The mentor's list of works is heavy to bring from the database (Seoul), and mentors reload it often
// (every change, every return to the tab). This process keeps the last list of each mentor and forgets it
// as soon as the database reports a change in that team. Without the change feed a list lives 15 seconds.
type Rows = Record<string, unknown>[];
type Entry = { teamId: string; at: number; rows?: Rows; loading?: Promise<{ data: Rows } | { error: unknown }> };
type State = { entries: Map<string, Entry>; subscribed: boolean; ready: boolean };

const AFFECTING: readonly ChangeTopic[] = ["submissions", "tasks", "users", "network", "teams"];
const FRESH_WITH_FEED = 5 * 60_000;
const FRESH_WITHOUT_FEED = 15_000;
const state = ((globalThis as typeof globalThis & { prokachkaMentorLists?: State }).prokachkaMentorLists ??= { entries: new Map(), subscribed: false, ready: false });

function listen() {
  if (state.subscribed) return;
  state.subscribed = true;
  // One subscription for the life of the process: the change feed stays open while the site runs.
  liveEvents.subscribe({
    change: (change) => {
      if (!change.topics.some((topic) => AFFECTING.includes(topic))) return;
      for (const [viewer, entry] of state.entries) if (change.catalog || change.teamIds.includes(entry.teamId)) state.entries.delete(viewer);
    },
    status: (ready) => { state.ready = ready; if (!ready) state.entries.clear(); },
  });
}

/** The mentor's list from memory when nothing changed in the team since it was read; otherwise read once (even for parallel requests). */
export async function cachedMentorList(viewerId: string, teamId: string, load: () => Promise<{ data: Rows } | { error: unknown }>) {
  listen();
  const now = Date.now();
  const entry = state.entries.get(viewerId);
  if (entry && entry.teamId === teamId) {
    if (entry.rows && now - entry.at < (state.ready ? FRESH_WITH_FEED : FRESH_WITHOUT_FEED)) return { data: entry.rows };
    if (entry.loading) return entry.loading;
  }
  const fresh: Entry = { teamId, at: now };
  const loading = load().then((result) => {
    if ("data" in result && state.entries.get(viewerId) === fresh) fresh.rows = result.data;
    else if (state.entries.get(viewerId) === fresh) state.entries.delete(viewerId);
    fresh.loading = undefined;
    return result;
  });
  fresh.loading = loading;
  state.entries.set(viewerId, fresh);
  return loading;
}

/** A mentor changed works in this team (review, a recorded completion): the next list must be read again. */
export function forgetTeamLists(teamId: string | undefined) {
  if (!teamId) return;
  for (const [viewer, entry] of state.entries) if (entry.teamId === teamId) state.entries.delete(viewer);
}
