import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { findTeamNetwork, isAudienceVisible } from "@/backend/services/network.service";

type AnnouncementViewer = { id: string; role: string; teamId?: string; canPublishTasks?: boolean };

export type AnnouncementInput = {
  title?: string;
  content?: string;
  resourceUrl?: string | null;
  isActive?: boolean;
};

const announcementSelect = "id,team_id,author_id,audience_root_id,title,content,resource_url,is_active,created_at,updated_at";

export async function findAnnouncements(options: { teamId?: string; includeInactive?: boolean; viewer?: AnnouncementViewer } = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  let query = supabase
    .from("announcements")
    .select(announcementSelect)
    .order("created_at", { ascending: false });

  if (options.teamId) query = query.eq("team_id", options.teamId);
  if (!options.includeInactive) query = query.eq("is_active", true);

  const result = await query;
  if (result.error) return { error: result.error };
  if (!options.teamId || !options.viewer || options.viewer.role === "ceo" || options.viewer.role === "admin") return { data: result.data };
  const network = await findTeamNetwork(options.teamId);
  if ("unavailable" in network) return { unavailable: true as const };
  if ("error" in network) return { error: network.error };
  return { data: (result.data || []).filter((announcement) => isAudienceVisible(network.data, options.viewer?.id || "", announcement.audience_root_id)) };
}

export async function insertAnnouncement(input: {
  teamId: string;
  authorId: string;
  title: string;
  content: string;
  resourceUrl?: string | null;
  audienceRootId?: string | null;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  const result = await supabase
    .from("announcements")
    .insert({
      team_id: input.teamId,
      author_id: input.authorId,
      title: input.title,
      content: input.content,
      resource_url: input.resourceUrl || null,
      audience_root_id: input.audienceRootId || null,
      is_active: true,
    })
    .select(announcementSelect)
    .single();

  return result.error ? { error: result.error } : { data: result.data };
}

export async function patchAnnouncement(
  id: string,
  input: AnnouncementInput,
  actor?: AnnouncementViewer,
) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  const current = await supabase.from("announcements").select("id,team_id,author_id").eq("id", id).maybeSingle();
  if (current.error || !current.data) return { forbidden: true as const };
  const canEdit = actor?.role === "ceo" || (Boolean(actor?.teamId) && current.data.team_id === actor?.teamId && (actor?.role === "admin" || (actor?.canPublishTasks === true && current.data.author_id === actor.id)));
  if (!canEdit) return { forbidden: true as const };
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.content !== undefined) patch.content = input.content;
  if (input.resourceUrl !== undefined) patch.resource_url = input.resourceUrl || null;
  if (input.isActive !== undefined) patch.is_active = input.isActive;

  let query = supabase.from("announcements").update(patch).eq("id", id);
  if (actor?.role !== "ceo" && actor?.teamId) query = query.eq("team_id", actor.teamId);

  const result = await query.select(announcementSelect).single();
  return result.error ? { error: result.error } : { data: result.data };
}

export async function removeAnnouncement(id: string, actor?: AnnouncementViewer) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  const current = await supabase.from("announcements").select("id,team_id,author_id").eq("id", id).maybeSingle();
  if (current.error || !current.data) return { forbidden: true as const };
  const canDelete = actor?.role === "ceo" || (Boolean(actor?.teamId) && current.data.team_id === actor?.teamId && (actor?.role === "admin" || (actor?.canPublishTasks === true && current.data.author_id === actor.id)));
  if (!canDelete) return { forbidden: true as const };
  let query = supabase.from("announcements").delete().eq("id", id);
  if (actor?.role !== "ceo" && actor?.teamId) query = query.eq("team_id", actor.teamId);

  const result = await query;
  return result.error ? { error: result.error } : { data: true };
}
