import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { withJobLock } from "../src/job-lock";
import { makePool } from "../src/db";

const APP = process.env.TEST_APP_DATABASE_URL;
const run = APP ? describe : describe.skip;

run("trava de jobs (pg_try_advisory_xact_lock)", () => {
  let pool: pg.Pool;
  beforeAll(() => { pool = new pg.Pool({ connectionString: APP, max: 5 }); });
  afterAll(async () => { await pool.end(); });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("duas execuções simultâneas do mesmo job: só uma roda", async () => {
    let ran = 0;
    const job = () => withJobLock(pool, "teste-a", async () => { ran++; await sleep(150); return "feito"; });
    const [a, b] = await Promise.all([job(), job()]);
    expect(ran).toBe(1);
    expect([a, b].filter((x) => x.ran).length).toBe(1);
    expect([a, b].find((x) => x.ran)!.value).toBe("feito");
  });
  it("jobs com chaves diferentes não se bloqueiam", async () => {
    let ran = 0;
    const j = (k: string) => withJobLock(pool, k, async () => { ran++; await sleep(80); });
    await Promise.all([j("teste-b1"), j("teste-b2")]);
    expect(ran).toBe(2);
  });
  it("libera a trava ao terminar e quando a função lança", async () => {
    await expect(withJobLock(pool, "teste-c", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    const again = await withJobLock(pool, "teste-c", async () => 1);
    expect(again).toEqual({ ran: true, value: 1 });
    const after = await withJobLock(pool, "teste-c", async () => 2);
    expect(after.ran).toBe(true);
  });
  it("não vaza conexão: o pool volta ao tamanho original", async () => {
    await withJobLock(pool, "teste-d", async () => 1);
    expect(pool.idleCount).toBe(pool.totalCount);
  });
});

describe("makePool", () => {
  it("aplica limites seguros por padrão e permite ajustar pelo ambiente", async () => {
    const p = makePool("postgres://u:p@localhost:5/x", {});
    expect(p.options.max).toBe(10);
    expect(p.options.idleTimeoutMillis).toBe(30_000);
    expect(p.options.connectionTimeoutMillis).toBe(5_000);
    expect(p.options.statement_timeout).toBe(30_000);
    expect(p.options.idle_in_transaction_session_timeout).toBe(60_000);
    await p.end();
    const q = makePool("postgres://u:p@localhost:5/x", { PG_POOL_MAX: "25", PG_STATEMENT_TIMEOUT_MS: "5000" });
    expect(q.options.max).toBe(25);
    expect(q.options.statement_timeout).toBe(5000);
    await q.end();
  });
  it("ignora valores inválidos no ambiente", async () => {
    const p = makePool("postgres://u:p@localhost:5/x", { PG_POOL_MAX: "abc", PG_STATEMENT_TIMEOUT_MS: "-1" });
    expect(p.options.max).toBe(10);
    expect(p.options.statement_timeout).toBe(30_000);
    await p.end();
  });
});
