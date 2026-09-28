import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

type Actor = { id: string; role: string };
export type FeedbackScope = "personal" | "mentor";
const identity = (user: Actor) => ({ p_actor: user.id === "ceo" ? null : user.id, p_ceo: user.role === "ceo" });

export async function listFeedback(user: Actor, scope: FeedbackScope, offset = 0, onlyReply = false) {
  const db = getSupabaseAdmin();
  if (!db) return { unavailable: true as const };
  const result = await db.rpc("app_feedback_list_scoped", { ...identity(user), p_scope: scope, p_limit: 50, p_offset: offset, p_only_reply: onlyReply });
  return result.error ? { error: result.error } : { data: result.data };
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
  return result.error ? { error: result.error } : { data: result.data };
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
