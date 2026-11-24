-- Pedidos, liberação atômica, transições com compare-and-swap e contador de volume.
\set ON_ERROR_STOP on
begin;

insert into activity_templates (key, version, definition) values ('pos-pago', 1, '{}') on conflict do nothing;
insert into organizations (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000a0','Org A','org-a-o'),
  ('00000000-0000-0000-0000-0000000000b0','Org B','org-b-o');
insert into projects (id, organization_id, name, template_key, template_version) values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a0','A1','pos-pago',1),
  ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a0','A2','pos-pago',1),
  ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b0','B1','pos-pago',1);
insert into app_users (id, email, name, platform_admin) values
  ('00000000-0000-0000-0000-0000000000f0','plat@o.test','Plataforma', true),
  ('00000000-0000-0000-0000-00000000001a','op@a1.o.test','Operador A1', false),
  ('00000000-0000-0000-0000-00000000002a','op@a2.o.test','Operador A2', false),
  ('00000000-0000-0000-0000-00000000000b','op@b1.o.test','Operador B1', false);
insert into memberships (user_id, organization_id, project_id, role, approved_at) values
  ('00000000-0000-0000-0000-00000000001a','00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a1','operator',now()),
  ('00000000-0000-0000-0000-00000000002a','00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a2','operator',now()),
  ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-0000000000b1','operator',now());
insert into plans (id, key, name) values ('00000000-0000-0000-0000-0000000000c0','o-test','Teste') on conflict do nothing;
insert into subscriptions (organization_id, plan_id, status, order_cap) values
  ('00000000-0000-0000-0000-0000000000a0', (select id from plans where key='o-test'), 'ativo', 5);

-- fixtures de negócio entram pelo papel da aplicação com contexto de admin da plataforma
set local role app_user;
select set_config('app.user_id','00000000-0000-0000-0000-0000000000f0', true);
insert into stock_items (id, organization_id, project_id, sku, name, quantity) values
  ('00000000-0000-0000-0000-0000000005a1','00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a1','CAIXA','Caixa', 10),
  ('00000000-0000-0000-0000-0000000005a2','00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a1','FRASCO','Frasco', 2);
insert into products (id, organization_id, project_id, name) values
  ('00000000-0000-0000-0000-0000000006a1','00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a1','Produto A1'),
  ('00000000-0000-0000-0000-0000000006a2','00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a2','Produto A2');
insert into product_plans (id, organization_id, project_id, product_id, name, price_cents, bom) values
  ('00000000-0000-0000-0000-0000000007a1','00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000006a1','Plano 1', 19900,
   '[{"stockItemId":"00000000-0000-0000-0000-0000000005a1","qty":1},{"stockItemId":"00000000-0000-0000-0000-0000000005a2","qty":1}]'),
  ('00000000-0000-0000-0000-0000000007a3','00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000006a1','Plano 3 frascos', 39900,
   '[{"stockItemId":"00000000-0000-0000-0000-0000000005a1","qty":1},{"stockItemId":"00000000-0000-0000-0000-0000000005a2","qty":3}]'),
  ('00000000-0000-0000-0000-0000000007a2','00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000006a2','Plano A2', 10000, '[]');
reset role;

set local role app_user;

create function pg_temp.as_user(u text, p text default '') returns void language sql as $$
  select set_config('app.user_id', u, true), set_config('app.project_id', p, true)
$$;
create function pg_temp.try(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate; end $$;

-- 1) criação: três eixos iniciais, evento e contador
do $$ declare r jsonb; oid uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000001a');
  r := app.create_order('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000007a1', null,
        '{"name":"Cliente","phone":"61999991234","cpf_hash":"h1"}', '\xdeadbeef', 19900, true, null, 'ext-1', 'created', null);
  assert (r->>'created')::boolean, 'cria pedido novo';
  oid := (r->>'id')::uuid;
  assert (select platform_status||'/'||shipping_status||'/'||payment_status from order_status where order_id = oid) = 'criado/sem_status/sem_status', 'eixos iniciais (After Pay)';
  assert (select count(*) from order_events where order_id = oid and axis = 'system') = 1, 'evento de criação';
  assert (select created_by from orders where id = oid) = '00000000-0000-0000-0000-00000000001a', 'registra o autor';
  r := app.create_order('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000007a1', null,
        '{"name":"Cliente 2","cpf_hash":"h2"}', null, 19900, false, null, null, 'created', null);
  assert (select payment_status from order_status where order_id = (r->>'id')::uuid) = 'pendente', 'pagamento antecipado nasce pendente';
end $$;

-- 2) idempotência por external_id (importação repetida não duplica nem recontabiliza)
do $$ declare a jsonb; b jsonb; used_before int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000001a');
  a := app.create_order('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000007a1', null,
        '{"name":"Importado","cpf_hash":"h3"}', null, 100, true, null, 'imp-1', 'imported', null);
  select used into used_before from app.volume_status('00000000-0000-0000-0000-0000000000a0');
  b := app.create_order('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000007a1', null,
        '{"name":"Importado","cpf_hash":"h3"}', null, 100, true, null, 'imp-1', 'imported', null);
  assert (a->>'id') = (b->>'id'), 'mesmo id na reimportação';
  assert not (b->>'created')::boolean, 'segunda chamada não cria';
  assert (select used from app.volume_status('00000000-0000-0000-0000-0000000000a0')) = used_before, 'não recontabiliza';
  assert (select count(*) from orders where external_id = 'imp-1') = 1, 'um único pedido';
end $$;

