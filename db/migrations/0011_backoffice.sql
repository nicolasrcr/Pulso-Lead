-- Fase 7: back-office do fornecedor, suspensão (somente leitura), descarte seguro e auditoria de plataforma.
alter table subscriptions add column closed_at timestamptz;
create unique index subscriptions_one_live_uq on subscriptions (organization_id) where status <> 'encerrado';

-- Ações da plataforma (não pertencem a um projeto): só o admin da plataforma lê. Imutável para a aplicação.
create table platform_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid references organizations(id),
  actor_id uuid,
  action text not null,
  meta jsonb not null default '{}',
  at timestamptz not null default now()
);
alter table platform_audit_log enable row level security;
alter table platform_audit_log force row level security;
create policy platform_audit_read on platform_audit_log for select to app_user using (app.is_platform_admin());
grant select on platform_audit_log to app_user;
do $$ begin
  execute format('create policy platform_audit_definer_write on platform_audit_log for all to %I using (true) with check (true)', current_user);
end $$;

create or replace function app.require_platform_admin() returns void
language plpgsql stable as $$
begin
  if not app.is_platform_admin() then raise exception 'apenas admin da plataforma' using errcode = '42501'; end if;
end $$;

create or replace function app.org_suspended(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.status in ('suspenso','encerrado') from subscriptions s
                    where s.organization_id = p_org order by (s.status <> 'encerrado') desc, s.created_at desc limit 1), false) $$;

create or replace function app.create_subscription(p_org uuid, p_plan_key text, p_monthly_cents int, p_order_cap int)
returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid; sid uuid;
begin
  perform app.require_platform_admin();
  select id into pid from plans where key = p_plan_key;
  if pid is null then raise exception 'plano inexistente' using errcode = '22023'; end if;
  if p_order_cap < 0 or p_monthly_cents < 0 then raise exception 'valores inválidos' using errcode = '22023'; end if;
  insert into subscriptions (organization_id, plan_id, monthly_fee_cents, order_cap) values (p_org, pid, p_monthly_cents, p_order_cap) returning id into sid;
  insert into platform_audit_log (organization_id, actor_id, action, meta)
  values (p_org, app.current_user_id(), 'subscription.create', jsonb_build_object('plan', p_plan_key, 'monthlyCents', p_monthly_cents, 'orderCap', p_order_cap));
  return sid;
end $$;

