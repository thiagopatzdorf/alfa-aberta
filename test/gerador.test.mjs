import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lerCsv, criarSerie, ajustarEventos } from "../public/motor/dados.js";
import { evoluir } from "../public/motor/gerador.js";
import { atestar } from "../public/motor/robustez.js";
import { criarAcaso } from "../public/motor/acaso.js";

const btc = () => lerCsv(readFileSync(new URL("../public/dados/BTCUSDT-1d.csv", import.meta.url), "utf8"), "BTCUSDT-1d");
const PED = { populacao: 30, geracoes: 4, semente: 3, custo_pct: 0.1 };

test("mesma_semente_gera_o_mesmo_banco_e_semente_diferente_gera_outro", () => {
  const a = evoluir(btc(), PED), b = evoluir(btc(), PED), c = evoluir(btc(), { ...PED, semente: 4 });
  assert.deepEqual(a.banco.map((x) => x.id), b.banco.map((x) => x.id));
  assert.notDeepEqual(a.banco.map((x) => x.id), c.banco.map((x) => x.id));
});

test("dados_fora_da_amostra_nunca_influenciam_a_evolucao", () => {
  // Embaralha o preço depois do corte: o banco (as regras e a aptidão) tem de sair idêntico;
  // só as métricas "fora" mudam. Se mudar, a evolução espiou o futuro.
  const s1 = btc(), s2 = btc(), corte = Math.floor(s1.n * 0.7);
  const A = criarAcaso(9);
  for (let i = corte + 50; i < s2.n; i++) { const f = 0.8 + 0.4 * A.real(); for (const k of ["abertura", "maxima", "minima", "fechamento"]) s2[k][i] *= f; }
  const a = evoluir(s1, PED), b = evoluir(s2, PED);
  assert.deepEqual(a.banco.map((x) => [x.id, x.aptidao]), b.banco.map((x) => [x.id, x.aptidao]));
});

test("banco_nao_guarda_duas_regras_com_as_mesmas_operacoes", () => {
  const r = evoluir(btc(), { ...PED, populacao: 60, geracoes: 6 });
  const digitais = r.banco.map((x) => `${x.completo.operacoes}:${x.completo.lucro_pct}`);
  assert.equal(new Set(digitais).size, digitais.length);
});

test("estrategia_que_compra_ao_acaso_nao_passa_no_teste_contra_o_acaso", () => {
  // Série de passeio aleatório sem tendência: nenhuma regra tem vantagem real.
  const A = criarAcaso(1); let p = 100; const barras = [];
  for (let i = 0; i < 2500; i++) { const o = p; p *= Math.exp((A.real() - 0.5) * 0.04); barras.push({ t: i * 864e5, o, h: Math.max(o, p) * 1.005, l: Math.min(o, p) * 0.995, c: p }); }
  const s = criarSerie("passeio", barras);
  const est = { versao: 1, direcao: "ambas", entrada: [{ op: ">", a: { ind: "rsi", p: [14] }, b: { k: 55 } }], saida: { atr_p: 14, stop_atr: 2, alvo_atr: 2 } };
  const at = atestar(s, est, { custo_pct: 0.05 });
  assert.equal(at.testes.find((t) => t.nome === "contra_o_acaso").passou, false);
  assert.notEqual(at.nota, "A");
});

test("atestado_e_deterministico_e_traz_a_regra_de_cada_teste", () => {
  const est = { versao: 1, direcao: "compra", entrada: [{ op: "cruza_acima", a: { ind: "ema", p: [20] }, b: { ind: "sma", p: [100] } }], saida: { atr_p: 14, stop_atr: 3, barras_max: 40 } };
  const a = atestar(btc(), est, { custo_pct: 0.1 }), b = atestar(btc(), est, { custo_pct: 0.1 });
  assert.deepEqual(a, b);
  for (const t of a.testes) assert.ok(t.regra.length > 20, t.nome);
});

test("desdobramento_no_cotahist_e_ajustado_e_registrado", () => {
  const b = [{ t: 0, o: 40, h: 41, l: 39, c: 40 }, { t: 1, o: 40, h: 41, l: 39, c: 40 }, { t: 2, o: 20.2, h: 20.5, l: 19.8, c: 20 }, { t: 3, o: 20, h: 21, l: 19, c: 21 }];
  const aj = ajustarEventos(b);
  assert.equal(aj.length, 1);
  assert.equal(aj[0].razao, 2);
  assert.equal(b[0].c, 20);
});
