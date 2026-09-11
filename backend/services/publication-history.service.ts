import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { descendants, findTeamNetwork } from "@/backend/services/network.service";
import type { AuthUser } from "@/shared/domain/types";

export type PublicationHistoryItem = {
  id: string;
  type: "task" | "program" | "announcement";
  title: string;
  authorId?: string;
  authorName: string;
  teamId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deadlineAt?: string;
  stepCount?: number;
};

export async function findPublicationHistory(teamId: string, viewer: AuthUser) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  const [network, tasksResult, programsResult, announcementsResult] = await Promise.all([
    findTeamNetwork(teamId),
    supabase.from("tasks").select("id,title,team_id,publisher_id,is_active,created_at,updated_at,deadline_at,publication_type").eq("team_id", teamId).neq("publication_type", "sequential").order("created_at", { ascending: false }),
    supabase.from("task_programs").select("id,title,team_id,publisher_id,is_active,created_at,updated_at").eq("team_id", teamId).order("created_at", { ascending: false }),
    supabase.from("announcements").select("id,title,team_id,author_id,is_active,created_at,updated_at").eq("team_id", teamId).order("created_at", { ascending: false }),
  ]);

  if ("unavailable" in network) return network;
  if ("error" in network || tasksResult.error || programsResult.error || announcementsResult.error) {
    return { error: ("error" in network ? network.error : null) || tasksResult.error || programsResult.error || announcementsResult.error };
  }

  const visibleAuthorIds = viewer.role === "ceo" || viewer.role === "admin"
    ? new Set(network.data.map((row) => String(row.id)))
    : descendants(network.data, viewer.id, true);
  const authorNames = new Map(network.data.map((row) => [String(row.id), String(row.name || "Наставник")]));
  const canSeeAuthor = (authorId: unknown) => Boolean(authorId ? visibleAuthorIds.has(String(authorId)) : viewer.role === "ceo" || viewer.role === "admin");
  const authorName = (authorId: unknown) => authorId ? authorNames.get(String(authorId)) || "Наставник" : "Системная публикация";

  const items: PublicationHistoryItem[] = [
    ...(tasksResult.data || []).filter((task) => canSeeAuthor(task.publisher_id)).map((task) => ({
      id: String(task.id), type: "task" as const, title: String(task.title || "Без названия"),
      authorId: task.publisher_id ? String(task.publisher_id) : undefined, authorName: authorName(task.publisher_id), teamId: String(task.team_id),
      isActive: Boolean(task.is_active), createdAt: String(task.created_at), updatedAt: String(task.updated_at || task.created_at),
      deadlineAt: task.deadline_at ? String(task.deadline_at) : undefined,
    })),
    ...(programsResult.data || []).filter((program) => canSeeAuthor(program.publisher_id)).map((program) => ({
      id: String(program.id), type: "program" as const, title: String(program.title || "Без названия"),
      authorId: program.publisher_id ? String(program.publisher_id) : undefined, authorName: authorName(program.publisher_id), teamId: String(program.team_id),
      isActive: Boolean(program.is_active), createdAt: String(program.created_at), updatedAt: String(program.updated_at || program.created_at),
    })),
    ...(announcementsResult.data || []).filter((announcement) => canSeeAuthor(announcement.author_id)).map((announcement) => ({
      id: String(announcement.id), type: "announcement" as const, title: String(announcement.title || "Без названия"),
      authorId: announcement.author_id ? String(announcement.author_id) : undefined, authorName: authorName(announcement.author_id), teamId: String(announcement.team_id),
      isActive: Boolean(announcement.is_active), createdAt: String(announcement.created_at), updatedAt: String(announcement.updated_at || announcement.created_at),
    })),
  ];

  return { data: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}
