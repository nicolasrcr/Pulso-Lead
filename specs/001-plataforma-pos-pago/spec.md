# Especificação de Feature: Plataforma de Operação Pós-Paga com Afiliados

**Branch**: `001-plataforma-pos-pago` · **Data**: 2026-11-22 · **Status**: Rascunho (pré-`/speckit.clarify`)

> Origem: engenharia reversa de uma plataforma existente de mercado, observada como usuário autenticado (telas, listas de status, formulários e matriz de permissões). A spec descreve **o quê e por quê**, sem stack. Cada afirmação é marcada: **[OBS]** observada diretamente na interface; **[INF]** inferida do comportamento; **[?]** ambígua, listada em `clarifications.md`.

## 1. Contexto e objetivo

Operações de venda de produtos físicos por afiliados enviam o pedido **antes** do pagamento (modelo "after pay") e cobram o cliente final depois da entrega, por Pix, boleto ou cartão. O risco é alto: parte relevante dos pedidos vira perda (roubo, devolução, cancelamento, inadimplência). Na plataforma observada, ~45% dos pedidos viraram pagos e ~26% foram classificados como "Roubo" **[OBS]**.

A plataforma deve dar a cada operação, em um único lugar: cadastro e recebimento de pedidos, envio e rastreio, cobrança, estoque, devoluções, comissões e visão gerencial confiável.

**Dor central a resolver:** operadores sem visibilidade confiável do que foi vendido, enviado, pago e perdido, e sem isolamento entre projetos de um mesmo CNPJ.

## 2. Atores e perfis

Hierarquia **[OBS/INF]**: Organização → Projeto → Usuários e dados do projeto. Um Administrador Global por organização vê todos os projetos **[DEC: premissa adotada]**.

Perfis selecionáveis no cadastro de usuário **[OBS]**: Administrador, Operador, Afiliado, Atendente, Analista de Cobrança, Jurídico. Existe também o papel **Suporte logístico**, visto como autor de devoluções **[OBS]**.

O perfil escolhido pré-marca **grupos de permissão** combináveis **[OBS]**:

| Grupo | Capacidades observadas |
|---|---|
| Interno | Dashboard completo; editar e cadastrar pedidos; ver status de todas as situações; alterar status de pedidos próprios após entrega e cobrança |
| Gestor de pedidos | Ver notas e status dos pedidos que cadastrou; dashboard parcial (só os seus); solicitar análise de situação |
| Checkout do Produtor | Ver o link de todos os checkouts |
| Mentorado/Atendente | Como Gestor, mais cadastrar pedidos e alterar status dos próprios pedidos após entrega e cobrança |
| Administrador/Produtor | CRUD de produtos; dashboard e relatórios completos; gerir usuários; gerir todos os pedidos; ver links de checkout |
| Produtos Privados | Ver produtos privados (além dos públicos) |
| Cobrança Master | Ver e alterar status de **todas** as situações e o status de cobrança; criar notas; gerir todos os pedidos; relatórios |
| Cobrança | Criar e ver notas; relatórios; solicitar análise; alterar status de pedidos próprios após entrega e cobrança; dashboard parcial |
| Apenas Produtos Privados | Ver somente produtos privados |

Convite por e-mail: o usuário recebe link para criar a própria senha **[OBS]**. Usuários têm status Ativo/Inativo **[OBS]**.

## 3. Histórias de usuário

### US1 — Receber pedidos dos checkouts automaticamente (P1)
Como Administrador, quero conectar meus checkouts para que vendas entrem sozinhas como pedidos.

**Aceite**
1. Dado um plano vinculado a `(plataforma, id externo)`, quando chega o webhook de venda daquela plataforma, então um pedido é criado no projeto com cliente, endereço, plano e valor.
2. Dado o mesmo evento reenviado, então nenhum pedido novo é criado e o evento fica registrado como duplicado.
3. Dado um webhook cujo `(plataforma, id externo)` não tem vínculo, então o evento é guardado como "não resolvido" e aparece para o operador, sem criar pedido.
4. Dado um pedido sem e-mail, então o sistema gera um e-mail sintético e o marca como tal **[OBS]**.
- Plataformas observadas: PayT, Braip, B4You, Get Envios **[OBS]**. O link de agendamento só oferecia Braip **[OBS]**.

### US2 — Cadastrar pedido manualmente (P1)
Como Atendente, quero lançar um pedido com comprovante para vender fora do checkout.

