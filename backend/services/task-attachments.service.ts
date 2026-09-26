import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { getMemberTaskFeed } from "@/backend/services/member-progress.service";
import { descendants, findTeamNetwork, isAudienceVisible } from "@/backend/services/network.service";
import type { AuthUser, TaskAttachment } from "@/shared/domain/types";

export const TASK_ATTACHMENT_BUCKET = "task-attachments";
export const TASK_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
export const TASK_ATTACHMENT_MAX_PER_TASK = 10;

type AttachmentRow = { id: string; task_id: string; storage_path: string; file_name: string; content_type: string; size_bytes: number; created_at: string };
function publicAttachment(row: Pick<AttachmentRow, "id" | "file_name" | "content_type" | "size_bytes" | "created_at">): TaskAttachment {
  return { id: row.id, fileName: row.file_name, contentType: "application/pdf", sizeBytes: Number(row.size_bytes), createdAt: row.created_at };
}

export async function listTaskAttachments(taskIds: string[]) {
  if (!taskIds.length) return { data: new Map<string, TaskAttachment[]>() };
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.from("task_attachments").select("id,task_id,file_name,content_type,size_bytes,created_at").in("task_id", taskIds).order("created_at");
  if (result.error) return { error: result.error };
  const grouped = new Map<string, TaskAttachment[]>();
  for (const row of (result.data || []) as AttachmentRow[]) {
    const list = grouped.get(row.task_id) || [];
    list.push(publicAttachment(row)); grouped.set(row.task_id, list);
  }
  return { data: grouped };
}

export async function removeAttachmentPaths(paths: string[]) {
  if (!paths.length) return { warning: false };
  const supabase = getSupabaseAdmin();
  if (!supabase) return { warning: true };
  let warning = false;
  for (let index = 0; index < paths.length; index += 100) {
    const result = await supabase.storage.from(TASK_ATTACHMENT_BUCKET).remove(paths.slice(index, index + 100));
    if (result.error) warning = true;
  }
  return { warning };
}

export async function mayViewTaskAttachment(taskId: string, user: AuthUser) {
  if (user.role === "ceo") return true;
  if (!user.teamId) return false;
  const supabase = getSupabaseAdmin();
  if (!supabase) return false;
  const task = await supabase.from("tasks").select("id,team_id,publisher_id,audience_root_id").eq("id", taskId).maybeSingle();
  if (task.error || !task.data || task.data.team_id !== user.teamId) return false;
  if (user.role === "admin") return true;
  if (!user.canReview && !user.canPublishTasks) {
    const feed = await getMemberTaskFeed(user.id, user.teamId, user.teamJoinedAt);
    return "data" in feed && Boolean(feed.data?.some((item) => item.id === taskId));
  }
  const network = await findTeamNetwork(user.teamId);
  if (!("data" in network) || !network.data) return false;
  const allowedAuthors = descendants(network.data, user.id, true);
  return isAudienceVisible(network.data, user.id, task.data.audience_root_id) || Boolean(task.data.publisher_id && allowedAuthors.has(String(task.data.publisher_id)));
}

async function manageableTask(taskId: string, user: AuthUser) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.from("tasks").select("id,team_id,publisher_id").eq("id", taskId).maybeSingle();
  if (result.error) return { error: result.error };
  if (!result.data) return { forbidden: true as const };
  const canManage = user.role === "ceo" || (user.teamId === result.data.team_id && (user.role === "admin" || (user.canPublishTasks && result.data.publisher_id === user.id)));
  return canManage ? { data: result.data } : { forbidden: true as const };
}

export async function uploadTaskAttachment(taskId: string, user: AuthUser, file: File) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const task = await manageableTask(taskId, user);
  if ("unavailable" in task) return { unavailable: true as const };
  if ("error" in task) return { error: task.error };
  if ("forbidden" in task) return { forbidden: true as const };
  if (file.size < 8 || file.size > TASK_ATTACHMENT_MAX_BYTES) return { validationError: "PDF должен быть не больше 15 МБ." };
  if (file.type && file.type !== "application/pdf" && file.type !== "application/octet-stream") return { validationError: "Можно прикрепить только PDF-файл." };
  const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const header = new TextDecoder("ascii").decode(bytes);
  if (!header.includes("%PDF-")) return { validationError: "Файл не похож на PDF. Проверьте выбранный документ." };

  const count = await supabase.from("task_attachments").select("id", { count: "exact", head: true }).eq("task_id", taskId);
  if (count.error) return { error: count.error };
  if ((count.count || 0) >= TASK_ATTACHMENT_MAX_PER_TASK) return { validationError: `К заданию можно прикрепить не больше ${TASK_ATTACHMENT_MAX_PER_TASK} PDF-файлов.` };

  const fileName = file.name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim().slice(0, 180) || "document.pdf";
  const storagePath = `${taskId}/${crypto.randomUUID()}.pdf`;
  const uploaded = await supabase.storage.from(TASK_ATTACHMENT_BUCKET).upload(storagePath, file, { contentType: "application/pdf", upsert: false, cacheControl: "3600" });
  if (uploaded.error) return { storageError: uploaded.error };
  const uploaderId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id) ? user.id : null;
  const inserted = await supabase.from("task_attachments").insert({ task_id: taskId, storage_path: storagePath, file_name: fileName, content_type: "application/pdf", size_bytes: file.size, uploaded_by: uploaderId }).select("id,task_id,storage_path,file_name,content_type,size_bytes,created_at").single();
  if (inserted.error) {
    await supabase.storage.from(TASK_ATTACHMENT_BUCKET).remove([storagePath]);
    if (inserted.error.message.includes("task_attachment_limit")) return { validationError: `К заданию можно прикрепить не больше ${TASK_ATTACHMENT_MAX_PER_TASK} PDF-файлов.` };
    return { error: inserted.error };
  }
  return { data: publicAttachment(inserted.data as AttachmentRow) };
}

export async function getTaskAttachment(taskId: string, attachmentId: string, user: AuthUser) {
  if (!(await mayViewTaskAttachment(taskId, user))) return { forbidden: true as const };
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const result = await supabase.from("task_attachments").select("id,task_id,storage_path,file_name,content_type,size_bytes,created_at").eq("task_id", taskId).eq("id", attachmentId).maybeSingle();
  if (result.error) return { error: result.error };
  if (!result.data) return { forbidden: true as const };
  const downloaded = await supabase.storage.from(TASK_ATTACHMENT_BUCKET).download(result.data.storage_path);
  if (downloaded.error || !downloaded.data) return { error: downloaded.error };
  return { data: { file: downloaded.data, attachment: publicAttachment(result.data as AttachmentRow) } };
}

export async function deleteTaskAttachment(taskId: string, attachmentId: string, user: AuthUser) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { unavailable: true as const };
  const task = await manageableTask(taskId, user);
  if ("unavailable" in task) return { unavailable: true as const };
  if ("error" in task) return { error: task.error };
  if ("forbidden" in task) return { forbidden: true as const };
  const found = await supabase.from("task_attachments").select("id,storage_path").eq("task_id", taskId).eq("id", attachmentId).maybeSingle();
  if (found.error) return { error: found.error };
  if (!found.data) return { forbidden: true as const };
  const removed = await supabase.from("task_attachments").delete().eq("id", attachmentId).eq("task_id", taskId);
  if (removed.error) return { error: removed.error };
  const storage = await supabase.storage.from(TASK_ATTACHMENT_BUCKET).remove([found.data.storage_path]);
  return { data: true, storageCleanupWarning: Boolean(storage.error) };
}
