import { failure, ok } from "@/backend/http/api-response";
import { getRequestUser } from "@/backend/http/auth-guard";
import { isUuid } from "@/backend/http/security";
import { findAccountById } from "@/backend/services/auth.service";
import { createTeamInvitation, getNetworkForViewer, updateNetworkUser } from "@/backend/services/network.service";

async function currentUser(request: Request) {
  const sessionUser = getRequestUser(request);
  if (!sessionUser) return null;
  if (sessionUser.id === "ceo") return sessionUser;
  return (await findAccountById(sessionUser.id)) || (process.env.NEXT_PUBLIC_SUPABASE_URL ? null : sessionUser);
}

export async function listNetwork(request: Request) {
  const user = await currentUser(request);
  if (!user) return failure("Сначала войдите в аккаунт.", 401);
  if (!user.teamId || (user.role !== "admin" && user.role !== "member")) return failure("Недостаточно прав.", 403);
  const result = await getNetworkForViewer(user);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("error" in result) return failure("Не удалось загрузить структуру сети.");
  return ok({ users: result.data });
}

export async function createInvitation(request: Request) {
  const user = await currentUser(request);
  if (!user || (user.role !== "admin" && user.role !== "member")) return failure("Недостаточно прав для приглашений.", user ? 403 : 401);
  if (!user.teamId) return failure("Сначала нужно назначить команду.", 400);
  const result = await createTeamInvitation(user.teamId, user.id);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if (result.error) return failure("Не удалось создать ссылку приглашения.");
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  return ok({ invitation: { ...result.data, url: `${origin.replace(/\/$/, "")}/?invite=${encodeURIComponent(result.data.token)}` } }, 201);
}

export async function patchNetworkUser(request: Request, id: string) {
  const user = await currentUser(request);
  if (!user || user.role !== "admin") return failure("Только руководитель команды может менять структуру.", user ? 403 : 401);
  if (!isUuid(id)) return failure("Некорректный пользователь.", 400);
  try {
    const body = await request.json();
    if (body.parentUserId !== undefined && body.parentUserId !== null && body.parentUserId !== "" && !isUuid(body.parentUserId)) return failure("Некорректный руководитель.", 400);
    for (const key of ["canReview", "canPublishTasks"]) {
      if (body[key] !== undefined && typeof body[key] !== "boolean") return failure("Некорректное значение разрешения.", 400);
    }
    const result = await updateNetworkUser(user, id, {
      parentUserId: body.parentUserId === "" ? null : body.parentUserId,
      canReview: body.canReview,
      canPublishTasks: body.canPublishTasks,
    });
    if ("unavailable" in result) return failure("База данных не настроена.", 503);
    if ("forbidden" in result) return failure("Пользователь не входит в вашу команду.", 403);
    if ("validationError" in result) return failure(result.validationError || "Некорректные данные.", 400);
    if ("error" in result) return failure("Не удалось сохранить структуру сети.");
    return ok({ user: result.data });
  } catch {
    return failure("Некорректные данные.", 400);
  }
}
