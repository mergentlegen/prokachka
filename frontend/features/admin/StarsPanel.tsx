"use client";

import { useMemo, useState } from "react";
import { Avatar } from "@/frontend/shared/Avatar";
import { formatDateTime } from "@/frontend/shared/lib/format";
import { createAdminStarAward, deleteAdminStarAward } from "@/frontend/shared/api/admin-client";
import type { StarAward, User } from "@/shared/domain/types";
import { starAwardOption, type StarAwardKind } from "@/shared/domain/star-awards";
import { StarAwardDialog } from "./StarAwardDialog";

type Props = {
  actorId: string;
  users: User[];
  awards: StarAward[];
  onChange: (awards: StarAward[]) => void;
  onError: (message: string) => void;
};

export function StarsPanel({ actorId, users, awards, onChange, onError }: Props) {
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [awardError, setAwardError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StarAward | null>(null);
  const [query, setQuery] = useState("");

  const members = users.filter((user) => user.role === "member" && user.id !== actorId);
  const totals = useMemo(() => {
    const result = new Map<string, number>();
    awards.forEach((award) => result.set(award.userId, (result.get(award.userId) || 0) + award.stars));
    return result;
  }, [awards]);
  const totalStars = awards.reduce((sum, award) => sum + award.stars, 0);
  const awardedMembers = members.filter((user) => (totals.get(user.id) || 0) > 0).length;
  const visibleMembers = members.filter((user) => user.name.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")));

  function openAward(user: User) {
    setSelectedUser(user);
    setAwardError("");
  }

  function closeAward() {
    if (!busy) setSelectedUser(null);
  }

  async function awardStars(kind: StarAwardKind, comment: string) {
    if (!selectedUser || busy) return;
    setBusy(true);
    setAwardError("");
    try {
      const award = await createAdminStarAward({ userId: selectedUser.id, kind, comment });
      onChange([award, ...awards]);
      setSelectedUser(null);
      onError("");
    } catch (error) {
      setAwardError(error instanceof Error ? error.message : "Не удалось присвоить звёзды.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeAward() {
    if (!deleteTarget || busy) return;
    setBusy(true);
    try {
      await deleteAdminStarAward(deleteTarget.id);
      onChange(awards.filter((award) => award.id !== deleteTarget.id));
      setDeleteTarget(null);
      onError("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Не удалось отменить выдачу звёзд.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stars-admin-page">
      <div className="stars-admin-intro">
        <div>
          <h2>Награждение звёздами</h2>
          <p>Starter · Classic · Premium. Звёзды суммируются в рейтинге.</p>
        </div>
      </div>

      <div className="stars-summary-grid">
        <div className="stars-summary-card"><span>★</span><div><strong>{totalStars}</strong><small>Всего звёзд</small></div></div>
        <div className="stars-summary-card"><span>♙</span><div><strong>{awardedMembers}</strong><small>Получили награду</small></div></div>
        <div className="stars-summary-card"><span>◷</span><div><strong>{awards.length}</strong><small>Выдач за всё время</small></div></div>
      </div>

      <div className="admin-panel stars-member-list">
        <div className="stars-member-heading"><h3>Выбери участника</h3></div>
        <label className="stars-search">Найти участника<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя участника" /></label>
        {visibleMembers.length === 0 ? (
          <div className="empty-admin"><span>★</span><p>{members.length ? "Участники не найдены." : "Нет участников, которых вы можете наградить."}</p></div>
        ) : (
          visibleMembers.map((user) => (
            <div className="stars-member-row" key={user.id}>
              <Avatar className="rank-avatar" name={user.name} src={user.avatarUrl} />
              <div className="stars-member-copy"><strong>{user.name}</strong><span className="stars-member-total">★ {totals.get(user.id) || 0} звёзд</span></div>
              <button type="button" className="button star-award-button" aria-label={"Выдать звёзды: " + user.name} onClick={() => openAward(user)}>+ Выдать</button>
            </div>
          ))
        )}
      </div>

      <div className="admin-panel stars-history-panel">
        <div className="panel-title"><div><p className="eyebrow">Контроль</p><h2>История выдачи</h2></div><span className="ceo-count-label">{awards.length} записей</span></div>
        {awards.length === 0 ? (
          <div className="empty-admin"><span>◷</span><p>История награждений пока пуста.</p></div>
        ) : (
          awards.map((award) => {
            const user = users.find((item) => item.id === award.userId);
            return <div className="star-award-row" key={award.id}>
              <Avatar className="rank-avatar" name={user?.name || "?"} src={user?.avatarUrl} />
              <div className="star-award-copy"><strong>{user?.name || "Удалённый участник"}</strong><span>{starAwardOption(award.kind)?.label || "Награждение звёздами"} · {formatDateTime(award.createdAt)}</span><span>Выдал: {award.mentorName || users.find((item) => item.id === award.mentorId)?.name || "Наставник"}</span>{award.comment && <span>{award.comment}</span>}</div>
              <b className="star-award-value">+{award.stars} ★</b>
              <button className="button button-danger" onClick={() => setDeleteTarget(award)}>Отменить</button>
            </div>;
          })
        )}
      </div>

      {selectedUser && <StarAwardDialog name={selectedUser.name} total={totals.get(selectedUser.id) || 0} busy={busy} error={awardError} onClose={closeAward} onAward={(kind, comment) => void awardStars(kind, comment)} />}

      {deleteTarget && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setDeleteTarget(null); }}>
          <div className="editor-modal admin-form-modal danger-modal" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setDeleteTarget(null)} aria-label="Закрыть">×</button>
            <p className="eyebrow eyebrow-danger">Отмена награждения</p>
            <h2>Отменить выдачу?</h2>
            <p className="modal-description">Звёзды будут убраны из профиля участника и общего итога.</p>
            <div className="modal-actions">
              <button className="button button-muted" onClick={() => setDeleteTarget(null)}>Оставить</button>
              <button className="button button-danger" onClick={() => void revokeAward()} disabled={busy}>{busy ? "Отменяем..." : "Отменить выдачу"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
