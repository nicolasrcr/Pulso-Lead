import { JtAdapter, fetchTransport, type JtTransport } from "@pulso/carriers";
import type { CarrierAdapter } from "@pulso/domain";
import type { Queryable } from "./tenant.ts";
import type { SecretBox } from "./webhooks/secret-box.ts";

export type CarrierFactory = (c: Queryable, projectId: string, carrierAccountId?: string | null) => Promise<{ adapter: CarrierAdapter; accountId: string } | null>;

/** Monta o adaptador a partir das credenciais seladas da conta (nunca em claro no banco). */
export function makeCarrierFactory(box: SecretBox, opts: { labelBaseUrl: string; transport?: JtTransport }): CarrierFactory {
  return async (c, projectId, accountId) => {
    const row = (await c.query(
      `select id, carrier_key, credentials_sealed from carrier_accounts
        where project_id = $1 and enabled and credentials_sealed is not null and ($2::uuid is null or id = $2)
        order by is_default desc, created_at limit 1`, [projectId, accountId ?? null])).rows[0] as { id: string; carrier_key: string; credentials_sealed: string } | undefined;
    if (!row || row.carrier_key !== "jt") return null;
    const cfg = JSON.parse(box.open(row.credentials_sealed)) as { customerCode: string; password: string; apiAccount: string; privateKey: string; env: "homolog" | "production"; sender: ConstructorParameters<typeof JtAdapter>[0]["sender"] };
    return {
      accountId: row.id,
      adapter: new JtAdapter({
        credentials: { customerCode: cfg.customerCode, password: cfg.password, apiAccount: cfg.apiAccount, privateKey: cfg.privateKey },
        sender: cfg.sender, env: cfg.env, transport: opts.transport ?? fetchTransport, labelBaseUrl: opts.labelBaseUrl,
        resolveTxId: async (code) => ((await c.query("select 'PL-' || id::text as t from orders where tracking_code = $1 and project_id = $2", [code, projectId])).rows[0] as { t: string } | undefined)?.t,
      }),
    };
  };
}
