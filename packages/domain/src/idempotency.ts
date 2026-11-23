export function idempotencyKey(i: { projectId: string; provider: string; eventId: string }): string {
  if (!i.projectId || !i.provider || !i.eventId) throw new Error("projectId, provider e eventId são obrigatórios");
  return `${i.projectId}:${i.provider}:${i.eventId}`;
}

/** Em produção equivale a um UNIQUE (project_id, provider, event_id) com INSERT ... ON CONFLICT DO NOTHING. */
export class IdempotencyStore {
  private keys = new Set<string>();
  claim(key: string): boolean {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
  }
}
