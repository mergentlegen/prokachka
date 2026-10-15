import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { withAvatarUrls } from "@/backend/services/avatar-urls.service";

type Actor = { id: string; role: string };
export type FeedbackScope = "personal" | "mentor";
const identity = (user: Actor) => ({ p_actor: user.id === "ceo" ? null : user.id, p_ceo: user.role === "ceo" });
type AvatarRow = { avatar_path?: string | null };

// The database returns private photo paths; the browser gets short-lived links instead.
async function withPhotos(rows: unknown) {
  if (!Array.isArray(rows)) return rows;
  const signed = await withAvatarUrls(rows as AvatarRow[]);
  return signed.map(({ avatar_url, ...row }) => ({ ...row, avatarUrl: avatar_url }));
}

export async function listFeedback(user: Actor, scope: FeedbackScope, offset = 0, onlyReply = false) {
  const db = getSupabaseAdmin();
  if (!db) return { unavailable: true as const };
  const result = await db.rpc("app_feedback_list_scoped", { ...identity(user), p_scope: scope, p_limit: 50, p_offset: offset, p_only_reply: onlyReply });
  return result.error ? { error: result.error } : { data: await withPhotos(result.data) };
}

export async function listFeedbackTaskGroups(user: Actor, offset = 0, onlyReply = false) {
  const db = getSupabaseAdmin();
  if (!db) return { unavailable: true as const };
  const result = await db.rpc("app_feedback_task_groups", { ...identity(user), p_limit: 50, p_offset: offset, p_only_reply: onlyReply });
  return result.error ? { error: result.error } : { data: result.data };
}

export async function listFeedbackForTask(user: Actor, taskKey: string, offset = 0, onlyReply = false) {
  const db = getSupabaseAdmin();
  if (!db) return { unavailable: true as const };
  const result = await db.rpc("app_feedback_list_task", { ...identity(user), p_task_key: taskKey, p_limit: 50, p_offset: offset, p_only_reply: onlyReply });
  return result.error ? { error: result.error } : { data: await withPhotos(result.data) };
}

// Conversations across all tasks: «Ждут ответа» (longest wait first) or a participant found by name.
export async function listMentorThreads(user: Actor, query: string, offset = 0, onlyReply = false) {
  const db = getSupabaseAdmin();
  if (!db) return { unavailable: true as const };
  const result = await db.rpc("app_feedback_mentor_threads", { ...identity(user), p_query: query, p_only_reply: onlyReply, p_limit: 50, p_offset: offset });
  return result.error ? { error: result.error } : { data: await withPhotos(result.data) };
}

// «Ответ не нужен»: the conversation stops waiting until the participant writes again.
export async function dismissFeedbackReply(id: string, user: Actor) {
  const db = getSupabaseAdmin();
  if (!db) return { unavailable: true as const };
  const result = await db.rpc("app_feedback_dismiss_reply", { p_thread: id, ...identity(user) });
  return result.error ? { error: result.error } : { data: result.data };
}

export async function countFeedback(user: Actor, scope: FeedbackScope) {
  const db = getSupabaseAdmin();
  if (!db) return { unavailable: true as const };
  const result = await db.rpc("app_feedback_counts_scoped", { ...identity(user), p_scope: scope });
  return result.error ? { error: result.error } : { data: result.data };
}

export async function getFeedback(id: string, user: Actor, scope: FeedbackScope) {
  const db = getSupabaseAdmin();
  if (!db) return { unavailable: true as const };
  const result = await db.rpc("app_feedback_detail_scoped", { p_thread: id, ...identity(user), p_scope: scope });
  if (result.error) return { error: result.error };
  const thread = result.data as { people?: unknown } | null;
  if (!thread || typeof thread !== "object" || !Array.isArray(thread.people)) return { data: thread };
  return { data: { ...thread, people: await withPhotos(thread.people) } };
}

export async function sendFeedback(id: string, user: Actor, scope: FeedbackScope, body: string, nonce: string) {
  const db = getSupabaseAdmin();
  if (!db) return { unavailable: true as const };
  const result = await db.rpc("app_feedback_send_scoped", { p_thread: id, ...identity(user), p_scope: scope, p_body: body, p_nonce: nonce });
  return result.error ? { error: result.error } : { data: result.data };
}

export async function markFeedbackRead(id: string, user: Actor, scope: FeedbackScope) {
  const db = getSupabaseAdmin();
  if (!db) return { unavailable: true as const };
  const result = await db.rpc("app_feedback_mark_read_scoped", { p_thread: id, ...identity(user), p_scope: scope });
  return result.error ? { error: result.error } : { data: result.data };
}
