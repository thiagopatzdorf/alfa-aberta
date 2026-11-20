// Exportadores. O Python é o de referência: roda aqui e tem de dar as MESMAS operações do motor JS.
// Pine, MQL5 e NTSL não compilam aqui: o teste cobra estrutura, valores e determinismo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lerCsv } from "../public/motor/dados.js";
import { backtest } from "../public/motor/backtest.js";
import { exportar, FORMATOS } from "../public/motor/exportar.js";
import { CATALOGO } from "../public/motor/indicadores.js";
import { validar } from "../public/motor/estrategia.js";
import { criarAcaso } from "../public/motor/acaso.js";
import { sortearEstrategia, normalizar, PADRAO } from "../public/motor/gerador.js";

const DADOS = fileURLToPath(new URL("../public/dados/", import.meta.url));
const series = {};
const serie = (nome) => (series[nome] ||= lerCsv(readFileSync(join(DADOS, nome), "utf8"), nome));

// Estratégias escritas à mão: juntas cobrem todo indicador do CATALOGO, todo operador, as três
// direções (com o espelho de "ambas"), stop + alvo, barras_max e inverter.
const MAO = [
  { arq: "BTCUSDT-4h.csv", est: { versao: 1, direcao: "ambas", entrada: [
    { op: "cruza_acima", a: { ind: "ema", p: [12] }, b: { ind: "sma", p: [50] } },
    { op: ">", a: { ind: "rsi", p: [14] }, b: { k: 55 } }],
  saida: { stop_atr: 2, alvo_atr: 4, atr_p: 14, inverter: true } } },
  { arq: "BTCUSDT-4h.csv", est: { versao: 1, direcao: "compra", entrada: [
    { op: "cruza_abaixo", a: { ind: "preco", campo: "fechamento" }, b: { ind: "bb_inf", p: [20, 2] } },
    { op: "<", a: { ind: "estoc", p: [14] }, b: { k: 20 } }],
  saida: { stop_atr: 3, barras_max: 10, atr_p: 10 } } },
  { arq: "BTCUSDT-4h.csv", est: { versao: 1, direcao: "venda", entrada: [
    { op: "cruza_abaixo", a: { ind: "preco", campo: "fechamento" }, b: { ind: "minima_n", p: [20] } },
    { op: "<", a: { ind: "cci", p: [20] }, b: { k: 50 } }],
  saida: { alvo_atr: 3, barras_max: 30, atr_p: 20 } } },
  { arq: "BTCUSDT-1d.csv", est: { versao: 1, direcao: "ambas", entrada: [
    { op: "cruza_acima", a: { ind: "macd", p: [12, 26] }, b: { k: 0 } },
    { op: ">", a: { ind: "roc", p: [10] }, b: { k: 2 } },
    { op: ">", a: { ind: "preco", campo: "maxima" }, b: { ind: "maxima_n", p: [10] } }],
  saida: { stop_atr: 1.5, alvo_atr: 2.5, barras_max: 15, atr_p: 7 } } },
  { arq: "BTCUSDT-4h.csv", est: { versao: 1, direcao: "ambas", entrada: [
    { op: "<", a: { ind: "preco", campo: "abertura" }, b: { ind: "bb_sup", p: [30, 1.5] } },
    { op: "cruza_abaixo", a: { ind: "rsi", p: [7] }, b: { k: 70 } }],
  saida: { stop_atr: 2, barras_max: 40, atr_p: 14, inverter: true } } },
];

// Do gerador, com semente: entra o que a evolução de verdade produz (constantes quebradas, bb com k real).
function sorteadas(arq, semente, quantas) {
  const A = criarAcaso(semente), s = serie(arq), cfg = { ...PADRAO, direcao: "livre" }, out = [];
  while (out.length < quantas) {
    const est = normalizar(sortearEstrategia(A, s, cfg));
    try { validar(est); out.push({ arq, est }); } catch { /* sorteio inválido: o gerador também descarta */ }
  }
  return out;
}

const pasta = mkdtempSync(join(tmpdir(), "alfa-exportar-"));
process.on("exit", () => rmSync(pasta, { recursive: true, force: true }));

function rodarPython(est, arq, custo, slip, janela = {}) {
  const { codigo } = exportar(est, "python", { custo_pct: custo, slippage_pct: slip });
  const f = join(pasta, `e${Math.random().toString(36).slice(2)}.py`);
  writeFileSync(f, codigo);
  const extra = janela.fim !== undefined ? ["--ini", String(janela.ini), "--fim", String(janela.fim)] : [];
  const saida = execFileSync("python3", [f, join(DADOS, arq), "--custo", String(custo), "--slippage", String(slip), ...extra],
    { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, maxBuffer: 64 << 20 });
  return JSON.parse(saida);
}

