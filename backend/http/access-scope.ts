import type { AuthUser } from "@/shared/domain/types";

export type TeamScope = { kind: "all" } | { kind: "team"; teamId: string };

export function teamScope(user: AuthUser): TeamScope | null {
  if (user.role === "ceo") return { kind: "all" };
  return user.teamId ? { kind: "team", teamId: user.teamId } : null;
}

export function isValidScope(scope: TeamScope | undefined): scope is TeamScope {
  return Boolean(scope && (scope.kind === "all" || (scope.kind === "team" && scope.teamId)));
}
