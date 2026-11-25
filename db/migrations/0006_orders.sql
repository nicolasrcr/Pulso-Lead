-- Fase 2: criação idempotente de pedidos, liberação (baixa única), transição com CAS e contador de volume.
-- Funções "invoker" respeitam o RLS; bump_usage e volume_status são "definer" porque usage_counters
-- é de plataforma (sem grant direto ao app_user) e fazem a própria autorização.
alter table orders add column if not exists created_by uuid references app_users(id);

create or replace function app.bump_usage(p_org uuid, p_project uuid, p_metric text) returns int
language plpgsql security definer set search_path = public as $$
declare v int; per date := ((now() at time zone 'UTC') - interval '3 hours')::date;
begin
  if not app.can_access_project(p_project) then
    raise exception 'projeto inacessível' using errcode = '42501';
  end if;
  if not exists (select 1 from projects where id = p_project and organization_id = p_org) then
    raise exception 'projeto não pertence à organização' using errcode = '22023';
  end if;
  if p_metric not in ('orders_created','orders_imported') then
    raise exception 'métrica inválida' using errcode = '22023';
  end if;
  insert into usage_counters (organization_id, project_id, metric, period, value)
  values (p_org, p_project, p_metric, date_trunc('month', per)::date, 1)
  on conflict (organization_id, metric, period, coalesce(project_id, '00000000-0000-0000-0000-000000000000'))
  do update set value = usage_counters.value + 1
  returning value into v;
  return v;
end $$;

create or replace function app.volume_status(p_org uuid)
returns table (used int, cap int, pct int, alert text, over boolean)
language plpgsql stable security definer set search_path = public as $$
declare u int; c int; per date := date_trunc('month', ((now() at time zone 'UTC') - interval '3 hours'))::date;
begin
  if not (exists (select 1 from app_users x where x.id = app.current_user_id() and x.platform_admin)
       or exists (select 1 from memberships m where m.user_id = app.current_user_id()
                  and m.organization_id = p_org and m.approved_at is not null)) then
    raise exception 'sem acesso à organização' using errcode = '42501';
  end if;
  select coalesce(sum(value), 0)::int into u from usage_counters
   where organization_id = p_org and period = per;
  select s.order_cap into c from subscriptions s
   where s.organization_id = p_org and s.status <> 'encerrado' order by s.created_at desc limit 1;
  c := coalesce(c, 0);
  used := u; cap := c;
  pct := case when c > 0 then (u * 100) / c else 0 end;
  over := c > 0 and u > c;
  alert := case when c > 0 and u >= c then '100' when c > 0 and u * 100 >= c * 80 then '80' end;
  return next;
end $$;

create or replace function app.create_order(
  p_project uuid, p_plan uuid, p_affiliate uuid, p_customer jsonb, p_cpf_enc bytea,
  p_total int, p_after_pay boolean, p_scheduled date, p_external_id text, p_origin text, p_batch uuid
) returns jsonb language plpgsql set search_path = public as $$
declare org uuid; oid uuid; cid uuid; existing uuid; metric text; vol jsonb;
begin
  if not app.can_access_project(p_project) then
    raise exception 'projeto inacessível' using errcode = '42501';
  end if;
  select organization_id into org from projects where id = p_project;
  metric := case p_origin when 'created' then 'orders_created' when 'imported' then 'orders_imported' end;
  if metric is null then raise exception 'origem inválida' using errcode = '22023'; end if;
  if p_total < 0 then raise exception 'total inválido' using errcode = '22023'; end if;
  if not exists (select 1 from product_plans where id = p_plan and project_id = p_project) then
    raise exception 'plano não pertence ao projeto' using errcode = '23503';
  end if;

  insert into orders (organization_id, project_id, external_id, plan_id, affiliate_id, total_cents,
                      after_pay, scheduled_for, import_batch_id, created_by)
  values (org, p_project, p_external_id, p_plan, p_affiliate, p_total, p_after_pay, p_scheduled, p_batch,
          app.current_user_id())
  on conflict (project_id, external_id) where external_id is not null do nothing
  returning id into oid;

  if oid is null then   -- já existia: idempotente, sem recontabilizar
    select id into existing from orders where project_id = p_project and external_id = p_external_id;
    select to_jsonb(v) into vol from app.volume_status(org) v;
    return jsonb_build_object('id', existing, 'created', false, 'volume', vol);
  end if;

  if p_customer ? 'cpf_hash' and nullif(p_customer->>'cpf_hash','') is not null then
    select id into cid from customers where project_id = p_project and cpf_hash = p_customer->>'cpf_hash' limit 1;
  end if;
  if cid is null then
    insert into customers (organization_id, project_id, name, cpf_encrypted, cpf_hash, phone, email, address)
    values (org, p_project, coalesce(nullif(p_customer->>'name',''), 'Sem nome'), p_cpf_enc,
            nullif(p_customer->>'cpf_hash',''), nullif(p_customer->>'phone',''),
            nullif(p_customer->>'email',''), coalesce(p_customer->'address', '{}'))
    returning id into cid;
  end if;
  update orders set customer_id = cid where id = oid;

  insert into order_status (order_id, organization_id, project_id, payment_status)
  values (oid, org, p_project, case when p_after_pay then 'sem_status' else 'pendente' end);
  insert into order_events (organization_id, project_id, order_id, axis, to_value, actor_id, payload)
  values (org, p_project, oid, 'system', 'created', app.current_user_id(), jsonb_build_object('origin', p_origin));

  perform app.bump_usage(org, p_project, metric);
  select to_jsonb(v) into vol from app.volume_status(org) v;
  return jsonb_build_object('id', oid, 'created', true, 'volume', vol);
