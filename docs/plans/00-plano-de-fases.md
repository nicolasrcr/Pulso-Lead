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
- [x] `JtAdapter` (cotação, etiqueta, cancelamento, rastreio) passando em `runCarrierContract` com transporte mockado: Double Digest, `PP_PM`, `translate` = remetente, valores inteiros em string, CEP de 8 dígitos, `cancelOrder` com `reason` + `orderType '2'`. Credenciais por projeto **seladas** (AES-GCM, subchave `integration:secret`), nunca devolvidas pela API
- [ ] **Homologação J&T** com etiqueta e rastreio reais — _bloqueada: faltam credenciais._ Só `addOrder` está confirmado em homologação; os paths de `cancelOrder`, `checkFreight` e `trackingQuery` e o mapa de códigos de scan (`events.ts`) são **provisórios** e precisam ser conferidos com a conta real
- [x] Rastreio: job a cada 5 min (`syncTrackingAll`), mais antigo primeiro, aplica eventos em ordem, nunca regride, pula scans intermediários (`pathTo`), falha de um pedido não derruba o lote; `tracking_synced` marcado pelo dispatcher ao entregar `SHIPPING_REGISTER`; reenvio manual `POST /v1/orders/:id/tracking/resend`. _Sem BullMQ_: fila no Postgres + `setInterval` (suficiente para o volume do MVP)
- [x] Conectores de venda (PayT, Braip, B4You, Get Envios): URL + segredo por conector, ingestão idempotente `(projeto, provider, event_id)`, `unlinked` até existir vínculo, reprocessamento. _Mapeadores de campo provisórios_ (`sales/mappers.ts`): ajustar com payload real
- [x] `apps/tracking`: Worker `.js` white-label (marca/cor por variável), selo "Enviado via J&T Express", sem PII, HTML escapado

## Fase 4 — Cobrança, comissão e devoluções
- [ ] Cobrança Pix/boleto/cartão via `PaymentProvider`
- [x] Ledger de comissão: accrual automático quando o pagamento vira `pago` (percentual em bps ou fixo, centavos inteiros), reversal espelhado na devolução, uma vez cada; ledger e `order_events` só aceitam INSERT (sem UPDATE/DELETE para a aplicação)
- [x] Devoluções: `returned` repõe a BOM no estoque (se liberado) e `discarded` não; ambas estornam a comissão e levam a plataforma a `devolucao_concluida`
- [x] Inadimplência: `app.mark_overdue` (dias completos após a entrega > `settings.overdue_grace_days`), idempotente; gatilho manual `POST /v1/overdue/run`. _Pendente:_ agendamento por cron (junto dos jobs da Fase 3). Frustrado segue pela transição manual `inadimplente → frustrado`
- [x] Correção: `create_order` valida que o afiliado pertence ao projeto (FK ignora RLS)
- **Marco 2 (pagamento):** pedidos + J&T + cobrança em staging

## Fase 5 — Dashboard confiável
- [x] Agregados `dash_daily` (`app.refresh_dash`, idempotente, lock por projeto) com `dash_refresh.refreshed_at` e alerta de atraso (> 60 min). Gatilho: `POST /v1/dashboard/refresh`; o cron chama a mesma função (jobs)
- [x] Seletor de projeto, "Todos os projetos" (só projetos onde o usuário tem `dashboard.full`), ranking por projeto, por afiliado, por UF e por dia; cards na web
- [x] CSV (`/v1/dashboard/export.csv`, com proteção contra CSV injection). Carga: 50 mil pedidos, refresh em ~75 ms e leitura em < 1 ms
- Premissa adotada (decisão em aberto): projeto = operação separada; o consolidado soma os projetos visíveis

