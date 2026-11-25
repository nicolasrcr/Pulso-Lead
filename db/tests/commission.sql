-- Ledger de comissão (accrual no pagamento, estorno na devolução), devoluções e inadimplência.
\set ON_ERROR_STOP on
begin;

insert into activity_templates (key, version, definition) values ('pos-pago', 1, '{}') on conflict do nothing;
insert into organizations (id, name, slug) values ('00000000-0000-0000-0000-0000000000d0','Org D','org-d-c');
insert into projects (id, organization_id, name, template_key, template_version, settings) values
  ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d0','D1','pos-pago',1,'{"overdue_grace_days": 10}'),
  ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000d0','D2','pos-pago',1,'{"overdue_grace_days": 10}');
insert into app_users (id, email, name, platform_admin) values
  ('00000000-0000-0000-0000-0000000000f1','plat@c.test','Plataforma', true),
  ('00000000-0000-0000-0000-00000000d01a','op@d1.c.test','Operador D1', false),
  ('00000000-0000-0000-0000-00000000d02a','op@d2.c.test','Operador D2', false);
insert into memberships (user_id, organization_id, project_id, role, approved_at) values
  ('00000000-0000-0000-0000-00000000d01a','00000000-0000-0000-0000-0000000000d0','00000000-0000-0000-0000-0000000000d1','operator',now()),
  ('00000000-0000-0000-0000-00000000d02a','00000000-0000-0000-0000-0000000000d0','00000000-0000-0000-0000-0000000000d2','operator',now());

set local role app_user;
select set_config('app.user_id','00000000-0000-0000-0000-0000000000f1', true);
insert into stock_items (id, organization_id, project_id, sku, name, quantity) values
  ('00000000-0000-0000-0000-0000000d05a1','00000000-0000-0000-0000-0000000000d0','00000000-0000-0000-0000-0000000000d1','CX','Caixa', 10);
insert into products (id, organization_id, project_id, name) values
  ('00000000-0000-0000-0000-0000000d06a1','00000000-0000-0000-0000-0000000000d0','00000000-0000-0000-0000-0000000000d1','Produto');
insert into product_plans (id, organization_id, project_id, product_id, name, price_cents, commission_rule, bom) values
  ('00000000-0000-0000-0000-0000000d07a1','00000000-0000-0000-0000-0000000000d0','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000d06a1','Pct', 19900,
   '{"type":"percent","bps":1000}', '[{"stockItemId":"00000000-0000-0000-0000-0000000d05a1","qty":2}]'),
  ('00000000-0000-0000-0000-0000000d07a2','00000000-0000-0000-0000-0000000000d0','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000d06a1','Fixo', 5000,
   '{"type":"fixed","cents":1234}', '[]');
insert into affiliates (id, organization_id, project_id, name) values
  ('00000000-0000-0000-0000-0000000d0aa1','00000000-0000-0000-0000-0000000000d0','00000000-0000-0000-0000-0000000000d1','Afiliada 1');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('app.user_id', u, true), set_config('app.project_id', '', true)
$$;
create function pg_temp.try(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.mk(plan text, total int, ext text, aff text default '00000000-0000-0000-0000-0000000d0aa1') returns uuid language plpgsql as $$
begin return (app.create_order('00000000-0000-0000-0000-0000000000d1', plan::uuid, aff::uuid, '{"name":"C"}', null, total, true, null, ext, 'created', null)->>'id')::uuid; end $$;
create function pg_temp.pay(o uuid) returns void language plpgsql as $$
begin
  perform app.transition_order(o,'payment','sem_status','pendente',now(),null);
  perform app.transition_order(o,'payment','pendente','pago',now(),null);
end $$;

-- 1) accrual percentual no pagamento (10% de 19900 = 1990), uma única vez
do $$ declare o uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000d01a');
  o := pg_temp.mk('00000000-0000-0000-0000-0000000d07a1', 19900, 'c1');
  assert (select count(*) from commission_ledger where order_id = o) = 0, 'sem accrual antes de pagar';
  perform app.transition_order(o,'payment','sem_status','pendente',now(),null);
  assert (select count(*) from commission_ledger where order_id = o) = 0, 'pendente não credita';
  perform app.transition_order(o,'payment','pendente','pago',now(),null);
  assert (select amount_cents from commission_ledger where order_id = o and kind='accrual') = 1990, 'percentual em centavos';
  assert app.accrue_commission(o) is null, 'segundo accrual é no-op';
  assert (select count(*) from commission_ledger where order_id = o) = 1, 'um único accrual';
