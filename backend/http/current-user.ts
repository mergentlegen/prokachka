import { getRequestUser } from "@/backend/http/auth-guard";
import { findAccountById } from "@/backend/services/auth.service";
import type { AuthUser } from "@/shared/domain/types";

// Request-local only: never cache permissions between requests or users.
const users = new WeakMap<Request, Promise<AuthUser | null>>();

export function getCurrentUser(request: Request): Promise<AuthUser | null> {
  let result = users.get(request);
  if (!result) {
    result = resolveUser(request);
    users.set(request, result);
  }
  return result;
}

async function resolveUser(request: Request): Promise<AuthUser | null> {
  const session = getRequestUser(request);
  if (!session) return null;
  if (session.id === "ceo" && session.role === "ceo") return session;
  const current = await findAccountById(session.id);
  if (current) return (current.sessionVersion || 0) === (session.sessionVersion || 0) ? current : null;
  return process.env.NODE_ENV !== "production" && !process.env.NEXT_PUBLIC_SUPABASE_URL ? session : null;
}
