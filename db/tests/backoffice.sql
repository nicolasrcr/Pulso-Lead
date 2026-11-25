-- Fase 7: back-office do fornecedor, suspensão (somente leitura), descarte seguro, auditoria de plataforma.
\set ON_ERROR_STOP on
begin;
insert into activity_templates (key, version, definition) values ('pos-pago', 1, '{}') on conflict do nothing;
insert into plans (key, name) values ('std-t7','Padrão T7') on conflict do nothing;
insert into organizations (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000d0','Org D','org-d-w'),('00000000-0000-0000-0000-0000000000d9','Org D sem assinatura','org-d9-w');
insert into projects (id, organization_id, name, template_key, template_version) values
  ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d0','D1','pos-pago',1),
  ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000d9','D2','pos-pago',1);
insert into app_users (id, email, name, platform_admin) values
  ('00000000-0000-0000-0000-0000000000d3','plat@d.test','Plataforma', true),
  ('00000000-0000-0000-0000-00000000d01a','adm@d.test','Admin D', false);
insert into memberships (user_id, organization_id, project_id, role, approved_at) values
  ('00000000-0000-0000-0000-00000000d01a','00000000-0000-0000-0000-0000000000d0',null,'org_admin',now());

set local role app_user;
select set_config('app.user_id','00000000-0000-0000-0000-0000000000d3', true);
insert into products (id, organization_id, project_id, name) values
  ('00000000-0000-0000-0000-0000000d06a1','00000000-0000-0000-0000-0000000000d0','00000000-0000-0000-0000-0000000000d1','P1');
insert into product_plans (id, organization_id, project_id, product_id, name, price_cents) values
  ('00000000-0000-0000-0000-0000000d07a1','00000000-0000-0000-0000-0000000000d0','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000d06a1','Pl1', 10000);

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('app.user_id', u, true), set_config('app.project_id', '', true) $$;
create function pg_temp.try(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate; end $$;

-- 1) só admin da plataforma opera assinaturas
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000d01a');
  assert pg_temp.try($q$select app.create_subscription('00000000-0000-0000-0000-0000000000d0','std-t7',100000,500)$q$) = '42501', 'admin de org não cria assinatura';
  assert pg_temp.try($q$select app.backoffice_overview()$q$) = '42501', 'admin de org não vê visão da plataforma';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d3');
  perform app.create_subscription('00000000-0000-0000-0000-0000000000d0','std-t7',100000,500);
  assert pg_temp.try($q$select app.create_subscription('00000000-0000-0000-0000-0000000000d0','std-t7',100000,500)$q$) = '23505', 'uma assinatura vigente por org';
  assert pg_temp.try($q$select app.create_subscription('00000000-0000-0000-0000-0000000000d0','nao-existe',1,1)$q$) = '22023', 'plano inexistente';
end $$;

-- 2) máquina de estados da assinatura + trilha de auditoria da plataforma
do $$ declare o constant uuid := '00000000-0000-0000-0000-0000000000d0'; begin
  assert pg_temp.try(format('select app.set_subscription_status(%L,%L,%L)', o, 'em_atraso', 'x')) = '22023', 'implantacao → em_atraso inválido';
  perform app.set_subscription_status(o, 'ativo', 'go-live');
  perform app.set_subscription_status(o, 'em_atraso', 'boleto vencido');
  perform app.set_subscription_status(o, 'ativo', 'pago');
  assert (select count(*) from platform_audit_log where organization_id = o and action = 'subscription.status') = 3, 'toda mudança auditada';
  assert (select meta->>'reason' from platform_audit_log where organization_id = o order by id desc limit 1) = 'pago', 'motivo gravado';
  assert pg_temp.try(format('select app.set_subscription_status(%L,%L,null)', o, 'suspenso')) = '22023', 'motivo obrigatório para suspender';
end $$;

