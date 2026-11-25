-- Autenticação, sessões e operações administrativas. Funções security definer com verificação explícita de autorização.
-- A aplicação (app_user) NÃO escreve em organizations/projects/memberships/app_users diretamente: só por estas funções.

alter table app_users add column password_hash text, add column disabled_at timestamptz;

alter table memberships add constraint memberships_caps_known check (capabilities <@ array[
  'orders.create','orders.read_all','orders.edit','orders.status.own_after_delivery','orders.status.all',
  'billing.status','notes.create','notes.read','reports.read','dashboard.full','dashboard.own',
  'products.manage','products.private.read','users.manage','checkout_links.read']::text[]);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,            -- só o hash do token opaco
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table sessions enable row level security;  -- sem policy e sem grant: invisível para app_user
revoke all on sessions from public, app_user;

-- ---------- helpers de autorização ----------
create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select platform_admin from app_users where id = app.current_user_id() and disabled_at is null), false)
$$;

-- org_admin da organização, ou project_admin do projeto, ou admin da plataforma
create or replace function app.is_admin_of(p_org uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_platform_admin()
      or exists (select 1 from memberships m
                 where m.user_id = app.current_user_id() and m.approved_at is not null
                   and m.organization_id = p_org and m.role = 'org_admin' and m.project_id is null)
      or (p_project is not null and exists (select 1 from memberships m
                 where m.user_id = app.current_user_id() and m.approved_at is not null
                   and m.organization_id = p_org and m.role = 'project_admin' and m.project_id = p_project))
$$;

create or replace function app.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_platform_admin()
      or exists (select 1 from memberships m
                 where m.user_id = app.current_user_id() and m.approved_at is not null
                   and m.organization_id = p_org and m.role = 'org_admin' and m.project_id is null)
$$;

-- visibilidade da equipe
create policy memberships_admin on memberships for select to app_user
  using (app.is_admin_of(organization_id, project_id));
create policy app_users_team on app_users for select to app_user
  using (exists (select 1 from memberships m where m.user_id = app_users.id and app.is_admin_of(m.organization_id, m.project_id)));

-- ---------- cadastro e sessão (antes de existir contexto de usuário) ----------
create or replace function app.register_user(p_email citext, p_name text, p_hash text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if coalesce(trim(p_name), '') = '' or coalesce(p_hash, '') = '' then
    raise exception 'dados obrigatórios' using errcode = '22023';
  end if;
  insert into app_users (email, name, password_hash) values (p_email, trim(p_name), p_hash) returning id into v;
  return v;
end $$;

create or replace function app.auth_lookup(p_email citext) returns table (id uuid, password_hash text)
language sql stable security definer set search_path = public as $$
  select u.id, u.password_hash from app_users u where u.email = p_email and u.disabled_at is null and u.password_hash is not null
$$;

create or replace function app.session_create(p_user uuid, p_token_hash text, p_ttl interval) returns timestamptz
language sql security definer set search_path = public as $$
  insert into sessions (user_id, token_hash, expires_at) values (p_user, p_token_hash, now() + p_ttl) returning expires_at
$$;

create or replace function app.session_user(p_token_hash text) returns uuid
language sql stable security definer set search_path = public as $$
  select s.user_id from sessions s join app_users u on u.id = s.user_id
  where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now() and u.disabled_at is null
$$;

create or replace function app.session_revoke(p_token_hash text) returns void
language sql security definer set search_path = public as $$
  update sessions set revoked_at = now() where token_hash = p_token_hash and revoked_at is null
$$;

-- ---------- organização, projeto e equipe ----------
create or replace function app.create_organization(p_name text, p_cnpj text, p_slug text, p_admin_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not app.is_platform_admin() then raise exception 'apenas admin da plataforma' using errcode = '42501'; end if;
  insert into organizations (name, cnpj, slug) values (p_name, p_cnpj, p_slug) returning id into v;
  if p_admin_user is not null then
    insert into memberships (user_id, organization_id, project_id, role, approved_at) values (p_admin_user, v, null, 'org_admin', now());
  end if;
  return v;
end $$;

create or replace function app.create_project(p_org uuid, p_name text, p_template_key text, p_template_version int) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not app.is_org_admin(p_org) then raise exception 'apenas org_admin da organização' using errcode = '42501'; end if;
  insert into projects (organization_id, name, template_key, template_version) values (p_org, trim(p_name), p_template_key, p_template_version) returning id into v;
  return v;
end $$;

create or replace function app.request_membership(p_org uuid, p_project uuid, p_role text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if app.current_user_id() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  if p_role not in ('operator', 'affiliate') then raise exception 'papel não solicitável' using errcode = '22023'; end if;
  if not exists (select 1 from projects where id = p_project and organization_id = p_org) then
    raise exception 'projeto não pertence à organização' using errcode = '22023';
  end if;
  insert into memberships (user_id, organization_id, project_id, role) values (app.current_user_id(), p_org, p_project, p_role) returning id into v;
  return v;
end $$;

create or replace function app.approve_membership(p_id uuid, p_capabilities text[]) returns void
language plpgsql security definer set search_path = public as $$
declare m memberships;
begin
  select * into m from memberships where id = p_id;
  if not found then raise exception 'membership inexistente' using errcode = '02000'; end if;
  if m.user_id = app.current_user_id() and not app.is_platform_admin() then
    raise exception 'ninguém aprova o próprio cadastro' using errcode = '42501';
  end if;
  if not app.is_admin_of(m.organization_id, m.project_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  -- project_admin só aprova papéis abaixo do seu
  if m.role in ('org_admin', 'project_admin') and not app.is_org_admin(m.organization_id) then
    raise exception 'apenas org_admin aprova este papel' using errcode = '42501';
  end if;
  update memberships set approved_at = coalesce(approved_at, now()), capabilities = coalesce(p_capabilities, '{}') where id = p_id;
end $$;

create or replace function app.reject_membership(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m memberships;
begin
  select * into m from memberships where id = p_id and approved_at is null;
  if not found then return; end if;
  if not app.is_admin_of(m.organization_id, m.project_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  delete from memberships where id = p_id;
end $$;

-- Execução: só app_user (nunca PUBLIC)
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and p.prosecdef loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to app_user', f.sig);
  end loop;
end $$;