## Fase 6 — Webhooks de saída, afiliados e migração
- [x] `ORDER_CREATE`, `CHARGE_UPDATED`, `SHIPPING_REGISTER`, `SHIPPING_UPDATE`: fila no banco (payload sem PII), assinatura `t=…,v1=HMAC-SHA256`, retry com backoff (30 s … 6 h, 8 tentativas), reenvio manual, segredo cifrado em repouso e mostrado uma vez, rotação, URL só https e sem destino interno (SSRF), sem seguir redirects
- [x] Link de afiliado assinado (`/v1/links/:token`, público, HMAC com segredo que não sai do banco); rastreio (`POST /v1/orders/:id/tracking`)
- [x] Importação CSV idempotente por `id_externo`, erros por linha, linhas "pagas" exigem `orders.status.all`/`billing.status`
- [x] Jobs (`apps/api/src/jobs.ts`): webhooks a cada 10 s, dashboards a cada hora, inadimplência a cada 6 h; precisam de `SYSTEM_USER_ID` (usuário admin da plataforma)
- [x] Limite de taxa por IP em login/cadastro e links públicos (fecha pendência da Fase 1)
- Limite conhecido: DNS que resolve para IP interno só é barrado pela checagem de hostname/IP literal; resolver e validar o IP no envio fica como endurecimento

## Fase 7 — Backoffice, billing, LGPD e go-live
- [x] Back-office do fornecedor (`/v1/backoffice/*`, só `platform_admin`): assinatura (plano, mensalidade, cap), máquina de estados (`implantacao → garantia/ativo ⇄ em_atraso → suspenso → encerrado`, motivo obrigatório), visão geral com uso do mês vs. cap, trilha `platform_audit_log` imutável
- [x] Suspensão/encerramento = **somente leitura**: trigger `app.block_if_suspended` em todas as tabelas de negócio (423 `organization_suspended`); vendas externas, jobs de rastreio e inadimplência pulam a organização; o admin da plataforma ainda reativa/descarta
- [x] Exportação self-service: `/v1/export/orders.csv` (`orders.read_all`) e `/v1/export/ledger.csv` (`reports.read`); sem CPF, telefone mascarado, proteção contra fórmula; funciona suspensa; auditada
- [x] Descarte seguro (`discard_org_pii`): só organização `encerrada` há ≥ 30 dias + confirmação com o id; anonimiza clientes e payloads crus; preserva pedidos/ledger; idempotente; auditado
- [x] `audit_log` ampliado: exportações, criação de conector/conta de transportadora, rotação de segredo de webhook (além do `reveal-cpf`)
- [x] Observabilidade: `x-request-id` em toda resposta, 5xx com `requestId` (sem detalhe interno) e `ErrorReporter` injetável (padrão: JSON no stderr; Sentry entra por esse gancho sem SDK obrigatório), `/ready` checa o banco, segredos removidos de URLs nos relatos
- [x] Runbook (`docs/runbook.md`) e checklist de aceite/go-live (`docs/go-live.md`)
- [ ] **Aceite e go-live (Marco 3)** — depende do cliente e das credenciais (ver `docs/go-live.md`)

## Depois do go-live
Fase 5b (segunda atividade), editor de templates na UI, API pública e MCP, checkout próprio, fiscal, notificações, IA nas bordas.


## Fase 8 — Telas (feat/08-telas)
Shell com navegação por permissão (`visiblePages`) e uma página por área da API; endpoint de extrato de estoque (`GET /v1/stock-items/:id/movements`). Limites: sem E2E em navegador; recuperação de senha, comprovante e PDF de etiqueta pendentes.

## Fase 9 — Desempenho e robustez (feat/09-desempenho)
Sem mudança de regra de negócio: paginação por cursor em `GET /v1/orders` (`limit` 1–200, `nextCursor`; sem parâmetros o contrato é o mesmo), índices (migration 0012), helmet + CORS por lista, SSRF por DNS, trava de jobs entre instâncias, limites no pool, `React.lazy` nas páginas e correção de uma corrida real (resposta enviada antes do COMMIT em 4 rotas; ver testes `commit-before-reply`). Índices **não** foram medidos com `EXPLAIN` em volume real.
