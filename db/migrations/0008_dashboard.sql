-- Fase 5: o dashboard lê agregados (dash_daily), nunca varre pedidos ao vivo.
-- dash_refresh guarda quando cada projeto foi atualizado pela última vez (para o alerta de atraso).
create table dash_refresh (
  project_id uuid primary key references projects(id),
  organization_id uuid not null references organizations(id),
  refreshed_at timestamptz not null default now()
);
alter table dash_refresh enable row level security;
alter table dash_refresh force row level security;
create policy dash_refresh_tenant on dash_refresh for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on dash_refresh to app_user;

-- Recalcula o recorte [p_from, p_to] (dia = data local UTC-3 da criação do pedido). Idempotente:
-- apaga o recorte e regrava a partir dos pedidos; lock por projeto evita refresh concorrente duplicado.
create or replace function app.refresh_dash(p_project uuid, p_from date default null, p_to date default null) returns int
language plpgsql set search_path = public as $$
declare org uuid; d1 date; d2 date; today date := ((now() at time zone 'UTC') - interval '3 hours')::date; n int;
begin
  if not app.can_access_project(p_project) then
    raise exception 'projeto inacessível' using errcode = '42501';
  end if;
  select organization_id into org from projects where id = p_project;
  perform pg_advisory_xact_lock(hashtextextended(p_project::text, 0));
  d2 := coalesce(p_to, today);
  d1 := coalesce(p_from, (select min(((created_at at time zone 'UTC') - interval '3 hours')::date) from orders where project_id = p_project), d2);
  if d1 > d2 then raise exception 'intervalo inválido' using errcode = '22023'; end if;

  delete from dash_daily where project_id = p_project and day between d1 and d2;
  insert into dash_daily (organization_id, project_id, day, affiliate_id, uf, plan_id, orders, gross_cents,
                          paid, paid_cents, delivered, lost, returned, overdue, refreshed_at)
  select org, p_project, ((o.created_at at time zone 'UTC') - interval '3 hours')::date as day,
         o.affiliate_id, nullif(upper(left(c.address->>'uf', 2)), '')::char(2), o.plan_id,
         count(*)::int, coalesce(sum(o.total_cents), 0)::bigint,
         count(*) filter (where s.payment_status = 'pago')::int,
         coalesce(sum(o.total_cents) filter (where s.payment_status = 'pago'), 0)::bigint,
         count(*) filter (where s.shipping_status in ('entregue','entregue_caixa'))::int,
         count(*) filter (where s.shipping_status in ('perdido','roubado'))::int,
         count(*) filter (where s.platform_status = 'devolucao_concluida')::int,
         count(*) filter (where s.platform_status = 'inadimplente')::int, now()
    from orders o join order_status s on s.order_id = o.id left join customers c on c.id = o.customer_id
   where o.project_id = p_project
     and ((o.created_at at time zone 'UTC') - interval '3 hours')::date between d1 and d2
   group by 3, 4, 5, 6;
  get diagnostics n = row_count;

  insert into dash_refresh (project_id, organization_id, refreshed_at) values (p_project, org, now())
  on conflict (project_id) do update set refreshed_at = excluded.refreshed_at;
  return n;
end $$;

revoke all on function app.refresh_dash(uuid, date, date) from public;
grant execute on function app.refresh_dash(uuid, date, date) to app_user;
