import { test } from "node:test";
import assert from "node:assert/strict";
import { criarSerie } from "../public/motor/dados.js";
import { backtest } from "../public/motor/backtest.js";
import { sma, ema, rsi, atr } from "../public/motor/indicadores.js";

const dia = 864e5;
const serieDe = (precos) => criarSerie("t", precos.map((p, i) => ({ t: i * dia, o: p[0], h: p[1], l: p[2], c: p[3] })));

test("indicadores_batem_com_as_contas_feitas_a_mao", () => {
  const x = Float64Array.from([1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...sma(x, 3)].slice(2), [2, 3, 4, 5]);
  assert.ok(Number.isNaN(sma(x, 3)[1]));
  const e = ema(x, 3); assert.equal(e[2], 2); assert.equal(e[3], 3); // semente SMA, depois 4*0.5+2*0.5
  const c = Float64Array.from([10, 11, 10, 11, 10]);
  const r = rsi(c, 2); assert.equal(r[2], 50); // um ganho e uma perda iguais
  const h = Float64Array.from([2, 3, 4]), l = Float64Array.from([1, 1, 2]), cc = Float64Array.from([1.5, 2, 3]);
  assert.equal(atr(h, l, cc, 2)[1], 1.5); // TR 1 e 2
});

// Estratégia: compra quando fechamento > 0 (sempre); stop 1 ATR, alvo 1 ATR, ATR(2).
const sempre = (saida) => ({ versao: 1, direcao: "compra", entrada: [{ op: ">", a: { ind: "preco", campo: "fechamento" }, b: { k: 0 } }], saida });

test("entrada_acontece_na_abertura_seguinte_e_nao_no_fechamento_do_sinal", () => {
  const s = serieDe([[10, 11, 9, 10], [10, 11, 9, 10], [12, 12, 12, 12], [12, 12, 12, 12]]);
  const r = backtest(s, sempre({ atr_p: 2, barras_max: 1 }), { custo_pct: 0, slippage_pct: 0 });
  assert.equal(r.trades[0].iEnt, 2); // ATR(2) só existe na barra 1; entra na abertura da 2
  assert.equal(r.trades[0].pEnt, 12);
});

test("stop_e_alvo_na_mesma_barra_conta_o_stop_hipotese_pessimista", () => {
  const s = serieDe([[10, 11, 9, 10], [10, 11, 9, 10], [10, 20, 0, 10], [10, 10, 10, 10]]);
  const r = backtest(s, sempre({ atr_p: 2, stop_atr: 1, alvo_atr: 1 }), { custo_pct: 0, slippage_pct: 0 });
  assert.equal(r.trades[0].motivo, "stop");
  assert.equal(r.trades[0].pSai, 8); // 10 - 1*ATR(2)=2
});

test("gap_alem_do_stop_executa_na_abertura_e_nao_no_preco_do_stop", () => {
  const s = serieDe([[10, 11, 9, 10], [10, 11, 9, 10], [10, 10.5, 9.5, 10], [5, 6, 4, 5], [5, 5, 5, 5]]);
  const r = backtest(s, sempre({ atr_p: 2, stop_atr: 1 }), { custo_pct: 0, slippage_pct: 0 });
  assert.equal(r.trades[0].motivo, "stop");
  assert.equal(r.trades[0].pSai, 5);
});

test("custo_e_slippage_reduzem_o_resultado_nos_dois_lados", () => {
  const s = serieDe([[10, 11, 9, 10], [10, 11, 9, 10], [10, 10, 10, 10], [10, 10, 10, 10]]);
  const sem = backtest(s, sempre({ atr_p: 2, barras_max: 1 }), { custo_pct: 0, slippage_pct: 0 }).trades[0].ret;
  const com = backtest(s, sempre({ atr_p: 2, barras_max: 1 }), { custo_pct: 0.1, slippage_pct: 0.1 }).trades[0].ret;
  assert.equal(sem, 0);
  assert.ok(Math.abs(com - (((9.99 - 10.01) / 10.01) * 100 - 0.2)) < 1e-9);
});

test("posicao_aberta_fecha_no_fim_da_janela", () => {
  const s = serieDe([[10, 11, 9, 10], [10, 11, 9, 10], [10, 12, 10, 12], [12, 13, 12, 13]]);
  const r = backtest(s, sempre({ atr_p: 2, stop_atr: 5 }), { custo_pct: 0, slippage_pct: 0 });
  assert.equal(r.trades.at(-1).motivo, "fim");
  assert.equal(r.trades.at(-1).pSai, 13);
  assert.equal(r.equity.at(-1), r.metricas.lucro_pct);
});

test("venda_espelha_a_banda_e_a_maxima_para_o_lado_de_baixo", async () => {
  const { espelhar } = await import("../public/motor/estrategia.js");
  const c = espelhar({ op: ">", a: { ind: "preco", campo: "maxima" }, b: { ind: "bb_sup", p: [20, 2] } });
  assert.deepEqual(c, { op: "<", a: { ind: "preco", campo: "minima" }, b: { ind: "bb_inf", p: [20, 2] } });
  assert.equal(espelhar({ op: "cruza_acima", a: { ind: "preco", campo: "fechamento" }, b: { ind: "maxima_n", p: [20] } }).b.ind, "minima_n");
});
