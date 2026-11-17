import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

export type CabinetTrainerOperation = "start" | "save" | "complete";
/** The cabinet trainers and their rules in the database (missions, questions of the check). */
export const CABINET_TRAINERS = {
  "free-membership": { rpc: "app_free_membership", missions: 7, questions: 5 },
  "marketing-director": { rpc: "app_marketing_director", missions: 6, questions: 4 },
} as const;
export type CabinetTrainerKind = keyof typeof CABINET_TRAINERS;
export function isCabinetTrainerKind(value: unknown): value is CabinetTrainerKind {
  return typeof value === "string" && Object.hasOwn(CABINET_TRAINERS, value);
}

// Cabinet trainers: the database checks the missions and the final check and gives the miles once.
export async function cabinetTrainerAction(kind: CabinetTrainerKind, userId: string, taskId: string, operation: CabinetTrainerOperation, step = 0, payload: Record<string, unknown> = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.rpc(CABINET_TRAINERS[kind].rpc, { p_user_id: userId, p_task_id: taskId, p_action: operation, p_step: step, p_payload: payload });
  if (result.error) return { error: result.error };
  const data = result.data as Record<string, unknown>;
  return typeof data.validationError === "string" ? { validationError: data.validationError } : { data };
}
