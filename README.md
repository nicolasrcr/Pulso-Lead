# Pulso-Lead

Plataforma multi-tenant para operar pedidos pós-pagos (pagamento na entrega) com afiliados, transportadora J&T e dashboard confiável.
Multi-atividade por templates versionados; white-label por organização e projeto.

- Blueprint: [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md)
- Constituição: [`.specify/memory/constitution.md`](.specify/memory/constitution.md)
- Especificação: [`specs/001-plataforma-pos-pago/spec.md`](specs/001-plataforma-pos-pago/spec.md)
- Plano por fases e tarefas: [`docs/plans/`](docs/plans/)

## Estrutura
```
apps/api            API Node/TS (Fastify): tenancy, templates, domínio
apps/web            Vite + React (casca inicial)
apps/tracking       Worker público de rastreio (Fase 3)
workers/webhook-ingest   Worker .js: valida assinatura e encaminha evento cru
workers/jobs        Workers BullMQ (Fase 3+)
packages/domain     Máquinas de estado, comissão, volume, idempotência, contrato CarrierAdapter (puros, TDD)
packages/templates  Templates de atividade (pós-pago v1) + validador + kanban derivado
packages/ui         Design tokens (tema claro, índigo; Coolors)
db/                 Migrations, seed e testes de isolamento (RLS)
```

## Desenvolvimento
Node 22 e pnpm 10. `pnpm install && pnpm test && pnpm typecheck && pnpm lint:sql`.
Banco: Postgres 16; `DATABASE_URL=postgres://... scripts/run-db-tests.sh`.

Segredos nunca entram no Git (`.env.example` lista as variáveis). Mudanças de banco só por migrations versionadas.