**Aceite**
1. CPF é validado; o CEP preenche endereço; o modo de envio é Correios, com opção "Retirar nos Correios" **[OBS]**.
2. Escolho produto e plano; o total é calculado do plano **[OBS]**.
3. Posso **agendar a liberação do envio**; o estoque só baixa na liberação **[OBS]**.
4. Um interruptor "pedido after pay" define pós-pago; desligado, o pedido nasce em "Aguardando Pagamento" (antecipado) **[OBS]**.
5. Posso anexar comprovante (imagem png/jpg até 5 MB, ou áudio) **[OBS]**.

### US3 — Gerar link de checkout/agendamento para o afiliado (P2)
Como Afiliado, escolho tipo (Antecipado ou After Pay), plataforma, produto e plano e recebo um link copiável **[OBS]**. **[DEC 2026-11-22]** o link carrega o afiliado em **parâmetro assinado** (assinatura verificável no servidor). O pedido que chega pelo webhook é atribuído ao afiliado do parâmetro; link sem assinatura válida cria o pedido sem afiliado e sinaliza para revisão.

### US4 — Acompanhar envio e rastreio automaticamente (P1)
Como Operador, quero que o status de envio se atualize sozinho, com histórico por evento.

**Aceite**
1. Cada evento de transporte é normalizado para o catálogo de status de envio (seção 5) e gravado com data, cidade, UF e detalhe **[OBS]**.
2. Há um interruptor de "atualizações automáticas de envio" por pedido **[OBS]**.
3. Pedidos que não casaram com o agregador de etiquetas ficam "Não Sincronizado" e visíveis **[OBS]**.
4. O tempo médio de entrega por UF (do primeiro trânsito à entrega) é recalculado a cada 30 minutos e mostra a hora da última atualização **[OBS]**.

### US5 — Cobrar e conciliar pagamento (P1)
Como Analista de Cobrança, quero ver pedidos entregues e não pagos, cobrar e registrar o resultado.

**Aceite**
1. Pagamento tem status (seção 5), método e data **[OBS]**.
2. Posso "Declarar como Cobrado" um pedido que requer atenção **[OBS]**.
3. Pedidos entregues e não pagos após o prazo viram **Inadimplente**; os definitivamente sem receita viram **Frustrado** **[INF]**. **[DEC 2026-11-22]** o prazo para virar Inadimplente é **configurável por projeto, padrão 15 dias** após a entrega. Passagem para Frustrado continua sendo decisão de cobrança **[?]**.
4. Atualização de cobrança dispara o evento de saída "Cobrança Atualizada" **[OBS]**.

### US5b — Painel de pedidos por situação (P1)
Quadro com colunas (buckets) e contadores: Agendados, Aguardando Pagamento, Reportados, Enviados, Saiu para Entrega, Retirar nos Correios, Requer Atenção, Entregues, Inadimplências, Frustrados, Pagos **[OBS]**. Busca, filtros e "carregar mais" por coluna **[OBS]**. Os buckets não são mutuamente exclusivos por definição, mas Frustrados e Pagos praticamente particionam os pedidos finalizados **[INF]**.

### US6 — Gerir produtos, planos e estoque (P1)
1. Produto: nome, descrição, visibilidade Pública ou Privada **[OBS]**.
2. Plano: título, preço, visibilidade, status Ativo/Inativo; várias faixas de preço para o mesmo título **[OBS]**.
3. Vínculos do plano: `(plataforma, id externo)` **[OBS]**.
4. Pré-definição de comissões por plano, entre produtor e afiliado **[OBS]**; **[DEC 2026-11-22]** cada pré-definição escolhe **percentual ou valor fixo**, configurável por plano.
5. Controle de estoque do plano: lista de itens de estoque com quantidade (ex.: 1 cápsula + 1 gel) **[OBS]**.
6. Estoque: SKU, nome, projeto, quantidade, estoque mínimo, tipo (físico), status; movimentação manual e extrato **[OBS]**.
7. Liberar um pedido baixa os itens do plano; devolução conferida pode recolocar; quantidade descartada não volta **[INF]**.

### US7 — Tratar devoluções (P2)
Entidade própria ligada ao pedido, com número, tipo, rastreio da reversa, quantidade devolvida e descartada, autor (suporte logístico) e data **[OBS]**. Ciclo: Solicitada → Em análise → Aprovada ou Rejeitada → Reversa postada → Em reversa → Aguardando conferência → Reembolso pendente → Reembolsada → Finalizada → Concluída; também Cancelada **[OBS]**. Filtros por produto, plano e status **[OBS]**.