end $$;

create or replace function app.release_order(p_order uuid) returns jsonb
language plpgsql set search_path = public as $$
declare o orders%rowtype; bom jsonb; n int := 0; r record;
begin
  select * into o from orders where id = p_order for update;       -- RLS: invisível = inexistente
  if not found then raise exception 'pedido não encontrado' using errcode = '02000'; end if;
  if o.released_at is not null then return jsonb_build_object('released', false, 'reason', 'already'); end if;
  select p.bom into bom from product_plans p where p.id = o.plan_id;

  -- trava os itens em ordem estável (evita deadlock) e confere TODOS antes de baixar qualquer um
  perform 1 from stock_items
   where id in (select (b->>'stockItemId')::uuid from jsonb_array_elements(coalesce(bom, '[]')) b)
   order by id for update;
  for r in
    select i.id, i.sku, i.quantity, sum((b->>'qty')::int) as need
      from jsonb_array_elements(coalesce(bom, '[]')) b
      join stock_items i on i.id = (b->>'stockItemId')::uuid
     group by i.id, i.sku, i.quantity order by i.id
  loop
    if r.need <= 0 then raise exception 'quantidade inválida na BOM' using errcode = '22023'; end if;
    if r.quantity < r.need then
      raise exception 'estoque insuficiente: % (saldo %, necessário %)', r.sku, r.quantity, r.need
        using errcode = '55000';
    end if;
  end loop;
  for r in
    select i.id, sum((b->>'qty')::int) as need
      from jsonb_array_elements(coalesce(bom, '[]')) b
      join stock_items i on i.id = (b->>'stockItemId')::uuid
     group by i.id order by i.id
  loop
    update stock_items set quantity = quantity - r.need where id = r.id;
    insert into stock_movements (organization_id, project_id, stock_item_id, order_id, delta, reason)
    values (o.organization_id, o.project_id, r.id, o.id, -r.need, 'release');
    n := n + 1;
  end loop;

  update orders set released_at = now(), updated_at = now() where id = o.id;
  insert into order_events (organization_id, project_id, order_id, axis, to_value, actor_id)
  values (o.organization_id, o.project_id, o.id, 'system', 'released', app.current_user_id());
  return jsonb_build_object('released', true, 'movements', n);
end $$;

create or replace function app.transition_order(
  p_order uuid, p_axis text, p_from text, p_to text, p_at timestamptz, p_actor uuid
) returns boolean language plpgsql set search_path = public as $$
declare s order_status%rowtype; cur text;
begin
  if p_axis not in ('platform','shipping','payment') then
    raise exception 'eixo desconhecido' using errcode = '22023';
  end if;
  select * into s from order_status where order_id = p_order for update;
  if not found then raise exception 'pedido não encontrado' using errcode = '02000'; end if;
  cur := case p_axis when 'platform' then s.platform_status when 'shipping' then s.shipping_status
                     else s.payment_status end;
  if cur is distinct from p_from then return false; end if;                      -- compare-and-swap
  if p_axis = 'shipping' and s.shipping_last_event_at is not null and p_at < s.shipping_last_event_at then
    return false;                                                                -- evento antigo não regride
  end if;

  update order_status set
    platform_status = case when p_axis = 'platform' then p_to else platform_status end,
    shipping_status = case when p_axis = 'shipping' then p_to else shipping_status end,
    payment_status  = case when p_axis = 'payment'  then p_to else payment_status end,
    shipping_last_event_at = case when p_axis = 'shipping' then p_at else shipping_last_event_at end,
    paid_at = case when p_axis = 'payment' and p_to = 'pago' then coalesce(paid_at, p_at) else paid_at end,
    delivered_at = case when p_axis = 'shipping' and p_to in ('entregue','entregue_caixa')
                        then coalesce(delivered_at, p_at) else delivered_at end,
    updated_at = now()
  where order_id = p_order;
  insert into order_events (organization_id, project_id, order_id, axis, from_value, to_value, actor_id, occurred_at)
  values (s.organization_id, s.project_id, p_order, p_axis, p_from, p_to, p_actor, p_at);
  return true;
end $$;

revoke all on function app.bump_usage(uuid,uuid,text), app.volume_status(uuid),
  app.create_order(uuid,uuid,uuid,jsonb,bytea,int,boolean,date,text,text,uuid),
  app.release_order(uuid), app.transition_order(uuid,text,text,text,timestamptz,uuid) from public;
grant execute on function app.bump_usage(uuid,uuid,text), app.volume_status(uuid),
  app.create_order(uuid,uuid,uuid,jsonb,bytea,int,boolean,date,text,text,uuid),
  app.release_order(uuid), app.transition_order(uuid,text,text,text,timestamptz,uuid) to app_user;
