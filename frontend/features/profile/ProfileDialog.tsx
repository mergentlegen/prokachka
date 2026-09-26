"use client";

import { useState } from "react";
import type { AuthUser } from "@/shared/domain/types";
import { Avatar } from "@/frontend/shared/Avatar";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import { ProfileEditor } from "./ProfileEditor";
import styles from "./ProfileEditor.module.css";

export function ProfileDialog({ user, onSaved, onClose }: { user: AuthUser; onSaved: (user: AuthUser) => void; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  return <ModalSheet title={editing ? "Редактировать профиль" : "Мой профиль"} onClose={() => { if (!busy) onClose(); }}>
    {editing ? <ProfileEditor user={user} onBusyChange={setBusy} onCancel={() => setEditing(false)} onSaved={(updated) => { onSaved(updated); setEditing(false); }} /> : <div className={styles.overview}>
      <div className={styles.identity}><Avatar name={user.name} src={user.avatarUrl} className={styles.previewAvatar} eager /><div><h2>{user.name}</h2><p>{user.role === "admin" ? "Наставник команды" : "Участник команды"}</p></div></div>
      {user.login && <div className={styles.accountInfo}><span>{user.login.includes("@") ? "Почта аккаунта" : "Логин аккаунта"}</span><strong>{user.login}</strong></div>}
      <button type="button" className={`button button-edit ${styles.editButton}`} onClick={() => setEditing(true)}>Редактировать профиль</button>
    </div>}
  </ModalSheet>;
}
