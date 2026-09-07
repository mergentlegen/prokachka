-- InCruises | Прокачка
-- Миграция существующей базы на регистрацию по email.
-- Подтверждение email намеренно не включено в MVP.

alter table public.users
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists email text;

-- Новые email сравниваются без учёта регистра.
create unique index if not exists users_email_lower_unique_idx
  on public.users (lower(email))
  where email is not null;

-- Если старый login уже был email, переносим его автоматически.
-- Старые логины без @ сохраняются и смогут быть обработаны отдельно.
update public.users
set email = lower(trim(login))
where email is null
  and position('@' in login) > 1
  and position('.' in split_part(login, '@', 2)) > 1;

comment on column public.users.email is 'Email для входа. Для старых аккаунтов может быть null до ручной миграции.';
comment on column public.users.first_name is 'Имя участника.';
comment on column public.users.last_name is 'Фамилия участника.';
