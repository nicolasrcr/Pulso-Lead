-- Fase 9: índices para listagem paginada e filtros operacionais. Sem mudança de regra de negócio.
-- Listagem de pedidos por projeto em ordem de criação (cursor created_at, id).
create index if not exists orders_project_created_idx on orders (project_id, created_at desc, id desc);
-- Visão "só os meus pedidos" (sem orders.read_all).
create index if not exists orders_creator_created_idx on orders (project_id, created_by, created_at desc, id desc);
-- Filtros por pagamento (inadimplência, cobrança).
create index if not exists order_status_payment_idx on order_status (project_id, payment_status);
-- Extrato de estoque por item, do mais novo ao mais antigo.
create index if not exists stock_movements_item_idx on stock_movements (stock_item_id, id desc);
-- Saldo por afiliado.
create index if not exists commission_ledger_affiliate_idx on commission_ledger (affiliate_id, created_at);
