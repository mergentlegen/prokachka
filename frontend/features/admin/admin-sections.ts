import type { AdminDataset } from "@/frontend/shared/api/admin-client";
import type { AuthUser } from "@/shared/domain/types";

export type AdminSection = "dashboard" | "tasks" | "programs" | "review" | "history" | "feedback" | "requests" | "announcements" | "stars" | "network" | "welcome-video";

export const sectionDatasets: Record<AdminSection, readonly AdminDataset[]> = {
  dashboard: ["users", "tasks", "submissions"],
  tasks: ["tasks", "submissions", "programs", "users"],
  programs: ["programs", "tasks"],
  review: ["users", "tasks", "submissions"],
  history: ["users", "tasks", "submissions"],
  feedback: ["submissions", "users", "tasks"],
  requests: ["users"],
  announcements: ["announcements"],
  stars: ["users", "starAwards"],
  network: [],
  "welcome-video": [],
};

type SectionViewer = Pick<AuthUser, "role" | "canPublishTasks" | "canReview">;

/** Whether this mentor sees the section in the menu (and may open it from the address bar). */
export function adminSectionAllowed(section: AdminSection, viewer: SectionViewer) {
  const canPublish = viewer.role === "admin" || Boolean(viewer.canPublishTasks);
  const canReview = viewer.role === "admin" || Boolean(viewer.canReview);
  if (section === "tasks" || section === "programs" || section === "announcements" || section === "welcome-video") return canPublish;
  if (section === "review" || section === "feedback" || section === "history" || section === "stars" || section === "requests") return canReview;
  return true;
}

/** Reads a section name from the address; anything unknown or closed to this mentor is ignored. */
export function adminSectionFromPage(value: string | null, viewer: SectionViewer): AdminSection | null {
  const section = (Object.keys(sectionDatasets) as AdminSection[]).find((item) => item === value);
  return section && adminSectionAllowed(section, viewer) ? section : null;
}
