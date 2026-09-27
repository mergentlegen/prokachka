import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import type { TaskOrderSnapshot } from "@/shared/domain/task-feed-order";
import type { AuthUser } from "@/shared/domain/types";

type Outcome = TaskOrderSnapshot | { forbidden: true } | { conflict: true } | { invalid: true };
export async function getTaskOrder(userId: string, editing = true) {
  const db = getSupabaseAdmin();
  if (!db) return { unavailable: true as const };
  const result = await db.rpc("app_task_order_snapshot", { p_viewer: userId, p_edit: editing });
  return result.error ? { error: result.error } : { data: result.data as Outcome };
}
export async function saveTaskOrder(userId: string, revision: string, pinned: string[], regular: string[], inherit = false) {
  const db = getSupabaseAdmin();
  if (!db) return { unavailable: true as const };
  const result = await db.rpc("app_save_task_order", { p_actor: userId, p_revision: revision, p_pinned: pinned, p_regular: regular, p_inherit: inherit });
  return result.error ? { error: result.error } : { data: result.data as Outcome };
}

// Apply only after the existing audience/progress checks. Order cannot add a task
// to the feed. A logical game key also preserves the position of an older attempt.
export async function applyTaskFeedOrder<T extends Record<string, unknown>>(rows: T[], user: AuthUser, editing: boolean) {
  if (!user.teamId || user.role === "ceo" || !rows.some((row) => row.publication_type !== "sequential")) return { data: rows };
  const result = await getTaskOrder(user.id, editing && (user.role === "admin" || Boolean(user.canPublishTasks)));
  if ("error" in result && result.error?.code === "PGRST202") return { data: rows }; // additive deployment before migration
  if (!result.data) return result;
  if (!("items" in result.data)) return { error: new Error("Task order unavailable") };
  const ranks = new Map(result.data.items.map((item, rank) => [item.key, { rank, item }]));
  return { data: rows.map((row) => {
    const order = row.publication_type === "sequential" ? undefined : ranks.get(row.interactive_kind ? `game:${row.interactive_kind}` : String(row.id));
    return { ...row, feed_order: order?.rank, ...(order && row.interactive_kind ? { is_pinned: order.item.isPinned, pinned_at: order.item.pinnedAt } : {}) };
  }) };
}
