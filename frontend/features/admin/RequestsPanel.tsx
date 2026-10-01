"use client";

import { useState } from "react";
import type { TeamJoinRequest, User } from "@/shared/domain/types";
import { Avatar } from "@/frontend/shared/Avatar";
import { ConfirmModal } from "@/frontend/shared/ConfirmModal";
import { formatDateTime } from "@/frontend/shared/lib/format";
import { plural } from "@/frontend/shared/lib/plural";
import { waitingInfo } from "./review-queue";
import styles from "./RequestsPanel.module.css";

type Decision = "approved" | "rejected";

// Join requests: who invited the person and when, a confirmation before rejecting, and "accept everyone".
export function RequestsPanel({ requests, users, onReview }: {
  requests: TeamJoinRequest[]; users: User[]; onReview: (request: TeamJoinRequest, status: Decision) => Promise<boolean>;
}) {
  const [busyId, setBusyId] = useState("");
  const [rejecting, setRejecting] = useState<TeamJoinRequest | null>(null);
  const [acceptingAll, setAcceptingAll] = useState(false);
  const names = new Map(users.map((user) => [user.id, user.name]));
  const oldestFirst = [...requests].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  async function decide(request: TeamJoinRequest, status: Decision) {
    setBusyId(request.id);
    const done = await onReview(request, status);
    setBusyId("");
    return done;
  }

  async function acceptAll() {
    setBusyId("all");
    for (const request of oldestFirst) { if (!(await onReview(request, "approved"))) break; }
    setBusyId(""); setAcceptingAll(false);
  }

  if (!requests.length) return <div className={styles.empty}><span aria-hidden="true">✓</span><strong>Новых заявок нет</strong><p>Когда кто-то перейдёт по ссылке-приглашению, заявка появится здесь.</p></div>;
  return <div className={styles.panel}>
    <div className={styles.bar}>
      <div><strong>{requests.length} {plural(requests.length, "заявка ждёт", "заявки ждут", "заявок ждут")} решения</strong><small>Сверху самые ранние</small></div>
      {requests.length > 1 && <button type="button" className="button button-success" disabled={Boolean(busyId)} onClick={() => setAcceptingAll(true)}>Принять всех</button>}
    </div>
    <ul className={styles.list}>
      {oldestFirst.map((request) => {
        const inviter = request.invitedByUserId ? names.get(request.invitedByUserId) : undefined;
        const waited = waitingInfo(request.createdAt);
        return <li key={request.id}>
          <div className={styles.person}>
            <Avatar className={styles.avatar} name={request.userName || "Новый участник"} src={request.userAvatarUrl} />
            <div>
              <strong>{request.userName || "Новый участник"}</strong>
              <span>{inviter ? <>Пригласил(а): <b>{inviter}</b></> : request.invitedByUserId ? "По ссылке-приглашению" : "Сам(а) выбрал(а) команду"}</span>
              <small>{formatDateTime(request.createdAt)} · <em className={styles[waited.tone]}>{waited.text}</em></small>
            </div>
          </div>
          <div className={styles.actions}>
            <button type="button" className="button button-danger" disabled={Boolean(busyId)} onClick={() => setRejecting(request)}>Отклонить</button>
            <button type="button" className="button button-success" disabled={Boolean(busyId)} onClick={() => void decide(request, "approved")}>{busyId === request.id ? "Принимаем…" : "Принять"}</button>
          </div>
        </li>;
      })}
    </ul>
    {rejecting && <ConfirmModal title="Отклонить заявку?" eyebrow="Участник не попадёт в команду" confirmLabel="Отклонить" busyLabel="Отклоняем…" busy={busyId === rejecting.id}
      description={<>«{rejecting.userName || "Новый участник"}» не получит доступ к заданиям команды. Новую заявку можно будет отправить позже.</>}
      onClose={() => setRejecting(null)} onConfirm={() => void decide(rejecting, "rejected").then((done) => { if (done) setRejecting(null); })} />}
    {acceptingAll && <ConfirmModal title="Принять всех?" eyebrow="Подтверждение" confirmLabel={`Принять ${requests.length}`} busyLabel="Принимаем…" busy={busyId === "all"}
      description={<>В команду вступят {requests.length} {plural(requests.length, "человек", "человека", "человек")}. Каждый сразу увидит задания и объявления.</>}
      onClose={() => setAcceptingAll(false)} onConfirm={() => void acceptAll()} />}
  </div>;
}
