import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { buildApp } from "../src/app";
import { PRESETS } from "@pulso/domain";

const ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const APP = process.env.TEST_APP_DATABASE_URL;
const run = ADMIN && APP ? describe : describe.skip;

const PASSWORD = "senha-de-teste-123";
let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}@t.test`;

run("API — auth, projetos e RBAC (Postgres real, papel app_user)", () => {
  let admin: pg.Pool, app: ReturnType<typeof buildApp>, pool: pg.Pool;
  let orgA: string, orgB: string, projA1: string, projA2: string, projB1: string;

  async function register(email: string, name = "Fulano") {
    const r = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email, name, password: PASSWORD } });
    return r;
  }
  async function login(email: string, password = PASSWORD) {
    return app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password } });
  }
  async function userWithToken(email = uniq("u")) {
    const reg = await register(email);
    const token = (await login(email)).json().token as string;
    return { id: reg.json().id as string, email, token, h: { authorization: `Bearer ${token}` } };
  }
  async function member(userId: string, org: string, project: string | null, role: string, caps: string[] = []) {
    await admin.query("insert into memberships (user_id, organization_id, project_id, role, capabilities, approved_at) values ($1,$2,$3,$4,$5,now())", [userId, org, project, role, caps]);
  }

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: ADMIN });
    pool = new pg.Pool({ connectionString: APP });
    app = buildApp({ pool, cpfKey: "c".repeat(64) });
    await admin.query("insert into activity_templates (key, version, definition) values ('pos-pago',1,'{}') on conflict do nothing");
    const mk = async (name: string) => (await admin.query("insert into organizations (name, slug) values ($1,$2) returning id", [name, `${name}-${Date.now()}-${n++}`])).rows[0].id as string;
    const mp = async (org: string, name: string) => (await admin.query("insert into projects (organization_id, name, template_key, template_version) values ($1,$2,'pos-pago',1) returning id", [org, name])).rows[0].id as string;
    orgA = await mk("orga"); orgB = await mk("orgb");
    projA1 = await mp(orgA, "A1"); projA2 = await mp(orgA, "A2"); projB1 = await mp(orgB, "B1");
  });
  afterAll(async () => { await pool.end(); await admin.end(); await app.close(); });

  it("registro valida entrada e recusa duplicidade", async () => {
    const email = uniq("reg");
    expect((await register(email)).statusCode).toBe(201);
    expect((await register(email.toUpperCase())).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "invalido", name: "x", password: PASSWORD } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: uniq("w"), name: "x", password: "curta" } })).statusCode).toBe(400);
  });

  it("login: credencial errada e usuário inexistente dão a mesma resposta 401", async () => {
    const email = uniq("lg");
    await register(email);
    const wrong = await login(email, "senha-errada-123");
    const ghost = await login(uniq("ghost"));
    expect(wrong.statusCode).toBe(401);
    expect(ghost.statusCode).toBe(401);
    expect(wrong.json()).toEqual(ghost.json());
  });

  it("/v1/me exige token, nunca devolve hash e logout revoga a sessão", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/me" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: { authorization: "Bearer lixo" } })).statusCode).toBe(401);
    const u = await userWithToken();
    const me = await app.inject({ method: "GET", url: "/v1/me", headers: u.h });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(u.email);
    expect(JSON.stringify(me.json())).not.toMatch(/password|scrypt/i);
    expect((await app.inject({ method: "POST", url: "/v1/auth/logout", headers: u.h })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: u.h })).statusCode).toBe(401);
  });

  it("só org_admin da própria organização cria projeto", async () => {
    const oa = await userWithToken(); await member(oa.id, orgA, null, "org_admin");
    const outsider = await userWithToken(); await member(outsider.id, orgB, null, "org_admin");
    const op = await userWithToken(); await member(op.id, orgA, projA1, "operator");
    const body = { organizationId: orgA, name: "Novo projeto" };
    const ok = await app.inject({ method: "POST", url: "/v1/projects", headers: oa.h, payload: body });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().id).toBeTruthy();
    expect((await app.inject({ method: "POST", url: "/v1/projects", headers: outsider.h, payload: body })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/projects", headers: op.h, payload: body })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/projects", headers: oa.h, payload: { organizationId: orgA } })).statusCode).toBe(400);
  });

  it("cadastro: solicitar → pendente não vê projeto → aprovado vê", async () => {
    const pa = await userWithToken(); await member(pa.id, orgA, projA1, "project_admin");
    const nu = await userWithToken();
    const req = await app.inject({ method: "POST", url: "/v1/memberships", headers: nu.h, payload: { organizationId: orgA, projectId: projA1, role: "operator" } });
    expect(req.statusCode).toBe(201);
    const mid = req.json().id as string;
    expect((await app.inject({ method: "GET", url: "/v1/projects", headers: nu.h })).json().projects).toHaveLength(0);
    const me = (await app.inject({ method: "GET", url: "/v1/me", headers: nu.h })).json();
    expect(me.memberships[0]).toMatchObject({ projectId: projA1, status: "pending" });
    expect((await app.inject({ method: "POST", url: `/v1/memberships/${mid}/approve`, headers: nu.h, payload: {} })).statusCode).toBe(403); // não se auto-aprova
    const ap = await app.inject({ method: "POST", url: `/v1/memberships/${mid}/approve`, headers: pa.h, payload: { preset: "gestor_pedidos" } });
    expect(ap.statusCode).toBe(204);
    const after = (await app.inject({ method: "GET", url: "/v1/projects", headers: nu.h })).json().projects;
    expect(after.map((p: any) => p.id)).toEqual([projA1]);
    const me2 = (await app.inject({ method: "GET", url: "/v1/me", headers: nu.h })).json();
    expect(me2.capabilities[projA1]).toEqual(expect.arrayContaining(PRESETS.gestor_pedidos!));
  });

  it("RBAC no servidor: listar equipe exige users.manage no projeto", async () => {
    const op = await userWithToken(); await member(op.id, orgA, projA1, "operator", ["orders.create"]);
    const paOther = await userWithToken(); await member(paOther.id, orgA, projA2, "project_admin");
    const pa = await userWithToken(); await member(pa.id, orgA, projA1, "project_admin");
    const oa = await userWithToken(); await member(oa.id, orgA, null, "org_admin");
    const url = `/v1/projects/${projA1}/members`;
    expect((await app.inject({ method: "GET", url, headers: op.h })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url, headers: paOther.h })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url, headers: pa.h })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url, headers: oa.h })).statusCode).toBe(200);
    const list = (await app.inject({ method: "GET", url, headers: pa.h })).json().members;
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(list)).not.toMatch(/password|scrypt/i);
  });

  it("x-project-id de projeto inacessível é 403, nunca lista vazia silenciosa", async () => {
    const op = await userWithToken(); await member(op.id, orgA, projA1, "operator");
    expect((await app.inject({ method: "GET", url: "/v1/projects", headers: { ...op.h, "x-project-id": projA1 } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/projects", headers: { ...op.h, "x-project-id": projB1 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/projects", headers: { ...op.h, "x-project-id": "nao-e-uuid" } })).statusCode).toBe(400);
  });

  it("anti-escalada: project_admin não aprova papel igual/acima; capability desconhecida é 400", async () => {
    const pa = await userWithToken(); await member(pa.id, orgA, projA1, "project_admin");
    const nu = await userWithToken();
    const m = await admin.query("insert into memberships (user_id, organization_id, project_id, role) values ($1,$2,$3,'project_admin') returning id", [nu.id, orgA, projA1]);
    expect((await app.inject({ method: "POST", url: `/v1/memberships/${m.rows[0].id}/approve`, headers: pa.h, payload: {} })).statusCode).toBe(403);
    const nu2 = await userWithToken();
    const req = await app.inject({ method: "POST", url: "/v1/memberships", headers: nu2.h, payload: { organizationId: orgA, projectId: projA1, role: "operator" } });
    const bad = await app.inject({ method: "POST", url: `/v1/memberships/${req.json().id}/approve`, headers: pa.h, payload: { capabilities: ["root.everything"] } });
    expect(bad.statusCode).toBe(400);
  });

  it("todos os presets são aceitos pelo banco (TS e CHECK do SQL em sincronia)", async () => {
    const pa = await userWithToken(); await member(pa.id, orgA, projA1, "project_admin");
    for (const preset of Object.keys(PRESETS)) {
      const nu = await userWithToken();
      const req = await app.inject({ method: "POST", url: "/v1/memberships", headers: nu.h, payload: { organizationId: orgA, projectId: projA1, role: "operator" } });
      const ap = await app.inject({ method: "POST", url: `/v1/memberships/${req.json().id}/approve`, headers: pa.h, payload: { preset } });
      expect(ap.statusCode, preset).toBe(204);
    }
  });

  it("rejeitar remove o pedido pendente; operador não rejeita", async () => {
    const pa = await userWithToken(); await member(pa.id, orgA, projA1, "project_admin");
    const nu = await userWithToken();
    const req = await app.inject({ method: "POST", url: "/v1/memberships", headers: nu.h, payload: { organizationId: orgA, projectId: projA1, role: "affiliate" } });
    const id = req.json().id;
    const op = await userWithToken(); await member(op.id, orgA, projA1, "operator");
    expect((await app.inject({ method: "POST", url: `/v1/memberships/${id}/reject`, headers: op.h })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/memberships/${id}/reject`, headers: pa.h })).statusCode).toBe(204);
    expect((await admin.query("select count(*)::int c from memberships where id = $1", [id])).rows[0].c).toBe(0);
  });
});
