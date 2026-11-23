# Ambiguidades para `/speckit.clarify`

Cada item traz a pergunta, por que importa e uma sugestão padrão. Responda ou ajuste antes de `/speckit.plan`.

## Negócio
1. **Quem é o cliente pagante da plataforma?** Produtor/dono do projeto, com afiliados como usuários. Sugestão: plano por projeto com mensalidade.
2. ~~Administrador Global~~ **PREMISSA ADOTADA (2026-11-22):** um papel por organização, com visão de todos os projetos. Reconfirmar com o cliente.
3. ~~Atribuição do afiliado~~ **RESOLVIDA (2026-11-22):** parâmetro assinado no link gerado.
4. ~~Comissão~~ **RESOLVIDA (2026-11-22):** percentual ou fixo, configurável por plano; devida na confirmação do pagamento, com estorno em devolução.
5. **Prazos de cobrança — PARCIAL (2026-11-22):** Inadimplente em prazo configurável por projeto, padrão 15 dias. **Ainda aberto:** quando e por quem um Inadimplente vira Frustrado.
6. **Quais réguas de cobrança existem (WhatsApp, e-mail, ligação)?** Existe fluxo de cobrança automática ou só manual?
7. **Papel Jurídico:** que ações tem (notas, bloqueio, notificação extrajudicial)? Não foi observado nenhum fluxo.

## Pedido e estoque
8. **Reserva de estoque no agendamento:** só baixa na liberação, mas há reserva? Sugestão: reserva leve no agendamento, baixa na liberação.
9. **Pedido sem estoque:** bloqueia a liberação, permite negativo ou entra em fila?
10. **Edição de pedido após envio:** quais campos são editáveis e por quem?
11. **Retirar nos Correios** é uma modalidade de entrega ou um status? Impacta o catálogo.
12. **Regra exata dos buckets:** quais combinações dos três eixos compõem cada coluna, incluindo "Requer Atenção" e "Reportados"?
13. **"Requer Atenção"**: que condições disparam (atraso, endereço incompleto, tentativa falha)?

## Envio e integrações
14. **Fonte do rastreio:** agregador de etiquetas, API direta dos Correios, ou ambos? Qual a política de frequência?
15. **Transportadoras no v1:** apenas Correios ou também J&T, Jadlog?
16. **"Não Sincronizado":** qual a causa típica e qual a ação do operador?
17. **Quais eventos de cada checkout** (criado, pago, reembolsado, chargeback) são consumidos e como mapeiam para os status?
18. **Webhook de saída:** assinatura (HMAC), política de retentativa, timeout e log de entregas.
19. **Credenciais de entrada:** a URL do webhook é o único segredo? Há rotação?

## Devoluções
20. **A devolução reabre estoque?** Regra para devolvida x descartada e quem confere.
21. **Reembolso:** o sistema só registra ou também executa pelo gateway?
22. **Devolução parcial** (parte dos itens do plano) é permitida?

## Fiscal
23. **Emissão de NF-e/DC-e:** automática no envio, manual ou fora do escopo no v1? Quem é o emitente (produtor, afiliado)?

## Permissões
24. **Matriz final:** os nove grupos observados são o modelo desejado ou vamos simplificar para papéis fixos mais exceções?
25. **Produtos privados:** quem os atribui a quem? Existe lista de acesso por usuário?
26. **Visão "parcial" do dashboard:** exatamente quais indicadores aparecem para dados próprios?

## Dados e conformidade
27. **Retenção:** por quanto tempo guardar pedidos, anexos de comprovante (imagem e áudio) e logs de auditoria?
28. **Mascaramento:** quem pode revelar CPF e telefone completos e em quais telas?
29. **Categorias de produto proibidas** na plataforma (ex.: itens regulados)? Há termo de uso a aceitar no cadastro?

## Produto
30. **Domínio e marca:** subdomínio por projeto ou domínio personalizado do cliente? Quem gerencia o certificado?
31. **Idioma e moeda:** apenas pt-BR e BRL no v1?
32. **Metas de escala:** pedidos por dia, número de projetos e de afiliados no primeiro ano (define fila, partição e custo).
