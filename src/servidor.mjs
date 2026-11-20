// Servidor do Alfa Aberta (molde dos sistemas da casa: porta PORT, /health, processo sem root,
// raiz só leitura). Serve a página, a API REST, o MCP e o login. O cálculo roda num pool de
// threads com o MESMO motor que o navegador usa (public/motor).
// Uso: node src/servidor.mjs   (PORT, BASE_URL, SESSAO_SEGREDO, GOOGLE_CLIENT_ID/_SECRET, ALFA_THREADS)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { OPS } from "./ops.js";
import { tratarMcp, VERSAO } from "./mcp.js";
import { Pool, Tarefas } from "./fila.js";
import { PESOS, ErroPedido } from "./limites.js";
import { criarSessao, lerSessao, chaveApi, lerChaveApi, cookies } from "./sessao.js";
import * as oauth from "./oauth.js";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const TIPOS = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".mp4": "video/mp4" };
const CORPO_MAX = 12 * 1024 * 1024; // CSV de quem entrou vai até 10 MB
const SEGURANCA = { "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "DENY",
  "content-security-policy": "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; media-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" };

const json = (rs, status, corpo, extra = {}) => { rs.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SEGURANCA, ...extra }); rs.end(JSON.stringify(corpo)); };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, mcp-session-id", "access-control-allow-methods": "GET, POST, OPTIONS" };

function quem(rq, env) {
  const auth = rq.headers.authorization?.replace(/^Bearer\s+/i, "");
  const email = lerChaveApi(env.SESSAO_SEGREDO, auth) || lerSessao(env.SESSAO_SEGREDO, cookies(rq.headers.cookie).alfa_sessao);
  if (email) return { dono: email, email, peso: PESOS.logado };
  const ip = rq.headers["cf-connecting-ip"] || String(rq.headers["x-forwarded-for"] || "").split(",")[0].trim() || rq.socket.remoteAddress;
  return { dono: `ip:${ip}`, email: null, peso: PESOS.anonimo };
}

async function lerCorpo(rq) {
  const partes = []; let total = 0;
  for await (const c of rq) { total += c.length; if (total > CORPO_MAX) throw new ErroPedido("corpo grande demais", 413); partes.push(c); }
  if (!total) return {};
  try { return JSON.parse(Buffer.concat(partes).toString()); } catch { throw new ErroPedido("JSON inválido"); }
}

async function estatico(rq, rs) {
  const p = decodeURIComponent(new URL(rq.url, "http://x").pathname);
  const arq = path.normalize(path.join(RAIZ, p.endsWith("/") ? p + "index.html" : p));
  if (!arq.startsWith(RAIZ + path.sep)) return json(rs, 404, { erro: "não encontrado" }); // path.normalize + prefixo: ../ não sai de public/
  try {
    const corpo = await readFile(arq);
    const ext = path.extname(arq);
    rs.writeHead(200, { "content-type": TIPOS[ext] || "application/octet-stream", ...SEGURANCA,
      "cache-control": ext === ".html" ? "no-cache" : ext === ".csv" ? "public, max-age=86400" : "public, max-age=300" });
    rs.end(rq.method === "HEAD" ? undefined : corpo);
  } catch { json(rs, 404, { erro: "não encontrado" }); }
}

