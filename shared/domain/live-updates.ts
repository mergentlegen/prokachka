import type { AuthUser } from "./types";

export const changeTopics = ["tasks", "programs", "submissions", "stars", "users", "network", "requests", "announcements", "teams", "session", "resync"] as const;
export type ChangeTopic = typeof changeTopics[number];
export function isChangeTopic(value: unknown): value is ChangeTopic {
  return typeof value === "string" && (changeTopics as readonly string[]).includes(value);
}
export function userScope(user: AuthUser | null) {
  return user ? [user.id, user.teamId, user.teamJoinedAt, user.role, user.parentUserId, user.canReview, user.canPublishTasks, user.canInviteMembers].join(":") : "";
}
export function resourceTopics(url: string): ChangeTopic[] {
  const [path, query = ""] = url.split("?");
  if (path === "/api/ranking") return ["submissions", "stars", "users"];
  if (path === "/api/submissions" && new URLSearchParams(query).has("summary")) return ["submissions", "requests", "users", "network"];
  if (path === "/api/submissions") return ["submissions", "tasks", "network"];
  if (path === "/api/tasks") return ["tasks", "programs", "submissions", "network"];
  if (path === "/api/programs/history") return ["programs", "tasks", "submissions", "users", "network"];
  if (path === "/api/publication-history") return ["programs", "tasks", "announcements", "users", "network"];
  if (path === "/api/programs") return ["programs", "tasks", "network"];
  if (path === "/api/ready-programs") return ["programs", "tasks", "network"];
  if (path === "/api/announcements") return ["announcements", "network"];
  if (path === "/api/stars") return ["stars", "users", "network"];
  if (path === "/api/users") return ["users", "network"];
  if (path === "/api/network") return ["users", "network"];
  if (path === "/api/team-requests") return ["requests", "users", "teams"];
  if (path === "/api/teams") return ["teams"];
  return [];
}
export function mutationTopics(url: string, method: string): ChangeTopic[] {
  if (url === "/api/profile") return ["users", "network", "requests"];
  if (url.startsWith("/api/network/users/")) return ["users", "network"];
  if (url.startsWith("/api/team-requests")) return ["requests", "users", "network"];
  if (url.startsWith("/api/users")) return ["users", "network", "requests"];
  if (url.startsWith("/api/teams")) return ["teams", "users", "network", "requests"];
  if (url.startsWith("/api/programs")) return ["programs", "tasks"];
  if (url.startsWith("/api/tasks")) return ["tasks", "submissions"];
  if (url.startsWith("/api/stars")) return ["stars"];
  if (url.startsWith("/api/announcements")) return ["announcements"];
  if (url.startsWith("/api/ready-programs/")) return ["submissions", "tasks", "programs"];
  if (url === "/api/ready-programs") return ["tasks", "programs"];
  // Preparing a Telegram answer does not yet create a submission.
  if (url.startsWith("/api/submissions/") && method !== "GET") return ["submissions", "tasks"];
  return [];
}

export type DatabaseChange = { topics: ChangeTopic[]; teamIds: string[]; userIds: string[]; catalog?: boolean };
export function topicsForViewer(change: DatabaseChange, user: AuthUser): ChangeTopic[] {
  const own = change.userIds.includes(user.id);
  if (user.role !== "ceo" && !own && !(user.teamId && change.teamIds.includes(user.teamId)) && !(change.catalog && !user.teamId)) return [];
  return change.topics.filter((topic) => {
    if (topic === "session") return own || user.role === "member" || change.catalog === true;
    if (topic === "requests") return own || user.role === "admin" || user.role === "ceo";
    return true;
  });
}
