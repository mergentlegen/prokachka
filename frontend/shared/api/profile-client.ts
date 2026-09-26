import type { AuthUser } from "@/shared/domain/types";
import { ApiError, authFetch, saveDevSession } from "./client";
import { announceMutation } from "./data-cache";
import { mutationTopics } from "@/shared/domain/live-updates";

export async function updateProfile(input: { firstName: string; lastName: string; expectedVersion: string; avatarAction: "keep" | "replace" | "remove"; avatar?: Blob }) {
  const form = new FormData();
  form.set("firstName", input.firstName); form.set("lastName", input.lastName);
  form.set("expectedVersion", input.expectedVersion); form.set("avatarAction", input.avatarAction);
  if (input.avatar) form.set("avatar", input.avatar, "avatar.webp");
  const response = await authFetch("/api/profile", { method: "PATCH", body: form });
  const body = await response.json().catch(() => ({})) as { user?: AuthUser; session?: string; message?: string };
  if (!response.ok || !body.user) throw new ApiError(body.message || "Не удалось сохранить профиль.", response.status);
  if (body.session) saveDevSession(body.session);
  announceMutation(mutationTopics("/api/profile", "PATCH"));
  return body.user;
}
