import { memberFeedShowsTask } from "@/backend/services/member-progress.service";
import type { AuthUser } from "@/shared/domain/types";

/** Mentors of the team see a task's materials; a participant those of tasks in their feed and of program steps they passed. */
export async function canOpenTaskMaterials(user: AuthUser, taskId: string, teamId: string) {
  if (!user.teamId || user.teamId !== teamId) return false;
  if (user.role === "admin" || user.canReview || user.canPublishTasks) return true;
  if (user.role !== "member") return false;
  return memberFeedShowsTask(user.id, user.teamId, user.teamJoinedAt, taskId);
}