end $$;

-- 2) arredondamento meio-para-cima e regra fixa
do $$ declare o uuid; o2 uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000d01a');
  o := pg_temp.mk('00000000-0000-0000-0000-0000000d07a1', 105, 'c2'); perform pg_temp.pay(o);   -- 10,5 -> 11
  assert (select amount_cents from commission_ledger where order_id = o) = 11, 'meio para cima';
  o2 := pg_temp.mk('00000000-0000-0000-0000-0000000d07a2', 5000, 'c3'); perform pg_temp.pay(o2);
  assert (select amount_cents from commission_ledger where order_id = o2) = 1234, 'fixo';
end $$;

-- 3) sem afiliado: sem comissão
do $$ declare o uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000d01a');
  o := (app.create_order('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000d07a1', null, '{"name":"S"}', null, 19900, true, null, 'c4','created', null)->>'id')::uuid;
  perform pg_temp.pay(o);
  assert (select count(*) from commission_ledger where order_id = o) = 0, 'sem afiliado, sem comissão';
end $$;

-- 4) o ledger é imutável para a aplicação
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000d01a');
  assert pg_temp.try($q$ update commission_ledger set amount_cents = 1 $q$) = '42501', 'sem UPDATE no ledger';
  assert pg_temp.try($q$ delete from commission_ledger $q$) = '42501', 'sem DELETE no ledger';
  assert pg_temp.try($q$ delete from order_events $q$) = '42501', 'order_events também é imutável';
end $$;

-- 5) devolução "devolvida": repõe estoque (se liberado), estorna comissão e conclui a devolução
do $$ declare o uuid; r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000d01a');
  o := pg_temp.mk('00000000-0000-0000-0000-0000000d07a1', 19900, 'c5');
  perform app.release_order(o);
  assert (select quantity from stock_items where sku='CX') = 8, 'baixou 2';
  perform app.transition_order(o,'platform','criado','cobrado',now(),null);
  perform pg_temp.pay(o);
  r := app.register_return(o, 'returned', 'cliente desistiu');
  assert (r->>'ok')::boolean, 'devolução registrada';
  assert (select quantity from stock_items where sku='CX') = 10, 'repôs o estoque';
  assert (select platform_status from order_status where order_id = o) = 'devolucao_concluida', 'plataforma concluída';
  assert (select amount_cents from commission_ledger where order_id = o and kind='reversal') = -1990, 'estorno espelha o accrual';
  assert (select qty_returned||'/'||qty_discarded from order_returns where order_id = o) = '1/0', 'devolvida';
  assert pg_temp.try(format($q$ select app.register_return(%L,'returned','x') $q$, o)) = '55000', 'segunda devolução é recusada';
  assert (select count(*) from commission_ledger where order_id = o) = 2, 'accrual + reversal, uma vez cada';
  assert (select quantity from stock_items where sku='CX') = 10, 'estoque não repõe duas vezes';
end $$;

-- 6) devolução "descartada": não repõe estoque, mas estorna
do $$ declare o uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000d01a');
  o := pg_temp.mk('00000000-0000-0000-0000-0000000d07a1', 19900, 'c6');
  perform app.release_order(o);
  perform app.transition_order(o,'platform','criado','cobrado',now(),null);
  perform pg_temp.pay(o);
  perform app.register_return(o, 'discarded', 'avariado');
  assert (select quantity from stock_items where sku='CX') = 8, 'descartada não volta ao estoque';
  assert (select qty_returned||'/'||qty_discarded from order_returns where order_id = o) = '0/1', 'descartada';
  assert (select count(*) from commission_ledger where order_id = o and kind='reversal') = 1, 'estornou';
