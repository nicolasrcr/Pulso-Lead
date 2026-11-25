-- Teste de isolamento entre tenants/projetos. Roda com psql como dono; falha (exit != 0) se algo vazar.
\set ON_ERROR_STOP on
begin;

insert into activity_templates (key, version, definition) values ('pos-pago', 1, '{}') on conflict do nothing;
insert into organizations (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000a0','Org A','org-a'),
  ('00000000-0000-0000-0000-0000000000b0','Org B','org-b');
insert into projects (id, organization_id, name, template_key, template_version) values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a0','A1','pos-pago',1),
  ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a0','A2','pos-pago',1),
  ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b0','B1','pos-pago',1);
insert into app_users (id, email, name, platform_admin) values
  ('00000000-0000-0000-0000-0000000000f0','plat@x.test','Plataforma', true),
  ('00000000-0000-0000-0000-00000000000a','admin@a.test','Admin A', false),
  ('00000000-0000-0000-0000-00000000001a','op@a1.test','Operador A1', false),
  ('00000000-0000-0000-0000-00000000000b','user@b.test','User B', false),
  ('00000000-0000-0000-0000-00000000002a','pend@a.test','Pendente A1', false);
insert into memberships (user_id, organization_id, project_id, role, approved_at) values
  ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a0',null,'org_admin',now()),
  ('00000000-0000-0000-0000-00000000001a','00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a1','operator',now()),
  ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-0000000000b1','project_admin',now()),
  ('00000000-0000-0000-0000-00000000002a','00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a1','operator',null);
set local role app_user;
select set_config('app.user_id','00000000-0000-0000-0000-0000000000f0', true);
insert into orders (organization_id, project_id, total_cents) values
  ('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a1',1000),
  ('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a2',2000),
  ('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-0000000000b1',3000);
reset role;
set local role app_user;

create function pg_temp.visible_orders(u text, p text) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('app.user_id', u, true);
  perform set_config('app.project_id', p, true);
  select count(*) into n from orders;
  return n;
end $$;

do $$ begin
  -- operador do A1 vê só o A1
  assert pg_temp.visible_orders('00000000-0000-0000-0000-00000000001a','') = 1, 'operador A1 deve ver 1 pedido';
  -- operador do A1 tentando selecionar o A2: nada
  assert pg_temp.visible_orders('00000000-0000-0000-0000-00000000001a','00000000-0000-0000-0000-0000000000a2') = 0, 'operador A1 não pode ver A2';
  -- org_admin vê A1+A2 em "Todos os projetos", e só um ao selecionar
  assert pg_temp.visible_orders('00000000-0000-0000-0000-00000000000a','') = 2, 'org_admin vê 2 projetos';
  assert pg_temp.visible_orders('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a2') = 1, 'org_admin filtra A2';
  -- org_admin A nunca vê Org B
  assert pg_temp.visible_orders('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000b1') = 0, 'org A não vê B1';
  -- usuário B só vê B1
  assert pg_temp.visible_orders('00000000-0000-0000-0000-00000000000b','') = 1, 'user B vê 1';
  -- membro sem aprovação não vê nada
  assert pg_temp.visible_orders('00000000-0000-0000-0000-00000000002a','') = 0, 'cadastro não aprovado não vê nada';
  -- sem usuário definido: nada
  assert pg_temp.visible_orders('','') = 0, 'sem usuário não vê nada';
end $$;

-- Escrita cruzada é bloqueada pelo WITH CHECK
do $$ begin
  perform set_config('app.user_id','00000000-0000-0000-0000-00000000001a', true);
  perform set_config('app.project_id','', true);
  begin
    insert into orders (organization_id, project_id, total_cents)
    values ('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-0000000000b1', 1);
    raise exception 'inserção cruzada deveria falhar';
  exception when insufficient_privilege then null; -- RLS WITH CHECK
  end;
end $$;

-- Histórico imutável
do $$ begin
  begin
    update order_events set payload = '{}';
    raise exception 'update em order_events deveria ser negado';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
\echo 'isolation.sql OK'
