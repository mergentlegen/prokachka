-- Store the participant's Telegram answer without copying media files to the VPS.
-- Run once in Supabase SQL Editor before deploying the updated application.

alter table public.submissions
  add column if not exists media_type text;

alter table public.submissions
  add column if not exists telegram_file_id text;

alter table public.submissions
  add column if not exists answer_text text not null default '';

alter table public.submissions
  drop constraint if exists submissions_media_type_check;

alter table public.submissions
  add constraint submissions_media_type_check
  check (media_type is null or media_type in ('text', 'photo', 'video', 'document'));

alter table public.submissions
  drop constraint if exists submissions_answer_text_length_check;

alter table public.submissions
  add constraint submissions_answer_text_length_check
  check (char_length(answer_text) <= 10000);
