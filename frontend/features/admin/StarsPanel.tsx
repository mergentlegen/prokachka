"use client";

import { useMemo, useState } from "react";
import { formatDateTime } from "@/frontend/shared/lib/format";
import { createAdminStarAward, deleteAdminStarAward } from "@/frontend/shared/api/admin-client";
import type { StarAward, User } from "@/shared/domain/types";

type Props = {
  actorId: string;
  users: User[];
  awards: StarAward[];
  onChange: (awards: StarAward[]) => void;
  onError: (message: string) => void;
};

export function StarsPanel({ actorId, users, awards, onChange, onError }: Props) {
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [stars, setStars] = useState(1);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StarAward | null>(null);

  const members = users.filter((user) => user.role === "member" && user.id !== actorId);
  const totals = useMemo(() => {
    const result = new Map<string, number>();
    awards.forEach((award) => result.set(award.userId, (result.get(award.userId) || 0) + award.stars));
    return result;
  }, [awards]);

  function openAward(user: User) {
    setSelectedUser(user);
    setStars(1);
    setComment("");
  }

  function closeAward() {
    if (!busy) setSelectedUser(null);
  }

  async function awardStars() {
    if (!selectedUser) return;
    setBusy(true);
    try {
      const award = await createAdminStarAward({ userId: selectedUser.id, stars, comment: comment.trim() });
      onChange([award, ...awards]);
      setSelectedUser(null);
      onError("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Не удалось присвоить звёзды.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeAward() {
    if (!deleteTarget) return;
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
    <>
      <div className="stars-admin-intro">
        <div>
          <p className="eyebrow">Мотивация команды</p>
          <h2>Награждение звёздами</h2>
          <p>Выдавай участникам от одной до пяти звёзд за прогресс, инициативу или отличный результат.</p>
        </div>
        <div className="stars-total-badge">★ <strong>{awards.reduce((sum, award) => sum + award.stars, 0)}</strong><span>выдано</span></div>
      </div>

      <div className="admin-panel stars-member-list">
        {members.length === 0 ? (
          <div className="empty-admin"><span>★</span><p>В команде пока нет участников.</p></div>
        ) : (
          members.map((user) => (
            <div className="stars-member-row" key={user.id}>
              <div className="rank-avatar">{user.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</div>
              <div className="stars-member-copy"><strong>{user.name}</strong><span>{totals.get(user.id) || 0} звёзд</span></div>
              <div className="stars-display" aria-label={(totals.get(user.id) || 0) + " звёзд"}>{"★".repeat(Math.min(totals.get(user.id) || 0, 10)) || "—"}</div>
              <button className="button button-primary" onClick={() => openAward(user)}>+ Выдать</button>
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
              <div className="rank-avatar">{user ? user.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() : "?"}</div>
              <div className="star-award-copy"><strong>{user?.name || "Удалённый участник"}</strong><span>{formatDateTime(award.createdAt)}{award.comment ? " · " + award.comment : ""}</span></div>
              <b className="star-award-value">+{award.stars} ★</b>
              <button className="button button-danger" onClick={() => setDeleteTarget(award)}>Отменить</button>
            </div>;
          })
        )}
      </div>

      {selectedUser && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) closeAward(); }}>
          <div className="editor-modal admin-form-modal star-award-modal" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={closeAward} aria-label="Закрыть">×</button>
            <p className="eyebrow">Новое награждение</p>
            <h2>Выдать звёзды</h2>
            <p className="modal-description">Участник: <strong>{selectedUser.name}</strong></p>
            <label>Количество звёзд
              <select value={stars} onChange={(event) => setStars(Number(event.target.value))}>
                {[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value} {value === 1 ? "звезда" : "звёзд"}</option>)}
              </select>
            </label>
            <label>Комментарий <span className="field-hint">необязательно</span>
              <textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={500} rows={4} placeholder="За что участник получил награду?" />
            </label>
            <div className="modal-actions">
              <button className="button button-muted" onClick={closeAward}>Отмена</button>
              <button className="button button-primary" onClick={() => void awardStars()} disabled={busy}>{busy ? "Сохраняем..." : "Выдать звёзды"}</button>
            </div>
          </div>
        </div>
      )}

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
    </>
  );
}
