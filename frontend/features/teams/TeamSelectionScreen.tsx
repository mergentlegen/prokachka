"use client";

import { useEffect, useState } from "react";
import { loadTeamSelection, submitTeamJoinRequest } from "@/frontend/shared/api/team-client";
import { authFetch, clearDevSession } from "@/frontend/shared/api/client";
import { useAutoRefresh } from "@/frontend/shared/hooks/use-auto-refresh";
import type { Team, TeamJoinRequest } from "@/shared/domain/types";
import styles from "./TeamSelectionScreen.module.css";

export function TeamSelectionScreen({ onCompleted }: { onCompleted: () => void }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [request, setRequest] = useState<TeamJoinRequest | null>(null);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  async function refresh(showLoading = false, showError = false) {
    if (showLoading) setLoading(true);
    if (showLoading || showError) setError("");
    try {
      const data = await loadTeamSelection();
      setTeams(data.teams);
      const nextRequest = data.requests.find((item) => item.status === "pending") || data.requests[0] || null;
      setRequest(nextRequest);
      if (nextRequest?.status === "approved") onCompleted();
    } catch {
      if (showLoading || showError) setError("Не удалось обновить данные. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => { void refresh(true); }, []);
  useAutoRefresh(async () => { await refresh(false); }, {
    enabled: !loading && !pending && !checking && request?.status !== "approved", intervalMs: 15000,
  });

  async function sendRequest() {
    if (pending || request?.status === "pending") return;
    if (!teams.some((team) => team.id === selectedTeam)) { setError("Выберите команду."); return; }
    setPending(true);
    setError("");
    try {
      const inviteToken = new URLSearchParams(window.location.search).get("invite") || undefined;
      setRequest(await submitTeamJoinRequest(selectedTeam, inviteToken));
    } catch {
      setError("Не удалось отправить заявку. Попробуйте ещё раз.");
    } finally { setPending(false); }
  }

  async function checkStatus() {
    if (checking) return;
    setChecking(true);
    await refresh(false, true);
    setChecking(false);
  }

  async function logout() {
    await authFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    clearDevSession();
    window.location.href = "/";
  }

  return <TeamSelectionView teams={teams} request={request} selectedTeam={selectedTeam} loading={loading} pending={pending} checking={checking} error={error}
    onSelect={(id) => { setSelectedTeam(id); setError(""); }} onSend={() => void sendRequest()} onRefresh={() => void checkStatus()} onLogout={() => void logout()} />;
}

type ViewProps = {
  teams: Team[]; request: TeamJoinRequest | null; selectedTeam: string;
  loading: boolean; pending: boolean; checking: boolean; error: string;
  onSelect: (id: string) => void; onSend: () => void; onRefresh: () => void; onLogout: () => void;
};

export function TeamSelectionView({ teams, request, selectedTeam, loading, pending, checking, error, onSelect, onSend, onRefresh, onLogout }: ViewProps) {
  const waiting = request?.status === "pending";
  const teamName = request?.teamName || teams.find((team) => team.id === request?.teamId)?.name || "Выбранная команда";
  const hasSelection = teams.some((team) => team.id === selectedTeam);
  return <main className={styles.page}>
    <section className={styles.card} aria-labelledby="team-gate-title" aria-busy={loading || pending || checking}>
      <header className={styles.brand}><img src="/brand/logo.svg" alt="Прокачка" width="180" height="60" /><span>Вместе к результату</span></header>
      {loading ? <div className={styles.loading}><h1 id="team-gate-title">Выбор команды</h1><p role="status">Загружаем доступные команды…</p></div> : waiting ? <>
        <div className={styles.waitingIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></svg></div>
        <span className={styles.status}>Заявка отправлена</span>
        <h1 id="team-gate-title">Ждём решения наставника</h1>
        <p className={styles.intro}>Наставник рассмотрит вашу заявку. После одобрения откроется доступ к команде.</p>
        <div className={styles.requestTeam}><span className={styles.teamIcon} aria-hidden="true">◈</span><div><small>Ваша команда</small><strong>{teamName}</strong></div><span className={styles.pendingDot} aria-label="Ожидает решения" /></div>
        <p className={styles.waitingNote}>Ничего отправлять повторно не нужно.</p>
        {error && <div className={styles.error} role="alert">{error}</div>}
        <button type="button" className={styles.secondary} disabled={checking} onClick={onRefresh}>{checking ? "Проверяем статус…" : "Проверить статус заявки"}</button>
      </> : <>
        <span className={styles.step}>Вступление в команду</span>
        <h1 id="team-gate-title">Выберите свою команду</h1>
        <p className={styles.intro}>Отправьте заявку наставнику, чтобы получить доступ к заданиям и рейтингу команды.</p>
        {request?.status === "rejected" && <div className={styles.warning} role="status">Предыдущая заявка не одобрена. Вы можете выбрать другую команду.</div>}
        {teams.length ? <fieldset className={styles.choices} disabled={pending}><legend>Доступные команды</legend>{teams.map((team) =>
          <label className={styles.choice} key={team.id}>
            <input type="radio" name="team" value={team.id} checked={selectedTeam === team.id} onChange={() => onSelect(team.id)} />
            <span className={styles.teamIcon} aria-hidden="true">◈</span>
            <span className={styles.teamCopy}><strong>{team.name}</strong>{team.description && <small>{team.description}</small>}</span>
            <span className={styles.choiceMark} aria-hidden="true">{selectedTeam === team.id ? "✓" : ""}</span>
          </label>
        )}</fieldset> : <div className={styles.empty}><strong>Пока нет доступных команд</strong><p>Уточните у наставника, когда можно будет присоединиться.</p><button type="button" className={styles.retry} onClick={onRefresh} disabled={checking}>Обновить список</button></div>}
        {error && <div className={styles.error} role="alert">{error}</div>}
        <button type="button" className={styles.primary} onClick={onSend} disabled={pending || !hasSelection}>{pending ? "Отправляем заявку…" : "Отправить заявку"}<span aria-hidden="true">→</span></button>
        {!hasSelection && teams.length > 0 && <p className={styles.selectionHint}>Сначала выберите команду из списка.</p>}
      </>}
      {!loading && <footer className={styles.footer}><button type="button" onClick={onLogout}>Выйти из аккаунта</button></footer>}
    </section>
  </main>;
}
