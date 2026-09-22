"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SetStateAction } from "react";
import type { AuthUser, RankEntry, Store, TeamJoinRequest, User } from "@/shared/domain/types";
import type { ProgramHistory, PublicationHistoryItem } from "@/shared/domain/history";
import { userScope } from "@/shared/domain/live-updates";
import { dataCache } from "@/frontend/shared/api/data-cache";
import { ScopeChangedError } from "@/frontend/shared/lib/query-cache";
import { loadNetwork } from "@/frontend/shared/api/network-client";
import { loadAdminData, loadAdminProgramHistory, loadAdminPublicationHistory, loadAdminRanking, loadMentorCounts } from "@/frontend/shared/api/admin-client";
import { loadTeamRequests } from "@/frontend/shared/api/team-client";
import { sectionDatasets, type AdminSection } from "./admin-sections";

const emptyStore = (): Store => ({ users: [], tasks: [], programs: [], programProgress: [], announcements: [], starAwards: [], submissions: [] });
const emptySnapshot = () => ({ scope: "", loaded: {} as Partial<Record<AdminSection, boolean>>, errors: {} as Partial<Record<AdminSection, string>>,
  store: emptyStore(), requests: [] as TeamJoinRequest[], networkUsers: [] as User[],
  programHistory: [] as ProgramHistory[], publicationHistory: [] as PublicationHistoryItem[], ranking: [] as RankEntry[],
  counts: { pending: 0, accepted: 0, requests: 0 } });

export function useAdminData(user: AuthUser | null, section: AdminSection) {
  const epoch = useSyncExternalStore(dataCache.subscribe, dataCache.getEpoch, dataCache.getEpoch);
  const enabled = Boolean(user && (user.role === "admin" || user.canReview || user.canPublishTasks));
  const scope = enabled ? userScope(user) + ":" + epoch : "";
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const version = useRef(0);
  const refreshData = useCallback(async () => {
    if (!scope) return;
    const requestVersion = ++version.current;
    const startedEpoch = dataCache.epoch;
    try {
      const [patch, counts, requests, programHistory, publicationHistory, ranking, networkUsers] = await Promise.all([
        loadAdminData(sectionDatasets[section]), loadMentorCounts(),
        section === "requests" ? loadTeamRequests() : null,
        section === "history" ? loadAdminProgramHistory() : null,
        section === "history" ? loadAdminPublicationHistory() : null,
        section === "dashboard" ? loadAdminRanking() : null,
        section === "network" ? loadNetwork() : null,
      ]);
      if (requestVersion !== version.current || startedEpoch !== dataCache.epoch) return;
      setSnapshot((previous) => {
        const current = previous.scope === scope ? previous : emptySnapshot();
        return { ...current, scope, loaded: { ...current.loaded, [section]: true }, errors: { ...current.errors, [section]: "" },
          store: { ...current.store, ...patch }, counts, networkUsers: networkUsers ?? current.networkUsers,
          requests: requests ?? current.requests, programHistory: programHistory ?? current.programHistory,
          publicationHistory: publicationHistory ?? current.publicationHistory, ranking: ranking ?? current.ranking };
      });
    } catch (error) {
      if (requestVersion !== version.current || startedEpoch !== dataCache.epoch || error instanceof ScopeChangedError) return;
      setSnapshot((previous) => {
        const current = previous.scope === scope ? previous : emptySnapshot();
        return { ...current, scope, errors: { ...current.errors, [section]: error instanceof Error ? error.message : "Не удалось обновить раздел." } };
      });
    }
  }, [scope, section]);

  useEffect(() => {
    const counter = version;
    void refreshData();
    return () => { counter.current++; };
  }, [refreshData]);

  const setStore = useCallback((value: SetStateAction<Store>) => {
    setSnapshot((current) => current.scope === scope ? { ...current, store: typeof value === "function" ? value(current.store) : value } : current);
  }, [scope]);
  const setRequests = useCallback((value: SetStateAction<TeamJoinRequest[]>) => {
    setSnapshot((current) => current.scope === scope ? { ...current, requests: typeof value === "function" ? value(current.requests) : value } : current);
  }, [scope]);
  const setNetworkUsers = useCallback((value: SetStateAction<User[]>) => {
    setSnapshot((current) => current.scope === scope ? { ...current, networkUsers: typeof value === "function" ? value(current.networkUsers) : value } : current);
  }, [scope]);
  const visible = snapshot.scope === scope ? snapshot : emptySnapshot();
  return { ...visible, setStore, setRequests, setNetworkUsers, refreshData, dataError: visible.errors[section],
    dataLoading: Boolean(scope && !visible.loaded[section] && !visible.errors[section]) };
}
