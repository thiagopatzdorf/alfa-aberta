import { test, after } from "node:test";
import assert from "node:assert/strict";
import { criarServidor } from "../src/servidor.mjs";
import { Pool } from "../src/fila.js";
import { chaveApi, criarSessao, lerSessao, lerChaveApi } from "../src/sessao.js";

const env = { SESSAO_SEGREDO: "segredo-de-teste" };
const srv = criarServidor(env, new Pool(2)).listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
after(() => srv.close());

const post = (p, corpo, h = {}) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(corpo) });
const esperarTarefa = async (id, h = {}) => { for (;;) { const t = await (await fetch(`${base}/api/tarefas/${id}`, { headers: h })).json(); if (t.estado === "pronta" || t.estado === "erro") return t; await new Promise((r) => setTimeout(r, 100)); } };
const EST = { versao: 1, direcao: "ambas", entrada: [{ op: "cruza_acima", a: { ind: "ema", p: [12] }, b: { ind: "sma", p: [50] } }], saida: { atr_p: 14, stop_atr: 2, alvo_atr: 4 } };

test("evolucao_no_servidor_da_o_mesmo_banco_que_o_motor_direto_com_a_mesma_semente", async () => {
  const pedido = { populacao: 20, geracoes: 3, ilhas: 2, semente: 7 };
  const { tarefa } = await (await post("/api/evoluir", { serie: "BTCUSDT-1d", pedido })).json();
  const t = await esperarTarefa(tarefa);
  assert.equal(t.estado, "pronta", t.erro);
  const { executar } = await import("../src/thread.mjs");
  const ped = { ...pedido, custo_pct: 0.1, slippage_pct: 0.02 };
  const ilhas = [0, 1].map((i) => executar({ tipo: "ilha", serie: "BTCUSDT-1d", pedido: ped, ilha: i }));
  const direto = executar({ tipo: "fechar", serie: "BTCUSDT-1d", pedido: ped, ilhas });
  assert.deepEqual(t.resultado.banco.map((b) => b.id), direto.banco.map((b) => b.id));
  assert.ok(t.resultado.banco.length > 0);
});

test("anonimo_nao_passa_do_teto_de_backtests_e_recebe_403_explicando", async () => {
  const r = await post("/api/evoluir", { serie: "BTCUSDT-4h", pedido: { populacao: 2000, geracoes: 100 } });
  assert.equal(r.status, 403);
  assert.match((await r.json()).erro, /navegador/);
});

test("logado_com_chave_de_api_tem_teto_maior", async () => {
  const h = { authorization: `Bearer ${chaveApi(env.SESSAO_SEGREDO, "a@b.c")}` };
  const eu = await (await fetch(`${base}/api/eu`, { headers: h })).json();
  assert.equal(eu.logado, true);
  assert.ok(eu.limites.avaliacoes_max > 12000);
  const r = await post("/api/evoluir", { serie: "BTCUSDT-1d", pedido: { populacao: 200, geracoes: 99, ilhas: 1 } }, h);
  assert.equal(r.status, 200);
});

test("chave_ou_sessao_adulterada_vira_anonimo", () => {
  const k = chaveApi("s", "a@b.c");
  assert.equal(lerChaveApi("s", k), "a@b.c");
  assert.equal(lerChaveApi("s", k.slice(0, -2) + "xx"), null);
  assert.equal(lerChaveApi("outro", k), null);
  const s = criarSessao("s", "a@b.c", 0);
  assert.equal(lerSessao("s", s, 1000), "a@b.c");
  assert.equal(lerSessao("s", s, 31 * 864e5), null); // expirada
});

test("serie_desconhecida_e_estrategia_invalida_dao_400_sem_derrubar_nada", async () => {
  assert.equal((await post("/api/evoluir", { serie: "../../etc/passwd" })).status, 400);
  assert.equal((await post("/api/backtest", { serie: "BTCUSDT-1d", estrategia: { versao: 1, direcao: "x" } })).status, 400);
  assert.equal((await fetch(`${base}/..%2f..%2fsrc/servidor.mjs`)).status, 404);
});

test("mcp_lista_ferramentas_e_faz_backtest_pelo_mesmo_caminho_da_api", async () => {
  const lista = await (await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" })).json();
  const nomes = lista.result.tools.map((t) => t.name);
  for (const n of ["alfa_series", "alfa_evoluir", "alfa_atestar", "alfa_backtest", "alfa_tarefa", "alfa_exportar"]) assert.ok(nomes.includes(n), n);
  const r = await (await post("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "alfa_backtest", arguments: { serie: "BTCUSDT-1d", estrategia: EST } } })).json();
  const viaMcp = JSON.parse(r.result.content[0].text);
  const viaApi = await (await post("/api/backtest", { serie: "BTCUSDT-1d", estrategia: EST })).json();
  assert.deepEqual(viaMcp.metricas, viaApi.metricas);
  assert.ok(viaApi.metricas.operacoes > 10);
});

test("mcp_atestar_espera_e_devolve_nota", async () => {
  const r = await (await post("/mcp", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "alfa_atestar", arguments: { serie: "BTCUSDT-1d", estrategia: EST, esperar_segundos: 60 } } })).json();
  const t = JSON.parse(r.result.content[0].text);
  assert.equal(t.estado, "pronta", t.erro);
  assert.match(t.resultado.nota, /^[A-E]$/);
  assert.ok(t.resultado.testes.length >= 6);
});

test("pagina_e_dados_sao_servidos_com_cabecalhos_de_seguranca", async () => {
  const r = await fetch(`${base}/dados/indice.json`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});

test("login_google_desligado_por_configuracao_some_mesmo_com_credenciais", async () => {
  const { configurado } = await import("../src/oauth.js");
  const cred = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s", SESSAO_SEGREDO: "x" };
  assert.equal(configurado(cred), true);
  assert.equal(configurado({ ...cred, LOGIN_GOOGLE: "desligado" }), false);
  assert.equal(configurado({ GOOGLE_CLIENT_ID: "id", SESSAO_SEGREDO: "x" }), false);
});
