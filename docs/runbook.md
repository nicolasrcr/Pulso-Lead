# Runbook de operação — Pulso-Lead

## Variáveis de ambiente (API)
| Variável | Obrigatória | Uso |
|---|---|---|
| `DATABASE_URL` | sim | Postgres, **papel `app_user`** (sem BYPASSRLS). Nunca o dono do schema |
| `CPF_KEY` | sim | 64 hex (`openssl rand -hex 32`). Deriva as chaves de CPF, segredos de webhook e credenciais de transportadora/conectores. **Perdê-la torna esses dados ilegíveis**; guarde em cofre e faça backup separado |
| `SYSTEM_USER_ID` | para jobs | id de um usuário `platform_admin` dedicado (sem login humano). Sem ele: webhooks de saída, dashboards, inadimplência, rastreio e recebimento de vendas externas ficam desligados |
| `LABEL_BASE_URL` | recomendada | base usada para montar `labelUrl` (o endpoint de PDF ainda não existe; ver `docs/go-live.md`) |
| `CORS_ORIGINS` | se o front estiver em outra origem | lista separada por vírgula (`https://app.exemplo.com.br`). Vazio = só mesma origem (proxy do front); nenhuma origem é liberada por padrão |
| `PG_POOL_MAX` · `PG_IDLE_TIMEOUT_MS` · `PG_CONNECT_TIMEOUT_MS` · `PG_STATEMENT_TIMEOUT_MS` · `PG_IDLE_TX_TIMEOUT_MS` | não | limites do pool (padrão 10 · 30 s · 5 s · 30 s · 60 s). Valores inválidos voltam ao padrão |
| `PORT` | não | padrão 3000 |

Gerar o usuário de sistema: registrar via `POST /v1/auth/register` com senha longa aleatória e marcar `update app_users set platform_admin = true where id = '…'`.

## Deploy
1. `scripts/run-db-tests.sh` num banco descartável (as migrations e testes SQL precisam passar como não-superusuário).
2. Aplicar `db/migrations/*.sql` em ordem no banco real com o papel dono. Conceder `app_user` à aplicação.
3. Subir a API (`node --experimental-strip-types apps/api/src/server.ts` ou build do seu orquestrador). Probes: `GET /health` (vivo), `GET /ready` (banco responde).
4. Workers `.js`: `apps/tracking` (rastreio público) e `workers/webhook-ingest` — segredos como Worker secrets, nunca em `wrangler.toml`.

## Jobs (a cada processo da API com `SYSTEM_USER_ID`)
webhooks de saída 10 s · rastreio 5 min · dashboards 1 h · inadimplência 6 h. Cada job tem trava de instância (`pg_try_advisory_xact_lock`): com várias réplicas só uma executa o ciclo e as demais o pulam; a trava some no commit/rollback ou se o processo cair. Os jobs continuam idempotentes (entregas usam `skip locked`).

## Incidentes comuns
- **Webhook de saída falhando:** `GET /v1/webhooks/deliveries?status=failed`; corrigir a URL do cliente e `POST /v1/webhooks/deliveries/:id/resend`.
- **Venda externa não virou pedido:** `GET /v1/sales-events?status=unlinked` → criar `POST /v1/product-links` → `POST /v1/sales-events/reprocess`. `failed` = payload fora do formato esperado (ajustar `sales/mappers.ts`).
- **Rastreio parado:** conferir `orders.tracking_sync_error`; erro de credencial → recriar a conta em `POST /v1/carriers`. Reenvio ao ERP: `POST /v1/orders/:id/tracking/resend`.
- **Dashboard desatualizado (> 60 min):** `POST /v1/dashboard/refresh`; verificar se o job está rodando.
- **Cliente reclama de 423:** a organização está suspensa/encerrada → `GET /v1/backoffice/overview`; reativar com `POST /v1/backoffice/organizations/:id/status {"to":"ativo","reason":"…"}`.
- **5xx:** o corpo traz `requestId`; procure essa id nos logs JSON.

## Suspensão e LGPD
- Suspender: `status {"to":"suspenso","reason":"…"}` → organização só lê e exporta (`/v1/export/*`).
- Encerrar → aguardar **30 dias** → `discard-pii {"confirm":"<id da organização>"}` (irreversível; pedidos e ledger permanecem sem PII). Tudo fica em `platform_audit_log`.

## Backup/restore
`pg_dump` diário + teste de restauração mensal. Restaurar exige a mesma `CPF_KEY`.

## Entrega de webhooks e SSRF
Além de exigir https e recusar IP interno literal, a entrega resolve o DNS e recusa o envio se **qualquer** endereço for interno (a entrega fica `retried` com erro `destino interno`). Limite conhecido: entre a checagem e a conexão o DNS pode mudar (rebinding); fechar isso exige fixar o IP na conexão.