### US8 — Ver desempenho e rankings (P2)
Dashboard com filtros de período, tipo de envio, operação (Internos ou Afiliados), usuário e produto **[OBS]**:
- Faturamento comparativo: hoje x ontem, semana, mês **[OBS]**.
- Relatório diário e funil de status; mix de pagamento; motivos de frustração **[OBS]**.
- Visão geral: cadastrados, enviados, pagos, pendentes, inadimplência, por afiliados e por atendentes **[OBS]**.
- Rankings de produtos, afiliados (pedidos e total bruto) e atendentes **[OBS]**.
- Compras por região e tempo médio de entrega por UF **[OBS]**.

Relatório tabular de pedidos paginado, ordenável (mais recentes, atualização de envio) e exportável em CSV **[OBS]**.

### US9 — Notificar sistemas externos (P3)
Webhooks de saída por projeto: nome, URL, produtos, eventos (Pedido Criado, Cobrança Atualizada, Pedido Enviado, Atualização de Envio), ativo/inativo **[OBS]**. **[?]** assinatura, retentativa, log de entregas.

### US10 — Página de rastreio white-label (P2)
Cada projeto define nome do link, endereço público próprio, logo, banner e três cores (principal, secundária, fundo); alterações vão ao ar ao salvar **[OBS]**.

### US11 — Comunicação interna (P3)
Avisos urgentes com contador de não lidos, banners rotativos na Home, botão de suporte configurável **[OBS]**.

## 4. Requisitos funcionais

- **FR-001** O sistema MUST isolar dados por Projeto e permitir visão global ao Administrador Global.
- **FR-002** MUST gravar todo webhook recebido de forma crua e processar de forma idempotente por `(provedor, id do evento)`.
- **FR-003** MUST resolver o plano por `(plataforma, id externo)` e rejeitar para fila de não resolvidos o que não casar.
- **FR-004** Pedido MUST ter três eixos de status independentes e uma tabela de transições permitidas.
- **FR-005** Buckets do painel MUST ser derivados dos três eixos, não armazenados.
- **FR-006** MUST suportar pedido pós-pago e antecipado, definido por pedido.
- **FR-007** MUST suportar agendamento de liberação; baixa de estoque MUST ocorrer na liberação, de forma atômica.
- **FR-008** MUST registrar histórico cronológico por pedido (eventos de envio, mudanças de status, eventos de webhook, edições) e notas imutáveis.
- **FR-009** MUST permitir alteração manual de status e de tags por quem tem permissão, com auditoria.
- **FR-010** MUST validar CPF, preencher endereço por CEP e aceitar pedido sem e-mail.
- **FR-011** MUST normalizar eventos de transporte para o catálogo de status de envio, de forma independente da transportadora.
- **FR-012** MUST calcular tempo médio de entrega por UF com atualização periódica e carimbo de atualização.
- **FR-013** MUST registrar pagamento com método, status e data; suportar pagamento parcial, recusado e expirado.
- **FR-014** MUST gerir produto, plano, vínculo de plataforma, comissão pré-definida e itens de estoque por plano.
- **FR-015** MUST manter estoque com extrato, mínimo e alerta de reposição; saldo MUST ser derivado do extrato.
- **FR-016** MUST gerir devoluções como entidade própria com o ciclo da US7 e efeito controlado no estoque.
- **FR-017** MUST aplicar permissões por grupo de capacidade e por perfil pré-definido, com convite por e-mail.
- **FR-018** MUST oferecer dashboard, rankings, relatório e exportação CSV com os filtros da US8.
- **FR-019** MUST oferecer webhooks de saída com os quatro eventos e log de entregas.
- **FR-020** MUST oferecer página pública de rastreio por projeto com identidade visual configurável e domínio próprio.
- **FR-021** MUST mascarar CPF, telefone e endereço por padrão e auditar a revelação.
- **FR-022** SHOULD emitir ou registrar documento fiscal por pedido (status, chave, PDF) **[OBS: campos existem; fluxo [?]]**.
- **FR-023** MUST calcular a comissão do afiliado na **confirmação do pagamento**, conforme a pré-definição do plano (percentual ou fixo, em centavos), e MUST gerar lançamento de estorno quando o pedido for devolvido depois disso **[DEC 2026-11-22]**.
- **FR-024** MUST atribuir pedido de checkout ao afiliado por parâmetro assinado no link e rejeitar assinatura inválida para revisão **[DEC 2026-11-22]**.
- **FR-025** MUST marcar como Inadimplente o pedido entregue e não pago após o prazo configurado no projeto (padrão 15 dias) **[DEC 2026-11-22]**.

