-- Fase 4 (núcleo, sem integrações): ledger de comissão, devoluções e inadimplência.
-- O ledger e o histórico de eventos passam a ser imutáveis para a aplicação (só INSERT).
revoke update, delete on commission_ledger from app_user;
revoke update, delete on order_events from app_user;
create unique index if not exists stock_return_once on stock_movements (order_id, stock_item_id) where reason = 'return';
create unique index if not exists order_returns_once on order_returns (order_id);

-- Crédito de comissão: só com pagamento confirmado, afiliado e uma única vez por pedido (commission_once).
-- Espelha @pulso/domain commissionCents: percentual em bps com arredondamento meio para cima; fixo em centavos.
create or replace function app.accrue_commission(p_order uuid) returns int
language plpgsql set search_path = public as $$
declare o orders%rowtype; st text; rule jsonb; amt int; n int;
begin
  select * into o from orders where id = p_order;
  if not found then raise exception 'pedido não encontrado' using errcode = '02000'; end if;
  if o.affiliate_id is null then return null; end if;
  select payment_status into st from order_status where order_id = p_order;
  if st is distinct from 'pago' then return null; end if;
  select commission_rule into rule from product_plans where id = o.plan_id;
  rule := coalesce(rule, '{"type":"percent","bps":0}'::jsonb);
  amt := case rule->>'type'
    when 'fixed' then (rule->>'cents')::int
    when 'percent' then floor((o.total_cents::numeric * (rule->>'bps')::int + 5000) / 10000)::int
  end;
  if amt is null or amt < 0 then raise exception 'regra de comissão inválida' using errcode = '22023'; end if;
  insert into commission_ledger (organization_id, project_id, order_id, affiliate_id, kind, amount_cents)
  values (o.organization_id, o.project_id, o.id, o.affiliate_id, 'accrual', amt)
  on conflict (order_id, kind) do nothing;
  get diagnostics n = row_count;
  return case when n = 0 then null else amt end;
end $$;

-- Estorno: espelha exatamente o accrual (sem recalcular), uma única vez.
create or replace function app.reverse_commission(p_order uuid, p_reason text) returns int
language plpgsql set search_path = public as $$
declare a commission_ledger%rowtype; n int; refund int;
begin
  select * into a from commission_ledger where order_id = p_order and kind = 'accrual';
  if not found then return null; end if;
  refund := -a.amount_cents;
  insert into commission_ledger (organization_id, project_id, order_id, affiliate_id, kind, amount_cents, reason)
  values (a.organization_id, a.project_id, a.order_id, a.affiliate_id, 'reversal', refund, p_reason)
  on conflict (order_id, kind) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return null; end if;
  return refund;
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
  return true;
end $$;


-- Devolução (1 unidade por pedido): "returned" repõe a BOM no estoque quando o pedido foi liberado;
-- "discarded" não repõe. Em ambos: plataforma -> devolucao_concluida e estorno da comissão.
create or replace function app.register_return(p_order uuid, p_disposition text, p_reason text) returns jsonb
language plpgsql set search_path = public as $$
declare o orders%rowtype; cur text; bom jsonb; r record; ok boolean;
begin
  if p_disposition not in ('returned','discarded') then
    raise exception 'disposição inválida' using errcode = '22023';
  end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'pedido não encontrado' using errcode = '02000'; end if;
  select platform_status into cur from order_status where order_id = p_order;
  if cur not in ('cobrado','inadimplente') or exists (select 1 from order_returns where order_id = p_order) then
    raise exception 'pedido não admite devolução no estado atual (%)', cur using errcode = '55000';
  end if;

  if p_disposition = 'returned' and o.released_at is not null then
    select p.bom into bom from product_plans p where p.id = o.plan_id;
    perform 1 from stock_items
     where id in (select (b->>'stockItemId')::uuid from jsonb_array_elements(coalesce(bom,'[]')) b) order by id for update;
    for r in
      select i.id, sum((b->>'qty')::int) as need
        from jsonb_array_elements(coalesce(bom,'[]')) b join stock_items i on i.id = (b->>'stockItemId')::uuid
       group by i.id order by i.id
    loop
      update stock_items set quantity = quantity + r.need where id = r.id;
      insert into stock_movements (organization_id, project_id, stock_item_id, order_id, delta, reason)
      values (o.organization_id, o.project_id, r.id, o.id, r.need, 'return');
    end loop;
  end if;

  insert into order_returns (organization_id, project_id, order_id, status, qty_returned, qty_discarded)
  values (o.organization_id, o.project_id, o.id, 'concluida',
          case when p_disposition = 'returned' then 1 else 0 end, case when p_disposition = 'discarded' then 1 else 0 end);
  ok := app.transition_order(p_order, 'platform', cur, 'devolucao_concluida', now(), app.current_user_id());
  if not ok then raise exception 'estado mudou durante a devolução' using errcode = '55000'; end if;
  perform app.reverse_commission(p_order, coalesce(p_reason, p_disposition));
  insert into order_events (organization_id, project_id, order_id, axis, to_value, actor_id, payload)
  values (o.organization_id, o.project_id, o.id, 'system', p_disposition, app.current_user_id(), jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true, 'disposition', p_disposition);
end $$;

-- Inadimplência: dias completos após a entrega > prazo do projeto (settings.overdue_grace_days, padrão 15),
-- sem pagamento. Idempotente; ignora pedidos já travados por outra transação.
create or replace function app.mark_overdue(p_project uuid, p_now timestamptz default now()) returns int
language plpgsql set search_path = public as $$
declare grace int; n int := 0; r record;
begin
  if not app.can_access_project(p_project) then
    raise exception 'projeto inacessível' using errcode = '42501';
  end if;
  select coalesce((settings->>'overdue_grace_days')::int, 15) into grace from projects where id = p_project;
  for r in
    select s.order_id from order_status s
     where s.project_id = p_project and s.platform_status = 'cobrado' and s.payment_status <> 'pago'
       and s.delivered_at is not null
       and floor(extract(epoch from (p_now - s.delivered_at)) / 86400) > grace
     order by s.order_id for update of s skip locked
  loop
    if app.transition_order(r.order_id, 'platform', 'cobrado', 'inadimplente', p_now, null) then n := n + 1; end if;
  end loop;
  return n;
end $$;

revoke all on function app.accrue_commission(uuid), app.reverse_commission(uuid,text),
  app.register_return(uuid,text,text), app.mark_overdue(uuid,timestamptz) from public;
grant execute on function app.accrue_commission(uuid), app.reverse_commission(uuid,text),
  app.register_return(uuid,text,text), app.mark_overdue(uuid,timestamptz) to app_user;

-- create_order passa a validar o afiliado (FK ignora RLS: sem isso dava para vincular afiliado de outro tenant).
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
  select to_jsonb(v) into vol from app.volume_status(org) v;
  return jsonb_build_object('id', oid, 'created', true, 'volume', vol);
end $$;
