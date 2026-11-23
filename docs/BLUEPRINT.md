# Pulso-Lead — Blueprint de Construção

Repositório: https://github.com/nicolasrcr/Pulso-Lead · Versão 1.3 · 2026-11-22 (multi-tenant multi-atividade; stack revisada; requisitos do cliente fundador; benchmark do front-end da referência)
Idioma do produto: pt-BR · Moeda: BRL

Este documento reúne tudo o que foi levantado e decidido para escrever o Pulso-Lead: regras de negócio, decisões, stack, modelo de dados, integrações, camada de IA, fases e fluxo de trabalho com o Claude Code. Ele é o ponto de entrada. O detalhe normativo continua em `.specify/memory/constitution.md` e `specs/001-plataforma-pos-pago/spec.md`.

**Legenda de confiança.** **[OBS]** observado diretamente na interface da plataforma de referência. **[INF]** inferido do comportamento. **[DEC]** decisão sua. **[PROP]** proposta nossa, a validar. **[?]** aberto.

**Limites do levantamento.** Foi feito com uma única conta (perfil afiliado), por navegação autenticada. A v1.3 incorpora o benchmark do front-end (rotas, flags, chamadas de rede e documentação pública, seção 3C): o **front** é Next.js e a API é um serviço separado, mas a **lógica de servidor** (comissão, frustração, filas) continua **inferida**. Telas de backoffice e financeiro não foram abertas (401 para o perfil afiliado). Não foram abertos: central de avisos, formulário de comissão e `/configuracoes` (que quebrou com erro no cliente). Replicamos **comportamento funcional**, não código, textos, marca ou imagens da referência. Revise os termos de uso da plataforma observada antes de qualquer lançamento.

---

## 1. O que o Pulso-Lead é

Plataforma multi-projeto de **operação de venda pós-paga** com afiliados. O pedido é enviado primeiro; a cobrança (Pix, boleto ou cartão) acontece depois da entrega, e o sistema acompanha conversão, inadimplência e perdas.

Quatro atores: **produtor** (dono do projeto), **afiliados** (vendem), **atendentes** (operam pedidos) e **cobrança/suporte logístico** (resolvem pagamento e devolução).

**Dor que o produto resolve:** operadores sem visibilidade confiável do que foi vendido, enviado, pago e perdido, e sem isolamento entre projetos de um mesmo CNPJ.

**Números da referência (conta observada, 6 meses)** [OBS]: 588 pedidos (R$ 232.514 bruto), 263 pagos (R$ 106.061), ~45% de conversão; mix de pagamento Pix 46%, boleto 39%, cartão 15%; "Roubo" em ~26% dos pedidos; tempo médio de entrega 7,9 dias. Perda por roubo e inadimplência precisa ser **métrica de primeira classe**.

---

## 2. Decisões tomadas

| # | Decisão | Status |
|---|---|---|
| D1 | Comissão do afiliado: **percentual ou valor fixo, configurável por plano** | [DEC] |
| D2 | Comissão devida na **confirmação do pagamento**, com **estorno** se houver devolução depois | [DEC] |
| D3 | Atribuição do afiliado por **parâmetro assinado** no link gerado | [DEC] |
| D4 | Inadimplente após **prazo configurável por projeto, padrão 15 dias** da entrega | [DEC] |
| D5 | Um **Administrador Global por organização** vê todos os projetos | premissa, reconfirmar |
| D6 | Núcleo determinístico; **IA só nas bordas** (triagem, atendimento, resumos) | [PROP] |
| D7 | Planejamento com Spec Kit; execução com Claude Code (ver seção 13) | [PROP] |
| D8 | Plataforma **multi-tenant para várias atividades**: o catálogo atual é o primeiro template | [DEC] |
| D9 | Tenancy em 3 níveis (plataforma, organização, projeto); isolamento por **pool + RLS**, com saída para banco dedicado | [PROP] |
| D10 | Atividade = **template versionado** (módulos, status, transições, campos); sem `if` por atividade no código | [PROP] |
| D11 | **Stack revista:** Postgres + **API Node/TypeScript** + **BullMQ/Redis**; Supabase vira host opcional do banco e da autenticação | [PROP, revisa a v1.0] |
| D12 | **J&T Express é a primeira transportadora** (cotação, etiqueta, cancelamento, rastreio); Correios/agregador ficam para depois | [DEC] |
| D13 | **Plano único completo** para o cliente fundador, com teto de 1.000 pedidos/mês e franquia de 4 h/mês; planos e faixas ficam no modelo para os próximos clientes | [DEC] |
| D14 | Identidade visual **clara, com índigo como cor da marca** e diferente da referência | [DEC] |
| D15 | Para o go-live: **um template (pós-pago) com status de seed**; editor de templates, segunda atividade e IA vêm depois | [PROP] |
| D16 | **Conectores de venda como módulo:** entrada de PayT, Braip, B4You e Get Envios, com tabelas de vínculo (produto externo → plano; e-mail → afiliado) e devolução de rastreio com flag `sincronizado` | [PROP] |
| D17 | **API pública e MCP** (credencial por projeto, escopos `recurso:ação[:all]`) ficam **depois do go-live**; o modelo de dados já reserva as credenciais | [PROP] |
| D19 | **J&T primeiro, outras transportadoras depois:** `CarrierAdapter` com contrato testável, credenciais por organização e escolha fixa no go-live (3C.5b) | [DEC] |
| D18 | **Feature flags por organização e projeto** controlam módulos e marca (ver 3C.3) | [PROP] |

---

## 3. Regras de negócio consolidadas

### 3.1 Hierarquia e acesso
- Organização → **Projeto** (tenant operacional) → usuários e dados. Dados de negócio sempre carregam `organization_id` e `project_id`. [OBS/INF] O desenho multi-tenant e multi-atividade está na **seção 3A**.
- Usuário tem **perfil** (Administrador, Operador, Afiliado, Atendente, Analista de Cobrança, Jurídico) e **grupos de capacidade** combináveis (seção 8). Existe também **Suporte logístico** (autor de devoluções). [OBS]
- Convite por e-mail; o usuário cria a própria senha. Status Ativo/Inativo. [OBS]

### 3.2 Pedido: três eixos independentes
Um pedido tem **status de plataforma** (situação comercial), **status de envio** e **status de pagamento**. Catálogos completos no Apêndice A. [OBS]

