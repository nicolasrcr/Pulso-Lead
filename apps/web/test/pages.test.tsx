import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import type { ApiClient, Me } from "../src/api";
import { Afiliados } from "../src/pages/Afiliados";
import { Backoffice } from "../src/pages/Backoffice";
import { Catalogo } from "../src/pages/Catalogo";
import { Equipe } from "../src/pages/Equipe";
import { Estoque } from "../src/pages/Estoque";
import { Exportar } from "../src/pages/Exportar";
import { Importar } from "../src/pages/Importar";
import { Painel } from "../src/pages/Painel";
import { Pedidos } from "../src/pages/Pedidos";
import { Transportadora } from "../src/pages/Transportadora";
import { Vendas } from "../src/pages/Vendas";
import { Webhooks } from "../src/pages/Webhooks";
import { Login } from "../src/App";

// API que nunca resolve: o SSR renderiza o estado inicial (carregando) sem rede.
const api = new Proxy({}, { get: () => () => new Promise(() => {}) }) as unknown as ApiClient;
const me = { user: { id: "u", email: "a@b.c", name: "A", platformAdmin: true }, memberships: [], projects: [], capabilities: {} } as Me;
const props = { api, me, projectId: "p1", caps: ["orders.create", "orders.edit", "products.manage", "users.manage", "dashboard.full"] };

describe("telas (SSR smoke)", () => {
  const cases: [string, () => string, string][] = [
    ["Painel", () => renderToString(<Painel api={api} projectId="p1" caps={props.caps} />), "Kanban"],
    ["Pedidos", () => renderToString(<Pedidos {...props} />), "Novo pedido"],
    ["Catálogo", () => renderToString(<Catalogo {...props} />), "Novo plano"],
    ["Estoque", () => renderToString(<Estoque {...props} />), "Novo item"],
    ["Afiliados", () => renderToString(<Afiliados {...props} />), "Link de checkout"],
    ["Vendas", () => renderToString(<Vendas {...props} />), "Conectores de venda"],
    ["Transportadora", () => renderToString(<Transportadora {...props} />), "Nova conta J&amp;T"],
    ["Webhooks", () => renderToString(<Webhooks {...props} />), "Novo webhook"],
    ["Equipe", () => renderToString(<Equipe {...props} />), "Equipe"],
    ["Importar", () => renderToString(<Importar {...props} />), "id_externo"],
    ["Exportar", () => renderToString(<Exportar {...props} />), "Sem CPF; telefone mascarado."],
    ["Backoffice", () => renderToString(<Backoffice {...props} />), "Organizações"],
    ["Login", () => renderToString(<Login api={api} onDone={() => {}} />), "Entrar"],
  ];
  for (const [name, render, text] of cases) it(`${name} renderiza`, () => expect(render()).toContain(text));

  it("sem permissão, Catálogo não mostra formulários", () => {
    const html = renderToString(<Catalogo {...props} caps={[]} />);
    expect(html).not.toContain("Novo plano");
  });
  it("Transportadora nunca renderiza segredo preenchido e usa campos de senha", () => {
    const html = renderToString(<Transportadora {...props} />);
    expect(html.match(/type="password"/g)?.length).toBe(2);
  });
});
