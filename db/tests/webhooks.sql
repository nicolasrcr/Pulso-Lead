-- Webhooks de saída (fila), tracking e link assinado de afiliado.
\set ON_ERROR_STOP on
begin;
insert into activity_templates (key, version, definition) values ('pos-pago', 1, '{}') on conflict do nothing;
insert into organizations (id, name, slug) values ('00000000-0000-0000-0000-0000000000f0','Org F','org-f-w');
insert into projects (id, organization_id, name, template_key, template_version) values
  ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f0','F1','pos-pago',1),
  ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000f0','F2','pos-pago',1);
insert into app_users (id, email, name, platform_admin) values
  ('00000000-0000-0000-0000-0000000000f3','plat@f.test','Plataforma', true),
  ('00000000-0000-0000-0000-00000000f01a','op@f1.test','Op F1', false);
insert into memberships (user_id, organization_id, project_id, role, approved_at) values
  ('00000000-0000-0000-0000-00000000f01a','00000000-0000-0000-0000-0000000000f0','00000000-0000-0000-0000-0000000000f1','operator',now());

set local role app_user;
select set_config('app.user_id','00000000-0000-0000-0000-0000000000f3', true);
insert into products (id, organization_id, project_id, name) values
  ('00000000-0000-0000-0000-0000000f06a1','00000000-0000-0000-0000-0000000000f0','00000000-0000-0000-0000-0000000000f1','P1'),
  ('00000000-0000-0000-0000-0000000f06a2','00000000-0000-0000-0000-0000000000f0','00000000-0000-0000-0000-0000000000f2','P2');
insert into product_plans (id, organization_id, project_id, product_id, name, price_cents) values
  ('00000000-0000-0000-0000-0000000f07a1','00000000-0000-0000-0000-0000000000f0','00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000f06a1','Pl1', 10000),
  ('00000000-0000-0000-0000-0000000f07a2','00000000-0000-0000-0000-0000000000f0','00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000f06a2','Pl2', 10000);
insert into affiliates (id, organization_id, project_id, name) values
  ('00000000-0000-0000-0000-0000000f0aa1','00000000-0000-0000-0000-0000000000f0','00000000-0000-0000-0000-0000000000f1','Af1'),
  ('00000000-0000-0000-0000-0000000f0aa2','00000000-0000-0000-0000-0000000000f0','00000000-0000-0000-0000-0000000000f2','Af2');
insert into outbound_webhooks (id, organization_id, project_id, name, url, secret, events, active) values
  ('00000000-0000-0000-0000-0000000f0b01','00000000-0000-0000-0000-0000000000f0','00000000-0000-0000-0000-0000000000f1','todos','https://a.example/h','s',array['ORDER_CREATE','CHARGE_UPDATED','SHIPPING_REGISTER','SHIPPING_UPDATE'],true),
  ('00000000-0000-0000-0000-0000000f0b02','00000000-0000-0000-0000-0000000000f0','00000000-0000-0000-0000-0000000000f1','so-criacao','https://b.example/h','s',array['ORDER_CREATE'],true),
  ('00000000-0000-0000-0000-0000000f0b03','00000000-0000-0000-0000-0000000000f0','00000000-0000-0000-0000-0000000000f1','inativo','https://c.example/h','s',array['ORDER_CREATE'],false),
  ('00000000-0000-0000-0000-0000000f0b04','00000000-0000-0000-0000-0000000000f0','00000000-0000-0000-0000-0000000000f2','outro-projeto','https://d.example/h','s',array['ORDER_CREATE'],true);

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('app.user_id', u, true), set_config('app.project_id', '', true) $$;
create function pg_temp.try(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate; end $$;

-- 1) ORDER_CREATE: só hooks ativos, do projeto e inscritos no evento; payload sem dados pessoais
do $$ declare o uuid; r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000f01a');
  r := app.create_order('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000f07a1', null,
        '{"name":"Maria Segredo","cpf_hash":"h","phone":"61999991234"}', '\xdeadbeef', 10000, true, null, 'w1', 'created', null);
  o := (r->>'id')::uuid;
  assert (select count(*) from webhook_deliveries where event = 'ORDER_CREATE') = 2, 'dois hooks elegíveis (todos + só-criação)';
  assert not exists (select 1 from webhook_deliveries where webhook_id in ('00000000-0000-0000-0000-0000000f0b03','00000000-0000-0000-0000-0000000f0b04')), 'inativo e de outro projeto não recebem';
  assert (select payload->>'orderId' from webhook_deliveries limit 1) = o::text, 'payload com orderId';
  assert (select payload->>'externalId' from webhook_deliveries limit 1) = 'w1', 'e externalId';
  assert (select payload->>'event' from webhook_deliveries limit 1) = 'ORDER_CREATE', 'e o nome do evento';
  assert (select count(*) from webhook_deliveries where payload::text ~* 'segredo|cpf|61999991234|deadbeef') = 0, 'sem PII no payload';
  assert (select status = 'pending' and attempts = 0 and next_attempt_at is not null from webhook_deliveries limit 1), 'nasce pendente e agendado';
  -- reenvio idempotente do mesmo pedido não enfileira de novo
  perform app.create_order('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000f07a1', null, '{"name":"x"}', null, 10000, true, null, 'w1', 'created', null);
  assert (select count(*) from webhook_deliveries where event = 'ORDER_CREATE') = 2, 'idempotente: não duplica entregas';
end $$;

