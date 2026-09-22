-- NEW / EMPTY database only. psql -X -v ON_ERROR_STOP=1 -f supabase/bootstrap.sql
-- Existing installations: apply only the new migration; never replay schema.sql.
\set ON_ERROR_STOP on
\ir schema.sql
\ir telegram-integrity-migration.sql
\ir star-award-kinds-migration.sql
\ir 20260917-architecture-integrity.sql
\ir 20260919-live-updates.sql
