-- Fundação: extensões, papéis e helpers de tenancy.
create extension if not exists pgcrypto;
create extension if not exists citext;

create schema if not exists app;

-- Papel da aplicação: sem BYPASSRLS e sem superuser. As migrations rodam com outro papel (dono).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user login noinherit nobypassrls;
  end if;
end $$;

-- Contexto definido por transação: set_config('app.user_id', ..., true) e set_config('app.project_id', ..., true).
create or replace function app.current_user_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;
create or replace function app.current_project_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.project_id', true), '')::uuid
$$;

create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
