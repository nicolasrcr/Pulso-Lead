# Constituição do Projeto — Plataforma de Operação Pós-Paga

Versão 1.0 · 2026-11-22

Princípios inegociáveis. Toda spec, plano e tarefa deve ser consistente com eles; `/speckit.analyze` deve tratar qualquer violação como CRÍTICA.

## I. Isolamento multi-tenant primeiro
- Todo dado de negócio pertence a um **Projeto** (tenant operacional) dentro de uma **Organização**.
- O isolamento é imposto na camada de dados (políticas por linha), nunca apenas na aplicação.
- Existe um papel de **Administrador Global** que enxerga todos os projetos de uma organização.

## II. Ingestão idempotente e rastreável
- Todo evento externo (webhook de checkout, de pagamento ou de transportadora) é gravado cru antes de ser processado.
- Reentrega do mesmo evento nunca duplica pedido, pagamento ou baixa de estoque.
- Resposta ao emissor é rápida; o processamento é assíncrono com retentativa e fila de falhas visível ao operador.

## III. Máquina de estados explícita
- Pedido tem três eixos de status independentes (plataforma, envio, pagamento). Cada transição é permitida por uma tabela declarada, com origem do evento (sistema, webhook, usuário).
- Buckets de tela (kanban) são **derivados**, nunca gravados.
- Testes cobrem cada transição válida e as inválidas mais prováveis, antes da implementação.

## IV. Histórico e notas imutáveis
- Toda mudança de status, edição de pedido e visualização de dado pessoal sensível gera registro de auditoria append-only.
- Notas de pedido são imutáveis: correções são novas notas.

## V. Dinheiro e estoque corretos
- Valores monetários em centavos inteiros. Nunca ponto flutuante.
- Baixa de estoque é uma movimentação registrada, atômica e reversível por movimentação inversa; saldo é derivado do extrato.

## VI. Privacidade por padrão (LGPD)
- CPF, telefone e endereço são mascarados por padrão; revelar exige permissão e gera auditoria.
- Credenciais de integração (URLs de webhook, tokens) são tratadas como segredos e rotacionáveis.
- Minimização: só coletar o dado necessário para envio, cobrança e fiscal.

## VII. Qualidade de interface
- Design baseado em tokens; acessibilidade WCAG 2.1 AA; estados de carregamento, vazio e erro em toda tela.
- Paleta e tipografia escolhidas a partir do Coolors (https://coolors.co/), registradas como tokens.

## VIII. Observabilidade
- Erros, filas e integrações têm métricas e alertas. Dashboard gerencial nunca exibe número sem data de atualização.

## Governança
- Mudança nesta constituição exige justificativa registrada e revisão de todas as specs abertas.
