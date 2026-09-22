-- Only for an EMPTY, DISPOSABLE PostgreSQL test database, never production.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
