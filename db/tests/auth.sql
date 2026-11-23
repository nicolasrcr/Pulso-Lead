-- Auth, sessões e funções administrativas (security definer). Falha (exit != 0) se algo vazar ou escalar.
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
insert into app_users (id, email, name, platform_admin, password_hash) values
  ('00000000-0000-0000-0000-0000000000f0','plat@x.test','Plataforma', true, 'h'),
  ('00000000-0000-0000-0000-00000000000a','orgadmin@a.test','Admin Org A', false, 'h'),
  ('00000000-0000-0000-0000-00000000001a','projadmin@a1.test','Admin A1', false, 'h'),
  ('00000000-0000-0000-0000-00000000002a','op@a1.test','Operador A1', false, 'h'),
  ('00000000-0000-0000-0000-00000000000b','orgadmin@b.test','Admin Org B', false, 'h');
insert into memberships (user_id, organization_id, project_id, role, approved_at) values
  ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a0',null,'org_admin',now()),
  ('00000000-0000-0000-0000-00000000001a','00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a1','project_admin',now()),
  ('00000000-0000-0000-0000-00000000002a','00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a1','operator',now()),
  ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000b0',null,'org_admin',now());
-- fixture: pedidos entram pelo papel da aplicação, com contexto de admin da plataforma (dono não-superusuário obedece FORCE RLS)
set local role app_user;
select set_config('app.user_id','00000000-0000-0000-0000-0000000000f0', true);
insert into orders (organization_id, project_id, total_cents) values
  ('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a1',1000);
reset role;
set local role app_user;

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('app.user_id', u, true), set_config('app.project_id', '', true)
$$;
-- retorna o sqlstate do erro (ou 'ok')
create function pg_temp.try(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate; end $$;

-- 1) registro e login
do $$ declare id1 uuid; begin
  id1 := app.register_user('Novo@Teste.com', 'Novo', 'scrypt$hash');
  assert id1 is not null, 'register_user devolve id';
  assert pg_temp.try($q$ select app.register_user('novo@teste.com','Dup','h') $q$) = '23505', 'e-mail duplicado (case-insensitive) falha';
  assert (select count(*) from app.auth_lookup('novo@teste.com')) = 1, 'auth_lookup acha o usuário';
  assert (select password_hash from app.auth_lookup('NOVO@teste.com')) = 'scrypt$hash', 'devolve o hash para a API conferir';
  assert (select count(*) from app.auth_lookup('naoexiste@x.test')) = 0, 'usuário inexistente não acha';
end $$;

-- 2) sessões: só o hash do token; expira; revoga
do $$ begin
  perform app.session_create('00000000-0000-0000-0000-00000000002a', 'tokhash1', interval '1 hour');
  assert app.session_user('tokhash1') = '00000000-0000-0000-0000-00000000002a', 'sessão válida resolve o usuário';
  assert app.session_user('outro') is null, 'token desconhecido não resolve';
  perform app.session_revoke('tokhash1');
  assert app.session_user('tokhash1') is null, 'sessão revogada não resolve';
  perform app.session_create('00000000-0000-0000-0000-00000000002a', 'tokhash2', interval '-1 minute');
  assert app.session_user('tokhash2') is null, 'sessão expirada não resolve';
  assert pg_temp.try('select * from sessions') = '42501', 'app_user não lê a tabela de sessões direto';
end $$;

-- 3) criar organização: só admin da plataforma
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
  assert pg_temp.try($q$ select app.create_organization('Org C','11222333000181','org-c', null) $q$) = '42501', 'org_admin não cria organização';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f0');
  assert pg_temp.try($q$ select app.create_organization('Org C','11222333000181','org-c', '00000000-0000-0000-0000-00000000000b') $q$) = 'ok', 'admin da plataforma cria';
  assert exists (select 1 from memberships where role='org_admin' and user_id = '00000000-0000-0000-0000-00000000000b' and organization_id = (select id from organizations where slug='org-c')), 'cria o org_admin inicial';