-- 2) CHARGE_UPDATED e SHIPPING_UPDATE só no hook que assina esses eventos
do $$ declare o uuid; begin
  o := (select id from orders where external_id = 'w1');
  perform app.transition_order(o,'payment','sem_status','pendente',now(),null);
  perform app.transition_order(o,'payment','pendente','pago',now(),null);
  assert (select count(*) from webhook_deliveries where event = 'CHARGE_UPDATED') = 2, 'uma entrega por mudança de pagamento';
  assert (select count(*) from webhook_deliveries where event = 'CHARGE_UPDATED' and payload #>> '{status,payment}' = 'pago') = 1, 'payload com o novo status';
  assert (select count(distinct webhook_id) from webhook_deliveries where event = 'CHARGE_UPDATED') = 1, 'só o hook inscrito';
  perform app.transition_order(o,'shipping','sem_status','coletado',now(),null);
  assert (select count(*) from webhook_deliveries where event = 'SHIPPING_UPDATE') = 1, 'SHIPPING_UPDATE';
  assert not app.transition_order(o,'shipping','sem_status','enviado',now(),null), 'CAS falha';
  assert (select count(*) from webhook_deliveries where event = 'SHIPPING_UPDATE') = 1, 'transição recusada não enfileira';
  perform app.transition_order(o,'platform','criado','cobrado',now(),null);
  assert (select count(*) from webhook_deliveries where event in ('CHARGE_UPDATED','SHIPPING_UPDATE')) = 3, 'eixo plataforma não gera evento de saída';
end $$;

-- 3) rastreio registrado: SHIPPING_REGISTER; código validado; isolamento
do $$ declare o uuid; begin
  o := (select id from orders where external_id = 'w1');
  perform app.set_tracking(o, 'JT123456789BR');
  assert (select tracking_code from orders where id = o) = 'JT123456789BR', 'grava o código';
  assert (select tracking_synced from orders where id = o) = false, 'marca para sincronizar';
  assert (select count(*) from webhook_deliveries where event = 'SHIPPING_REGISTER') = 1, 'SHIPPING_REGISTER';
  assert pg_temp.try(format($q$ select app.set_tracking(%L, 'a b;drop') $q$, o)) = '22023', 'código inválido';
  assert pg_temp.try(format($q$ select app.set_tracking(%L, '') $q$, o)) = '22023', 'código vazio';
  assert pg_temp.try($q$ select app.set_tracking(gen_random_uuid(), 'ABC123') $q$) = '02000', 'pedido inexistente';
end $$;

-- 4) link assinado de afiliado: ida e volta, adulteração, plano de outro projeto, afiliado inativo
do $$ declare t text; r jsonb; t2 text; begin
  t := app.affiliate_link('00000000-0000-0000-0000-0000000f0aa1', '00000000-0000-0000-0000-0000000f07a1');
  r := app.resolve_affiliate_link(t);
  assert r->>'affiliateId' = '00000000-0000-0000-0000-0000000f0aa1', 'resolve o afiliado';
  assert r->>'planId' = '00000000-0000-0000-0000-0000000f07a1', 'e o plano';
  assert r->>'projectId' = '00000000-0000-0000-0000-0000000000f1', 'e o projeto';
  assert app.resolve_affiliate_link(replace(t, '0aa1', '0aa2')) is null, 'trocar o afiliado invalida a assinatura';
  assert app.resolve_affiliate_link(left(t, length(t) - 1) || case when right(t, 1) = '0' then '1' else '0' end) is null, 'assinatura adulterada';
  assert app.resolve_affiliate_link('lixo') is null and app.resolve_affiliate_link('') is null, 'lixo é nulo, não erro';
  t2 := app.affiliate_link('00000000-0000-0000-0000-0000000f0aa1', null);
  assert app.resolve_affiliate_link(t2)->>'planId' is null, 'link sem plano';
  assert pg_temp.try($q$ select app.affiliate_link('00000000-0000-0000-0000-0000000f0aa1', '00000000-0000-0000-0000-0000000f07a2') $q$) = '23503', 'plano de outro projeto não gera link';
  update affiliates set active = false where id = '00000000-0000-0000-0000-0000000f0aa1';
  assert app.resolve_affiliate_link(t) is null, 'afiliado inativo não resolve';
end $$;

-- 4b) resolução pública: o link é aberto SEM sessão (nenhum usuário no contexto) e precisa funcionar
do $$ declare t text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
  t := app.affiliate_link('00000000-0000-0000-0000-0000000f0aa2', '00000000-0000-0000-0000-0000000f07a2');   -- (admin da plataforma ainda no contexto)
  perform set_config('app.user_id', '', true);
  assert (select count(*) from affiliates) = 0, 'sem usuário, o RLS esconde os afiliados (premissa do teste)';
  assert app.resolve_affiliate_link(t)->>'affiliateId' = '00000000-0000-0000-0000-0000000f0aa2', 'resolve sem sessão';
  assert app.resolve_affiliate_link(t)->>'planId' = '00000000-0000-0000-0000-0000000f07a2', 'inclusive o plano';
end $$;

-- 5) isolamento: operador do F1 não gera link de afiliado do F2
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000f01a');
  assert pg_temp.try($q$ select app.affiliate_link('00000000-0000-0000-0000-0000000f0aa2', null) $q$) = '02000', 'afiliado de outro projeto é invisível';
end $$;

rollback;
\echo 'webhooks.sql OK'
