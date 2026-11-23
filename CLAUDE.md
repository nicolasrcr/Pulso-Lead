# Pulso-Lead — instruções para o Claude Code

SaaS multi-tenant (organização/CNPJ → projeto/atividade) para operar pedidos pós-pagos com afiliados. Ponto de entrada: `docs/BLUEPRINT.md` (v1.3). Normativo: `.specify/memory/constitution.md` e `specs/001-plataforma-pos-pago/spec.md`.

## Regras
- Dinheiro sempre em centavos inteiros. Nunca float.
- Toda tabela de negócio tem `organization_id` e `project_id` (NOT NULL) e RLS; toda mudança de schema vem com teste em `db/tests` e passa em `pnpm lint:sql`.
- Comportamento por atividade vem de templates (dados versionados em `packages/templates`), nunca de `if` por tipo de atividade no código.
- A conexão da aplicação usa o papel `app_user` (sem BYPASSRLS) e define `app.user_id` e `app.project_id` por transação (`withTenant` em `apps/api/src/tenant.ts`).
- Máquinas de estado ficam em `packages/domain`, puras e testadas antes do código (RED → GREEN → refactor).
- Eventos externos: gravar cru (`webhook_events_raw`) e processar de forma idempotente `(project_id, provider, event_id)`.
- Transportadora: toda integração implementa `CarrierAdapter` e passa em `runCarrierContract`. J&T é a primeira; nunca vazar código nativo para o domínio.
- Código de Cloudflare Worker em arquivo `.js` (nunca `.mjs`).
- Mascarar CPF/telefone em UI, logs e contexto de IA. Revelar CPF grava `audit_log`.
- Paleta e fontes vêm de tokens (`packages/ui`, Coolors); nunca valores fixos nas telas.
- pt-BR e BRL. Replicar comportamento funcional da plataforma de referência, nunca código, textos, marca ou layout.

## Comandos
- `pnpm install` · `pnpm test` · `pnpm typecheck` · `pnpm lint:sql`
- Banco: `DATABASE_URL=... scripts/run-db-tests.sh` (aplica migrations, seed e `db/tests/*.sql`).

## Não cortar, mesmo com prazo apertado
Testes de isolamento entre projetos, idempotência de webhook, baixa de estoque única, comissão com estorno e homologação J&T.
