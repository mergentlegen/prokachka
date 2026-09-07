import { getSessionToken, readSession } from "@/backend/services/auth.service";
import type { AuthUser, UserRole } from "@/shared/domain/types";

export function getRequestUser(request: Request): AuthUser | null {
  const token = getSessionToken(request);
  return readSession(token);
}

export function hasRole(user: AuthUser | null, roles: UserRole[]) {
  return Boolean(user && roles.includes(user.role));
}