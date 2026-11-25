import { randomUUID } from "node:crypto";

export interface ErrorReport { requestId: string; method: string; url: string; message: string; stack?: string }
export type ErrorReporter = (r: ErrorReport) => void;

const SECRET_QS = /([?&](?:token|secret|key|password)=)[^&]*/gi;
/** Remove segredos de query string antes de logar/reportar. */
export const scrub = (url: string) => url.replace(SECRET_QS, "$1[redigido]");

/**
 * Relato de erros 5xx. Padrão: uma linha JSON no stderr (coletável por qualquer agregador).
 * Para Sentry/Datadog, injete um `ErrorReporter` em `buildApp({ reporter })` — nenhum SDK é exigido.
 */
export const consoleReporter: ErrorReporter = (r) => console.error(JSON.stringify({ level: "error", ...r }));
export const newRequestId = () => randomUUID();
