import type { AuthUser } from "@/shared/domain/types";
import { ApiError, authFetch, request, saveDevSession } from "./client";
import { announceMutation } from "./data-cache";
import { mutationTopics } from "@/shared/domain/live-updates";

export async function updateProfile(input: { firstName: string; lastName: string; expectedVersion: string; avatarAction: "keep" | "replace" | "remove"; avatar?: Blob; phone?: string }) {
  const form = new FormData();
  form.set("firstName", input.firstName); form.set("lastName", input.lastName);
  form.set("expectedVersion", input.expectedVersion); form.set("avatarAction", input.avatarAction);
  // Sent only when it changed: an empty value removes the phone.
  if (input.phone !== undefined) form.set("phone", input.phone);
  if (input.avatar) form.set("avatar", input.avatar, input.avatar.type === "image/jpeg" ? "avatar.jpg" : "avatar.webp");
  const response = await authFetch("/api/profile", { method: "PATCH", body: form });
  const body = await response.json().catch(() => ({})) as { user?: AuthUser; session?: string; message?: string };
  if (!response.ok || !body.user) throw new ApiError(body.message || "Не удалось сохранить профиль.", response.status);
  if (body.session) saveDevSession(body.session);
  announceMutation(mutationTopics("/api/profile", "PATCH"));
  return body.user;
}

export type ProfileExtras = { phone?: string; teamName?: string; mentorName?: string; branchSize?: number };
/** Own phone, team and mentor names — not part of the session. */
export async function loadProfileExtras(): Promise<ProfileExtras> {
  const { profile } = await request<{ profile: ProfileExtras }>("/api/profile", { cache: "no-store" });
  return profile || {};
}

/** Checks the current password and sets a new one; other devices will have to sign in again. */
export async function changePassword(currentPassword: string, newPassword: string) {
  const response = await authFetch("/api/profile/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
  const body = await response.json().catch(() => ({})) as { user?: AuthUser; session?: string; message?: string };
  if (!response.ok || !body.user) throw new ApiError(body.message || "Не удалось сменить пароль.", response.status);
  if (body.session) saveDevSession(body.session);
  return body.user;
}

/** Mentors only: phones of the participants they may see, by user id. */
export async function loadVisiblePhones(): Promise<Record<string, string>> {
  const { phones } = await request<{ phones: Record<string, string> }>("/api/contacts", { cache: "no-store" });
  return phones || {};
}

/** Unlinks Telegram from the own account. */
export async function unlinkTelegram() {
  await request<{ unlinked: boolean }>("/api/telegram/unlink", { method: "POST", body: "{}" });
}
