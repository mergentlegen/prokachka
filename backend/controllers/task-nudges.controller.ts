import { getCurrentUser } from "@/backend/http/current-user";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { auditRecord, recordAudit } from "@/backend/services/audit-log.service";
import { taskNudge } from "@/backend/services/task-nudges.service";
import { scheduleTelegramDelivery } from "@/backend/services/telegram-notifications.service";

async function run(request: Request, taskId: string, send: boolean) {
  if (!isUuid(taskId)) return failure("Некорректное задание.", 400);
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  // The team leader, branch reviewers and publishers; the database narrows reviewers to their branch.
  if (!(user.role === "admin" || (user.role === "member" && (user.canReview || user.canPublishTasks))) || !user.teamId) return failure("Недостаточно прав.", 403);
  const result = await taskNudge(user.id, taskId, send);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("forbidden" in result) return failure("У вас нет доступа к этому заданию.", 403);
  if ("validationError" in result) return failure(result.validationError || "Напоминание не отправлено.", 409);
  if ("error" in result) return failure(send ? "Не удалось отправить напоминание." : "Не удалось проверить, кому напомнить.");
  if (send) {
    scheduleTelegramDelivery();
    const task = await auditRecord("tasks", taskId);
    await recordAudit(user, { action: "task.nudge", targetId: taskId, targetLabel: task?.label, teamId: task?.teamId || user.teamId, details: { recipients: result.data.queued } });
  }
  return ok({ nudge: result.data });
}

export function previewTaskNudge(request: Request, taskId: string) { return run(request, taskId, false); }
export function sendTaskNudge(request: Request, taskId: string) { return run(request, taskId, true); }
