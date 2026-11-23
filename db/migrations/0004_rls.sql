-- RLS em todas as tabelas com project_id. Gerado a partir de 0003; o lint (scripts/check-migrations.js) garante cobertura.
alter table products enable row level security;
alter table products force row level security;
create policy products_tenant on products for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on products to app_user;
alter table product_plans enable row level security;
alter table product_plans force row level security;
create policy product_plans_tenant on product_plans for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on product_plans to app_user;
alter table external_product_links enable row level security;
alter table external_product_links force row level security;
create policy external_product_links_tenant on external_product_links for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on external_product_links to app_user;
alter table affiliates enable row level security;
alter table affiliates force row level security;
create policy affiliates_tenant on affiliates for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on affiliates to app_user;
alter table affiliate_email_links enable row level security;
alter table affiliate_email_links force row level security;
create policy affiliate_email_links_tenant on affiliate_email_links for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on affiliate_email_links to app_user;
alter table customers enable row level security;
alter table customers force row level security;
create policy customers_tenant on customers for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on customers to app_user;
alter table carrier_accounts enable row level security;
alter table carrier_accounts force row level security;
create policy carrier_accounts_tenant on carrier_accounts for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on carrier_accounts to app_user;
alter table import_batches enable row level security;
alter table import_batches force row level security;
create policy import_batches_tenant on import_batches for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on import_batches to app_user;
alter table orders enable row level security;
alter table orders force row level security;
create policy orders_tenant on orders for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on orders to app_user;
alter table order_status enable row level security;
alter table order_status force row level security;
create policy order_status_tenant on order_status for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on order_status to app_user;
alter table order_events enable row level security;
alter table order_events force row level security;
create policy order_events_tenant on order_events for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on order_events to app_user;
alter table webhook_events_raw enable row level security;
alter table webhook_events_raw force row level security;
create policy webhook_events_raw_tenant on webhook_events_raw for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on webhook_events_raw to app_user;
alter table outbound_webhooks enable row level security;
alter table outbound_webhooks force row level security;
create policy outbound_webhooks_tenant on outbound_webhooks for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on outbound_webhooks to app_user;
alter table webhook_deliveries enable row level security;
alter table webhook_deliveries force row level security;
create policy webhook_deliveries_tenant on webhook_deliveries for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on webhook_deliveries to app_user;
alter table stock_items enable row level security;
alter table stock_items force row level security;
create policy stock_items_tenant on stock_items for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on stock_items to app_user;
alter table stock_movements enable row level security;
alter table stock_movements force row level security;
create policy stock_movements_tenant on stock_movements for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on stock_movements to app_user;
alter table commission_ledger enable row level security;
alter table commission_ledger force row level security;
create policy commission_ledger_tenant on commission_ledger for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on commission_ledger to app_user;
alter table order_returns enable row level security;
alter table order_returns force row level security;
create policy order_returns_tenant on order_returns for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on order_returns to app_user;
alter table api_credentials enable row level security;
alter table api_credentials force row level security;
create policy api_credentials_tenant on api_credentials for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on api_credentials to app_user;
alter table dash_daily enable row level security;
alter table dash_daily force row level security;
create policy dash_daily_tenant on dash_daily for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on dash_daily to app_user;
alter table audit_log enable row level security;
alter table audit_log force row level security;
create policy audit_log_tenant on audit_log for all to app_user
  using (app.row_visible(project_id)) with check (app.row_visible(project_id));
grant select, insert, update, delete on audit_log to app_user;

-- Tabelas de tenancy
grant usage on schema app to app_user;
grant select on organizations, projects, plans, activity_templates to app_user;
alter table memberships enable row level security; alter table memberships force row level security;
create policy memberships_self on memberships for select to app_user using (user_id = app.current_user_id());
grant select on memberships to app_user;
alter table app_users enable row level security; alter table app_users force row level security;
create policy app_users_self on app_users for select to app_user using (id = app.current_user_id());
grant select on app_users to app_user;
alter table subscriptions enable row level security; alter table subscriptions force row level security;
create policy subscriptions_org on subscriptions for select to app_user
  using (exists (select 1 from memberships m where m.user_id = app.current_user_id() and m.organization_id = subscriptions.organization_id and m.project_id is null and m.approved_at is not null));
grant select on subscriptions to app_user;
alter table usage_counters enable row level security; alter table usage_counters force row level security;
create policy usage_org on usage_counters for select to app_user
  using (exists (select 1 from memberships m where m.user_id = app.current_user_id() and m.organization_id = usage_counters.organization_id and m.project_id is null and m.approved_at is not null));
grant select on usage_counters to app_user;

alter table projects enable row level security; alter table projects force row level security;
create policy projects_visible on projects for select to app_user using (app.can_access_project(id));
alter table organizations enable row level security; alter table organizations force row level security;
create policy organizations_visible on organizations for select to app_user
  using (exists (select 1 from projects p where p.organization_id = organizations.id and app.can_access_project(p.id)));

-- Histórico imutável: a aplicação só insere e lê.
revoke update, delete on order_events, audit_log, commission_ledger, stock_movements from app_user;
