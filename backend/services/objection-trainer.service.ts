import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

export type TrainerKind = "podumayu" | "dorogo" | "piramida" | "garantii" | "bally" | "deshevle" | "strah" | "vremya" | "semya" | "setevoy" | "nepoluchitsya" | "zarabotok";
export type TrainerOperation = "start" | "answer" | "mark" | "complete";

// The database function of each objection trainer: it checks each pick, keeps the marks of the sorting round and gives the mile once.
const RPC: Record<TrainerKind, string> = { podumayu: "app_podumayu", dorogo: "app_dorogo", piramida: "app_piramida", garantii: "app_garantii", bally: "app_bally", deshevle: "app_deshevle", strah: "app_strah", vremya: "app_vremya", semya: "app_semya", setevoy: "app_setevoy", nepoluchitsya: "app_nepoluchitsya", zarabotok: "app_zarabotok" };

export async function objectionTrainerAction(kind: TrainerKind, userId: string, taskId: string, operation: TrainerOperation, step = 0, payload: Record<string, unknown> = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc(RPC[kind], { p_user_id: userId, p_task_id: taskId, p_action: operation, p_step: step, p_payload: payload });
  if (result.error) return { error: result.error };
  const data = result.data as Record<string, unknown>;
  return typeof data.validationError === "string" ? { validationError: data.validationError } : { data };
}
