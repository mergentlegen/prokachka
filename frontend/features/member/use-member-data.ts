"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AuthUser } from "@/shared/domain/types";
import { userScope } from "@/shared/domain/live-updates";
import { dataCache } from "@/frontend/shared/api/data-cache";
import { loadMemberData, type MemberData, type MemberDataset } from "@/frontend/shared/api/client";
import { ScopeChangedError } from "@/frontend/shared/lib/query-cache";

export type MemberTab = "home" | "tasks" | "ranking" | "network" | "profile";
const datasets: Record<MemberTab, MemberDataset[]> = {
  home: ["announcements", "ranking"], tasks: ["tasks", "submissions"], ranking: ["ranking"],
  network: ["network"], profile: ["tasks", "submissions", "stars", "ranking"],
};
const empty = (): MemberData => ({ store: { users: [], tasks: [], programs: [], programProgress: [], announcements: [], starAwards: [], submissions: [] }, ranking: [], starRanking: [], network: [] });
const initial = () => ({ scope: "", data: empty(), loaded: {} as Partial<Record<MemberTab, boolean>>, errors: {} as Partial<Record<MemberTab, string>> });
export function useMemberData(user: AuthUser | null, tab: MemberTab) {
  const epoch = useSyncExternalStore(dataCache.subscribe, dataCache.getEpoch, dataCache.getEpoch);
  const scope = user?.teamId ? userScope(user) + ":" + epoch : "";
  const id = user?.id;
  const [snapshot, setSnapshot] = useState(initial);
  const version = useRef(0);
  const refreshData = useCallback(async () => {
    if (!scope || !id) return;
    const currentVersion = ++version.current, startedEpoch = dataCache.epoch;
    try {
      const data = await loadMemberData(id, datasets[tab]);
      if (version.current !== currentVersion || startedEpoch !== dataCache.epoch) return;
      setSnapshot((previous) => {
        const current = previous.scope === scope ? previous : initial();
        return { scope, data, loaded: { ...current.loaded, [tab]: true }, errors: { ...current.errors, [tab]: "" } };
      });
    } catch (error) {
      if (version.current !== currentVersion || startedEpoch !== dataCache.epoch || error instanceof ScopeChangedError) return;
      setSnapshot((previous) => {
        const current = previous.scope === scope ? previous : initial();
        return { ...current, scope, errors: { ...current.errors, [tab]: error instanceof Error ? error.message : "Не удалось обновить раздел." } };
      });
    }
  }, [id, scope, tab]);
  useEffect(() => {
    const counter = version;
    void refreshData();
    return () => { counter.current++; };
  }, [refreshData]);
  const visible = snapshot.scope === scope ? snapshot : initial();
  return { ...visible.data, refreshData, dataError: visible.errors[tab], dataLoading: Boolean(scope && !visible.loaded[tab] && !visible.errors[tab]) };
}