create or replace function app.set_subscription_status(p_org uuid, p_to text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare s subscriptions%rowtype;
begin
  perform app.require_platform_admin();
  select * into s from subscriptions where organization_id = p_org and status <> 'encerrado' order by created_at desc limit 1;
  if not found then raise exception 'organização sem assinatura vigente' using errcode = '22023'; end if;
  if not (
    (s.status = 'implantacao' and p_to in ('garantia','ativo','suspenso','encerrado')) or
    (s.status = 'garantia'    and p_to in ('ativo','em_atraso','suspenso','encerrado')) or
    (s.status = 'ativo'       and p_to in ('em_atraso','suspenso','encerrado')) or
    (s.status = 'em_atraso'   and p_to in ('ativo','suspenso','encerrado')) or
    (s.status = 'suspenso'    and p_to in ('ativo','encerrado'))
  ) then raise exception 'transição % → % inválida', s.status, p_to using errcode = '22023'; end if;
  if p_to in ('suspenso','encerrado','em_atraso') and (p_reason is null or length(trim(p_reason)) = 0) then
    raise exception 'motivo obrigatório' using errcode = '22023';
  end if;
  update subscriptions set status = p_to,
         suspended_at = case when p_to = 'suspenso' then now() when p_to = 'ativo' then null else suspended_at end,
         closed_at = case when p_to = 'encerrado' then now() else closed_at end,
         go_live_at = case when p_to = 'ativo' and go_live_at is null then (now() at time zone 'America/Sao_Paulo')::date else go_live_at end
   where id = s.id;
  insert into platform_audit_log (organization_id, actor_id, action, meta)
  values (p_org, app.current_user_id(), 'subscription.status', jsonb_build_object('from', s.status, 'to', p_to, 'reason', p_reason));
end $$;

-- Visão da plataforma: uma linha por organização (status, plano, uso do mês-calendário em UTC-3 vs. cap).
create or replace function app.backoffice_overview() returns setof jsonb
language plpgsql stable security definer set search_path = public as $$
declare per date := date_trunc('month', ((now() at time zone 'UTC') - interval '3 hours'))::date;
begin
  perform app.require_platform_admin();
  return query
  select jsonb_build_object(
    'organizationId', o.id, 'name', o.name,
    'status', coalesce(s.status, 'sem_assinatura'), 'plan', p.key,
    'monthlyFeeCents', s.monthly_fee_cents, 'orderCap', coalesce(s.order_cap, 0),
    'usedThisMonth', coalesce((select sum(u.value) from usage_counters u where u.organization_id = o.id and u.period = per), 0)::int,
    'projects', (select count(*) from projects pr where pr.organization_id = o.id)::int,
    'goLiveAt', s.go_live_at, 'suspendedAt', s.suspended_at)
  from organizations o
  left join lateral (select * from subscriptions x where x.organization_id = o.id order by (x.status <> 'encerrado') desc, x.created_at desc limit 1) s on true
  left join plans p on p.id = s.plan_id
  order by o.name;
end $$;

-- Suspensão/encerramento: a organização só lê (e exporta). Admin da plataforma segue operando (reativar, descartar).
create or replace function app.block_if_suspended() returns trigger
language plpgsql set search_path = public as $$
declare org uuid;
begin
  org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  if not app.is_platform_admin() and app.org_suspended(org) then
    raise exception 'organização suspensa: somente leitura' using errcode = '55006';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'organization_id'
       and exists (select 1 from information_schema.columns d where d.table_schema = 'public' and d.table_name = c.table_name and d.column_name = 'project_id')
       and c.table_name not in ('webhook_deliveries','webhook_events_raw','audit_log','dash_daily','dash_refresh','platform_audit_log','usage_counters')
  loop
    execute format('create trigger %I before insert or update or delete on %I for each row execute function app.block_if_suspended()', t || '_suspended', t);
  end loop;
end $$;

-- Descarte seguro: só organização encerrada há ≥ 30 dias e com confirmação explícita (o próprio id).
-- Anonimiza dados pessoais; pedidos, estoque e ledger ficam (histórico financeiro/fiscal), sem PII.
create or replace function app.discard_org_pii(p_org uuid, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s subscriptions%rowtype; n_c int; n_o int;
begin
  perform app.require_platform_admin();
  if p_confirm is distinct from p_org::text then raise exception 'confirmação inválida' using errcode = '22023'; end if;
  select * into s from subscriptions where organization_id = p_org and status = 'encerrado' order by closed_at desc nulls last limit 1;
  if not found then raise exception 'organização não encerrada' using errcode = '22023'; end if;
  if s.closed_at is null or s.closed_at > now() - interval '30 days' then
    raise exception 'retenção mínima de 30 dias após o encerramento' using errcode = '22023';
  end if;
  update customers set name = '[descartado]', cpf_encrypted = null, cpf_hash = null, phone = null, email = null, address = '{}'
   where organization_id = p_org and (cpf_encrypted is not null or cpf_hash is not null or phone is not null or email is not null or name <> '[descartado]' or address <> '{}');
  get diagnostics n_c = row_count;
  update webhook_events_raw set payload = '{"discarded":true}' where organization_id = p_org and payload <> '{"discarded":true}';
  get diagnostics n_o = row_count;
  insert into platform_audit_log (organization_id, actor_id, action, meta)
  values (p_org, app.current_user_id(), 'org.discard_pii', jsonb_build_object('customers', n_c, 'rawEvents', n_o));
  return jsonb_build_object('customers', n_c, 'rawEvents', n_o);
end $$;

do $$ declare f text; begin
  foreach f in array array['app.create_subscription(uuid,text,int,int)','app.set_subscription_status(uuid,text,text)','app.backoffice_overview()','app.discard_org_pii(uuid,text)','app.org_suspended(uuid)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to app_user', f);
  end loop;
end $$;