-- 3) suspensão = somente leitura (escrita barrada, leitura e exportação seguem)
do $$ declare o constant uuid := '00000000-0000-0000-0000-0000000000d0'; ord uuid; begin
  ord := (app.create_order('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000d07a1', null,
        '{"name":"Maria Segredo","cpf_hash":"h","phone":"61999991234","email":"m@x.com"}', '\xdeadbeef', 10000, true, null, 'd1', 'created', null)->>'id')::uuid;
  perform app.set_subscription_status(o, 'suspenso', 'inadimplência');
  assert app.org_suspended(o), 'suspensa';
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000d01a');
  assert pg_temp.try($q$select app.create_order('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000d07a1', null,'{"name":"X"}', null, 1, true, null, 'd2', 'created', null)$q$) = '55006', 'create_order barrado';
  assert pg_temp.try($q$update products set name = 'novo'$q$) = '55006', 'update direto barrado';
  assert pg_temp.try($q$delete from product_plans$q$) = '55006', 'delete direto barrado';
  assert (select count(*) from orders) = 1, 'leitura segue';
  -- admin da plataforma ainda opera (reativação/descarte) e a org volta a escrever
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d3');
  perform app.set_subscription_status(o, 'ativo', 'regularizou');
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000d01a');
  assert pg_temp.try($q$update products set name = 'novo'$q$) = 'ok', 'reativada escreve';
end $$;

-- 4) organização sem assinatura não é bloqueada
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d3');
  assert not app.org_suspended('00000000-0000-0000-0000-0000000000d9'), 'sem assinatura = livre';
  insert into products (organization_id, project_id, name) values ('00000000-0000-0000-0000-0000000000d9','00000000-0000-0000-0000-0000000000d2','livre');
end $$;

-- 5) visão geral da plataforma
do $$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d3');
  select jsonb_agg(x) into r from app.backoffice_overview() x where (x->>'organizationId') = '00000000-0000-0000-0000-0000000000d0';
  assert (r->0->>'status') = 'ativo' and (r->0->>'orderCap')::int = 500, 'status e cap';
  assert (r->0->>'projects')::int = 1, 'contagem de projetos';
  assert r->0 ? 'usedThisMonth', 'uso do mês presente';
end $$;

-- 6) descarte seguro: só encerrada + confirmação + retenção; anonimiza PII, preserva ledger/pedidos
do $$ declare o constant uuid := '00000000-0000-0000-0000-0000000000d0'; r jsonb; begin
  assert pg_temp.try(format('select app.discard_org_pii(%L,%L)', o, o::text)) = '22023', 'ativa não pode descartar';
  perform app.set_subscription_status(o, 'suspenso', 'fim');
  perform app.set_subscription_status(o, 'encerrado', 'contrato encerrado');
  assert pg_temp.try(format('select app.discard_org_pii(%L,%L)', o, 'errado')) = '22023', 'confirmação exigida';
  assert pg_temp.try(format('select app.discard_org_pii(%L,%L)', o, o::text)) = '22023', 'retenção mínima ainda não venceu';
end $$;
reset role;
update subscriptions set closed_at = now() - interval '31 days' where organization_id = '00000000-0000-0000-0000-0000000000d0';
set local role app_user;
select set_config('app.user_id','00000000-0000-0000-0000-0000000000d3', true);
do $$ declare o constant uuid := '00000000-0000-0000-0000-0000000000d0'; r jsonb; begin
  r := app.discard_org_pii(o, o::text);
  assert (r->>'customers')::int = 1, 'um cliente anonimizado';
  assert (select name from customers limit 1) = '[descartado]' and (select cpf_encrypted from customers limit 1) is null
     and (select phone from customers limit 1) is null and (select email from customers limit 1) is null, 'PII removida';
  assert (select count(*) from orders) = 1, 'pedido preservado (histórico financeiro)';
  assert exists (select 1 from platform_audit_log where action = 'org.discard_pii' and organization_id = o), 'descarte auditado';
  r := app.discard_org_pii(o, o::text);
  assert (r->>'customers')::int = 0, 'idempotente';
end $$;
rollback;