## 5. Catálogos de status (observados)

**Pagamento**: Sem Status · Pago · Pagamento Parcial · Pagamento Pendente · Pagamento Recusado · Expirado.
**Método**: Pix · Boleto · Cartão de Crédito · Transferência Bancária · Outro.

**Envio**: Sem Status · Preparando logística · Preparando · Aguardando coleta · Coletado · Enviado · Em trânsito · Rota de Entrega · Pronto p/ retirada · Entregue · Entregue em caixas inteligentes · Não entregue · Entrega falhou · Endereço incompleto · Atrasado · Reenviado · Retornando · Devolvido · Reverso Gerado · Reverso pendente · Retornado com Reverso · Avariado · Bloqueado · Apreendido · Perdido · Roubado · Cancelado · Em análise · Desconhecido · Não Sincronizado · Etiqueta Expirada/Cancelada.

**Plataforma (situação comercial)**: Sem Status · Em Análise · Criado · Roubo · Cancelado · Cancelado sem Custo · Cancelado com Custo · Cobrado · Inadimplente · Concluído · Devolução Concluída · Frustrado.

**Devolução**: Solicitada · Em análise · Aprovada · Rejeitada · Reversa postada · Em reversa · Aguardando conferência · Reembolso pendente · Reembolsada · Finalizada · Concluída · Cancelada.

**Motivos de frustração**: Roubo · Cancelado · Devolvido · Entregue e não pago **[OBS]**.

Filtros do painel também oferecem por **pedido**: Todos os pedidos · Todos enviados · Pago · Não pago · Por afiliado · Por atendente · outros itens não lidos **[OBS parcial]**.

## 6. Entidades-chave

- **Organização**, **Projeto**, **Usuário**, **Associação(usuário, projeto, perfil, grupos)**.
- **Produto**, **Plano(preço, visibilidade, status)**, **VínculoPlano(plataforma, id externo)**, **ComissãoPré-definida(plano, produtor, afiliado)**.
- **ItemEstoque**, **MovimentoEstoque**, **ItemDoPlano(plano, item, quantidade)**.
- **Pedido** (número sequencial legível + id único; autor afiliado; atendente; cliente com snapshot; plano; valor; modo pós-pago ou antecipado; liberação agendada; anexos; tags; 3 status; origem/plataforma; link de checkout).
- **Envio** (transportadora, etiqueta, código de rastreio, plataforma de envio, atualização automática, sincronizado), **EventoDeEnvio**.
- **Pagamento**, **DocumentoFiscal**.
- **Devolução**, **Nota** (imutável), **EventoDeAuditoria**.
- **EventoDeWebhookRecebido**, **WebhookDeSaída**, **EntregaDeWebhook**.
- **PáginaDeRastreio**, **Aviso**, **Banner**, **LinkDeCheckout**.

## 7. Critérios de sucesso

- **SC-001** 100% dos eventos duplicados de webhook são descartados sem efeito colateral.
- **SC-002** Pedido de checkout aparece no painel em até 30 s do recebimento.
- **SC-003** Status de envio reflete o evento de transporte em até 30 min.
- **SC-004** Saldo de estoque confere com o extrato em 100% dos casos; nenhuma baixa dupla por pedido.
- **SC-005** Dashboard exibe carimbo de atualização em todo indicador agregado e bate com o relatório CSV do mesmo período.
- **SC-006** Nenhum usuário acessa dado de outro projeto (verificado por teste automatizado de isolamento).
- **SC-007** Revelação de CPF sempre gera registro de auditoria.

## 8. Fora de escopo (v1)

Marketplace de produtos, app móvel nativo, cálculo de frete com cotação multi-transportadora, gateway de pagamento próprio, módulo financeiro de repasse bancário.

## 9. Riscos e conformidade

- **LGPD**: a plataforma de referência expõe CPF completo em listas; esta deve mascarar.
- **Categoria de produto**: o catálogo de referência vende itens de saúde por pós-pago; o nosso produto é genérico e cada cliente responde pela conformidade regulatória do que vende **[?]**.
- **Dependência de terceiros**: contratos e termos de checkouts, agregador de etiquetas e transportadoras.
- **Perda por roubo/extravio**: a taxa observada é alta e deve ser métrica de primeira classe.
