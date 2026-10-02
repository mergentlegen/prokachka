import { failure, ok } from "@/backend/http/api-response";
import { findInvitationByToken } from "@/backend/services/network.service";

// Anyone holding an invitation link may see who invites them and to which team, before signing up.
export async function previewInvitation(token: string) {
  if (token.length < 20 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) return failure("Ссылка приглашения недействительна.", 404);
  const result = await findInvitationByToken(token);
  if ("unavailable" in result) return failure("База данных не настроена.", 503);
  if ("validationError" in result) return failure(result.validationError || "Ссылка приглашения недействительна.", 404);
  if ("error" in result) return failure("Не удалось проверить приглашение.");
  return ok({ invitation: result.preview });
}
