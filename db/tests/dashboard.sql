-- Agregados do dashboard: refresh idempotente, isolamento e controle de atraso.
\set ON_ERROR_STOP on
begin;
insert into activity_templates (key, version, definition) values ('pos-pago', 1, '{}') on conflict do nothing;
insert into organizations (id, name, slug) values ('00000000-0000-0000-0000-0000000000e0','Org E','org-e-d');
insert into projects (id, organization_id, name, template_key, template_version) values
  ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e0','E1','pos-pago',1),
  ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000e0','E2','pos-pago',1);
insert into app_users (id, email, name, platform_admin) values
  ('00000000-0000-0000-0000-0000000000f2','plat@e.test','Plataforma', true),
  ('00000000-0000-0000-0000-00000000e01a','op@e1.test','Op E1', false),
  ('00000000-0000-0000-0000-00000000e02a','op@e2.test','Op E2', false);
insert into memberships (user_id, organization_id, project_id, role, approved_at) values
  ('00000000-0000-0000-0000-00000000e01a','00000000-0000-0000-0000-0000000000e0','00000000-0000-0000-0000-0000000000e1','operator',now()),
  ('00000000-0000-0000-0000-00000000e02a','00000000-0000-0000-0000-0000000000e0','00000000-0000-0000-0000-0000000000e2','operator',now());

set local role app_user;
select set_config('app.user_id','00000000-0000-0000-0000-0000000000f2', true);
insert into products (id, organization_id, project_id, name) values
  ('00000000-0000-0000-0000-0000000e06a1','00000000-0000-0000-0000-0000000000e0','00000000-0000-0000-0000-0000000000e1','P1'),
  ('00000000-0000-0000-0000-0000000e06a2','00000000-0000-0000-0000-0000000000e0','00000000-0000-0000-0000-0000000000e2','P2');
insert into product_plans (id, organization_id, project_id, product_id, name, price_cents) values
  ('00000000-0000-0000-0000-0000000e07a1','00000000-0000-0000-0000-0000000000e0','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000e06a1','Pl1', 10000),
  ('00000000-0000-0000-0000-0000000e07a2','00000000-0000-0000-0000-0000000000e0','00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000e06a2','Pl2', 20000);

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('app.user_id', u, true), set_config('app.project_id', '', true) $$;
create function pg_temp.try(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.mk(proj text, plan text, total int, ext text, uf text) returns uuid language plpgsql as $$
begin return (app.create_order(proj::uuid, plan::uuid, null, jsonb_build_object('name','C','address',jsonb_build_object('uf',uf)), null, total, true, null, ext, 'created', null)->>'id')::uuid; end $$;

-- cenário: E1 com 3 pedidos (SP pago+entregue, SP criado, RJ devolvido), E2 com 1
do $$ declare a uuid; b uuid; c uuid; d uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000e01a');
  a := pg_temp.mk('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000e07a1',10000,'a','sp');
  b := pg_temp.mk('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000e07a1',10000,'b','SP');
  c := pg_temp.mk('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000e07a1',10000,'c','RJ');
  perform app.transition_order(a,'platform','criado','cobrado',now(),null);
  perform app.transition_order(a,'payment','sem_status','pendente',now(),null);
  perform app.transition_order(a,'payment','pendente','pago',now(),null);
  perform app.transition_order(a,'shipping','sem_status','entregue',now(),null);
  perform app.transition_order(c,'platform','criado','cobrado',now(),null);
  perform app.register_return(c,'discarded','x');
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000e02a');
  d := pg_temp.mk('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000e07a2',20000,'d',null);
end $$;

-- 1) nunca atualizado: sem linha de controle; o refresh preenche agregados e o controle
do $$ declare n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000e01a');
  assert (select count(*) from dash_refresh) = 0, 'nunca atualizado';
  assert (select count(*) from dash_daily) = 0, 'sem agregados antes do refresh';
  n := app.refresh_dash('00000000-0000-0000-0000-0000000000e1');
  assert n = 2, 'duas combinações (dia, uf) no E1, veio ' || n;
  assert (select refreshed_at is not null from dash_refresh where project_id = '00000000-0000-0000-0000-0000000000e1'), 'controle gravado';
  assert (select sum(orders) from dash_daily) = 3, 'três pedidos';
  assert (select sum(gross_cents) from dash_daily) = 30000, 'bruto';
  assert (select sum(paid) from dash_daily) = 1 and (select sum(paid_cents) from dash_daily) = 10000, 'pagos';
  assert (select sum(delivered) from dash_daily) = 1, 'entregues';
  assert (select sum(returned) from dash_daily) = 1, 'devolvidos';
  assert (select orders from dash_daily where uf = 'SP') = 2, 'UF normalizada em maiúsculas';
end $$;

-- 2) idempotência: refresh repetido não duplica nem soma de novo
do $$ begin
  perform app.refresh_dash('00000000-0000-0000-0000-0000000000e1');
  perform app.refresh_dash('00000000-0000-0000-0000-0000000000e1');
  assert (select sum(orders) from dash_daily) = 3, 'continua 3';
  assert (select count(*) from dash_daily) = 2, 'sem linhas duplicadas';
end $$;

-- 3) o agregado acompanha mudanças de estado após novo refresh
do $$ declare b uuid; begin
  b := (select id from orders where external_id = 'b');
  perform app.transition_order(b,'payment','sem_status','pendente',now(),null);
  perform app.transition_order(b,'payment','pendente','pago',now(),null);
  assert (select sum(paid) from dash_daily) = 1, 'defasado até o refresh (agregado, não ao vivo)';
  perform app.refresh_dash('00000000-0000-0000-0000-0000000000e1');
  assert (select sum(paid) from dash_daily) = 2, 'refletido após o refresh';
end $$;

-- 4) isolamento: o E1 não atualiza nem lê o E2
do $$ begin
  assert pg_temp.try($q$ select app.refresh_dash('00000000-0000-0000-0000-0000000000e2') $q$) = '42501', 'sem acesso ao projeto';
  assert (select count(*) from dash_daily where project_id = '00000000-0000-0000-0000-0000000000e2') = 0, 'não vê agregados do E2';
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000e02a');
  perform app.refresh_dash('00000000-0000-0000-0000-0000000000e2');
  assert (select count(*) from dash_daily where project_id = '00000000-0000-0000-0000-0000000000e1') = 0, 'E2 não vê o E1';
  assert (select sum(orders) from dash_daily) = 1, 'E2 vê só o seu';
end $$;

-- 5) "Todos os projetos": plataforma enxerga os dois conjuntos
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
  assert (select count(distinct project_id) from dash_daily) = 2, 'admin da plataforma vê ambos';
  assert (select count(*) from dash_refresh) = 2, 'e os dois controles';
end $$;

-- 6) intervalo explícito reprocessa só aquele recorte
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000e01a');
  assert app.refresh_dash('00000000-0000-0000-0000-0000000000e1', current_date - 400, current_date - 390) = 0, 'recorte sem pedidos não gera linhas';
  assert (select sum(orders) from dash_daily) = 3, 'o resto fica intacto';
end $$;

rollback;
\echo 'dashboard.sql OK'