Campos relevantes: número sequencial legível (#369153) + UUID; autor (afiliado) e atendente; cliente (CPF validado, nome, WhatsApp, e-mail ou e-mail sintético, endereço por CEP); plano; valor; modo **pós-pago ou antecipado**; liberação agendada; anexos (imagem png/jpg até 5 MB ou áudio); tags; origem e id externo; link de checkout. [OBS]

### 3.3 Ciclo de vida (proposta a validar)
```
Criado → [agendado?] → liberado (baixa de estoque) → etiqueta/coleta → em trânsito
       → rota de entrega → entregue → cobrança → pago → concluído
                                   ↘ não pago após prazo → inadimplente → frustrado
Perdas: roubado · extraviado · devolvido · cancelado (com ou sem custo)
```
- **Pós-pago:** nasce sem pagamento pendente; a cobrança é gerada ao detectar "Entregue" [PROP].
- **Antecipado:** nasce em "Aguardando Pagamento" e só libera o envio depois de pago [OBS: toggle "pedido after pay"].
- **Agendamento:** o pedido só libera no horário escolhido; **o estoque baixa na liberação**. [OBS]
- **Cancelado com custo:** a etiqueta já foi consumida; **sem custo:** etiqueta expirada ou cancelada. [INF]

### 3.4 Buckets do painel (derivados, nunca gravados) [PROP — validar]
| Bucket | Regra proposta |
|---|---|
| Agendados | `scheduled_release_at` no futuro e não liberado |
| Aguardando Pagamento | modo antecipado e pagamento em Sem Status ou Pendente |
| Reportados | marcado manualmente como reportado [?] |
| Enviados | envio em Aguardando coleta, Coletado, Enviado ou Em trânsito |
| Saiu para Entrega | envio em Rota de Entrega |
| Retirar nos Correios | envio em Pronto p/ retirada |
| Requer Atenção | flag manual ou envio em Não entregue, Entrega falhou, Endereço incompleto, Atrasado, Avariado, Bloqueado, Em análise, Não Sincronizado |
| Entregues | envio Entregue e pagamento ainda não resolvido |
| Inadimplências | plataforma = Inadimplente |
| Frustrados | perdas terminais sem receita (Roubo, Cancelado com ou sem custo, Devolução Concluída, entregue e não pago em definitivo) |
| Pagos | pagamento = Pago |

Observação [OBS]: Frustrados (322) + Pagos (262) + Enviados (2) somam 586 dos 588 pedidos. "Entregue" é transitório: o pedido migra para Pagos ou Frustrados.

### 3.5 Estoque e plano
- **Produto** agrupa **planos**; o plano é a unidade vendável (título, preço, visibilidade, status). O mesmo título pode ter várias faixas de preço. [OBS]
- **Controle de estoque do plano** = lista de itens com quantidade (ex.: plano "1 Caps + 1 Gel" baixa 1 SKU de cápsulas e 1 de gel). [OBS]
- Estoque por SKU e projeto: quantidade, **mínimo**, tipo (físico), status; movimentação manual e **extrato**. [OBS]
- **Saldo é derivado do extrato.** Baixa é movimentação atômica e reversível por movimentação inversa. [constituição V]
- Devolução conferida pode recolocar estoque; a **quantidade descartada não volta**. [INF]

### 3.6 Vínculo com checkouts e ingestão
- O plano é vinculado a `(plataforma, id externo)`. O webhook da plataforma resolve o plano por esse vínculo. [OBS]
- Plataformas observadas: **PayT, Braip, B4You, Get Envios**; o link de agendamento só oferecia Braip. [OBS]
- Cada webhook de entrada tem **URL própria** por projeto; a URL funciona como credencial. [OBS]
- Sem vínculo: evento fica "não resolvido" para o operador, sem criar pedido. [PROP]

### 3.7 Envio e rastreio
- Etiqueta por **agregador** (na referência, "Vendliber") e transporte pelos **Correios**. [OBS]
- Cada evento de transporte é normalizado ao catálogo de envio e gravado com data, cidade, UF e detalhe. [OBS]
- Interruptor "atualizações automáticas de envio" por pedido; flag "Não Sincronizado" quando o pedido não casou com o agregador. [OBS]
- **SLA por UF:** tempo do primeiro trânsito à entrega, recalculado a cada 30 minutos, com carimbo de atualização. [OBS]
- **Regra de ordenação [PROP]:** todo evento é gravado; o status "corrente" só muda se `occurred_at` for posterior ao último aplicado. Evento atrasado nunca regride o status.

### 3.8 Pagamento e cobrança
- Pagamento: status, método, data. Há **pagamento parcial, recusado e expirado**. [OBS]
- Ação manual "Declarar como Cobrado" para pedido que requer atenção. [OBS]
- Inadimplente: prazo por projeto, padrão 15 dias após a entrega. [DEC D4]
- Passagem de Inadimplente a Frustrado: quando e por quem **[?]**.

### 3.9 Comissão
- Pré-definição por plano entre produtor e afiliado. [OBS]
- **Lançamento de competência** na confirmação do pagamento; **estorno** em devolução posterior. Valores em centavos. [DEC D1, D2]
- O livro de comissões é um *ledger* append-only (accrual e reversal).

### 3.10 Devoluções
- Entidade própria ligada ao pedido: número, tipo, rastreio da reversa, quantidade devolvida e descartada, autor, data. [OBS]
- Ciclo: Solicitada → Em análise → Aprovada ou Rejeitada → Reversa postada → Em reversa → Aguardando conferência → Reembolso pendente → Reembolsada → Finalizada → Concluída; também Cancelada. [OBS]

### 3.11 Fiscal
- Campos por pedido: status fiscal, chave da nota, PDF. Hoje "Pendente" e "Não gerada" na referência. Fluxo de emissão **[?]**.

### 3.12 Dashboard e relatórios [OBS]
Filtros: período, tipo de envio (Correios ou Transportadora), operação (Internos ou Afiliados), usuário, produto. Indicadores: faturamento comparativo (hoje x ontem, semana, mês), relatório diário, funil de status, mix de pagamento, motivos de frustração, visão geral (cadastrados, enviados, pagos, pendentes, inadimplência, por afiliados e por atendentes), rankings (produtos, afiliados, atendentes), compras por região, SLA por UF. Relatório tabular paginado e **exportável em CSV**.

### 3.13 Webhooks de saída
Por projeto: nome, URL, produtos, eventos (**Pedido Criado, Cobrança Atualizada, Pedido Enviado, Atualização de Envio**), ativo. [OBS] Assinatura, retentativa e log de entregas **[PROP]** (ver 5.3).

### 3.14 Página de rastreio white-label
Nome do link, endereço público, logo, banner e três cores (principal, secundária, fundo); publicada ao salvar. [OBS]

### 3.15 Comunicação
Avisos urgentes com contador de não lidos, banners rotativos na Home, botão de suporte configurável. [OBS]

---

## 3A. Multi-tenant para múltiplas atividades

**Requisito [DEC]:** a mesma plataforma atende **várias atividades** (verticais), cada uma com seus módulos, status, campos e papéis, **sem fork de código**. O catálogo da seção 3 passa a ser o **primeiro template** (pós-pago com afiliados), e não o produto inteiro.

### 3A.1 Tenancy em três níveis [PROP]

| Nível | O que é | Exemplos |
|---|---|---|
| **Plataforma** | Você: super-admin, planos comerciais, catálogo de templates | Painel interno |
| **Organização** | Conta do cliente (CNPJ): usuários, faturamento, Administrador Global | "Grupo X" |
| **Projeto** | Uma **atividade instanciada** (workspace). Uma organização tem N projetos, de atividades diferentes | "Afiliados MGA", "Loja própria", "Delivery" |

- **Isolamento padrão: pool.** Um banco, um schema, `organization_id` e `project_id` **NOT NULL** em toda tabela de negócio, com RLS.
- **Saída para silo.** Organização grande ou regulada pode ir para banco dedicado: a API consulta um `tenant_registry` (organização → conexão) e usa as mesmas migrations. Não usar schema por tenant: o custo de aplicar migrations N vezes e de monitorar N schemas não compensa.
- **Resolução do tenant.** Subdomínio ou seletor de projeto na interface. A API valida o projeto contra `memberships` e, no início de cada transação, define `SET LOCAL app.user_id` e `SET LOCAL app.project_id`. As políticas de RLS leem `current_setting('app.project_id')`. A conexão da aplicação usa um papel **sem BYPASSRLS**.
- Um usuário pode ter vínculo com várias organizações e projetos (seletor de projeto).

```sql
create policy tenant_isolation on orders
  using (project_id = nullif(current_setting('app.project_id', true), '')::uuid
         and app.is_project_member(project_id));
```

### 3A.2 Atividade como template [PROP]

**Template** = pacote **versionado** de dados que descreve uma atividade: módulos habilitados, eixos de status e transições, presets de capacidades, campos personalizados, buckets do painel, indicadores do dashboard, eventos de webhook e textos. O projeto **nasce** de um template e pode divergir por **configuração**, nunca por código.

| Parte | Núcleo (código, igual para todos) | Configurável (dados, por projeto) |
|---|---|---|
| Identidade e acesso | Autenticação, tenancy, capabilities | Presets de perfil |
| Trabalho | Pedido/atendimento genérico, notas, anexos, auditoria | Eixos de status, transições, campos personalizados |
| Módulos | Estoque, envio, cobrança, devoluções, comissões, rastreio público, mensageria | Quais estão ligados e sua configuração |
| Integração | Eventos de domínio, webhooks de entrada e saída | Quais eventos e quais provedores |
| Gestão | Motor de relatórios | Indicadores e buckets do painel |

**Categoria canônica de status.** Cada status tem uma `category` fixa (`open`, `in_progress`, `success`, `failure`, `returned`, `cancelled`). Dashboards e rankings usam a **categoria**, não o código do status, e por isso funcionam em qualquer atividade.

**Templates candidatos [?]:** pós-pago com afiliados (base); e-commerce com envio próprio; delivery/restaurante; logística de bases; captação de leads. A **segunda atividade valida a abstração**: só generalize depois de ter dois templates reais.

### 3A.3 Alterações no modelo de dados

```sql
create table activity_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null, version int not null, name text not null,
  definition jsonb not null,                 -- módulos, eixos, status, transições, campos, buckets
  unique (code, version));

alter table projects
  add column activity_template_id uuid references activity_templates(id),
  add column template_version int;

create table project_modules (
  project_id uuid references projects(id), module text not null,
  enabled boolean not null default true, config jsonb not null default '{}',
  primary key (project_id, module));

create table status_axes (
  project_id uuid references projects(id), code text not null, name text not null,
  primary key (project_id, code));                              -- ex.: platform, shipping, payment

create table status_definitions (
  project_id uuid not null, axis_code text not null, code text not null, label text not null,
  category text not null check (category in ('open','in_progress','success','failure','returned','cancelled')),
  is_terminal boolean not null default false, sort int not null default 0,
  primary key (project_id, axis_code, code));

create table status_transitions (
  project_id uuid not null, axis_code text not null, from_code text not null, to_code text not null,
  allowed_sources text[] not null default '{system,webhook,user}',
  required_capability text,
  primary key (project_id, axis_code, from_code, to_code));

create table custom_field_definitions (
  id uuid primary key default gen_random_uuid(), project_id uuid not null,
  entity text not null, key text not null, label text not null,
  type text not null check (type in ('text','number','date','bool','select')),
  required boolean not null default false, options jsonb,
  unique (project_id, entity, key));

-- No lugar das três colunas fixas de status em orders:
create table order_status (
  order_id uuid not null references orders(id), project_id uuid not null,
  axis_code text not null, status_code text not null, updated_at timestamptz not null default now(),
  primary key (order_id, axis_code));
create index on order_status (project_id, axis_code, status_code);   -- contadores do kanban
-- orders ganha: custom jsonb not null default '{}'  (valores dos campos personalizados)

-- Planos comerciais do SaaS e limites
create table plans (code text primary key, modules text[] not null, limits jsonb not null);
create table subscriptions (organization_id uuid primary key references organizations(id), plan_code text references plans(code), status text not null, current_period_end timestamptz);
create table usage_counters (organization_id uuid, project_id uuid, metric text, period date, value bigint not null default 0, primary key (organization_id, project_id, metric, period));
```

**Trade-off assumido:** tirar os três status de `orders` para `order_status` custa um *join* nas listagens, mas permite atividades com 1, 2 ou 5 eixos. Mitigação: índice por `(project_id, axis_code, status_code)` e, se o volume exigir, uma coluna desnormalizada só para os buckets do painel.

As colunas `platform_status`, `shipping_status` e `payment_status` da seção 6 viram **linhas de `order_status`** no template de pós-pago. Os catálogos do Apêndice A passam a ser a **semente** desse template.

### 3A.4 Isolamento além do banco

- **Filas:** todo job carrega `organization_id` e `project_id`. Evitar que um tenant barulhento atrase os outros: limite de taxa e concorrência **por tenant** (token bucket no Redis; o BullMQ Pro tem *groups*, confirmar licença) e filas separadas por classe de job.
- **Segredos por organização:** tokens de webhook, credenciais de gateway e de transportadora em cofre, com **chave por organização** (envelope encryption). O CPF usa a mesma chave.
- **Arquivos:** prefixo `org/project/` e URLs assinadas de curta duração.
- **Limites:** rate limit, tamanho de payload e cotas por tenant na API; os planos comerciais ligam e desligam módulos (*feature gate*) e medem uso.
- **Domínios:** subdomínio por organização e domínio próprio por projeto na página de rastreio.
- **Observabilidade:** rótulos de tenant em logs e métricas, **sem PII**.
- **Ciclo de vida:** exportação e eliminação por projeto (LGPD), e restauração de backup testada.

### 3A.5 Versionamento de template

Cada projeto fixa o `template_version`. A atualização é **opt-in**, com diff e mapa de migração de status (de → para). Assim, uma melhoria no template nunca quebra uma operação em produção.

### 3A.6 Testes obrigatórios de multi-tenancy

1. pgTAP: toda tabela com `project_id` ou `organization_id` tem RLS ligado (o teste varre o catálogo).
2. Vazamento cruzado: usuário do projeto A não lê, altera nem apaga linha do projeto B, nem de outra organização.
3. Papel da aplicação não tem `BYPASSRLS`; consulta sem `app.project_id` retorna zero linhas.
4. Contrato dos templates: JSON Schema válido; toda transição referencia status existentes; estado terminal não tem saída sem capability.
5. Fila: job do tenant A nunca lê dado do tenant B; tenant barulhento não degrada o p95 dos demais.
6. Feature gate: módulo desligado no plano responde 403 em API e some da interface.

### 3A.7 O que **não** fazer

- **Não** construir um no-code genérico. A configuração cobre módulos, status, transições, campos e automações simples. Comportamento novo é módulo novo, em código.
- **Não** usar schema por tenant.
- **Não** deixar `project_id` ou `organization_id` opcionais.
- **Não** colocar `if (atividade === ...)` no código: variação de atividade vem do template.

---

## 3B. Requisitos do cliente fundador e do modelo comercial

Fonte: conversa de proposta e contrato (16 a 20/09/2026). **Valores em reais e dados do cliente ficam fora deste repositório**; aqui entram só as restrições que o produto precisa atender.

### 3B.1 Contexto

- O cliente fundador **opera hoje na plataforma de referência**. A dor declarada: o **dashboard dela não funciona**, e a operação fica "às cegas" com os números.
- Ele quer uma plataforma equivalente **com a J&T Express integrada de forma nativa**.
- O produto é **software**. A operação física (armazém, separação, expedição, 3PL) é **fora de escopo** e precisa ficar explícita para o cliente.
- A plataforma de referência não publica preço; ela se posiciona como serviço de fulfillment para vendas com pagamento na entrega. O Pulso-Lead é licença de uso de software, e não é comparável por preço.

### 3B.2 Condições comerciais que viram restrições de produto [DEC]

| Condição | Implicação no produto |
|---|---|
| **Plano único completo** (condição de cliente fundador; os próximos clientes pagam mais) | Todos os módulos ligados para esse cliente, mas a arquitetura mantém planos, faixas e feature gates para os próximos |
| **Licença de uso**; o código-fonte é do fornecedor | SaaS multi-tenant com marca do cliente; nada de entrega de repositório ao cliente |
| Mensalidade **a partir do go-live** | Assinatura com `go_live_at`; antes disso, o projeto está em implantação |
| Teto de **1.000 pedidos/mês** | Contador mensal (ver 3B.4); o sistema **avisa**, não bloqueia a operação |
| Franquia de **4 h/mês** de ajustes; hora extra à parte | Registro opcional de horas no back-office do fornecedor |
| **90 dias** de garantia e testes após o go-live; depois, defeito é coberto pela mensalidade e funcionalidade nova é evolução | `warranty_until` na assinatura; backlog separa `bug` de `evolution` |
| **Prazo mínimo de 12 meses** contado do go-live; saída antes do go-live paga o proporcional entregue | `min_term_end` na assinatura |
| Suspensão por atraso após **10 dias** | Estado "suspenso" com aviso prévio, acesso somente leitura e exportação liberada |
| **Exportação dos dados em CSV em até 15 dias, sem custo** ao fim do contrato | Exportação self-service por projeto e por organização |
| LGPD: **cliente = controlador, fornecedor = operador**; descarte seguro ao fim | Registro de tratamento, retenção definida, rotina de eliminação auditada |
| SLA leve: resposta em até 2 dias úteis | Canal de suporte com carimbo de abertura e resposta |
| Prazo de entrega: **8 a 12 semanas** | Ver 3B.5 (tensão escopo × prazo) |

### 3B.3 Requisitos funcionais adicionais

1. **J&T Express como transportadora de primeira classe:** cotação, geração de etiqueta, cancelamento e rastreio pela Open Platform. Credenciais de produção **por organização**, em cofre. **Homologação com etiqueta e rastreio reais antes do go-live.** É a parte de maior risco técnico do projeto. A página pública de rastreio exibe o selo "Enviado via J&T Express".
2. **Dashboard confiável (a dor do cliente):**
   - Nunca varrer pedidos ao vivo na abertura. Usar **agregados** atualizados por gatilho ou cron, com `refreshed_at` visível e alerta quando o agregado atrasar.
   - Índice `(organization_id, project_id, created_at, status)` nas tabelas de pedido.
   - **Seletor de projeto** no topo, mais "Todos os projetos" (soma), mais **ranking por projeto lado a lado**.
   - Admin global vê tudo; operador só o projeto dele, sem precisar filtrar.
3. **Multiprojeto por CNPJ:** Organização (o CNPJ) → Projetos (as atividades) → Usuários. Papéis `org_admin` (admin global, enxerga e gerencia todos os projetos), `project_admin` e `operator`. O admin global cria projetos, distribui usuários e entra em qualquer projeto.
4. **White-label:** nome da marca, logo, cores, domínio do app (ex.: `app.suamarca.com.br`) e do rastreio, por organização e por projeto.
5. **Coexistência e migração a partir da plataforma de referência:** o cliente poderá **rodar em paralelo e migrar aos poucos**. Importação CSV de pedidos e histórico, com mapeamento de status e idempotência por id externo. Pedido importado **conta no volume**.
6. **Controle de volume:** conta cada pedido **cadastrado ou importado** no **mês-calendário**. Alertas aos 80% e 100% do teto. Acima do teto, o sistema informa e o fornecedor ajusta a faixa comercial.
7. **Back-office do fornecedor** (nível plataforma): assinaturas, estados (implantação, garantia, ativo, em atraso, suspenso), uso por organização e projeto, e exportações solicitadas.
8. **Notificações** como módulo (canal a definir [?]).
9. **Complementos futuros, fora do plano único:** PWA de expedição, conciliação de pagamento na entrega, transportadoras extras, bot de WhatsApp.

### 3B.4 Alterações no modelo de dados

```sql
alter table subscriptions
  add column go_live_at date,
  add column warranty_until date,
  add column min_term_end date,
  add column monthly_fee_cents int,
  add column order_cap int not null default 1000,
  add column included_hours int not null default 4,
  add column extra_hour_cents int,
  add column suspended_at timestamptz;

-- Contador de volume: mês-calendário; conta pedidos criados OU importados (nunca duplicados do mesmo id externo)
-- usage_counters.metric in ('orders_created','orders_imported'); período = primeiro dia do mês.

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, project_id uuid not null,
  source text not null, status text not null default 'pending',
  stats jsonb not null default '{}', created_by uuid, created_at timestamptz not null default now());
alter table orders add column import_batch_id uuid references import_batches(id);

-- Agregados do dashboard (nunca consultar pedidos ao vivo para os indicadores)
create table dash_daily (
  organization_id uuid not null, project_id uuid not null, day date not null,
  affiliate_id uuid, uf char(2), plan_id uuid,
  orders int not null default 0,           gross_cents bigint not null default 0,
  paid int not null default 0,             paid_cents bigint not null default 0,
  delivered int not null default 0,        lost int not null default 0,
  returned int not null default 0,         overdue int not null default 0,
  refreshed_at timestamptz not null default now());
create unique index uq_dash_daily on dash_daily
  (project_id, day, coalesce(affiliate_id, '00000000-0000-0000-0000-000000000000'), coalesce(uf, '--'), coalesce(plan_id, '00000000-0000-0000-0000-000000000000'));
```

### 3B.5 Tensão entre escopo e prazo (leia antes de se comprometer)

O compromisso é **8 a 12 semanas, sozinho, com agentes de IA**. O blueprint completo é maior que isso. Para o go-live do cliente fundador, a recomendação é:

- **Entra no go-live:** Fases 0 a 7, com **um único template (pós-pago)**, status vindos de **seed** (sem editor de status e campos na interface) e a tenancy completa de organização e projeto.
- **Depois do go-live:** Fase 5b (segunda atividade), editor de templates na interface e a camada de IA (Fase 8). Webhooks de saída, notificações e fiscal só entram antes do go-live se o cliente tiver exigido [?].
- **Não cortar:** testes de isolamento entre projetos, idempotência de webhook, baixa de estoque única, comissão com estorno e **homologação da J&T**.

Estimativa grossa [PROP, validar]: Fases 0 e 1 em 2 semanas; 2 e 3 em 3 a 4; 4 e 5 em 2 a 3; 6 e 7 em 2; mais folga para a homologação da J&T, que depende de terceiros.

**Marcos de pagamento (3 parcelas) mapeados às entregas [PROP]:** 1ª na assinatura (início da Fase 0); 2ª com pedidos, J&T e cobrança funcionando em homologação (fim da Fase 4); 3ª no aceite e go-live.

### 3B.6 Identidade visual do cliente fundador [DEC]

- As primeiras telas-conceito imitavam a referência (escuro e verde-limão) e foram **trocadas por um tema claro, com azul-índigo como cor da marca**, para ter identidade própria. Telas-conceito: kanban de pedidos, dashboard de resultados e página de rastreio no celular. O selo vermelho da J&T permanece (é a marca deles).
- A paleta e as fontes finais saem do Coolors (https://coolors.co/), com o índigo como ponto de partida, registradas como tokens.

### 3B.7 Lacunas que precisam de decisão

| # | Lacuna | Por que importa | Ação recomendada | Dono |
|---|---|---|---|---|
| 1 | **Multiprojeto e painel consolidado não constam** no Anexo I do contrato nem na proposta aceita | É a principal dor do cliente; sem texto contratual, vira disputa de escopo | Incluir nos dois documentos agora | Você + cliente |
| 2 | **Escopo × prazo:** 8 a 12 semanas, sozinho | O blueprint completo não cabe | Go-live só com o template pós-pago e status de seed; **adiar** Fase 5b, editor de templates na interface, IA e API pública/MCP (3C). **Não cortar:** testes de isolamento entre projetos, idempotência de webhook, baixa de estoque única, comissão com estorno e homologação J&T | Você |
| 3 | **Vencimento da mensalidade:** o contrato fixa 30 dias após a assinatura, mas a mensalidade só começa no go-live | Cláusulas em conflito: cobrança antes de entregar | Fixar o vencimento a partir do `go_live_at` | Você + advogado |
| 4 | **Projeto = linha de produto ou operação separada do mesmo produto?** | Define o agrupamento do painel consolidado e o ranking por projeto [?] | Perguntar ao cliente; o modelo suporta os dois, mas o agrupamento muda | Cliente |
| 5 | **Razão social em branco** no contrato | Compromete a validade e a força executiva | Preencher; preferir **assinatura eletrônica** (sem testemunhas); revisão por advogado das cláusulas de prazo mínimo, teto de responsabilidade e definição de pedido | Você + advogado |
| 6 | **Definição de pedido** para o teto de 1.000/mês | Base da cobrança | Pedido cadastrado ou importado no mês-calendário; implementar exatamente assim | Você |

Gatilho de decisão: itens 1, 3 e 5 devem estar resolvidos **antes da 1ª parcela** (assinatura). Item 4 antes da Fase 5 (dashboard).

### 3B.8 Testes adicionais

1. O contador de volume conta pedido criado e importado uma vez só, mesmo em reimportação do mesmo lote.
2. O dashboard abre dentro da meta com volume alto (meta de p95 a definir [?]) e mostra `refreshed_at`; agregado atrasado dispara alerta.
3. "Todos os projetos" soma exatamente a soma dos projetos visíveis; operador nunca vê projeto alheio.
4. Suspensão por atraso deixa somente leitura e exportação, e **nunca apaga dados**.
5. Exportação CSV traz todos os dados do projeto e confere em contagem com o banco.
6. Homologação J&T: etiqueta, cancelamento e rastreio reais passam em ambiente de produção do cliente.

---

## 3C. Achados do benchmark do front-end da referência

Fonte: doc "Engenharia reversa e benchmark — Five Delivery vs Pulso-Lead" (https://claude.ai/artifact/HKcGa5tmi9PJnPJM4YhEEa), feito em 22/11/2026 a partir do bundle JS, rotas, tráfego de rede e documentação pública. **Regras e fluxos, nunca código, textos, marca ou layout** da referência.

### 3C.1 O que a referência faz que o blueprint ainda não cobria [OBS]

| Área | Achado | Efeito no Pulso-Lead | Prio |
|---|---|---|---|
| Entrada de venda | Recebe PayT, Braip, B4You e Get Envios; vínculo por produto externo e por e-mail do afiliado | Módulo de conectores com `external_product_links` e `affiliate_email_links` (D16) | P0 |
| Saída de rastreio | Devolve o código à plataforma de venda (Braip, PayT); flag **Sincronizado / Não Sincronizado** | Fila com retry, flag `tracking_synced` e reenvio manual na UI. Na referência, pedidos ficam "Não Sincronizado" sem retry visível | P0 |
| Pedido manual | After Pay desligado = pagamento antecipado (aguarda pagamento); fluxo configurável para Reportados (padrão, todos ou nenhum, com exceção por usuário); anexo de comprovante (imagem ou áudio, até 5 MB) | Configuração por projeto e por usuário; anexos em storage com limite e tipos permitidos | P0 |
| Frustração | Dias após a entrega sem pagamento; se o pagamento chega no prazo, não frustra | Já coberto (prazo por projeto, padrão 15 dias); confirmar a regra "pagamento no prazo cancela a frustração" | P0 |
| Webhooks de saída | Eventos `ORDER_CREATE`, `CHARGE_UPDATED`, `SHIPPING_REGISTER`, `SHIPPING_UPDATE` | Usar esses 4 como núcleo, com HMAC, retry exponencial, log e reenvio manual (ponto fraco da referência) | P1 |
| API pública | REST `/v1/*`, credencial por projeto e usuário, escopos `orders:read`, `orders:write`, `products:read`, `shipping:quote` etc., token opaco com hash, rate limit, cursor (máx. 100) | Fase pós-go-live (D17); tabela `api_credentials` reservada | P1 |
| MCP | Streamable HTTP, só leitura, OAuth 2.0 code + PKCE com registro dinâmico de client | Diferencial de marketing, depois da API | P2 |
| Checkout e pagamento | Checkout próprio (ids de plataforma 002, 010, 011, 014 no bundle, **inferido**); Pagar.me e Pag2Pay | Fora do go-live; `PaymentProvider` já existe como interface | P1 |
| Fiscal | Notazz | Interface `FiscalProvider`; fora do go-live | P2 |
| Notificações | Push via FCM, avisos urgentes, tipos INFO/SUCCESS/WARNING/ERROR/ANNOUNCEMENT, NPS por pesquisa | Módulo opcional; canal ainda aberto [?] | P2 |
| CEP | Cascata de consulta (ViaCEP, BrasilAPI e outras) | Cascata com timeout e cache; falha de um provedor não derruba o cadastro | P1 |
| Permissões | ~35 permissões (pedido, produto, dashboard, relatório, usuário, projeto, `BO_*`) checadas também em componente de UI | Alimenta o catálogo de capacidades; **checar sempre no servidor** (RLS e API), a UI só esconde | P0 |
| Hierarquia de usuários | Perfis, subperfis, filhos e **aprovação de cadastro** (accept/reject) | Fluxo de aprovação de afiliado/usuário no Papel `project_admin` | P1 |
| Billing do SaaS | Planos, assinatura atual, upgrade, pendência de checkout, registro de uso | Já previsto (`plans`, `subscriptions`, `usage_counters`) | P1 |

### 3C.2 Fragilidades da referência (oportunidade) [OBS]

- Erros em produção durante a sessão: 500 no endpoint de conteúdo do botão de suporte, 503 no coletor do Sentry e crash client-side em `/configuracoes/transportadoras`.
- Rastreio "Não Sincronizado" sem retry visível ao usuário.
- Dashboard pouco útil para o afiliado (é a dor do cliente fundador).
- MCP só leitura; criação de pedidos apenas via REST.

Consequência: manter esses quatro pontos como **critérios de aceite** do Pulso-Lead (telas com estado de erro tratado, reenvio de rastreio na UI, dashboard por agregados, API de escrita).

### 3C.3 Feature flags por organização e projeto [PROP]

Padrão da referência: um objeto de configuração por marca liga e desliga módulos. Lista de flags a reservar em `project_modules` / `organization_settings`:

`dark_theme`, `reports`, `multi_projects`, `ranking_on_dashboard`, `tracking_link_personalize`, `private_product`, `manage_fiscal`, `pwa`, `notifications`, `notification_list`, `inclusive_offers`, `kanban_filter`, `manage_webhooks`, `order_proof_request`, `order_tags`, `order_manual_create`, `affiliate_links`, `checkout`, `checkout_providers`, `frustrations`, `returns`, `public_api`, `mcp`.

Nomes são nossos; apenas o conceito vem da referência. O plano comercial (D13) decide quais flags vêm ligadas por padrão.

### 3C.4 Matriz de paridade (resumo)

Legenda: ✔ pronto, ◐ especificado no blueprint, ✘ falta especificar. Nada está **implementado** ainda.

| # | Capacidade | Status no blueprint | Prio |
|---|---|---|---|
| 1 | Multi-tenant (projeto no mesmo CNPJ) + admin global | ◐ (3A, 3B.3) | P0 |
| 2 | RBAC granular, checagem no servidor | ◐ (seção 8) | P0 |
| 3 | Kanban com 3 eixos | ◐ (3, 7) | P0 |
| 4 | Pedido manual: agendamento, After Pay, comprovante | ◐ (3C.1) | P0 |
| 5 | Inadimplência e frustração por prazo | ◐ | P0 |
| 6 | Comissão com ledger e estorno | ◐ | P0 |
| 7 | Atribuição por link assinado | ◐ | P0 |
| 8 | Webhooks de entrada com vínculo | ◐ (D16) | P0 |
| 9 | Devolução de rastreio e flag de sync | ◐ (3C.1) | P0 |
| 10 | Webhooks de saída | ◐ | P1 |
| 11 | Multi-transportadora com cotação | ◐ (J&T primeiro) | P0 |
| 12 | Estoque por SKU, mínimo, extrato, baixa na liberação | ◐ | P1 |
| 13 | Devoluções e etiquetas | ◐ | P1 |
| 14 | Pagamento/adquirente e checkout próprio | ✘ | P1 |
| 15 | Fiscal | ✘ | P2 |
| 16 | Billing do SaaS | ◐ | P1 |
| 17 | API pública com escopos | ✘ (D17) | P1 |
| 18 | MCP/OAuth | ✘ (D17) | P2 |
| 19 | White-label por flags | ◐ (3B.3, 3C.3) | P1 |
| 20 | Notificações, push e NPS | ✘ | P2 |
| 21 | Dashboard, ranking e relatório com CSV | ◐ (3B.3, agregados) | P0 |
| 22 | Observabilidade | ◐ (seção 10) | P2 |

### 3C.5 Alterações no modelo de dados

```sql
create table external_product_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, project_id uuid not null,
  provider text not null, external_product_id text not null,
  plan_id uuid not null references plans(id) on delete restrict,
  unique (project_id, provider, external_product_id));

create table affiliate_email_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, project_id uuid not null,
  provider text not null, email citext not null, affiliate_id uuid not null,
  unique (project_id, provider, email));

alter table orders
  add column tracking_synced boolean not null default false,
  add column tracking_synced_at timestamptz,
  add column tracking_sync_error text;

create table api_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, project_id uuid not null, created_by uuid not null,
  name text not null, scopes text[] not null,
  token_hash text not null unique, last_used_at timestamptz,
  revoked_at timestamptz, created_at timestamptz not null default now());
```

### 3C.5b Multi-transportadora desde o desenho, J&T primeiro [DEC]

O envio sai pela **J&T no go-live**, mas há a ideia de **outras transportadoras no futuro**. Por isso a J&T entra como **a primeira implementação** de uma abstração, e não como código acoplado ao pedido:

- Interface `CarrierAdapter`: `quote`, `createShipment` (etiqueta), `cancel`, `track` e `normalizeEvent`. Os eventos de cada transportadora são traduzidos para o catálogo canônico de status de envio; a máquina de estados nunca conhece códigos da J&T.
- Tabela `carriers` (catálogo da plataforma) e `carrier_accounts` (credenciais **por organização**, em cofre, com `enabled` por projeto). O pedido guarda `carrier_account_id`, `carrier_tracking_code` e a cotação usada.
- Regra de escolha da transportadora por projeto: fixa (J&T) no go-live; a seleção por CEP, peso, custo ou prazo fica prevista no modelo (`carrier_rules`), mas **sem interface** até existir a segunda transportadora.
- A segunda transportadora (Correios via agregador, Jadlog ou outra) é um complemento fora do plano único, no mesmo molde dos demais. Só a segunda implementação valida a abstração, então o contrato do `CarrierAdapter` deve ter testes de contrato reutilizáveis.
- Rastreio público, selo "Enviado via J&T Express" e webhooks de saída (`SHIPPING_REGISTER`, `SHIPPING_UPDATE`) já usam o status canônico e o nome da transportadora do pedido.

```sql
create table carrier_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, carrier_key text not null, -- 'jt', futuramente outras
  credentials_ref text not null,                           -- referência ao cofre, nunca a credencial
  created_at timestamptz not null default now());
create table project_carriers (
  project_id uuid not null, carrier_account_id uuid not null references carrier_accounts(id),
  enabled boolean not null default true, is_default boolean not null default false,
  primary key (project_id, carrier_account_id));
alter table orders add column carrier_account_id uuid references carrier_accounts(id);
```

Teste adicional: um `CarrierAdapter` falso (segunda transportadora de teste) passa na mesma suíte de contrato da J&T sem mudar a máquina de estados.

### 3C.6 Testes adicionais

1. Webhook de venda com produto sem vínculo cai em fila de "sem vínculo" e **não cria pedido**; depois do vínculo, reprocessa sem duplicar.
2. Falha ao devolver rastreio mantém `tracking_synced = false`, agenda retry exponencial e permite reenvio manual.
3. Pagamento confirmado dentro do prazo impede a frustração, mesmo com o job rodando depois.
4. Anexo acima de 5 MB ou de tipo não permitido é recusado no servidor.
5. Token de API guarda só o hash; credencial revogada responde 401; escopo insuficiente responde 403.
6. Permissão negada na UI também é negada na API (nunca só no componente).

---

## 4. Stack recomendada

Escolhida para o seu histórico (React, TypeScript, Supabase, Postgres, BullMQ, Cloudflare) e para os três requisitos duros: **multi-tenant com isolamento no banco**, **ingestão idempotente** e **polling de rastreio**.

| Camada | Escolha | Por quê |
|---|---|---|
| Banco | **PostgreSQL** + RLS, hospedado no Supabase (região São Paulo) ou em outro Postgres gerenciado | Isolamento por projeto via políticas; portável. Auth e Storage do Supabase podem ficar no início |
| Tempo real | Realtime do Supabase ou SSE/WebSocket pela API | Atualizar o kanban sem recarregar |
| Front administrativo | **Vite + React + TypeScript**, TanStack Router e Query, Tailwind, shadcn/ui, react-hook-form + zod | Painel autenticado não precisa de SSR |
| API de domínio | **Node/TypeScript (NestJS ou Fastify)**, com a lógica de negócio, tenancy e templates; transações no Postgres | Testável localmente, observável, sem acoplamento a Edge Functions. Operações atômicas (liberar pedido, baixar estoque, lançar comissão) numa transação |
| Ingestão de webhooks | **Cloudflare Worker** (arquivo `.js`) | Resposta rápida; grava o evento cru e enfileira |
| Jobs | **Redis + BullMQ** desde o início | Retentativa com recuo, limite de taxa por transportadora e por tenant, fila de falhas |
| Página de rastreio | **Worker/Pages separado** com hostnames por projeto (Cloudflare for SaaS) | Desacoplado do painel. Verifique plano e custo antes de contar com isso |
| Domínio puro | Pacote TypeScript **sem dependências** (`packages/domain`) | Máquinas de estado testáveis com TDD |
| Testes | Vitest, **pgTAP** (RLS), Playwright | Isolamento e transições são o risco central |
| Observabilidade | Sentry, PostHog, logs do Supabase | PostHog substitui o Microsoft Clarity da referência |
| CI/CD | GitHub Actions; deploy do front no Cloudflare Pages | Alinhado ao que você já publica |

**Alternativas.** Next.js (App Router) se quiser unificar painel e páginas públicas; foi o que a referência usa [OBS]. NestJS + Postgres + Redis + BullMQ quando o volume de eventos justificar um backend dedicado. Não recomendo começar por aí.

**Integrações externas (decisões pendentes).**
- **Transportadoras:** interface `CarrierAdapter`. **Primeira: J&T Express Open Platform** (cotação, etiqueta, cancelamento, rastreio) [DEC D12]. Depois Correios via agregador de etiquetas e Jadlog.
- **Cobrança pós-entrega:** interface `PaymentProvider` (Pix, boleto, cartão) com webhook de confirmação. Candidatos: Asaas, Mercado Pago, Stone [?].
- **Fiscal:** Focus NFe, eNotas ou Bling [?].
- **Mensageria:** WhatsApp Cloud API (Meta) para cobrança, agendamento e aviso de entrega [PROP].

---

## 5. Arquitetura

### 5.1 Visão geral
```
Checkouts (Braip, PayT, B4You, Get Envios)
        │ webhook                       Agregador / Transportadoras
        ▼                                      │ polling / webhook
[Worker de ingestão .js] ─► webhook_events ◄───┘
        │ enfileira                       │
        ▼                                 ▼
   [Fila BullMQ/Redis] ─► Workers + API Node (TypeScript) ─► Postgres (RLS)
                                                 │             │
                              Realtime ◄─────────┘             ├─► outbound_webhooks
                                  │                             └─► ledger de comissões
                          [Painel React]            [Página de rastreio pública]
```

### 5.2 Ingestão idempotente de webhook
1. Resolver o projeto pelo **token da URL** (guardar apenas o hash).
2. Calcular `event_id` (id do provedor ou SHA-256 do corpo).
3. `insert into webhook_events … on conflict (project_id, provider, event_id) do nothing`. Sem inserção: responder 200 como duplicado.
4. Enfileirar e responder 200 **antes** de processar.
5. Processador: mapear para `(plataforma, id externo)` → plano; criar o pedido com chave `(project_id, source, source_external_id)`; sem vínculo, marcar `unresolved`.
6. Falha: retentativa com recuo exponencial; após N tentativas, fila de falhas **visível ao operador**.

### 5.3 Webhook de saída [PROP]
Assinatura HMAC no cabeçalho, `delivery_id` único, retentativa com recuo, timeout curto, log de entregas por webhook e reenvio manual.

### 5.4 Rastreio
Job a cada 15 a 30 minutos sobre envios não terminais com atualização automática ligada. Cada evento é gravado cru e normalizado. A aplicação ao status corrente segue a regra de ordenação (3.7). SLA por UF é recalculado por job e guardado em tabela agregada com carimbo.

### 5.5 Liberação de pedido (atômica)
Uma única transação (função SQL chamada pela API): bloqueia o pedido, confirma `released_at is null`, insere um movimento por item do plano, define `released_at`. Índice único parcial em `inventory_movements (order_id, item_id) where reason = 'release'` impede baixa dupla mesmo sob concorrência.

---

## 6. Modelo de dados

Convenções: `uuid` como chave, `timestamptz`, **dinheiro em centavos inteiros**, `project_id` em toda tabela de negócio, `created_at`/`updated_at`.

```sql
-- Tenancy
create table organizations (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
create table projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null, slug text unique not null,
  settings jsonb not null default '{"overdue_days": 15}',   -- D4
  created_at timestamptz not null default now());
create table org_admins (user_id uuid references auth.users(id), organization_id uuid references organizations(id), primary key (user_id, organization_id));
create table memberships (
  user_id uuid references auth.users(id), project_id uuid references projects(id),
  profile text not null check (profile in ('admin','operator','affiliate','attendant','collections','legal','logistics_support')),
  capabilities text[] not null default '{}',
  status text not null default 'active' check (status in ('active','inactive')),
  primary key (user_id, project_id));

-- Helpers de política
create function app.is_project_member(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.user_id = auth.uid() and m.project_id = p and m.status = 'active')
      or exists (select 1 from org_admins a join projects pr on pr.organization_id = a.organization_id where a.user_id = auth.uid() and pr.id = p) $$;
create function app.has_cap(p uuid, cap text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_admins a join projects pr on pr.organization_id = a.organization_id where a.user_id = auth.uid() and pr.id = p)
      or exists (select 1 from memberships m where m.user_id = auth.uid() and m.project_id = p and m.status = 'active' and cap = any(m.capabilities)) $$;

-- Catálogo
create table products (id uuid primary key default gen_random_uuid(), project_id uuid not null references projects(id), name text not null, description text, visibility text not null default 'public' check (visibility in ('public','private')));
create table product_plans (id uuid primary key default gen_random_uuid(), project_id uuid not null, product_id uuid not null references products(id), title text not null, price_cents int not null check (price_cents >= 0), visibility text not null default 'public', status text not null default 'active' check (status in ('active','inactive')));
create table plan_platform_links (id uuid primary key default gen_random_uuid(), project_id uuid not null, plan_id uuid not null references product_plans(id), platform text not null, external_id text not null, unique (project_id, platform, external_id));
create table commission_presets (id uuid primary key default gen_random_uuid(), project_id uuid not null, plan_id uuid not null references product_plans(id), producer_id uuid, affiliate_id uuid, kind text not null check (kind in ('percent','fixed')), value int not null check (value >= 0)); -- percent em basis points

-- Estoque
create table inventory_items (id uuid primary key default gen_random_uuid(), project_id uuid not null, code text not null, name text not null, type text not null default 'physical', min_qty int not null default 0, status text not null default 'active', unique (project_id, code));
create table plan_stock_items (plan_id uuid references product_plans(id), item_id uuid references inventory_items(id), qty int not null check (qty > 0), primary key (plan_id, item_id));
create table inventory_movements (id uuid primary key default gen_random_uuid(), project_id uuid not null, item_id uuid not null references inventory_items(id), qty_delta int not null, reason text not null check (reason in ('manual','release','return','discard','adjust')), order_id uuid, return_id uuid, created_by uuid, created_at timestamptz not null default now());
create unique index uq_release_once on inventory_movements (order_id, item_id) where reason = 'release';
create view inventory_balance as select item_id, project_id, sum(qty_delta) as qty from inventory_movements group by item_id, project_id;

-- Pedido
create table orders (
  id uuid primary key default gen_random_uuid(),
  public_seq bigint generated always as identity,
  project_id uuid not null references projects(id),
  author_id uuid, attendant_id uuid,
  plan_id uuid not null references product_plans(id),
  amount_cents int not null,
  payment_mode text not null check (payment_mode in ('after_pay','prepaid')),
  scheduled_release_at timestamptz, released_at timestamptz,
  platform_status text not null default 'none', shipping_status text not null default 'none', payment_status text not null default 'none',
  needs_attention boolean not null default false, tags text[] not null default '{}',
  source text not null, source_external_id text, checkout_url text,
  customer jsonb not null,           -- nome, whatsapp, e-mail (+ synthetic), endereço
  customer_cpf_enc bytea, customer_cpf_hash text,   -- cifrado + hash p/ busca; nunca CPF em claro
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (project_id, source, source_external_id));
create index on orders (project_id, platform_status);
create index on orders (project_id, shipping_status);
create index on orders (project_id, payment_status);
create index on orders (project_id, author_id);

-- Eventos e dinheiro
create table shipments (id uuid primary key default gen_random_uuid(), project_id uuid not null, order_id uuid not null references orders(id), carrier text not null, tracking_code text, label_platform text, auto_update boolean not null default true, synced boolean not null default false, last_event_at timestamptz);
create table shipment_events (id uuid primary key default gen_random_uuid(), project_id uuid not null, shipment_id uuid not null references shipments(id), carrier_event_id text, normalized_status text not null, raw jsonb not null, city text, uf text, occurred_at timestamptz not null, unique (shipment_id, carrier_event_id));
create table payments (id uuid primary key default gen_random_uuid(), project_id uuid not null, order_id uuid not null references orders(id), method text, status text not null, amount_cents int not null, paid_at timestamptz, gateway_id text, unique (project_id, gateway_id));
create table commission_entries (id uuid primary key default gen_random_uuid(), project_id uuid not null, order_id uuid not null, affiliate_id uuid not null, kind text not null check (kind in ('accrual','reversal')), amount_cents int not null, created_at timestamptz not null default now(), unique (order_id, kind));
create table returns (id uuid primary key default gen_random_uuid(), project_id uuid not null, order_id uuid not null, status text not null, type text not null default 'return', reverse_tracking text, qty_returned int not null default 0, qty_discarded int not null default 0, author_id uuid, requested_at timestamptz not null default now());

-- Integração e auditoria
create table webhook_endpoints (id uuid primary key default gen_random_uuid(), project_id uuid not null, provider text not null, token_hash text not null unique, active boolean not null default true);
create table webhook_events (id uuid primary key default gen_random_uuid(), project_id uuid not null, provider text not null, event_id text not null, payload jsonb not null, status text not null default 'received', attempts int not null default 0, received_at timestamptz not null default now(), unique (project_id, provider, event_id));
create table order_notes (id uuid primary key default gen_random_uuid(), project_id uuid not null, order_id uuid not null, author_id uuid not null, body text not null, created_at timestamptz not null default now()); -- trigger impede update e delete
create table audit_log (id bigint generated always as identity primary key, project_id uuid, actor_id uuid, action text not null, entity text not null, entity_id uuid, diff jsonb, at timestamptz not null default now()); -- append-only
```

**Demais tabelas** (mesmo padrão): `outbound_webhooks`, `webhook_deliveries`, `tracking_pages`, `checkout_links`, `notices`, `banners`, `fiscal_documents`, `delivery_sla_by_uf`.

**Política de exemplo (pedidos).**
```sql
alter table orders enable row level security;
create policy orders_read on orders for select using (
  app.is_project_member(project_id) and (
    app.has_cap(project_id, 'orders.read_all') or author_id = auth.uid() or attendant_id = auth.uid()));
```
Regra: **toda tabela com `project_id` tem RLS ligado**. Teste pgTAP percorre o catálogo e falha se alguma não tiver.

**CPF.** Guardar cifrado (Supabase Vault ou criptografia de coluna) com `cpf_hash` para busca. A interface mostra mascarado e a revelação grava em `audit_log`.

---

## 7. Máquinas de estado e testes (TDD)

Implementar em `packages/domain`, funções puras, **testes antes do código**.

**Envio (proposta).**
- Pré-envio: Sem Status → Preparando logística → Preparando → Aguardando coleta → Coletado.
- Trânsito: Enviado → Em trânsito → Rota de Entrega → {Entregue, Não entregue, Entrega falhou, Pronto p/ retirada, Entregue em caixas inteligentes}.
- Não entregue → Rota de Entrega (nova tentativa) | Retornando | Pronto p/ retirada. Retornando → Devolvido | Retornado com Reverso.
- Excepcionais: Avariado, Bloqueado, Apreendido, Perdido, Roubado, Atrasado, Endereço incompleto, Em análise, Desconhecido, Reenviado, Cancelado, Etiqueta Expirada/Cancelada, Não Sincronizado.
- Terminais: Entregue, Devolvido, Retornado com Reverso, Perdido, Roubado, Cancelado, Etiqueta Expirada/Cancelada, Apreendido. Reabrir terminal exige ação manual auditada.

**Pagamento (proposta).** Sem Status → Pendente → Pago | Parcial → Pago | Recusado | Expirado.

**Plataforma (proposta).** Criado → Em Análise → Cobrado → Concluído; Cobrado → Inadimplente (prazo); Inadimplente → Concluído (pagou) ou Frustrado. Roubo, Cancelado com ou sem custo e Devolução Concluída são terminais sem receita.

**Casos de teste prioritários.**
1. Webhook duplicado não cria segundo pedido nem segunda baixa.
2. Evento de transporte com `occurred_at` antigo não regride o status.
3. Liberar o mesmo pedido duas vezes (concorrente) baixa o estoque uma vez.
4. Comissão: accrual único por pedido; devolução após pagamento gera reversal; sem pagamento não há accrual.
5. Inadimplente só após o prazo do projeto (borda: dia 15 e 16).
6. Usuário do projeto A nunca lê linha do projeto B (pgTAP, para todas as tabelas).
7. Afiliado só vê os próprios pedidos; Cobrança Master vê todos.
8. Assinatura de link inválida cria pedido sem afiliado e sinaliza revisão.
9. Estorno de comissão em dinheiro inteiro, sem arredondamento perdido.
10. Revelar CPF grava `audit_log`.

---

## 8. Permissões

Perfis pré-marcam **grupos de capacidade** [OBS]. Recomendação [PROP]: implementar como **capabilities atômicas** (`orders.create`, `orders.read_all`, `orders.edit`, `orders.status.own_after_delivery`, `orders.status.all`, `billing.status`, `notes.create`, `notes.read`, `reports.read`, `dashboard.full`, `dashboard.own`, `products.manage`, `products.private.read`, `users.manage`, `checkout_links.read`) e os 9 grupos como **presets** que preenchem `memberships.capabilities`.

| Grupo (referência) | Capacidades principais |
|---|---|
| Interno | dashboard completo; editar e cadastrar pedidos; ver todos os status; alterar status próprio após entrega e cobrança |
| Gestor de pedidos | notas e status dos próprios pedidos; dashboard parcial; solicitar análise |
| Checkout do Produtor | ver links de todos os checkouts |
| Mentorado/Atendente | como Gestor, mais cadastrar pedidos e alterar status próprio após entrega e cobrança |
| Administrador/Produtor | CRUD de produtos; dashboard e relatórios completos; gerir usuários e pedidos; ver links |
| Produtos Privados / Apenas Produtos Privados | ver produtos privados (ou somente eles) |
| Cobrança Master | todos os status e status de cobrança; notas; gerir todos os pedidos; relatórios |
| Cobrança | notas; relatórios; solicitar análise; status próprio após entrega e cobrança; dashboard parcial |

Notas de pedido são **imutáveis**: correção é nova nota.

---

## 9. Camada de IA (fase final)

Base: https://github.com/anthropics/claude-quickstarts. **O LLM nunca está no caminho crítico de estado ou dinheiro.**

| Caso | Quickstart de referência | Regra |
|---|---|---|
| Normalizar evento de transporte desconhecido | — (saída estruturada) | Só o que o mapeamento determinístico não resolver; gravar cru; resultado marcado como "sugerido" |
| Triagem de Requer Atenção, Não Sincronizado, Endereço incompleto | — | Agente **propõe**, humano aprova |
| Atendimento ao cliente final (WhatsApp) | `customer-support-agent` | Ferramentas **somente leitura** (pedido, rastreio) |
| Resumo diário da operação | `managed-agents/daily-brief` | Frustrados, inadimplentes, estoque abaixo do mínimo |
| Pergunte ao dashboard | `financial-data-analyst` | Consulta com o **token do usuário**, nunca com chave de serviço |
| Construir o sistema | `autonomous-coding` | Alternativa ao `/speckit.implement`; use só um dos dois |

Modelos: `claude-haiku-5-5` para classificação, `claude-sonnet-5-5` para análise e atendimento. **Mascarar CPF, telefone e endereço antes de enviar contexto ao modelo.** A `ANTHROPIC_API_KEY` fica fora do repositório.

---

## 10. Segurança e LGPD

- RLS em tudo; teste automatizado de isolamento no CI.
- URLs de webhook são segredos: guardar só o hash, permitir **rotação**, nunca registrar em log.
- CPF e telefone mascarados por padrão; revelação auditada. A referência expõe CPF completo em listas: **não replicar**.
- Retenção definida para pedidos, anexos (imagem e áudio) e auditoria [?].
- Assinatura HMAC nos webhooks de saída; segredos em variáveis de ambiente, nunca no repositório.
- Termo de uso a aceitar no cadastro, com **categorias de produto proibidas** [?]. A referência vende itens de saúde por pós-pago; cada cliente responde pela conformidade do que vende.
- Backups e restauração testados antes do primeiro cliente real.

---

## 11. Design system

- Tokens em `packages/ui` (CSS variables + config Tailwind): cores semânticas, tipografia, espaçamento base 8 px, sombras, raios, transições.
- **Paleta e fontes escolhidas no Coolors** (https://coolors.co/), conforme a sua regra para SaaS. Registrar a paleta final como tokens (`--color-primary`, `--color-secondary`, `--color-success`, `--color-warning`, `--color-error`, `--color-background`, `--color-surface`, `--color-text-*`, `--color-border`). Não copiar a identidade visual da referência (tema escuro com acento verde-limão).
- Obrigatório: modo claro e escuro sem flash, WCAG 2.1 AA (contraste 4,5:1), foco visível, estados de loading, vazio e erro em toda tela, skeletons em listas e painéis.
- Componentes centrais: kanban de pedidos com contadores e "carregar mais" por coluna, tabela paginada com ordenação e exportação CSV, modais de filtro por eixo, linha do tempo de envio, mapa/ranking por UF.

---

## 12. Plano de entrega por fases

| Fase | Entrega | Saída (critério) |
|---|---|---|
| 0 Fundação | Monorepo, CI, Postgres, Auth, **tenancy em 3 níveis, motor de templates e status configuráveis**, RLS, tokens de design | Teste de isolamento verde entre projetos **e** organizações; template de pós-pago instanciando um projeto |
| 1 Catálogo | Produtos, planos, vínculos, itens de estoque por plano, estoque e extrato | Saldo sempre igual ao extrato |
| 2 Pedidos e ingestão | Cadastro manual, kanban, histórico, notas, webhook de **um** checkout (Braip) | Duplicado ignorado; sem vínculo vai para "não resolvido" |
| 3 Envio e rastreio | **J&T Express** (cotação, etiqueta, cancelamento, rastreio), eventos normalizados, SLA por UF | Sem regressão por evento atrasado; **homologação J&T concluída** com etiqueta e rastreio reais |
| 4 Cobrança | Gateway, pagamento, inadimplência por prazo, **comissão e estorno** | Ledger confere com pagamentos |
| 5 Devoluções | Ciclo completo, reposição e descarte de estoque | Devolução gera estorno quando aplicável |
| 5b Segunda atividade | Template de uma atividade diferente da pós-paga, no mesmo núcleo | Projeto da nova atividade funciona **sem alterar código do núcleo**; valida a abstração |
| 6 Gestão | Dashboard, rankings, relatório e CSV | Números do painel batem com o CSV do mesmo período |
| 7 Extensões | Webhooks de saída, página de rastreio white-label, avisos | Entregas com log e reenvio |
| 8 IA | Triagem, atendimento, resumo diário | Só leitura por padrão; escrita com aprovação |

Cada fase fecha com `/speckit.analyze` sem pendência crítica e com os testes da seção 7 correspondentes.

---

## 13. Como escrever o sistema (fluxo no Claude Code)

**Estrutura do repositório.**
```
Pulso-Lead/
  .specify/memory/constitution.md
  specs/001-plataforma-pos-pago/{spec.md, clarifications.md, plan.md, tasks.md}
  docs/BLUEPRINT.md                 # este arquivo
  CLAUDE.md
  apps/web/                         # Vite + React
  apps/tracking/                    # Worker público de rastreio
  apps/api/                         # API Node/TS (NestJS ou Fastify): domínio, tenancy, templates
  workers/webhook-ingest/           # Worker de ingestão (.js)
  workers/jobs/                     # Workers BullMQ (rastreio, cobrança, webhooks de saída)
  packages/templates/               # templates de atividade (JSON versionado + schema)
  packages/domain/                  # máquinas de estado puras + testes
  packages/ui/                      # tokens e componentes
  db/{migrations,tests,seed.sql}    # migrations versionadas + testes pgTAP
```

**Passos.**
1. Criar o repositório https://github.com/nicolasrcr/Pulso-Lead, copiar `constitution.md`, `spec.md`, `clarifications.md` e este arquivo.
1b. **Design (em paralelo):** definir as telas e o design system no Claude Design (tema claro, índigo, tokens do Coolors) e exportar o *handoff bundle* para o Claude Code.
2. `specify init` (Spec Kit: https://github.com/github/spec-kit) no repositório.
3. Responder as perguntas abertas do `clarifications.md` e rodar `/speckit.clarify`.
4. `/speckit.plan` informando a stack da seção 4; `/speckit.checklist`; `/speckit.tasks`; `/speckit.analyze`.
5. Instalar o Superpowers (https://github.com/obra/superpowers): `/plugin marketplace add obra/superpowers-marketplace` e `/plugin install superpowers@superpowers-marketplace`. Ele conduz brainstorming, planos curtos, TDD e revisão.
6. Executar fase a fase. **Use um único executor de tarefas** (`/speckit.implement` ou `autonomous-coding`), não os dois.

**Trecho sugerido para o `CLAUDE.md`.**
```
- Dinheiro sempre em centavos inteiros. Nunca float.
- Toda tabela de negócio tem organization_id e project_id (NOT NULL) e RLS; toda mudança de schema vem com teste pgTAP.
- Comportamento por atividade vem de templates (dados versionados), nunca de `if` por tipo de atividade no código.
- A conexão da aplicação usa papel sem BYPASSRLS e define app.user_id e app.project_id por transação.
- Máquinas de estado ficam em packages/domain, puras e testadas antes do código.
- Eventos externos: gravar cru, processar de forma idempotente.
- Código de Cloudflare Worker entregue em arquivo .js (nunca .mjs).
- Mascarar CPF/telefone em UI, logs e contexto de IA.
- Paleta e fontes vêm de tokens (Coolors); nunca valores fixos.
- pt-BR e BRL.
```

**Segredos e ambientes.** `.env.local` fora do Git; chaves do Supabase, do gateway, da transportadora e da Anthropic em variáveis de ambiente do Cloudflare e do Supabase; ambientes separados (dev, staging, produção). Alterações de banco **somente por migrations versionadas**.

---

## 14. Riscos

| Risco | Mitigação |
|---|---|
| Perda alta por roubo e inadimplência (referência: ~26% roubo) | Métrica de primeira classe, alertas por afiliado e UF, regras de bloqueio configuráveis |
| Dependência de checkouts, agregador e transportadoras | Interfaces `CarrierAdapter` e `PaymentProvider`; eventos crus preservados |
| Vazamento de PII | Mascaramento, cifra de CPF, auditoria, RLS testado no CI |
| Escopo grande demais | Fases com saída verificável; Braip primeiro; IA por último |
| Regras inferidas erradas (buckets, prazos) | Marcadas **[PROP]**/**[?]**; validar com um operador real antes da Fase 2 |
| Conformidade do que o cliente vende | Termo de uso e lista de categorias proibidas |
| Generalizar demais e virar no-code | Configuração limitada a módulos, status, campos e automações simples; só generalizar com 2 templates reais |
| Tenant barulhento degradando os demais | Limites por tenant na API e nas filas; teste de carga; opção de banco dedicado |
| Vazamento entre tenants por política mal escrita | RLS em todas as tabelas, papel sem BYPASSRLS, testes de vazamento cruzado no CI |
| Prazo de 8 a 12 semanas, sozinho, para um escopo maior | Corte da seção 3B.5; fases com saída verificável; não cortar testes de isolamento nem a homologação J&T |
| Homologação da J&T depende de terceiros e de credenciais de produção do cliente | Começar a homologação na Fase 3, com folga no cronograma, e testar etiqueta e rastreio reais |
| Dashboard lento ou desatualizado (a dor do cliente) | Agregados por gatilho ou cron, `refreshed_at` visível, alerta de atraso, teste de carga |
| Cota de uso das ferramentas de IA esgotando no meio do projeto | Planejar o consumo; fechar o visual no Claude Design sem refinar pixel; manter a opção de gerar o front pelo Claude Code |

---

## 15. Perguntas ainda abertas (as de maior impacto)

1. Quando e por quem um **Inadimplente vira Frustrado**?
2. O link assinado do afiliado **expira** ou é permanente?
3. ~~Transportadora do v1~~ **RESOLVIDA:** J&T Express Open Platform. **Aberto:** Correios via agregador entra como segunda transportadora?
4. **Gateway de cobrança** (Asaas, Mercado Pago ou Stone) e quando a cobrança é gerada (na entrega?).
5. **Reserva de estoque** no agendamento; pedido sem estoque bloqueia, permite negativo ou entra em fila?
6. Regra exata dos **buckets** e o que dispara "Requer Atenção" e "Reportados".
7. **Fiscal**: NF-e/DC-e automática, manual ou fora do v1? Quem é o emitente?
8. Devolução **parcial** e reembolso: só registrar ou executar no gateway?
9. **Retenção** de dados e anexos; quem pode revelar CPF.
10. Metas de escala (pedidos por dia, projetos, afiliados) para dimensionar fila e custo.
11. **Quais atividades** entram como templates e em que ordem? A segunda valida a abstração.
11b. **Ingestão de webhook:** Worker Cloudflare (D11) ou Supabase Edge Function? O benchmark da referência sugere Edge Function; seus projetos atuais usam os dois. Confirmar o D11.
11c. **Conectores de entrada do v1:** só PayT e Braip ou também B4You e Get Envios? Qual o cliente fundador usa hoje?
11d. Lacunas de contrato e escopo da seção 3B.7 (itens 1 a 5).
12. **Plano comercial do SaaS:** cobrança por módulo, por pedidos/mês ou por projeto? Algum cliente exigirá **banco dedicado**?
13. Um usuário pode pertencer a **várias organizações**? Precisa de SSO?

Lista completa (32 itens) em `specs/001-plataforma-pos-pago/clarifications.md`.

---

## Apêndice A — Catálogos de status (observados)

**Pagamento:** Sem Status · Pago · Pagamento Parcial · Pagamento Pendente · Pagamento Recusado · Expirado.
**Método:** Pix · Boleto · Cartão de Crédito · Transferência Bancária · Outro.
**Envio:** Sem Status · Preparando logística · Preparando · Em trânsito · Rota de Entrega · Devolvido · Enviado · Entregue · Aguardando coleta · Coletado · Reverso Gerado · Reverso pendente · Retornado com Reverso · Pronto p/ retirada · Não entregue · Avariado · Bloqueado · Perdido · Roubado · Retornando · Cancelado · Entrega falhou · Reenviado · Em análise · Desconhecido · Apreendido · Atrasado · Endereço incompleto · Entregue em caixas inteligentes · Não Sincronizado · Etiqueta Expirada/Cancelada.
**Plataforma:** Sem Status · Em Análise · Criado · Roubo · Cancelado · Cancelado sem Custo · Cancelado com Custo · Cobrado · Inadimplente · Concluído · Devolução Concluída · Frustrado.
**Devolução:** Solicitada · Em análise · Aprovada · Rejeitada · Reversa postada · Em reversa · Aguardando conferência · Reembolso pendente · Reembolsada · Finalizada · Concluída · Cancelada.
**Eventos de webhook de saída:** Pedido Criado · Cobrança Atualizada · Pedido Enviado · Atualização de Envio.

## Apêndice B — Telas da referência (para o inventário de UI)

Home (kanban de pedidos), Frustrações, Dashboard, Ranking, Relatório, Devoluções (`/devolucao`), Produto (com abas Planos e Vínculos; plano com Dados, Vínculos, Pré-definição de Comissões e Controle de Estoque), Estoque (Estoque e Extrato), Personalizar (rastreio white-label), Webhooks (entrada e saída), Usuário (lista e cadastro com perfis e grupos), Suporte (botão de suporte), Configurações, Cadastro de Pedido, Link de Agendamento, Filtros por eixo, detalhe do pedido (dados, fiscal, envio, rastreio, comprovantes, notas, pagamento, histórico, eventos de webhook).

## Apêndice C — Fontes

- Plataforma de referência observada em https://app.fivedelivery.com.br/ (navegação autenticada, 2026-11-22).
- Spec Kit: https://github.com/github/spec-kit
- Superpowers: https://github.com/obra/superpowers
- Claude Quickstarts: https://github.com/anthropics/claude-quickstarts
- Coolors: https://coolors.co/
- Conversa de proposta e contrato do cliente fundador (16 a 20/09/2026), base da seção 3B.
- Benchmark do front-end da referência, base da seção 3C: https://claude.ai/artifact/HKcGa5tmi9PJnPJM4YhEEa
- Documentação pública do MCP da referência: https://app.fivedelivery.com.br/docs-mcp
