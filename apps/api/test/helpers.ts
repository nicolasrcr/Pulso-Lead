import { randomUUID } from "node:crypto";

/**
 * E-mail único entre arquivos de teste que rodam em paralelo no mesmo banco.
 * Antes: `${prefixo}-${Date.now()}-${n++}`, que colide quando dois arquivos começam no mesmo milissegundo
 * (n reinicia em cada arquivo). Uma colisão faz o cadastro falhar e o login devolver o usuário de OUTRO arquivo.
 */
export const uniq = (prefix: string) => `${prefix}-${randomUUID()}@t.test`;