end $$;

-- 4) criar projeto: org_admin da própria organização
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
  assert pg_temp.try($q$ select app.create_project('00000000-0000-0000-0000-0000000000a0','Novo A','pos-pago',1) $q$) = 'ok', 'org_admin cria projeto na própria org';
  assert pg_temp.try($q$ select app.create_project('00000000-0000-0000-0000-0000000000b0','Invasor','pos-pago',1) $q$) = '42501', 'org_admin não cria projeto em outra org';
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000001a');
  assert pg_temp.try($q$ select app.create_project('00000000-0000-0000-0000-0000000000a0','X','pos-pago',1) $q$) = '42501', 'project_admin não cria projeto';
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000002a');
  assert pg_temp.try($q$ select app.create_project('00000000-0000-0000-0000-0000000000a0','Y','pos-pago',1) $q$) = '42501', 'operador não cria projeto';
end $$;

-- 5) solicitação e aprovação de cadastro
do $$ declare nu uuid; req uuid; req2 uuid; begin
  nu := app.register_user('afiliado@x.test','Afiliado','h');
  perform pg_temp.as_user(nu::text);
  assert pg_temp.try($q$ select app.request_membership('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a1','org_admin') $q$) <> 'ok', 'não se pode pedir papel de org_admin';
  assert pg_temp.try($q$ select app.request_membership('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000b1','affiliate') $q$) <> 'ok', 'projeto de outra organização é recusado';
  req := app.request_membership('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a1','affiliate');
  assert (select count(*) from orders) = 0, 'cadastro não aprovado não vê pedidos';
  assert pg_temp.try(format($q$ select app.approve_membership(%L, '{}') $q$, req)) = '42501', 'o próprio solicitante não se aprova';

  perform pg_temp.as_user('00000000-0000-0000-0000-00000000002a');
  assert pg_temp.try(format($q$ select app.approve_membership(%L, '{}') $q$, req)) = '42501', 'operador não aprova';

  perform pg_temp.as_user('00000000-0000-0000-0000-00000000001a');
  assert pg_temp.try(format($q$ select app.approve_membership(%L, '{"orders.create"}') $q$, req)) = 'ok', 'project_admin do projeto aprova';
  assert (select approved_at is not null from memberships where id = req), 'aprovado grava approved_at';

  -- project_admin não aprova em outro projeto
  perform pg_temp.as_user(nu::text);
  req2 := app.request_membership('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a2','operator');
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000001a');
  assert pg_temp.try(format($q$ select app.approve_membership(%L, '{}') $q$, req2)) = '42501', 'project_admin do A1 não aprova no A2';
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
  assert pg_temp.try(format($q$ select app.approve_membership(%L, '{}') $q$, req2)) = 'ok', 'org_admin aprova em qualquer projeto da org';

  -- capability desconhecida é barrada
  perform pg_temp.as_user(nu::text);
  assert pg_temp.try($q$ select app.request_membership('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a1','operator') $q$) <> 'ok', 'membership duplicada é recusada';
end $$;

-- 6) visibilidade de membros: admin vê a equipe; operador vê só a si
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
  assert (select count(*) from memberships where organization_id = '00000000-0000-0000-0000-0000000000a0') >= 4, 'org_admin lista todos os membros da org';
  assert (select count(*) from memberships where organization_id = '00000000-0000-0000-0000-0000000000b0') = 0, 'org_admin A não vê membros da org B';
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000002a');
  assert (select count(*) from memberships) = 1, 'operador vê só a própria membership';
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000001a');
  assert (select count(*) from memberships where project_id = '00000000-0000-0000-0000-0000000000a1') >= 2, 'project_admin lista a equipe do próprio projeto';
  assert (select count(*) from memberships where project_id = '00000000-0000-0000-0000-0000000000a2') = 0, 'project_admin não vê equipe de outro projeto';
end $$;

rollback;
\echo 'auth.sql OK'
