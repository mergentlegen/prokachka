import { getCurrentUser } from "@/backend/http/current-user";
import { failure, ok } from "@/backend/http/api-response";
import { isUuid } from "@/backend/http/security";
import { recordTaskLinkOpen } from "@/backend/services/task-reminders.service";

export async function taskLinkOpened(request: Request, taskId: string) {
  if (!isUuid(taskId)) return failure("Некорректное задание.", 400);
  const user = await getCurrentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  // Only participants owe work; mentors browsing a task never get reminders.
  if (user.role !== "member") return ok({ recorded: false });
  const result = await recordTaskLinkOpen(user.id, taskId);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("error" in result) return failure("Не удалось сохранить открытие материала.");
  return ok({ recorded: result.data });
}
