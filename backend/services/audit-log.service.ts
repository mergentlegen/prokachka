import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { isUuid } from "@/backend/http/security";
import type { AuthUser } from "@/shared/domain/types";

export type AuditAction =
  | "user.access" | "user.delete" | "user.network"
  | "team.create" | "team.update" | "team.disable" | "team.enable" | "team.delete"
  | "request.approve" | "request.reject"
  | "task.create" | "task.delete" | "task.nudge" | "task.video" | "program.create" | "program.delete"
  | "announcement.create" | "announcement.delete"
  | "star.award" | "star.revoke";

export type AuditEntry = { action: AuditAction; targetId?: string; targetLabel?: string; teamId?: string | null; details?: Record<string, unknown> };

export type AuditLogItem = {
  id: number; createdAt: string; actorId?: string; actorName: string; actorRole: AuthUser["role"]; action: AuditAction;
  targetId?: string; targetLabel?: string; teamId?: string; teamLabel?: string; details: Record<string, unknown>;
};

type Actor = Pick<AuthUser, "id" | "name" | "role">;

/** Writes one journal line. The journal records actions, it never blocks them: a failure is only logged. */
export async function recordAudit(actor: Actor, entry: AuditEntry) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return;
    const result = await supabase.rpc("app_record_audit", {
      p_actor_id: isUuid(actor.id) ? actor.id : null, p_actor_name: actor.role === "ceo" && !isUuid(actor.id) ? "CEO" : actor.name,
      p_actor_role: actor.role, p_action: entry.action, p_target_id: entry.targetId || null, p_target_label: entry.targetLabel || null,
      p_team_id: entry.teamId && isUuid(entry.teamId) ? entry.teamId : null, p_details: entry.details || {},
    });
    if (result.error) console.warn("Audit entry was not saved", { action: entry.action, code: result.error.code });
  } catch {
    console.warn("Audit entry was not saved", { action: entry.action });
  }
}

export type AuditUserSnapshot = { name: string; role: string; teamId: string | null; parentUserId: string | null; canReview: boolean; canPublishTasks: boolean };

/** What a person looked like before a change, so the journal can say "from → to". */
export async function auditUser(id: string): Promise<AuditUserSnapshot | null> {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase || !isUuid(id)) return null;
    const result = await supabase.from("users").select("name,role,team_id,parent_user_id,can_review,can_publish_tasks").eq("id", id).maybeSingle();
    if (result.error || !result.data) return null;
    const row = result.data;
    return { name: String(row.name || ""), role: String(row.role), teamId: row.team_id ? String(row.team_id) : null, parentUserId: row.parent_user_id ? String(row.parent_user_id) : null, canReview: Boolean(row.can_review), canPublishTasks: Boolean(row.can_publish_tasks) };
  } catch { return null; }
}

const labelColumns = { teams: "name", tasks: "title,team_id", task_programs: "title,team_id", announcements: "title,team_id" } as const;

/** The name of a record read before it is deleted; the journal keeps it after the row is gone. */
export async function auditRecord(table: keyof typeof labelColumns, id: string): Promise<{ label: string; teamId: string | null } | null> {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase || !isUuid(id)) return null;
    const result = await supabase.from(table).select(labelColumns[table]).eq("id", id).maybeSingle();
    if (result.error || !result.data) return null;
    const row = result.data as unknown as Record<string, unknown>;
    return { label: String(row.name ?? row.title ?? ""), teamId: table === "teams" ? id : row.team_id ? String(row.team_id) : null };
  } catch { return null; }
}

/** Star awards and join requests are named after the participant they concern. */
export async function auditPersonRecord(table: "star_awards" | "team_join_requests", id: string): Promise<{ label: string; teamId: string | null; stars?: number } | null> {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase || !isUuid(id)) return null;
    const result = await supabase.from(table).select(table === "star_awards" ? "team_id,stars,users!user_id(name)" : "team_id,users!team_join_requests_user_id_fkey(name)").eq("id", id).maybeSingle();
    if (result.error || !result.data) return null;
    const row = result.data as unknown as { team_id?: string; stars?: number; users?: { name?: string } | Array<{ name?: string }> };
    const person = Array.isArray(row.users) ? row.users[0] : row.users;
    return { label: String(person?.name || ""), teamId: row.team_id ? String(row.team_id) : null, stars: row.stars };
  } catch { return null; }
}

/** Newest first, a page at a time; `before` is the id of the last entry already shown. */
export async function findAuditLog(options: { before?: number; limit: number }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  let query = supabase.from("audit_log").select("id,created_at,actor_id,actor_name,actor_role,action,target_id,target_label,team_id,team_label,details").order("id", { ascending: false }).limit(options.limit);
  if (options.before) query = query.lt("id", options.before);
  const result = await query;
  if (result.error) return { error: result.error };
  return {
    data: (result.data || []).map((row): AuditLogItem => ({
      id: Number(row.id), createdAt: String(row.created_at), actorId: row.actor_id ? String(row.actor_id) : undefined, actorName: String(row.actor_name),
      actorRole: row.actor_role as AuditLogItem["actorRole"], action: row.action as AuditAction, targetId: row.target_id ? String(row.target_id) : undefined,
      targetLabel: row.target_label ? String(row.target_label) : undefined, teamId: row.team_id ? String(row.team_id) : undefined,
      teamLabel: row.team_label ? String(row.team_label) : undefined, details: (row.details || {}) as Record<string, unknown>,
    })),
  };
}
