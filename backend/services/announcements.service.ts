import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";

export type AnnouncementInput = {
  title?: string;
  content?: string;
  isActive?: boolean;
};

const announcementSelect = "id,team_id,author_id,title,content,is_active,created_at,updated_at";

export async function findAnnouncements(options: { teamId?: string; includeInactive?: boolean } = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  let query = supabase
    .from("announcements")
    .select(announcementSelect)
    .order("created_at", { ascending: false });

  if (options.teamId) query = query.eq("team_id", options.teamId);
  if (!options.includeInactive) query = query.eq("is_active", true);

  const result = await query;
  return result.error ? { error: result.error } : { data: result.data };
}

export async function insertAnnouncement(input: {
  teamId: string;
  authorId: string;
  title: string;
  content: string;
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
      is_active: true,
    })
    .select(announcementSelect)
    .single();

  return result.error ? { error: result.error } : { data: result.data };
}

export async function patchAnnouncement(
  id: string,
  input: AnnouncementInput,
  teamId?: string,
) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.content !== undefined) patch.content = input.content;
  if (input.isActive !== undefined) patch.is_active = input.isActive;

  let query = supabase.from("announcements").update(patch).eq("id", id);
  if (teamId) query = query.eq("team_id", teamId);

  const result = await query.select(announcementSelect).single();
  return result.error ? { error: result.error } : { data: result.data };
}

export async function removeAnnouncement(id: string, teamId?: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  let query = supabase.from("announcements").delete().eq("id", id);
  if (teamId) query = query.eq("team_id", teamId);

  const result = await query;
  return result.error ? { error: result.error } : { data: true };
}
