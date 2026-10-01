import type { AdminDataset } from "@/frontend/shared/api/admin-client";

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