function conferirParidade({ arq, est }, custo = 0.05, slip = 0.02, janela = {}) {
  const js = backtest(serie(arq), est, { custo_pct: custo, slippage_pct: slip, ...janela });
  const py = rodarPython(est, arq, custo, slip, janela);
  const rotulo = JSON.stringify(est);
  assert.equal(py.metricas.operacoes, js.trades.length, `número de operações difere: ${rotulo}`);
  js.trades.forEach((t, k) => {
    const p = py.operacoes[k];
    assert.deepEqual([p.iEnt, p.iSai, p.dir, p.motivo], [t.iEnt, t.iSai, t.dir, t.motivo], `operação ${k} difere: ${rotulo}`);
    assert.ok(Math.abs(p.ret - t.ret) < 1e-9, `retorno da operação ${k} difere: ${p.ret} x ${t.ret}`);
  });
  const lucroJs = js.trades.reduce((a, t) => a + t.ret, 0);
  assert.ok(Math.abs(py.metricas.lucro_pct_exato - lucroJs) < 1e-6, `lucro difere: ${py.metricas.lucro_pct_exato} x ${lucroJs}`);
  assert.equal(py.metricas.lucro_pct, js.metricas.lucro_pct);
  return js;
}

test("estrategias_de_paridade_cobrem_todo_indicador_operador_direcao_e_saida", () => {
  const ests = MAO.map((x) => x.est), ops = ests.flatMap((e) => e.entrada).flatMap((c) => [c.a, c.b]);
  for (const ind of Object.keys(CATALOGO)) assert.ok(ops.some((o) => o.ind === ind), `indicador sem caso de paridade: ${ind}`);
  for (const op of [">", "<", "cruza_acima", "cruza_abaixo"]) assert.ok(ests.some((e) => e.entrada.some((c) => c.op === op)), `operador sem caso: ${op}`);
  for (const d of ["ambas", "compra", "venda"]) assert.ok(ests.some((e) => e.direcao === d), `direção sem caso: ${d}`);
  assert.ok(ests.some((e) => e.saida.stop_atr && e.saida.alvo_atr));
  assert.ok(ests.some((e) => e.saida.barras_max));
  assert.ok(ests.some((e) => e.saida.inverter));
  assert.ok(MAO.some((x) => x.arq === "BTCUSDT-1d.csv"));
});

test("python_exportado_gera_as_mesmas_operacoes_que_o_motor_js", () => {
  const motivos = new Set();
  for (const caso of MAO) {
    // Poucas operações provam pouco: cada caso escrito à mão precisa exercitar o motor de verdade.
    assert.ok(conferirParidade(caso).trades.length >= 20, `estratégia com menos de 20 operações prova pouco: ${JSON.stringify(caso.est)}`);
    for (const t of backtest(serie(caso.arq), caso.est).trades) motivos.add(t.motivo);
  }
  // Janela parcial (como a do fora da amostra) com posição aberta no fim: fecha no fechamento da última barra.
  const janela = conferirParidade(MAO[0], 0.05, 0.02, { ini: 1000, fim: 5000 });
  assert.equal(janela.trades.at(-1).motivo, "fim");
  motivos.add("fim");
  // As cinco saídas do motor aparecem pelo menos uma vez na paridade.
  for (const m of ["stop", "alvo", "tempo", "inversao", "fim"]) assert.ok(motivos.has(m), `saída "${m}" não exercitada`);
});

test("python_exportado_bate_com_o_motor_em_estrategias_sorteadas_pelo_gerador", () => {
  const casos = [...sorteadas("BTCUSDT-4h.csv", 7, 4), ...sorteadas("BTCUSDT-1d.csv", 2026, 2)];
  let operacoes = 0;
  for (const caso of casos) operacoes += conferirParidade(caso).trades.length;
  assert.ok(operacoes > 0);
});

test("python_exportado_respeita_custo_e_slippage_diferentes_do_padrao", () => {
  conferirParidade(MAO[0], 0, 0);
  conferirParidade(MAO[3], 0.1, 0.05);
});

const PLATAFORMAS = ["pine", "mql5", "ntsl"];

test("mesma_estrategia_gera_arquivo_identico_byte_a_byte_em_todo_formato", () => {
  for (const f of Object.keys(FORMATOS)) for (const { est } of MAO) {
    const a = exportar(structuredClone(est), f), b = exportar(structuredClone(est), f);
    assert.equal(a.codigo, b.codigo, f);
    assert.equal(a.arquivo, b.arquivo);
    assert.ok(a.arquivo.endsWith(FORMATOS[f].extensao));
  }
});

test("todo_arquivo_comeca_com_cabecalho_mit_descricao_e_json_da_estrategia", () => {
  const est = MAO[3].est, json = JSON.stringify(est);
  for (const f of Object.keys(FORMATOS)) {
    const { codigo } = exportar(est, f);
    const topo = codigo.split("\n").slice(0, 15).join("\n");
    assert.match(topo, /Alfa Aberta \(licença MIT\)/, f);
    assert.ok(topo.includes(json), `${f} sem o JSON da estratégia no cabeçalho`);
    assert.ok(topo.includes("MACD(12, 26)"), `${f} sem a descrição`);
  }
});