export function criarServidor(env = {}, pool = new Pool(+env.ALFA_THREADS || undefined)) {
  const tarefas = new Tarefas(pool);
  const base = (rq) => env.BASE_URL || `https://${rq.headers.host}`;
  const srv = http.createServer(async (rq, rs) => {
    const url = new URL(rq.url, "http://x");
    try {
      if (url.pathname === "/health" || url.pathname === "/saude") { rs.writeHead(200, { "content-type": "text/plain" }); return rs.end("ok"); }
      if (rq.method === "OPTIONS" && (url.pathname.startsWith("/api/") || url.pathname === "/mcp")) { rs.writeHead(204, CORS); return rs.end(); }
      const eu = quem(rq, env);
      const ctx = { ...eu, pool, tarefas, env };

      if (url.pathname === "/mcp") {
        if (rq.method === "GET") return json(rs, 405, { erro: "use POST com JSON-RPC" }, CORS);
        const m = await lerCorpo(rq);
        const r = Array.isArray(m) ? (await Promise.all(m.map((x) => tratarMcp(x, ctx)))).filter(Boolean) : await tratarMcp(m, ctx);
        if (!r || (Array.isArray(r) && !r.length)) { rs.writeHead(202, CORS); return rs.end(); }
        return json(rs, 200, r, CORS);
      }
      if (url.pathname === "/api/eu") return json(rs, 200, { logado: Boolean(eu.email), email: eu.email, limites: eu.peso, login_disponivel: oauth.configurado(env),
        chave_api: eu.email ? chaveApi(env.SESSAO_SEGREDO, eu.email) : null, versao: VERSAO, threads: pool.tamanho }, CORS);
      if (url.pathname === "/api/series" && rq.method === "GET") return json(rs, 200, await OPS[0].fn({}, ctx), { ...CORS, "cache-control": "public, max-age=3600" });
      const tarefa = url.pathname.match(/^\/api\/tarefas\/([\w-]{6,40})$/);
      if (tarefa && rq.method === "GET") return json(rs, 200, await OPS.find((o) => o.nome === "tarefa").fn({ id: tarefa[1] }, ctx), CORS);
      const op = url.pathname.startsWith("/api/") && OPS.find((o) => `/api/${o.nome}` === url.pathname);
      if (op) {
        if (rq.method !== "POST") return json(rs, 405, { erro: "use POST" }, CORS);
        return json(rs, 200, await op.fn(await lerCorpo(rq), ctx), CORS);
      }

      if (url.pathname === "/entrar/google") {
        if (!oauth.configurado(env)) return json(rs, 503, { erro: "login com Google não configurado neste servidor" });
        const { url: destino, cookie } = oauth.iniciar(env, base(rq));
        rs.writeHead(302, { location: destino, "set-cookie": `alfa_oauth=${cookie}; Path=/entrar; HttpOnly; Secure; SameSite=Lax; Max-Age=600` });
        return rs.end();
      }
      if (url.pathname === "/entrar/google/retorno") {
        const [estado, verif] = String(cookies(rq.headers.cookie).alfa_oauth || "").split(".");
        if (!estado || estado !== url.searchParams.get("state")) return json(rs, 400, { erro: "login expirado ou de outra aba; tente de novo" });
        const email = await oauth.identidade(env, base(rq), url.searchParams.get("code") || "", verif);
        rs.writeHead(302, { location: "/#conta", "set-cookie": [`alfa_sessao=${criarSessao(env.SESSAO_SEGREDO, email)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`,
          "alfa_oauth=; Path=/entrar; Max-Age=0"] });
        return rs.end();
      }
      if (url.pathname === "/sair") { rs.writeHead(302, { location: "/", "set-cookie": "alfa_sessao=; Path=/; Max-Age=0" }); return rs.end(); }
      if (rq.method === "GET" || rq.method === "HEAD") return estatico(rq, rs);
      return json(rs, 405, { erro: "método não suportado" });
    } catch (e) {
      if (e instanceof ErroPedido) return json(rs, e.status, { erro: e.message }, CORS);
      console.error("erro no pedido:", url.pathname, e?.message || e);
      if (!rs.headersSent) json(rs, 500, { erro: "erro interno" }, CORS); else rs.end();
    }
  });
  srv.on("close", () => pool.fechar());
  return srv;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const porta = +(process.argv[2] || process.env.PORT || 8080);
  const srv = criarServidor(process.env).listen(porta, () => console.log(`Alfa Aberta em :${porta}`));
  // O k3s manda SIGTERM no rollout: fecha sem cortar pedido em andamento.
  process.on("SIGTERM", () => srv.close(() => process.exit(0)));
}
