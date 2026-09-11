"use client";

import { useEffect, useState } from "react";
import { loadTeamSelection, submitTeamJoinRequest } from "@/frontend/shared/api/team-client";
import { authFetch, clearDevSession } from "@/frontend/shared/api/client";
import { useAutoRefresh } from "@/frontend/shared/hooks/use-auto-refresh";
import type { Team, TeamJoinRequest } from "@/shared/domain/types";

export function TeamSelectionScreen({ onCompleted }: { onCompleted: () => void }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [request, setRequest] = useState<TeamJoinRequest | null>(null);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function refresh(showLoading = false) {
    if (showLoading) setLoading(true);
    try {
      const data = await loadTeamSelection();
      setTeams(data.teams);
      const nextRequest = data.requests.find((item) => item.status === "pending") || data.requests[0] || null;
      setRequest(nextRequest);
      if (nextRequest?.status === "approved") onCompleted();
    } catch {
      if (showLoading) setError("Не удалось загрузить список команд.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => { void refresh(true); }, []);

  useAutoRefresh(async () => {
    await refresh(false);
  }, { enabled: !loading && !request?.status?.includes("approved"), intervalMs: 15000 });

  async function sendRequest() {
    if (!selectedTeam) { setError("Выберите команду."); return; }
    setPending(true);
    setError("");
    try {
      const inviteToken = new URLSearchParams(window.location.search).get("invite") || undefined;
      setRequest(await submitTeamJoinRequest(selectedTeam, inviteToken));
    } catch {
      setError("Не удалось отправить заявку. Попробуйте ещё раз.");
    } finally {
      setPending(false);
    }
  }

  if (loading) return <div className="auth-loading">Загрузка команд...</div>;
  if (request?.status === "pending") return <main className="team-gate"><div className="team-gate-card"><div className="login-brand"><img className="brand-logo" src="/brand/logo-light.svg" alt="Прокачка" /></div><p className="eyebrow">Заявка отправлена</p><h1>Ждём решения наставника</h1><p>Твоя заявка в команду <strong>{request.teamName || teams.find((team) => team.id === request.teamId)?.name || ""}</strong> уже у наставника.</p><span className="team-gate-status">Заявка проверяется автоматически</span><button className="back-link-button" onClick={() => { setLoading(true); void refresh(true); }}>Проверить сейчас</button></div></main>;

  return <main className="team-gate"><div className="team-gate-card"><div className="login-brand"><img className="brand-logo" src="/brand/logo-light.svg" alt="Прокачка" /></div><p className="eyebrow">Первый шаг</p><h1>Выбери свою команду</h1><p>Отправь заявку наставнику. После одобрения появятся задания и рейтинг команды.</p>{request?.status === "rejected" && <div className="team-gate-status rejected-gate">Предыдущая заявка не одобрена. Можно выбрать другую команду.</div>}<div className="team-choice-list">{teams.length === 0 ? <div className="team-empty">Пока нет доступных команд. Попроси CEO создать команду.</div> : teams.map((team) => <button type="button" className={"team-choice " + (selectedTeam === team.id ? "selected" : "")} key={team.id} onClick={() => setSelectedTeam(team.id)}><span className="team-choice-icon">◈</span><span><strong>{team.name}</strong><small>{team.description || "Команда развития"}</small></span><b>{selectedTeam === team.id ? "✓" : "→"}</b></button>)}</div>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button full" onClick={() => { void sendRequest(); }} disabled={pending || teams.length === 0}>{pending ? "Отправляем..." : "Отправить заявку"}<span>→</span></button><button className="back-link-button" onClick={() => { void authFetch("/api/auth/logout", { method: "POST" }); clearDevSession(); window.location.href = "/"; }}>Выйти</button></div></main>;
}
