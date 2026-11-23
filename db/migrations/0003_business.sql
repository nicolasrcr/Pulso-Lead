-- Tabelas de negócio. Toda tabela aqui tem organization_id e project_id NOT NULL (RLS em 0004).
-- Dinheiro sempre em centavos inteiros.

create table products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  name text not null,
  sku text,
  private boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table product_plans (                  -- plano/tratamento com preço próprio
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  product_id uuid not null references products(id),
  name text not null,
  price_cents int not null check (price_cents >= 0),
  commission_rule jsonb not null default '{"type":"percent","bps":0}',
  bom jsonb not null default '[]',            -- itens de estoque consumidos na liberação
  active boolean not null default true
);

create table external_product_links (         -- BLUEPRINT 3C.5
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  provider text not null,
  external_product_id text not null,
  plan_id uuid not null references product_plans(id) on delete restrict,
  unique (project_id, provider, external_product_id)
);

create table affiliates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  user_id uuid references app_users(id),
  name text not null,
  link_secret text not null default encode(gen_random_bytes(24), 'hex'),
  active boolean not null default true
);

create table affiliate_email_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  provider text not null,
  email citext not null,
  affiliate_id uuid not null references affiliates(id),
  unique (project_id, provider, email)
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  name text not null,
  cpf_encrypted bytea,                        -- nunca em texto claro
  cpf_hash text,                              -- busca/duplicidade
  phone text,
  email citext,
  address jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on customers (project_id, cpf_hash);

create table carrier_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  carrier_key text not null,                  -- 'jt' no go-live
  credentials_ref text not null,              -- referência ao cofre, nunca a credencial
  enabled boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  source text not null,
  status text not null default 'pending',
  stats jsonb not null default '{}',
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  external_id text,                           -- id na plataforma de venda/migração
  customer_id uuid references customers(id),
  affiliate_id uuid references affiliates(id),
  plan_id uuid references product_plans(id),
  total_cents int not null check (total_cents >= 0),
  after_pay boolean not null default true,
  scheduled_for date,
  released_at timestamptz,                    -- baixa de estoque acontece uma única vez aqui
  carrier_account_id uuid references carrier_accounts(id),
  tracking_code text,
  tracking_synced boolean not null default false,
  tracking_synced_at timestamptz,
  tracking_sync_error text,
  import_batch_id uuid references import_batches(id),
  needs_review boolean not null default false,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index orders_external_uq on orders (project_id, external_id) where external_id is not null;
create index orders_dash_idx on orders (organization_id, project_id, created_at);
create trigger orders_touch before update on orders for each row execute function app.touch_updated_at();

-- Três eixos independentes por pedido; o kanban é derivado, não armazenado.
create table order_status (
  order_id uuid primary key references orders(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  platform_status text not null default 'criado',
  shipping_status text not null default 'sem_status',
  payment_status text not null default 'sem_status',
  payment_method text,
  paid_at timestamptz,
  delivered_at timestamptz,
  shipping_last_event_at timestamptz,
  updated_at timestamptz not null default now()
);
create index on order_status (project_id, platform_status);
create index on order_status (project_id, shipping_status);

create table order_events (                   -- histórico imutável
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  order_id uuid not null references orders(id),
  axis text not null check (axis in ('platform','shipping','payment','note','system')),
  from_value text, to_value text,
  actor_id uuid, payload jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
create index on order_events (order_id, occurred_at);

create table webhook_events_raw (             -- grava cru e processa de forma idempotente
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  provider text not null,
  event_id text not null,
  payload jsonb not null,
  signature_ok boolean not null default false,
  status text not null default 'received' check (status in ('received','processed','failed','unlinked')),
  attempts int not null default 0,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (project_id, provider, event_id)
);

create table outbound_webhooks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  name text not null,
  url text not null,
  secret text not null,
  events text[] not null default '{}',        -- ORDER_CREATE, CHARGE_UPDATED, SHIPPING_REGISTER, SHIPPING_UPDATE
  active boolean not null default true
);
create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  webhook_id uuid not null references outbound_webhooks(id),
  event text not null, payload jsonb not null,
  status text not null default 'pending', attempts int not null default 0,
  next_attempt_at timestamptz, last_status_code int,
  created_at timestamptz not null default now()
);

create table stock_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  sku text not null, name text not null,
  quantity int not null default 0 check (quantity >= 0),
  min_quantity int not null default 0,
  unique (project_id, sku)
);
create table stock_movements (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  stock_item_id uuid not null references stock_items(id),
  order_id uuid references orders(id),
  delta int not null, reason text not null,
  created_at timestamptz not null default now()
);
-- Baixa única por pedido e item: liberar duas vezes não baixa duas vezes.
create unique index stock_release_once on stock_movements (order_id, stock_item_id) where reason = 'release';

create table commission_ledger (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  order_id uuid not null references orders(id),
  affiliate_id uuid not null references affiliates(id),
  kind text not null check (kind in ('accrual','reversal')),
  amount_cents int not null,
  reason text,
  created_at timestamptz not null default now()
);
create unique index commission_once on commission_ledger (order_id, kind);

create table order_returns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  order_id uuid not null references orders(id),
  status text not null default 'solicitada',
  qty_returned int not null default 0,        -- devolvida
  qty_discarded int not null default 0,       -- descartada
  created_at timestamptz not null default now()
);

create table api_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  created_by uuid not null references app_users(id),
  name text not null,
  scopes text[] not null,
  token_hash text not null unique,            -- só o hash do token opaco
  last_used_at timestamptz, revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table dash_daily (                     -- agregados: o dashboard nunca varre pedidos ao vivo
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  day date not null,
  affiliate_id uuid, uf char(2), plan_id uuid,
  orders int not null default 0, gross_cents bigint not null default 0,
  paid int not null default 0, paid_cents bigint not null default 0,
  delivered int not null default 0, lost int not null default 0,
  returned int not null default 0, overdue int not null default 0,
  refreshed_at timestamptz not null default now()
);
create unique index dash_daily_uq on dash_daily
  (project_id, day, coalesce(affiliate_id, '00000000-0000-0000-0000-000000000000'), coalesce(uf, '--'), coalesce(plan_id, '00000000-0000-0000-0000-000000000000'));

create table audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  actor_id uuid, action text not null, entity text, entity_id text,
  meta jsonb not null default '{}',
  at timestamptz not null default now()
);
