// Worker público de rastreio (white-label). Sem estado e sem PII: só consulta GET /v1/track/:code da API.
// Variáveis: API_BASE (obrigatória), BRAND_NAME, BRAND_COLOR (hex). Não usa credenciais de nenhum tipo.
const LABELS = {
  aguardando_coleta: "Aguardando coleta", coletado: "Coletado", enviado: "Enviado", em_transito: "Em trânsito",
  rota_entrega: "Saiu para entrega", entregue: "Entregue", entregue_caixa: "Entregue", nao_entregue: "Entrega não realizada",
  entrega_falhou: "Tentativa de entrega falhou", pronto_retirada: "Pronto para retirada", retornando: "Retornando ao remetente",
  devolvido: "Devolvido", preparando_logistica: "Preparando envio", preparando: "Preparando envio", atrasado: "Atrasado",
  avariado: "Avaria registrada", extraviado: "Extraviado", perdido: "Extraviado", cancelado: "Cancelado", etiqueta_cancelada: "Etiqueta cancelada",
};
export const statusLabel = (s) => LABELS[s] ?? (String(s ?? "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) || "Atualizado");
export const safeColor = (c) => (typeof c === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : "#0b5fff");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const fmt = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }); };

const shell = (brand, color, inner) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Rastreio — ${esc(brand)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f6f7f9;color:#14181f}main{max-width:560px;margin:0 auto;padding:24px 16px}
header{border-top:6px solid ${color};background:#fff;padding:16px;border-radius:8px;margin-bottom:16px}h1{font-size:18px;margin:0}
.badge{display:inline-block;margin-top:8px;padding:2px 10px;border-radius:999px;background:${color};color:#fff;font-size:13px}
ol{list-style:none;padding:0;margin:0}li{background:#fff;border-left:4px solid ${color};padding:10px 14px;margin-bottom:8px;border-radius:4px}
small{color:#5b6472}.cur{font-weight:600}</style></head><body><main><header><h1>${esc(brand)}</h1></header>${inner}</main></body></html>`;

export function renderPage(d, { brand = "Rastreio", color } = {}) {
  const c = safeColor(color);
  const hist = [...(d.history ?? [])].sort((a, b) => new Date(a.at) - new Date(b.at));
  const items = hist.map((h, i) => `<li class="${i === hist.length - 1 ? "cur" : ""}">${esc(statusLabel(h.status))}<br><small>${esc(fmt(h.at))}</small></li>`).join("");
  return shell(brand, c, `<section><p>Código <strong>${esc(d.trackingCode)}</strong></p><p class="cur">${esc(statusLabel(d.status))}</p>
<span class="badge">${esc(d.carrier ?? "")}</span></section><ol>${items || "<li><small>Ainda sem movimentações.</small></li>"}</ol>`);
}

const html = (body, status = 200, extra = {}) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow", ...extra } });

export default {
  async fetch(req, env) {
    const code = decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, "").split("/")[0] ?? "");
    const brand = env.BRAND_NAME ?? "Rastreio", color = env.BRAND_COLOR;
    const notFound = () => html(shell(brand, safeColor(color), "<p>Código de rastreio não encontrado.</p>"), 404, { "cache-control": "no-store" });
    if (!/^[A-Za-z0-9-]{4,60}$/.test(code)) return notFound();
    const doFetch = env.fetch ?? fetch;
    let r;
    try { r = await doFetch(`${env.API_BASE}/v1/track/${encodeURIComponent(code)}`, { redirect: "manual" }); }
    catch { return html(shell(brand, safeColor(color), "<p>Serviço indisponível. Tente novamente em instantes.</p>"), 503, { "cache-control": "no-store" }); }
    if (r.status === 404) return notFound();
    if (!r.ok) return html(shell(brand, safeColor(color), "<p>Serviço indisponível. Tente novamente em instantes.</p>"), 502, { "cache-control": "no-store" });
    return html(renderPage(await r.json(), { brand, color }), 200, { "cache-control": "public, max-age=60" });
  },
};
