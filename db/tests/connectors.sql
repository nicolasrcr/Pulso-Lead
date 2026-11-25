-- Fase 3: sync de rastreio, ingestão idempotente de vendas, consulta pública sem PII.
\set ON_ERROR_STOP on
begin;
insert into activity_templates (key, version, definition) values ('pos-pago', 1, '{}') on conflict do nothing;
insert into organizations (id, name, slug) values ('00000000-0000-0000-0000-0000000000c0','Org C','org-c-w');
insert into projects (id, organization_id, name, template_key, template_version) values
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c0','C1','pos-pago',1),
  ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c0','C2','pos-pago',1);
insert into app_users (id, email, name, platform_admin) values
  ('00000000-0000-0000-0000-0000000000c3','plat@c.test','Plataforma', true),
  ('00000000-0000-0000-0000-00000000c01a','op@c2.test','Op C2', false);
insert into memberships (user_id, organization_id, project_id, role, approved_at) values
  ('00000000-0000-0000-0000-00000000c01a','00000000-0000-0000-0000-0000000000c0','00000000-0000-0000-0000-0000000000c2','operator',now());

set local role app_user;
select set_config('app.user_id','00000000-0000-0000-0000-0000000000c3', true);
insert into products (id, organization_id, project_id, name) values
  ('00000000-0000-0000-0000-0000000c06a1','00000000-0000-0000-0000-0000000000c0','00000000-0000-0000-0000-0000000000c1','P1');
insert into product_plans (id, organization_id, project_id, product_id, name, price_cents) values
  ('00000000-0000-0000-0000-0000000c07a1','00000000-0000-0000-0000-0000000000c0','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000c06a1','Pl1', 10000);

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('app.user_id', u, true), set_config('app.project_id', '', true) $$;
create function pg_temp.try(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate; end $$;

-- 1) ingestão idempotente por (projeto, provider, event_id)
do $$ declare a jsonb; b jsonb; begin
  a := app.ingest_sale_event('00000000-0000-0000-0000-0000000000c1','braip','E1','{"x":1}', true);
  b := app.ingest_sale_event('00000000-0000-0000-0000-0000000000c1','braip','E1','{"x":2}', true);
  assert (a->>'duplicate')::boolean = false and (b->>'duplicate')::boolean = true, 'segunda chegada é duplicata';
  assert a->>'id' = b->>'id', 'mesmo registro';
  assert (select count(*) from webhook_events_raw where event_id = 'E1') = 1, 'uma linha';
  assert (select payload->>'x' from webhook_events_raw where event_id = 'E1') = '1', 'payload original preservado';
  assert pg_temp.try($q$select app.ingest_sale_event('00000000-0000-0000-0000-0000000000c1','desconhecido','E2','{}', true)$q$) = '22023', 'provider fora da lista';
end $$;

-- 2) finish_sale_event: transições válidas e contagem de tentativas
do $$ declare eid uuid; begin
  select (app.ingest_sale_event('00000000-0000-0000-0000-0000000000c1','payt','E3','{}', true)->>'id')::uuid into eid;
  perform app.finish_sale_event(eid, 'unlinked');
  assert (select status from webhook_events_raw where webhook_events_raw.id = eid) = 'unlinked', 'unlinked';
  assert (select attempts from webhook_events_raw where webhook_events_raw.id = eid) = 1, 'tentativa contada';
  assert pg_temp.try(format('select app.finish_sale_event(%L, %L)', eid, 'received')) = '22023', 'status inválido';
end $$;

-- 3) isolamento: operador do C2 não ingere nem lê eventos do C1
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000c01a');
  assert pg_temp.try($q$select app.ingest_sale_event('00000000-0000-0000-0000-0000000000c1','braip','E9','{}', true)$q$) = '42501', 'sem acesso ao projeto';
  assert (select count(*) from webhook_events_raw) = 0, 'RLS esconde eventos de outro projeto';
end $$;

-- 4) mark_tracking_sync + consulta pública sem PII
do $$ declare o uuid; r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
  o := (app.create_order('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000c07a1', null,
        '{"name":"Maria Segredo","cpf_hash":"h","phone":"61999991234"}', '\xdeadbeef', 10000, true, null, 'c1', 'created', null)->>'id')::uuid;
  perform app.set_tracking(o, 'JT123456');
  perform app.mark_tracking_sync(o, false, 'timeout');
  assert (select tracking_synced from orders where id = o) = false and (select tracking_sync_error from orders where id = o) = 'timeout', 'erro registrado';
  perform app.mark_tracking_sync(o, true, null);
  assert (select tracking_synced from orders where id = o) and (select tracking_synced_at from orders where id = o) is not null, 'sincronizado';
  assert (select tracking_sync_error from orders where id = o) is null, 'erro limpo';
  reset role; -- sessão pública: sem usuário no contexto
  set local role app_user;
  perform set_config('app.user_id', '', true);
  r := app.public_tracking('JT123456');
  assert r is not null and r->>'status' is not null, 'consulta pública responde';
  assert r::text not like '%Maria%' and r::text not like '%61999%' and r::text not like '%deadbeef%', 'sem PII';
  assert app.public_tracking('NAOEXISTE1') is null, 'código inexistente → null';
  assert app.public_tracking('x') is null, 'código fora do formato → null';
end $$;
rollback;
