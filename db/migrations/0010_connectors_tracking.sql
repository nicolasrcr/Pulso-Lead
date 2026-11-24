-- Fase 3: credenciais de transportadora seladas, sync de rastreio, ingestão idempotente de vendas, consulta pública.
alter table carrier_accounts add column credentials_sealed text;   -- JSON selado (AES-GCM) fora do banco em claro

-- Conectores de venda (PayT, Braip, B4You, Get Envios): cada um tem URL própria e segredo selado.
create table sale_connectors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  provider text not null check (provider in ('payt','braip','b4you','getenvios')),
  secret_sealed text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table sale_connectors enable row level security;
alter table sale_connectors force row level security;
create policy sale_connectors_tenant on sale_connectors for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on sale_connectors to app_user;
create index on webhook_events_raw (project_id, status, received_at);

create or replace function app.ingest_sale_event(p_project uuid, p_provider text, p_event_id text, p_payload jsonb, p_sig_ok boolean)
returns jsonb language plpgsql set search_path = public as $$
declare org uuid; rid uuid;
begin
  if p_provider not in ('payt','braip','b4you','getenvios') then
    raise exception 'provider inválido' using errcode = '22023';
  end if;
  if p_event_id is null or length(p_event_id) = 0 or length(p_event_id) > 200 then
    raise exception 'event_id inválido' using errcode = '22023';
  end if;
  if not app.can_access_project(p_project) then raise exception 'projeto inacessível' using errcode = '42501'; end if;
  select organization_id into org from projects where id = p_project;
  insert into webhook_events_raw (organization_id, project_id, provider, event_id, payload, signature_ok)
  values (org, p_project, p_provider, p_event_id, p_payload, p_sig_ok)
  on conflict (project_id, provider, event_id) do nothing returning id into rid;
  if rid is not null then return jsonb_build_object('id', rid, 'duplicate', false); end if;
  select id into rid from webhook_events_raw where project_id = p_project and provider = p_provider and event_id = p_event_id;
  return jsonb_build_object('id', rid, 'duplicate', true);
end $$;

create or replace function app.finish_sale_event(p_id uuid, p_status text) returns void
language plpgsql set search_path = public as $$
begin
  if p_status not in ('processed','failed','unlinked') then raise exception 'status inválido' using errcode = '22023'; end if;
  update webhook_events_raw set status = p_status, attempts = attempts + 1,
         processed_at = case when p_status = 'processed' then now() else processed_at end
   where id = p_id;
  if not found then raise exception 'evento não encontrado' using errcode = '02000'; end if;
end $$;

create or replace function app.mark_tracking_sync(p_order uuid, p_ok boolean, p_error text) returns void
language plpgsql set search_path = public as $$
begin
  update orders set tracking_synced = p_ok,
         tracking_synced_at = case when p_ok then now() else null end,
         tracking_sync_error = case when p_ok then null else left(coalesce(p_error, 'erro'), 500) end,
         updated_at = now()
   where id = p_order;
  if not found then raise exception 'pedido não encontrado' using errcode = '02000'; end if;
end $$;

-- Consulta pública (página white-label): somente status e histórico de transporte; nunca PII.
do $$ begin
  execute format('create policy orders_definer_read on orders for select to %I using (true)', current_user);
  execute format('create policy order_status_definer_read on order_status for select to %I using (true)', current_user);
  execute format('create policy order_events_definer_read on order_events for select to %I using (true)', current_user);
end $$;

create or replace function app.public_tracking(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o orders%rowtype; s order_status%rowtype;
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9-]{4,60}$' then return null; end if;
  select * into o from orders where tracking_code = p_code order by created_at desc limit 1;
  if not found then return null; end if;
  select * into s from order_status where order_id = o.id;
  return jsonb_build_object(
    'trackingCode', o.tracking_code,
    'status', s.shipping_status,
    'delivered', s.delivered_at is not null,
    'history', coalesce((select jsonb_agg(jsonb_build_object('status', e.to_value, 'at', e.occurred_at) order by e.occurred_at)
                           from order_events e where e.order_id = o.id and e.axis = 'shipping'), '[]'::jsonb));
end $$;
revoke all on function app.public_tracking(text) from public;
grant execute on function app.public_tracking(text) to app_user;