-- 3) isolamento: outro projeto/organização
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000001a');
  assert pg_temp.try($q$ select app.create_order('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000007a2', null, '{"name":"x"}', null, 1, true, null, null, 'created', null) $q$) = '42501', 'operador A1 não cria no A2';
  assert pg_temp.try($q$ select app.create_order('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000007a2', null, '{"name":"x"}', null, 1, true, null, null, 'created', null) $q$) <> 'ok', 'plano de outro projeto é recusado';
  assert pg_temp.try($q$ select app.create_order('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000007a2', null, '{"name":"x"}', null, 1, true, null, null, 'created', null) $q$) = '42501', 'operador A1 não cria na Org B';
  assert pg_temp.try($q$ select app.bump_usage('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-0000000000a1','orders_created') $q$) <> 'ok', 'bump_usage não aceita org que não é do projeto';
  assert pg_temp.try($q$ select app.bump_usage('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a2','orders_created') $q$) = '42501', 'bump_usage não aceita projeto inacessível';
end $$;

-- 4) contador de volume: teto 5, alerta a 80% (4º) e 100% (5º), segue informando acima do teto
do $$ declare r jsonb; used int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000002a');
  -- Org A já tem 3 pedidos nesta transação (1 + 1 + 1 importado). Operador do A2 acrescenta.
  select s.used into used from app.volume_status('00000000-0000-0000-0000-0000000000a0') s;
  assert used = 3, 'a org já tem 3 no mês: ' || used;
  r := app.create_order('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000007a2', null, '{"name":"v4"}', null, 1, true, null, null, 'created', null);
  assert r #>> '{volume,alert}' = '80', 'alerta 80% no 4º: ' || (r->>'volume');
  r := app.create_order('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000007a2', null, '{"name":"v5"}', null, 1, true, null, null, 'created', null);
  assert r #>> '{volume,alert}' = '100', 'alerta 100% no 5º';
  r := app.create_order('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000007a2', null, '{"name":"v6"}', null, 1, true, null, null, 'created', null);
  assert (r #>> '{volume,over}')::boolean, 'acima do teto informa, mas não bloqueia';
  assert (r->>'created')::boolean, 'o pedido acima do teto é criado';
end $$;

-- 5) volume_status só para membros da organização
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
  assert pg_temp.try($q$ select * from app.volume_status('00000000-0000-0000-0000-0000000000a0') $q$) = '42501', 'usuário da Org B não vê o volume da Org A';
end $$;

-- 6) liberação: baixa única e atômica
do $$ declare r jsonb; oid uuid; r2 jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000001a');
  oid := (select id from orders where external_id = 'ext-1');
  r := app.release_order(oid);
  assert (r->>'released')::boolean, 'libera';
  assert (select quantity from stock_items where sku='CAIXA') = 9 and (select quantity from stock_items where sku='FRASCO') = 1, 'baixa pela BOM';
  r2 := app.release_order(oid);
  assert not (r2->>'released')::boolean, 'segunda liberação não baixa de novo';
  assert (select quantity from stock_items where sku='CAIXA') = 9, 'estoque intacto na repetição';
  assert (select count(*) from stock_movements where order_id = oid and reason = 'release') = 2, 'dois movimentos (um por item)';
end $$;

-- 7) falta de estoque: nada é baixado (atomicidade entre itens)
do $$ declare r jsonb; oid uuid; code text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000001a');
  r := app.create_order('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000007a3', null, '{"name":"3 frascos"}', null, 39900, true, null, null, 'created', null);
  oid := (r->>'id')::uuid;
  code := pg_temp.try(format($q$ select app.release_order(%L) $q$, oid));
  assert code = '55000', 'estoque insuficiente = 55000, veio ' || code;
  assert (select quantity from stock_items where sku='CAIXA') = 9, 'o primeiro item não foi baixado (rollback do bloco)';
  assert (select released_at from orders where id = oid) is null, 'pedido segue não liberado';
end $$;

-- 8) liberação respeita o isolamento
do $$ declare oid uuid; begin
  oid := (select id from orders where external_id = 'ext-1');
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000002a');
  assert pg_temp.try(format($q$ select app.release_order(%L) $q$, oid)) = '02000', 'operador de outro projeto não enxerga o pedido';
end $$;

-- 9) transição com compare-and-swap e evento
do $$ declare oid uuid; ok boolean; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000001a');
  oid := (select id from orders where external_id = 'ext-1');
  assert not app.transition_order(oid, 'payment', 'pendente', 'pago', now(), null), 'from errado não transiciona';
  assert app.transition_order(oid, 'payment', 'sem_status', 'pendente', now(), '00000000-0000-0000-0000-00000000001a'), 'from correto transiciona';
  assert app.transition_order(oid, 'payment', 'pendente', 'pago', now(), null), 'pago';
  assert (select paid_at is not null from order_status where order_id = oid), 'grava paid_at ao pagar';
  assert (select count(*) from order_events where order_id = oid and axis = 'payment') = 2, 'um evento por transição';
  assert app.transition_order(oid, 'shipping', 'sem_status', 'preparando_logistica', '2026-11-10T10:00:00Z', null), 'envio avança';
  assert not app.transition_order(oid, 'shipping', 'preparando_logistica', 'preparando', '2026-11-09T10:00:00Z', null), 'evento de envio antigo não regride';
  assert pg_temp.try($q$ select app.transition_order(gen_random_uuid(), 'bogus', 'a', 'b', now(), null) $q$) <> 'ok', 'eixo desconhecido é recusado';
end $$;

-- 10) entrega grava delivered_at
do $$ declare oid uuid; begin
  oid := (select id from orders where external_id = 'ext-1');
  perform app.transition_order(oid, 'shipping', 'preparando_logistica', 'entregue', '2026-11-12T10:00:00Z', null);
  assert (select delivered_at from order_status where order_id = oid) = '2026-11-12T10:00:00Z', 'delivered_at = momento do evento';
end $$;

rollback;
\echo 'orders.sql OK'
