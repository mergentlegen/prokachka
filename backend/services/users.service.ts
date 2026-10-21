import { readPages } from "@/backend/infrastructure/supabase/read-pages";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

export async function findUsers(options: { teamId?: string; userId?: string; includeLogin?: boolean } = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const fields = options.includeLogin
    ? "id,name,avatar_path,login,role,team_id,team_joined_at,parent_user_id,can_review,can_publish_tasks,can_invite_members,created_at"
    : "id,name,avatar_path,role,team_id,team_joined_at,parent_user_id,can_review,can_publish_tasks,can_invite_members,created_at";
  let query = supabase.from("users").select(fields).order("created_at", { ascending: false });
  if (options.teamId) query = query.eq("team_id", options.teamId);
  if (options.userId) query = query.eq("id", options.userId);
  let levelsQuery = supabase.from("member_levels").select("user_id,level,users!member_levels_user_id_fkey!inner(team_id)").is("revoked_at", null);
  if (options.teamId) levelsQuery = levelsQuery.eq("users.team_id", options.teamId);
  if (options.userId) levelsQuery = levelsQuery.eq("user_id", options.userId);
  const [result, levels] = await Promise.all([readPages(query.order("id")), readPages(levelsQuery.order("user_id").order("level"))]);
  if (result.error) return { error: result.error };
  const rows = (result.data || []) as unknown as Array<Record<string, unknown>>;
  // Levels only label people and count who a task is for; without them the list still works.
  if (levels.error) { console.warn("Member levels are temporarily unavailable", { error: levels.error.message }); return { data: rows }; }
  const levelOf = new Map<string, number>();
  for (const row of levels.data || []) levelOf.set(String(row.user_id), Math.max(levelOf.get(String(row.user_id)) || 1, Number(row.level) || 1));
  return { data: rows.map((row) => levelOf.has(String(row.id)) ? { ...row, level: levelOf.get(String(row.id)) } : row) };
}

export async function saveUser(name: string, telegramId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.from("users").upsert({ name, telegram_id: telegramId, role: "member" }, { onConflict: "telegram_id" }).select("id,name,avatar_path,login,role,team_id,team_joined_at,parent_user_id,can_review,can_publish_tasks,can_invite_members,created_at").single();
  return result.error ? { error: result.error } : { data: result.data };
}
export async function updateUserAccess(id: string, input: { role?: "admin" | "member"; teamId?: string | null; canReview?: boolean; canPublishTasks?: boolean; canInviteMembers?: boolean }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const patch: Record<string, unknown> = {};
  if (input.role === "admin" || input.role === "member") patch.role = input.role;
  if (input.teamId !== undefined) {
    const current = await supabase.from("users").select("team_id,team_joined_at").eq("id", id).single();
    if (current.error || !current.data) return { error: current.error || new Error("User not found") };
    patch.team_id = input.teamId || null;
    patch.team_joined_at = input.teamId ? (current.data.team_id === input.teamId && current.data.team_joined_at ? current.data.team_joined_at : new Date().toISOString()) : null;
    if (current.data.team_id !== input.teamId) patch.parent_user_id = null;
  }
  if (input.role === "admin") {
    patch.can_review = false;
    patch.can_publish_tasks = false;
    patch.can_invite_members = false;
    patch.parent_user_id = null;
  } else {
    if (input.canReview !== undefined) patch.can_review = input.canReview;
    if (input.canPublishTasks !== undefined) patch.can_publish_tasks = input.canPublishTasks;
    if (input.canInviteMembers !== undefined) patch.can_invite_members = input.canInviteMembers;
  }
  const result = await supabase.from("users").update(patch).eq("id", id).select("id,name,avatar_path,login,role,team_id,team_joined_at,parent_user_id,can_review,can_publish_tasks,can_invite_members,created_at").single();
  return result.error ? { error: result.error } : { data: result.data };
}

type DeletionImpact = { children: number; tasks: number; programs: number; announcements: number; otherSubmissions: number };
type DeletionResult = { notFound?: boolean; forbidden?: boolean; deleted?: boolean; impact?: DeletionImpact; authUserId?: string | null };

export async function previewUserDeletion(id: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_delete_user", { p_target: id, p_preview: true });
  return result.error ? { error: result.error } : { data: result.data as DeletionResult };
}

export async function deleteUser(id: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc("app_delete_user", { p_target: id, p_preview: false });
  if (result.error) return { error: result.error };
  const data = result.data as DeletionResult;
  if (!data.deleted || !data.authUserId) return { data: { ...data, cleanupPending: false } };

  // The SQL transaction already removed the app account and queued this Auth ID.
  // A failed Auth API call cannot resurrect the profile; the cleanup worker retries.
  try {
    const removed = await supabase.auth.admin.deleteUser(data.authUserId);
    if (removed.error && removed.error.status !== 404) return { data: { ...data, cleanupPending: true } };
    const cleared = await supabase.from("user_auth_cleanup_queue").delete().eq("auth_user_id", data.authUserId);
    return { data: { ...data, cleanupPending: Boolean(cleared.error) } };
  } catch {
    return { data: { ...data, cleanupPending: true } };
  }
}
