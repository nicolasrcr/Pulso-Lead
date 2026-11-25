import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { buildApp } from "../src/app";
import { uniq } from "./helpers";

const ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const APP = process.env.TEST_APP_DATABASE_URL;
const run = ADMIN && APP ? describe : describe.skip;
const PASSWORD = "senha-de-teste-123";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pool cujo COMMIT demora: expõe qualquer rota que responde ao cliente antes de a transação confirmar. */
function slowCommit(real: pg.Pool, ms: number): pg.Pool {
  return new Proxy(real, {
    get(t, k) {
      if (k !== "connect") { const v = Reflect.get(t, k, t); return typeof v === "function" ? v.bind(t) : v; } // pool.query interno usaria o connect "lento" sem callback
      return async () => {
        const c = await t.connect();
        return new Proxy(c, { get(ct, ck, cr) {
          if (ck !== "query") return Reflect.get(ct, ck, cr);
          return async (sql: unknown, ...rest: unknown[]) => {
            if (typeof sql === "string" && sql.trim().toLowerCase() === "commit") await sleep(ms);
            return (ct.query as (...a: unknown[]) => unknown).call(ct, sql, ...rest);
          };
        } });
      };
    },
  });
}

run("a resposta só sai depois do COMMIT (leitura imediata enxerga a escrita)", () => {
  let admin: pg.Pool, real: pg.Pool, app: ReturnType<typeof buildApp>;
  let org: string, proj: string;
  const H = (token: string, project?: string) => ({ authorization: `Bearer ${token}`, ...(project ? { "x-project-id": project } : {}) });
  async function user(role: string, project: string | null): Promise<{ id: string; token: string }> {
    const email = uniq("u");
    const reg = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email, name: "U", password: PASSWORD } });
    const token = (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: PASSWORD } })).json().token as string;
    await admin.query("insert into memberships (user_id, organization_id, project_id, role, capabilities, approved_at) values ($1,$2,$3,$4,'{}',now())", [reg.json().id, org, project, role]);
    return { id: reg.json().id as string, token };
  }
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: ADMIN }); real = new pg.Pool({ connectionString: APP });
    app = buildApp({ pool: slowCommit(real, 250), cpfKey: "6".repeat(64) });
    await admin.query("insert into activity_templates (key, version, definition) values ('pos-pago',1,'{}') on conflict do nothing");
    org = (await admin.query("insert into organizations (name, slug) values ('ocb',$1) returning id", [`ocb-${uniq("s")}`])).rows[0].id;
    proj = (await admin.query("insert into projects (organization_id, name, template_key, template_version) values ($1,'CB','pos-pago',1) returning id", [org])).rows[0].id;
  });
  afterAll(async () => { await real.end(); await admin.end(); await app.close(); });

  it("aprovar cadastro: ao receber 204 a aprovação já está confirmada", async () => {
    const boss = await user("project_admin", proj);
    const nu = await user("operator", proj);
    await admin.query("delete from memberships where user_id = $1", [nu.id]);
    const mid = (await app.inject({ method: "POST", url: "/v1/memberships", headers: H(nu.token), payload: { organizationId: org, projectId: proj, role: "operator" } })).json().id as string;
    const ap = await app.inject({ method: "POST", url: `/v1/memberships/${mid}/approve`, headers: H(boss.token), payload: { preset: "gestor_pedidos" } });
    expect(ap.statusCode).toBe(204);
    expect((await admin.query("select approved_at from memberships where id = $1", [mid])).rows[0].approved_at).not.toBeNull();
  });
  it("vínculos e transportadora: ao receber 201 a linha já existe", async () => {
    const boss = await user("project_admin", proj);
    const h = { headers: H(boss.token, proj) };
    const prod = (await app.inject({ method: "POST", url: "/v1/products", ...h, payload: { name: "P" } })).json().id as string;
    const plan = (await app.inject({ method: "POST", url: `/v1/products/${prod}/plans`, ...h, payload: { name: "Pl", priceCents: 1000, commissionRule: { type: "percent", bps: 500 }, bom: [] } }));
    expect(plan.statusCode).toBe(201);
    expect((await admin.query("select 1 from product_plans where id = $1", [plan.json().id])).rows.length).toBe(1);
    const aff = (await app.inject({ method: "POST", url: "/v1/affiliates", ...h, payload: { name: "Af" } })).json().id as string;

    const pl = await app.inject({ method: "POST", url: "/v1/product-links", ...h, payload: { provider: "braip", externalProductId: "X1", planId: plan.json().id } });
    expect(pl.statusCode).toBe(201);
    expect((await admin.query("select 1 from external_product_links where id = $1", [pl.json().id])).rows.length).toBe(1);

    const el = await app.inject({ method: "POST", url: "/v1/affiliate-email-links", ...h, payload: { provider: "braip", email: "a@b.com", affiliateId: aff } });
    expect(el.statusCode).toBe(201);
    expect((await admin.query("select 1 from affiliate_email_links where id = $1", [el.json().id])).rows.length).toBe(1);

    const creds = { customerCode: "C", password: "P", apiAccount: "A", privateKey: "K", env: "homolog", sender: { name: "N", company: "E", postCode: "70000000", taxNumber: "12345678000199", phone: "61999990000", prov: "DF", city: "Brasilia", area: "Asa", street: "Rua", streetNumber: "1" } };
    const ca = await app.inject({ method: "POST", url: "/v1/carriers", ...h, payload: { carrierKey: "jt", credentials: creds } });
    expect(ca.statusCode).toBe(201);
    expect((await admin.query("select 1 from carrier_accounts where id = $1", [ca.json().id])).rows.length).toBe(1);
  });
});
