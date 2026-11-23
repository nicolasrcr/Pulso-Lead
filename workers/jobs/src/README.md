# workers/jobs

Workers BullMQ (Fase 3 em diante): rastreio J&T com retry, job de inadimplência (`isOverdue` do domínio, prazo do projeto),
reenvio de rastreio à plataforma de venda (`orders.tracking_synced`), entrega de webhooks de saída com retry exponencial,
refresh dos agregados `dash_daily`.
Cada job é idempotente e testado antes do código. Ainda não implementado.
