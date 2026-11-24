# Plano de implementação por fases

Origem: BLUEPRINT seção 12 e 3B.5. Cada tarefa segue TDD (teste falhando → código mínimo → refactor → commit).
**Go-live (8–12 semanas, solo):** Fases 0–7 com um único template (pós-pago), status de seed.
**Depois:** Fase 5b (2ª atividade), editor de templates na UI, API pública/MCP, IA.

## Fase 0 — Fundação [feito nesta branch]
- [x] Monorepo pnpm, TS estrito, CI (typecheck, testes, lint SQL, migrations + isolamento)
- [x] `packages/domain`: dinheiro, envio, comissão, inadimplência, volume, idempotência, contrato `CarrierAdapter`
- [x] `packages/templates`: pós-pago v1, validador, kanban derivado
- [x] `db/`: tenancy, negócio, RLS em todas as tabelas, teste de isolamento
- [x] `workers/webhook-ingest`: assinatura HMAC + encaminhamento cru
- [x] `apps/api`: `withTenant`, `/health`, `/v1/templates/:key`

## Fase 1 — Autenticação, organização e projetos [feito]
- [x] Cadastro, login (scrypt), sessão por token opaco (só o hash no banco), logout que revoga
- [x] `memberships` com solicitação e aprovação de cadastro; anti-escalada (papel e capabilities)
- [x] Organização (admin da plataforma) e projeto (org_admin) por funções `security definer` com checagem explícita
- [x] Seletor de projeto e "Todos os projetos" (`x-project-id` validado: inacessível = 403)
- [x] RBAC: 15 capabilities, 9 presets, **checagem no servidor**; a UI só esconde
- [x] Testes: isolamento por RLS (SQL), 10 testes de integração da API contra Postgres real como `app_user`
- Limitação conhecida: gestão de equipe é **por papel** (org_admin/project_admin). Delegar `users.manage` a um operador ainda não dá poder no banco; entra quando houver necessidade.
- Pendente de operação: limitar tentativas de login (rate limit) e recuperação de senha; entram com o e-mail transacional.

## Fase 2 — Catálogo, estoque e pedidos
- [x] Produto, planos (preço, BOM) e estoque por SKU com movimentos (`/v1/products`, `/v1/stock-items`). _Pendente:_ regra de comissão por plano na API (campo existe no banco; entra com o ledger) e tela de extrato
- [x] Pedido manual (After Pay, agendamento), `order_status` em três eixos, `order_events`; CPF cifrado (AES-256-GCM, chave `CPF_KEY` fora do banco) e mascarado, `reveal-cpf` com `audit_log`. _Pendente:_ upload de comprovante ≤ 5 MB (precisa de storage)
- [x] Liberação com baixa de estoque atômica e única (`app.release_order`; testada com 6 chamadas concorrentes)
- [x] Contador de volume mensal (criados + importados) e alertas 80/100% que nunca bloqueiam (`app.volume_status`, banner na web)
- [x] Transição por compare-and-swap (`app.transition_order`), validada pelo template; o eixo de envio fica para os eventos da transportadora (Fase 3)
- Operação: a API exige `CPF_KEY` (`openssl rand -hex 32`) quando há banco; sem ela não sobe.

## Fase 3 — J&T, rastreio e entrada de vendas
- [ ] `JtAdapter` (cotação, etiqueta, cancelamento, rastreio) passando em `runCarrierContract`; credenciais por organização no cofre
- [ ] **Homologação J&T** com etiqueta e rastreio reais (começar cedo: depende de terceiros)
- [ ] Jobs BullMQ: rastreio com retry; `tracking_synced` + reenvio manual
- [ ] Conectores de venda (PayT, Braip, B4You, Get Envios) com `external_product_links` e `affiliate_email_links`
- [ ] `apps/tracking`: página pública white-label, selo "Enviado via J&T Express"

## Fase 4 — Cobrança, comissão e devoluções
- [ ] Cobrança Pix/boleto/cartão via `PaymentProvider`
- [ ] Ledger de comissão (accrual no pagamento; reversal na devolução)
- [ ] Devoluções: devolvida × descartada; estoque
- [ ] Job de inadimplência (prazo do projeto, padrão 15 dias) e fluxo Frustrado
- **Marco 2 (pagamento):** pedidos + J&T + cobrança em staging

## Fase 5 — Dashboard confiável
- [ ] Agregados `dash_daily` por gatilho/cron, `refreshed_at`, alerta de atraso
- [ ] Seletor de projeto, "Todos os projetos", ranking por projeto
- [ ] Teste de carga e CSV

## Fase 6 — Webhooks de saída, afiliados e migração
- [ ] `ORDER_CREATE`, `CHARGE_UPDATED`, `SHIPPING_REGISTER`, `SHIPPING_UPDATE` com HMAC, retry e reenvio manual
- [ ] Link de afiliado assinado; importação CSV (`import_batches`) idempotente

## Fase 7 — Backoffice, billing, LGPD e go-live
- [ ] Back-office do fornecedor: assinaturas, estados, uso; suspensão = somente leitura + exportação
- [ ] Exportação CSV self-service; descarte seguro; `audit_log`
- [ ] Observabilidade (Sentry), runbook, **aceite e go-live (Marco 3)**

## Depois do go-live
Fase 5b (segunda atividade), editor de templates na UI, API pública e MCP, checkout próprio, fiscal, notificações, IA nas bordas.
