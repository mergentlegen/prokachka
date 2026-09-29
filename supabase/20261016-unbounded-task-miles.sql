-- No product-level 100-mile ceiling; PostgreSQL integer is the technical limit.
-- Safe to apply after the manually executed organization-game rollback.
begin;

alter table public.tasks drop constraint if exists tasks_max_points_check;
alter table public.tasks add constraint tasks_max_points_check check (max_points >= 0);

alter table public.submissions drop constraint if exists submissions_points_check;
alter table public.submissions add constraint submissions_points_check check (points >= 0);

alter table public.feedback_events drop constraint if exists feedback_events_points_check;
alter table public.feedback_events add constraint feedback_events_points_check check (points is null or points >= 0);

notify pgrst, 'reload schema';
commit;
