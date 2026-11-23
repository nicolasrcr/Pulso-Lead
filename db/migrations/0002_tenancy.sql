-- Plataforma -> organização (CNPJ) -> projeto (atividade/operação). Ver BLUEPRINT 3A e 3B.
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cnpj text unique,
  slug text not null unique,
  brand jsonb not null default '{}',          -- white-label: logo, cores, domínios
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table activity_templates (             -- catálogo da plataforma, versionado
  key text not null,
  version int not null,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  primary key (key, version)
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  template_key text not null,
  template_version int not null,
  settings jsonb not null default '{"overdue_grace_days": 15}',
  flags jsonb not null default '{}',          -- feature flags por projeto (BLUEPRINT 3C.3)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (template_key, template_version) references activity_templates(key, version)
);
create index on projects (organization_id);

create table app_users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  name text not null,
  platform_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- project_id nulo = vale para todos os projetos da organização (org_admin)
create table memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id),
  organization_id uuid not null references organizations(id),
  project_id uuid references projects(id),
  role text not null check (role in ('org_admin','project_admin','operator','affiliate')),
  capabilities text[] not null default '{}',
  approved_at timestamptz,                    -- aprovação de cadastro
  created_at timestamptz not null default now()
);
create unique index memberships_uq on memberships (user_id, organization_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'));

-- Acesso: admin da plataforma, org_admin da organização, ou membro do projeto.
create or replace function app.can_access_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users u where u.id = app.current_user_id() and u.platform_admin)
      or exists (
        select 1 from memberships m
        join projects p on p.id = p_project
        where m.user_id = app.current_user_id()
          and m.approved_at is not null
          and m.organization_id = p.organization_id
          and (m.project_id is null or m.project_id = p_project)
      )
$$;

-- Linha visível quando o usuário acessa o projeto E (se houver projeto selecionado) é aquele projeto.
create or replace function app.row_visible(p_project uuid) returns boolean
language sql stable as $$
  select app.can_access_project(p_project)
     and (app.current_project_id() is null or app.current_project_id() = p_project)
$$;

-- Assinatura e uso (BLUEPRINT 3B.2/3B.4)
create table plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  entitlements jsonb not null default '{}'
);
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  plan_id uuid not null references plans(id),
  status text not null default 'implantacao'
    check (status in ('implantacao','garantia','ativo','em_atraso','suspenso','encerrado')),
  go_live_at date,
  warranty_until date,
  min_term_end date,
  monthly_fee_cents int,
  order_cap int not null default 1000,
  included_hours int not null default 4,
  extra_hour_cents int,
  suspended_at timestamptz,
  created_at timestamptz not null default now()
);
create table usage_counters (
  organization_id uuid not null references organizations(id),
  project_id uuid references projects(id),
  metric text not null check (metric in ('orders_created','orders_imported')),
  period date not null,                       -- primeiro dia do mês-calendário
  value int not null default 0
);
create unique index usage_counters_uq on usage_counters
  (organization_id, metric, period, coalesce(project_id, '00000000-0000-0000-0000-000000000000'));
