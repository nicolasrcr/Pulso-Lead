# Aceite e go-live (Marco 3)

Legenda: ✅ pronto e testado · 🟡 pronto contra contrato/mock, **falta credencial ou payload real** · ⬜ não construído.

## Funcional
- ✅ Multi-tenant (organização → projeto) com RLS e testes de isolamento; RBAC com 15 capacidades
- ✅ Pedido com 3 eixos, kanban derivado, volume/alertas 80/100, estoque (baixa única), devoluções, comissão (ledger imutável)
- ✅ Dashboard agregado, CSV, webhooks de saída assinados, link de afiliado assinado, importação CSV idempotente
- ✅ Back-office, suspensão somente leitura, exportação, descarte seguro, auditoria
- 🟡 **J&T**: adapter, assinatura e payload seguem as regras validadas em homologação (03/08/2026); `addOrder` confirmado. Falta: credenciais do cliente, conferir paths de `cancelOrder`/`checkFreight`/`trackingQuery` e o mapa de códigos de scan com a conta real
- 🟡 **PayT / Braip / B4You / Get Envios**: ingestão idempotente pronta; mapeadores de campo **provisórios** — ajustar com o payload real de cada plataforma (`apps/api/src/sales/mappers.ts`, 1 tabela)
- ⬜ Cobrança Pix/boleto/cartão (`PaymentProvider`) — o MVP opera pós-pago (pagamento na entrega); depende de provedor
- ⬜ Upload de comprovante (≤ 5 MB): precisa de storage (R2/S3)
- ⬜ Recuperação de senha: precisa de e-mail transacional
- ⬜ Telas: a web tem login, kanban, volume, dashboard. Faltam telas de back-office, conectores, transportadora, catálogo e exportação (a API já cobre tudo)

## Limites conhecidos
- Bloqueio de SSRF por hostname/IP literal; destinos que resolvem para IP privado via DNS não são barrados no envio
- Rate limit em memória (por instância)
- `tracking_synced` considera a primeira entrega de `SHIPPING_REGISTER`; com vários webhooks, o último resultado vence

## Checklist de homologação (com credenciais em mãos)
1. Cadastrar conta J&T em `POST /v1/carriers` (`env: "homolog"`), gerar etiqueta de teste; conferir `999005030` esperado nos endpoints que só funcionam em produção.
2. Trocar para `production`, gerar 1 etiqueta real e conferir rastreio por 24 h.
3. Para cada plataforma de venda: criar conector, apontar o webhook, enviar venda de teste, ajustar mapeador, vincular produto, `reprocess`.
4. Conferir dashboards e comissão com 10 pedidos reais.
5. Definir `SYSTEM_USER_ID`, `CPF_KEY` (backup em cofre) e alertas em `/ready`.
6. Assinatura do cliente: `POST /v1/backoffice/organizations/:id/subscription` → `status ativo` (registra o go-live).
