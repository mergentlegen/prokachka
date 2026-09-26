-- NEW / EMPTY database only. psql -X -v ON_ERROR_STOP=1 -f supabase/bootstrap.sql
-- Existing installations: apply only the new migration; never replay schema.sql.
\set ON_ERROR_STOP on
\ir schema.sql
\ir telegram-integrity-migration.sql
\ir star-award-kinds-migration.sql
\ir 20260926-premium-five-stars.sql
\ir 20260917-architecture-integrity.sql
\ir 20260919-live-updates.sql
\ir 20260925-ready-programs.sql
\ir 20260925-ready-program-quiz-retry.sql
\ir 20260926-task-attachments.sql
\ir 20260926-welcome-videos.sql
\ir 20260926-welcome-video-branch-model.sql
\ir 20260926-welcome-video-tus-auth.sql
\ir 20260927-publication-pins.sql
\ir 20260927-starter-rules.sql
\ir 20260927-heart-survey.sql
\ir 20260928-publication-audiences.sql
