import { readPages } from "@/backend/infrastructure/supabase/read-pages";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { descendants, findTeamNetwork, isAudienceVisible } from "@/backend/services/network.service";
import { releaseAnnouncementPhotoIntent, uploadAnnouncementPhotos, validatePhotoFiles, withAnnouncementPhotoUrls, type StoredAnnouncementPhoto } from "@/backend/services/announcement-photos.service";

type AnnouncementViewer = { id: string; role: string; teamId?: string; canPublishTasks?: boolean };

export type AnnouncementInput = {
  title?: string;
  content?: string;
  resourceUrl?: string | null;
  isActive?: boolean;
  isPinned?: boolean;
  photoFiles?: File[];
  keepPhotoIds?: string[];
};

const announcementSelect = "id,team_id,author_id,audience_root_id,title,content,resource_url,photos,is_active,is_pinned,pinned_at,created_at,updated_at";

export async function findAnnouncements(options: { teamId?: string; includeInactive?: boolean; viewer?: AnnouncementViewer } = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  let query = supabase
    .from("announcements")
    .select(announcementSelect)
    .order("is_pinned", { ascending: false }).order("pinned_at", { ascending: true }).order("created_at", { ascending: true });

  if (options.teamId) query = query.eq("team_id", options.teamId);
  if (!options.includeInactive) query = query.eq("is_active", true);

  const result = await readPages(query.order("id"));
  if (result.error) return { error: result.error };
  if (!options.teamId || !options.viewer || options.viewer.role === "ceo" || options.viewer.role === "admin") return { data: await withAnnouncementPhotoUrls(result.data || []) };
  const network = await findTeamNetwork(options.teamId);
  if ("unavailable" in network) return { unavailable: true as const };
  if ("error" in network) return { error: network.error };
  const allowedAuthors = descendants(network.data, options.viewer?.id || "", true);
  const visible = (result.data || []).filter((announcement) => isAudienceVisible(network.data, options.viewer?.id || "", announcement.audience_root_id) || (announcement.author_id && allowedAuthors.has(String(announcement.author_id))));
  return { data: await withAnnouncementPhotoUrls(visible) };
}

export async function insertAnnouncement(input: {
  teamId: string;
  authorId: string;
  title: string;
  content: string;
  resourceUrl?: string | null;
  audienceRootId?: string | null;
  photoFiles?: File[];
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  const files = input.photoFiles || [];
  const invalid = validatePhotoFiles(files);
  if (invalid) return { validationError: invalid };
  const id = crypto.randomUUID();
  const uploaded = await uploadAnnouncementPhotos(id, files);
  if (!uploaded.data || !uploaded.paths) return uploaded;
  const result = await supabase
    .from("announcements")
    .insert({
      id,
      team_id: input.teamId,
      author_id: input.authorId,
      title: input.title,
      content: input.content,
      resource_url: input.resourceUrl || null,
      photos: uploaded.data,
      audience_root_id: input.audienceRootId || null,
      is_active: true,
    })
    .select(announcementSelect)
    .single();

  if (result.error) return { error: result.error };
  await releaseAnnouncementPhotoIntent(uploaded.paths);
  return { data: (await withAnnouncementPhotoUrls([result.data]))[0] };
}

export async function patchAnnouncement(
  id: string,
  input: AnnouncementInput,
  actor?: AnnouncementViewer,
) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };

  const current = await supabase.from("announcements").select("id,team_id,author_id,photos,updated_at").eq("id", id).maybeSingle();
  if (current.error || !current.data) return { forbidden: true as const };
  const canEdit = actor?.role === "ceo" || (Boolean(actor?.teamId) && current.data.team_id === actor?.teamId && (actor?.role === "admin" || (actor?.canPublishTasks === true && current.data.author_id === actor.id)));
  if (!canEdit) return { forbidden: true as const };
  const existingPhotos = Array.isArray(current.data.photos) ? current.data.photos as StoredAnnouncementPhoto[] : [];
  const keepIds = input.keepPhotoIds;
  if (keepIds && (new Set(keepIds).size !== keepIds.length || keepIds.some((photoId) => !existingPhotos.some((photo) => photo.id === photoId))))
    return { validationError: "Список фотографий изменился. Обновите объявление и попробуйте ещё раз." };
  const retained = keepIds ? existingPhotos.filter((photo) => keepIds.includes(photo.id)) : existingPhotos;
  const files = input.photoFiles || [];
  const invalid = validatePhotoFiles(files, retained.length);
  if (invalid) return { validationError: invalid };
  const uploaded = await uploadAnnouncementPhotos(id, files);
  if (!uploaded.data || !uploaded.paths) return uploaded;
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.content !== undefined) patch.content = input.content;
  if (input.resourceUrl !== undefined) patch.resource_url = input.resourceUrl || null;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (input.isPinned !== undefined) patch.is_pinned = input.isPinned;
  if (keepIds || files.length) patch.photos = [...retained, ...uploaded.data];

  let query = supabase.from("announcements").update(patch).eq("id", id).eq("updated_at", current.data.updated_at);
  if (actor?.role !== "ceo" && actor?.teamId) query = query.eq("team_id", actor.teamId);

  const result = await query.select(announcementSelect).single();
  if (result.error) return { error: result.error };
  await releaseAnnouncementPhotoIntent(uploaded.paths);
  return { data: (await withAnnouncementPhotoUrls([result.data]))[0] };
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