end $$;

-- 7) devolução exige estado compatível e respeita o isolamento
do $$ declare o uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000d01a');
  o := pg_temp.mk('00000000-0000-0000-0000-0000000d07a2', 5000, 'c7');
  assert pg_temp.try(format($q$ select app.register_return(%L,'returned','x') $q$, o)) = '55000', 'pedido apenas criado não admite devolução';
  assert pg_temp.try(format($q$ select app.register_return(%L,'bogus','x') $q$, o)) = '22023', 'disposição inválida';
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000d02a');
  assert pg_temp.try(format($q$ select app.register_return(%L,'returned','x') $q$, o)) = '02000', 'outro projeto não enxerga o pedido';
end $$;

-- 8) inadimplência: dias completos APÓS a entrega > prazo do projeto (10)
do $$ declare o_late uuid; o_edge uuid; o_paid uuid; o_undel uuid; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000d01a');
  o_late := pg_temp.mk('00000000-0000-0000-0000-0000000d07a2', 5000, 'od1');
  o_edge := pg_temp.mk('00000000-0000-0000-0000-0000000d07a2', 5000, 'od2');
  o_paid := pg_temp.mk('00000000-0000-0000-0000-0000000d07a2', 5000, 'od3');
  o_undel := pg_temp.mk('00000000-0000-0000-0000-0000000d07a2', 5000, 'od4');
  perform app.transition_order(o,'platform','criado','cobrado',now(),null) from (values (o_late),(o_edge),(o_paid),(o_undel)) v(o);
  perform app.transition_order(o_late,'shipping','sem_status','entregue','2026-11-01T12:00:00Z',null);   -- 23 dias antes de 24/11
  perform app.transition_order(o_edge,'shipping','sem_status','entregue','2026-11-14T12:00:00Z',null);   -- exatamente 10 dias: ainda não
  perform app.transition_order(o_paid,'shipping','sem_status','entregue','2026-11-01T12:00:00Z',null);
  perform pg_temp.pay(o_paid);
  n := app.mark_overdue('00000000-0000-0000-0000-0000000000d1', '2026-11-24T12:00:00Z');
  assert n = 1, 'só um vira inadimplente, veio ' || n;
  assert (select platform_status from order_status where order_id = o_late) = 'inadimplente', 'atrasado';
  assert (select platform_status from order_status where order_id = o_edge) = 'cobrado', 'no limite não é inadimplente';
  assert (select platform_status from order_status where order_id = o_paid) = 'cobrado', 'pago não é inadimplente';
  assert (select platform_status from order_status where order_id = o_undel) = 'cobrado', 'não entregue não é inadimplente';
  assert app.mark_overdue('00000000-0000-0000-0000-0000000000d1', '2026-11-24T12:00:00Z') = 0, 'reexecução é idempotente';
  assert (select count(*) from order_events where order_id = o_late and axis='platform' and to_value='inadimplente') = 1, 'um evento';
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000d02a');
  assert pg_temp.try($q$ select app.mark_overdue('00000000-0000-0000-0000-0000000000d1') $q$) = '42501', 'sem acesso ao projeto';
end $$;

-- 9) afiliado de outro projeto não pode ser vinculado (FK ignora RLS; a função valida)
insert into affiliates (id, organization_id, project_id, name) values
  ('00000000-0000-0000-0000-0000000d0aa2','00000000-0000-0000-0000-0000000000d0','00000000-0000-0000-0000-0000000000d2','Afiliado do D2');
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000d01a');
  assert pg_temp.try($q$ select pg_temp.mk('00000000-0000-0000-0000-0000000d07a2', 5000, 'cx1', '00000000-0000-0000-0000-0000000d0aa2') $q$) = '23503', 'afiliado de outro projeto é recusado';
  assert pg_temp.try($q$ select pg_temp.mk('00000000-0000-0000-0000-0000000d07a2', 5000, 'cx2', gen_random_uuid()::text) $q$) = '23503', 'afiliado inexistente é recusado';
end $$;

rollback;
\echo 'commission.sql OK'
