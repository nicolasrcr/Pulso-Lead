import { describe, it, expect } from "vitest";
import { withTenant, type Queryable } from "../src/tenant";

function fakeClient() {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const client: Queryable = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
  return { client, calls };
}

describe("withTenant", () => {
  it("abre transação e define app.user_id/app.project_id só para ela (set_config local)", async () => {
    const { client, calls } = fakeClient();
    await withTenant(client, { userId: "u1", projectId: "p1" }, async (c) => { await c.query("select 1"); });
    expect(calls[0]!.sql).toBe("begin");
    expect(calls[1]!.sql).toContain("set_config('app.user_id'");
    expect(calls[1]!.sql).toContain("true"); // is_local
    expect(calls[1]!.params).toEqual(["u1", "p1"]);
    expect(calls.at(-1)!.sql).toBe("commit");
  });
  it("projectId ausente = 'Todos os projetos' (string vazia)", async () => {
    const { client, calls } = fakeClient();
    await withTenant(client, { userId: "u1" }, async () => {});
    expect(calls[1]!.params).toEqual(["u1", ""]);
  });
  it("faz rollback e repropaga o erro", async () => {
    const { client, calls } = fakeClient();
    await expect(withTenant(client, { userId: "u1" }, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(calls.at(-1)!.sql).toBe("rollback");
  });
  it("recusa userId vazio (nunca roda sem identidade)", async () => {
    const { client } = fakeClient();
    await expect(withTenant(client, { userId: "" }, async () => {})).rejects.toThrow();
  });
});