test("pine_tem_strategy_v6_entradas_saidas_e_os_valores_da_estrategia", () => {
  const { codigo, avisos } = exportar(MAO[3].est, "pine", { custo_pct: 0.07 });
  assert.ok(codigo.startsWith("//@version=6\n"));
  assert.match(codigo, /strategy\("Alfa Aberta [0-9a-z]+", overlay = true, process_orders_on_close = false/);
  assert.match(codigo, /commission_value = 0\.07/);
  for (const s of ["input.int(7, \"Período do ATR\")", "input.float(1.5,", "input.float(2.5,", "input.int(15,", "input.bool(false,",
    "f_ema(close, 12) - f_ema(close, 26)", "f_roc(close, 10)", "f_min_ant(low, 10)", "f_cruza_acima(ind1, 0.0)",
    "f_cruza_abaixo(ind1, 0.0)", "f_menor(ind2, -2.0)", "strategy.entry(\"Compra\", strategy.long)",
    "strategy.entry(\"Venda\", strategy.short)", "loss = ticks_stop, profit = ticks_alvo", "immediately = true"])
    assert.ok(codigo.includes(s), `Pine sem: ${s}`);
  assert.ok(!/ta\.(ema|rsi|atr|rma)\(/.test(codigo), "Pine não pode usar ta.ema/rsi/atr: a semente difere da nossa");
  assert.ok(avisos.some((a) => /não compilado/.test(a)));
  assert.ok(avisos.some((a) => /mesma barra/.test(a)));
});

test("pine_so_compra_nao_gera_sinal_de_venda_e_sem_alvo_nao_passa_profit", () => {
  const { codigo } = exportar(MAO[1].est, "pine");
  assert.match(codigo, /bool venda = false/);
  assert.match(codigo, /strategy\.exit\("Saída compra", "Compra", loss = ticks_stop\)/);
});

test("mql5_tem_ontick_ctrade_buffers_proprios_e_os_valores_da_estrategia", () => {
  const { codigo, avisos } = exportar(MAO[0].est, "mql5");
  for (const s of ["#include <Trade/Trade.mqh>", "void OnTick()", "int OnInit()", "CTrade   trade;", "CopyRates(", "input double Lote",
    "input ulong  Magico", "input int    AtrPeriodo = 14;", "input double StopAtr = 2.0;", "input double AlvoAtr = 4.0;",
    "input bool   Inverter = true;", "Ema(C, 12, ind1);", "Sma(C, 50, ind2);", "Rsi(C, 14, ind3);",
    "CruzaAcima(ind1[i - 1], ind2[i - 1], ind1[i], ind2[i])", "Menor(ind3[i], 45.0)", "trade.Buy(", "trade.Sell(", "iBarShift("])
    assert.ok(codigo.includes(s), `MQL5 sem: ${s}`);
  assert.ok(!/\bi(MA|RSI|ATR)\(/.test(codigo), "MQL5 não pode usar iMA/iRSI/iATR");
  assert.ok(avisos.some((a) => /não compilado/.test(a)));
});

test("ntsl_tem_ordens_do_profit_indicadores_a_mao_e_os_valores_da_estrategia", () => {
  const { codigo, avisos } = exportar(MAO[2].est, "ntsl");
  for (const s of ["input", "StopAtr(0.0);", "AlvoAtr(3.0);", "BarrasMax(30);", "Inverter(False);", "begin", "end;",
    "SellShortAtMarket;", "BuyToCoverLimit(", "IsSold", "CurrentBar", "High[1]", "for j := 2 to 20 do", "(0.015 *"])
    assert.ok(codigo.includes(s), `NTSL sem: ${s}`);
  assert.match(codigo, /compra := False;/); // direção só venda
  assert.ok(codigo.trimEnd().endsWith("end;"));
  assert.ok(avisos.some((a) => /não compilado/.test(a)));
  assert.ok(avisos.some((a) => /não conferidos/.test(a)));
});

test("estrategia_invalida_e_recusada_antes_de_gerar_codigo", () => {
  const ruim = { versao: 1, direcao: "ambas", entrada: [{ op: ">", a: { ind: "rsi", p: [14] }, b: { ind: "sma", p: [20] } }], saida: { atr_p: 14, stop_atr: 1 } };
  for (const f of Object.keys(FORMATOS)) assert.throws(() => exportar(ruim, f), /escalas diferentes/);
  assert.throws(() => exportar({ ...MAO[0].est, saida: { atr_p: 14 } }, "python"), /sem nenhuma saída/);
  assert.throws(() => exportar(MAO[0].est, "cobol"), /formato desconhecido/);
  assert.throws(() => exportar(null, "pine"), /versao 1/);
});

test("so_o_python_se_declara_verificado", () => {
  for (const [f, m] of Object.entries(FORMATOS)) assert.equal(m.verificado, f === "python", f);
  for (const f of PLATAFORMAS) assert.ok(exportar(MAO[0].est, f).avisos.length >= 3, f);
});
