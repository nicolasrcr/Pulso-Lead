-- Fase 6: fila de webhooks de saída, rastreio, link assinado de afiliado.
alter table webhook_deliveries add column if not exists last_error text;
alter table webhook_deliveries add column if not exists delivered_at timestamptz;
create index if not exists webhook_deliveries_due on webhook_deliveries (next_attempt_at) where status = 'pending';

-- Payload dos eventos: identificadores e status apenas. Nunca CPF, nome, telefone ou endereço.
create or replace function app.order_payload(p_order uuid) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'orderId', o.id, 'externalId', o.external_id, 'totalCents', o.total_cents, 'trackingCode', o.tracking_code,
    'status', jsonb_build_object('platform', s.platform_status, 'shipping', s.shipping_status, 'payment', s.payment_status),
    'occurredAt', now())
  from orders o join order_status s on s.order_id = o.id where o.id = p_order
$$;

create or replace function app.enqueue_webhooks(p_project uuid, p_event text, p_payload jsonb) returns int
language plpgsql set search_path = public as $$
declare n int;
begin
  insert into webhook_deliveries (organization_id, project_id, webhook_id, event, payload, next_attempt_at)
  select w.organization_id, w.project_id, w.id, p_event, p_payload, now()
    from outbound_webhooks w where w.project_id = p_project and w.active and p_event = any(w.events);
  get diagnostics n = row_count;
  return n;
end $$;

-- Rastreio registrado (etiqueta emitida): marca para sincronizar e notifica SHIPPING_REGISTER.
create or replace function app.set_tracking(p_order uuid, p_code text) returns void
language plpgsql set search_path = public as $$
declare o orders%rowtype;
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9-]{4,60}$' then
    raise exception 'código de rastreio inválido' using errcode = '22023';
  end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'pedido não encontrado' using errcode = '02000'; end if;
  update orders set tracking_code = p_code, tracking_synced = false, tracking_synced_at = null,
                    tracking_sync_error = null, updated_at = now() where id = p_order;
  insert into order_events (organization_id, project_id, order_id, axis, to_value, actor_id, payload)
  values (o.organization_id, o.project_id, o.id, 'system', 'tracking_set', app.current_user_id(), jsonb_build_object('tracking', p_code));
  perform app.enqueue_webhooks(o.project_id, 'SHIPPING_REGISTER', app.order_payload(p_order) || '{"event":"SHIPPING_REGISTER"}'::jsonb);
end $$;

-- Link de afiliado: <afiliado>.<plano|->.<hmac-sha256 hex>, assinado com o link_secret do afiliado (nunca sai do banco).
create or replace function app.affiliate_link(p_affiliate uuid, p_plan uuid) returns text
language plpgsql set search_path = public as $$
declare a affiliates%rowtype; payload text;
begin
  select * into a from affiliates where id = p_affiliate;
  if not found then raise exception 'afiliado não encontrado' using errcode = '02000'; end if;
  if p_plan is not null and not exists (select 1 from product_plans where id = p_plan and project_id = a.project_id) then
    raise exception 'plano não pertence ao projeto' using errcode = '23503';
  end if;
  payload := a.id::text || '.' || coalesce(p_plan::text, '-');
  return payload || '.' || encode(hmac(convert_to(payload, 'UTF8'), convert_to(a.link_secret, 'UTF8'), 'sha256'), 'hex');
end $$;

-- As funções "definer" rodam como o dono das tabelas, e FORCE RLS vale para o dono. A resolução do link é pública
-- (sem usuário no contexto), então o dono precisa de leitura própria nestas duas tabelas. A policy é restrita ao papel
-- dono (o mesmo que roda as migrations e é dono das funções): app_user não é membro dele e não herda esse acesso.
do $$ begin
  execute format('create policy affiliates_definer_read on affiliates for select to %I using (true)', current_user);
  execute format('create policy product_plans_definer_read on product_plans for select to %I using (true)', current_user);
end $$;

-- Público (sem sessão): só devolve algo se a assinatura for válida e o afiliado estiver ativo.
create or replace function app.resolve_affiliate_link(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare parts text[]; a affiliates%rowtype; plan uuid; payload text;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_token is null or length(p_token) > 200 then return null; end if;
  parts := string_to_array(p_token, '.');
  if array_length(parts, 1) is distinct from 3 or parts[1] !~ uuid_re or (parts[2] <> '-' and parts[2] !~ uuid_re) or parts[3] !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into a from affiliates where id = parts[1]::uuid and active;
  if not found then return null; end if;
  payload := parts[1] || '.' || parts[2];
  if encode(hmac(convert_to(payload, 'UTF8'), convert_to(a.link_secret, 'UTF8'), 'sha256'), 'hex') <> parts[3] then return null; end if;
  if parts[2] <> '-' then
    plan := parts[2]::uuid;
    if not exists (select 1 from product_plans where id = plan and project_id = a.project_id and active) then return null; end if;
  end if;
  return jsonb_build_object('affiliateId', a.id, 'projectId', a.project_id, 'organizationId', a.organization_id, 'planId', plan);
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
  if p_axis = 'payment' and p_to = 'pago' then perform app.accrue_commission(p_order); end if;
  if p_axis = 'payment' then
    perform app.enqueue_webhooks(s.project_id, 'CHARGE_UPDATED', app.order_payload(p_order) || '{"event":"CHARGE_UPDATED"}'::jsonb);
  elsif p_axis = 'shipping' then
    perform app.enqueue_webhooks(s.project_id, 'SHIPPING_UPDATE', app.order_payload(p_order) || '{"event":"SHIPPING_UPDATE"}'::jsonb);
  end if;
  return true;
end $$;



-- create_order passa a enfileirar ORDER_CREATE.
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
  if p_affiliate is not null and not exists (select 1 from affiliates where id = p_affiliate and project_id = p_project) then
    raise exception 'afiliado não pertence ao projeto' using errcode = '23503';
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
  perform app.enqueue_webhooks(p_project, 'ORDER_CREATE', app.order_payload(oid) || '{"event":"ORDER_CREATE"}'::jsonb);
  select to_jsonb(v) into vol from app.volume_status(org) v;
  return jsonb_build_object('id', oid, 'created', true, 'volume', vol);
end $$;

revoke all on function app.order_payload(uuid), app.enqueue_webhooks(uuid,text,jsonb), app.set_tracking(uuid,text),
  app.affiliate_link(uuid,uuid), app.resolve_affiliate_link(text) from public;
grant execute on function app.order_payload(uuid), app.enqueue_webhooks(uuid,text,jsonb), app.set_tracking(uuid,text),
  app.affiliate_link(uuid,uuid), app.resolve_affiliate_link(text) to app_user;
