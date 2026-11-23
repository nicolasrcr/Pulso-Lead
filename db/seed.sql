-- Seed mínimo de desenvolvimento. Template pós-pago v1 (conteúdo completo em packages/templates).
insert into activity_templates (key, version, definition)
values ('pos-pago', 1, '{"note":"definição completa vive em packages/templates/src/pos-pago.v1.json"}')
on conflict do nothing;
insert into plans (key, name, entitlements) values
  ('fundador', 'Plano único (cliente fundador)', '{"order_cap":1000,"included_hours":4,"modules":"all"}')
on conflict do nothing;
