// Atestado de robustez: a bateria que separa estratégia de sorte. Cada teste devolve
// { nome, passou, numeros, regra } e a regra de aprovação está escrita no próprio resultado,
// para quem ler o atestado saber exatamente o que foi cobrado. Determinístico pela semente.
import { criarAcaso } from "./acaso.js";
import { backtest } from "./backtest.js";
import { sinaisDaEstrategia, chave, arred, validar } from "./estrategia.js";
import { CATALOGO } from "./indicadores.js";
import { maxDrawdown } from "./metricas.js";
import { aptidao, PADRAO, hash } from "./gerador.js";

const pct = (lista, p) => { const v = [...lista].sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(p * v.length))]; };
const mediana = (l) => pct(l, 0.5);
const r2 = (x) => Math.round(x * 100) / 100;

// Variação dos parâmetros numéricos de uma estratégia (períodos, constantes, saídas) em ±amp.
export function perturbar(A, est, amp = 0.2) {
  const e = JSON.parse(JSON.stringify(est));
  const mexe = (v, inteiro, min = 1, max = 500) => {
    const novo = v * (1 + (A.real() * 2 - 1) * amp);
    return Math.min(max, Math.max(min, inteiro ? Math.round(novo) : arred(novo)));
  };
  for (const c of e.entrada) for (const o of [c.a, c.b]) {
    if (o.k !== undefined) { if (o.k !== 0) o.k = arred(o.k + (A.real() * 2 - 1) * amp * Math.abs(o.k)); }
    else if (o.p) o.p = o.p.map((v, i) => { const [a, b] = CATALOGO[o.ind].params[i]; return mexe(v, !(o.ind.startsWith("bb") && i === 1), a, b); });
  }
  const s = e.saida;
  if (s.stop_atr) s.stop_atr = mexe(s.stop_atr, false, 0.1, 20);
  if (s.alvo_atr) s.alvo_atr = mexe(s.alvo_atr, false, 0.1, 20);
  if (s.barras_max) s.barras_max = mexe(s.barras_max, true, 1, 1000);
  return e;
}

function foraDaAmostra(serie, est, cfg, corte) {
  const m = backtest(serie, est, { ini: corte, fim: serie.n, ...cfg.custos }).metricas;
  const minimo = Math.max(5, Math.round(cfg.min_operacoes * (1 - cfg.fracao_is) / cfg.fracao_is / 2));
  return { nome: "fora_da_amostra", titulo: "Fora da amostra", passou: m.lucro_pct > 0 && m.fator_lucro >= 1.1 && m.operacoes >= minimo,
    regra: `lucro > 0, fator de lucro ≥ 1,1 e ≥ ${minimo} operações nos ${Math.round((1 - cfg.fracao_is) * 100)}% finais, nunca usados na evolução`,
    numeros: { operacoes: m.operacoes, lucro_pct: m.lucro_pct, fator_lucro: m.fator_lucro, dd_max_pct: m.dd_max_pct } };
}

// Walk-forward: em cada janela reotimiza os parâmetros (busca local, 30 vizinhos) dentro da
// amostra e opera a janela seguinte sem olhar. Só o resultado das janelas cegas conta.
function walkForward(serie, est, cfg, A, janelas = 5, fracao = 0.7) {
  const n = serie.n, passo = Math.floor(n / (janelas + fracao / (1 - fracao)));
  const tamIs = Math.floor(passo * fracao / (1 - fracao));
  const runs = [];
  for (let k = 0; k < janelas; k++) {
    const iniIs = k * passo, fimIs = iniIs + tamIs, fimOos = Math.min(n, fimIs + passo);
    if (fimOos - fimIs < 10) break;
    const cfgJ = { ...cfg, min_operacoes: Math.max(5, Math.round(cfg.min_operacoes * tamIs / (n * cfg.fracao_is))) };
    let melhor = est, melhorFit = -Infinity, melhorIs = null;
    for (let v = 0; v < 30; v++) {
      const cand = v === 0 ? est : perturbar(A, est, 0.25);
      try { validar(cand); } catch { continue; }
      const m = backtest(serie, cand, { ini: iniIs, fim: fimIs, ...cfg.custos }).metricas;
      const f = aptidao(m, cfgJ);
      if (f > melhorFit) { melhorFit = f; melhor = cand; melhorIs = m; }
    }
    const oos = backtest(serie, melhor, { ini: fimIs, fim: fimOos, ...cfg.custos }).metricas;
    runs.push({ janela: k + 1, de: new Date(serie.tempo[fimIs]).toISOString().slice(0, 10), ate: new Date(serie.tempo[fimOos - 1]).toISOString().slice(0, 10),
      lucro_dentro_ano: melhorIs.lucro_ano_pct, lucro_fora: oos.lucro_pct, lucro_fora_ano: oos.lucro_ano_pct, operacoes_fora: oos.operacoes });
  }
  const positivas = runs.filter((r) => r.lucro_fora > 0).length;
  const total = runs.reduce((a, r) => a + r.lucro_fora, 0);
  const isAno = runs.reduce((a, r) => a + r.lucro_dentro_ano, 0) / runs.length, oosAno = runs.reduce((a, r) => a + r.lucro_fora_ano, 0) / runs.length;
  const eficiencia = isAno > 0 ? oosAno / isAno : 0;
  return { nome: "walk_forward", titulo: "Walk-forward", passou: positivas / runs.length >= 0.6 && total > 0 && eficiencia >= 0.4,
    regra: `${runs.length} janelas reotimizadas e operadas às cegas: ≥ 60% delas lucrativas, soma > 0 e eficiência (anual fora ÷ anual dentro) ≥ 0,4`,
    numeros: { janelas_lucrativas: `${positivas}/${runs.length}`, lucro_fora_total_pct: r2(total), eficiencia: r2(eficiencia) }, janelas: runs };
}

// Monte Carlo das operações: reamostra a lista de operações (com reposição) e pula 10% ao acaso.
function monteCarloOperacoes(rets, ddOriginal, A, n = 1000) {
  const lucros = [], dds = [];
  for (let s = 0; s < n; s++) {
    let acum = 0; const eq = [];
    for (let i = 0; i < rets.length; i++) { if (A.chance(0.1)) continue; acum += rets[Math.floor(A.real() * rets.length)]; eq.push(acum); }
    lucros.push(acum); dds.push(maxDrawdown(eq));
  }
  const p5 = pct(lucros, 0.05), dd95 = pct(dds, 0.95);
  return { nome: "monte_carlo_operacoes", titulo: "Monte Carlo das operações", passou: rets.length >= 10 && p5 > 0,
    regra: `${n} sequências reamostradas com 10% das operações puladas: o pior 5% ainda lucra`,
    numeros: { lucro_p5_pct: r2(p5), lucro_mediano_pct: r2(mediana(lucros)), dd_p95_pct: r2(dd95), dd_original_pct: r2(ddOriginal) } };
}

// Monte Carlo de reteste: custos e slippage piores e sinais perdidos ao acaso.
function monteCarloReteste(serie, est, cfg, A, n = 150) {
  const sinais = sinaisDaEstrategia(serie, est);
  const base = { custo_pct: cfg.custos.custo_pct ?? 0.05, slippage_pct: cfg.custos.slippage_pct ?? 0.02 };
  const lucros = [];
  for (let s = 0; s < n; s++) {
    const m = backtest(serie, est, { sinais, custo_pct: base.custo_pct * (1 + A.real()), slippage_pct: base.slippage_pct * (1 + 2 * A.real()), pular: () => A.chance(0.1) }).metricas;
    lucros.push(m.lucro_pct);
  }
  const prop = lucros.filter((x) => x > 0).length / n;
  return { nome: "monte_carlo_reteste", titulo: "Custos piores e sinais perdidos", passou: prop >= 0.8,
    regra: `${n} retestes com custo até 2×, slippage até 3× e 10% dos sinais perdidos: ≥ 80% lucrativos`,
    numeros: { lucrativos_pct: r2(prop * 100), lucro_p5_pct: r2(pct(lucros, 0.05)), lucro_mediano_pct: r2(mediana(lucros)) } };
}

function estabilidadeParametros(serie, est, cfg, A, original, n = 150) {
  const rdd = [], lucros = [];
  for (let s = 0; s < n; s++) {
    const v = perturbar(A, est, 0.2);
    try { validar(v); } catch { continue; }
    const m = backtest(serie, v, { ...cfg.custos }).metricas;
    rdd.push(m.retorno_dd); lucros.push(m.lucro_pct);
  }
  const prop = lucros.filter((x) => x > 0).length / lucros.length, med = mediana(rdd);
  return { nome: "estabilidade_parametros", titulo: "Parâmetros vizinhos", passou: prop >= 0.7 && med >= 0.5 * original.retorno_dd,
    regra: `${lucros.length} variações de ±20% em todos os parâmetros: ≥ 70% lucrativas e retorno/DD mediano ≥ metade do original`,
    numeros: { lucrativas_pct: r2(prop * 100), retorno_dd_mediano: r2(med), retorno_dd_original: original.retorno_dd } };
}

// Teste contra o acaso: as mesmas saídas e a mesma quantidade de sinais, mas em barras sorteadas.
// O p-valor é a fração de estratégias aleatórias que lucraram tanto quanto a real.
function contraOAcaso(serie, est, cfg, A, original, n = 300) {
  const { compra, venda } = sinaisDaEstrategia(serie, est);
  let nc = 0, nv = 0; for (let i = 0; i < serie.n; i++) { nc += compra[i]; nv += venda[i]; }
  let melhores = 0; const lucros = [];
  for (let s = 0; s < n; s++) {
    const c = new Uint8Array(serie.n), v = new Uint8Array(serie.n);
    for (let k = 0; k < nc; k++) c[Math.floor(A.real() * serie.n)] = 1;
    for (let k = 0; k < nv; k++) v[Math.floor(A.real() * serie.n)] = 1;
    const m = backtest(serie, est, { sinais: { compra: c, venda: v }, ...cfg.custos }).metricas;
    lucros.push(m.lucro_pct); if (m.lucro_pct >= original.lucro_pct) melhores++;
  }
  const p = (melhores + 1) / (n + 1);
  return { nome: "contra_o_acaso", titulo: "Contra entradas aleatórias", passou: p < 0.05,
    regra: `${n} estratégias com as mesmas saídas e o mesmo número de sinais em barras sorteadas: menos de 5% delas lucram tanto (p < 0,05)`,
    numeros: { p_valor: Math.round(p * 1000) / 1000, lucro_real_pct: original.lucro_pct, lucro_acaso_mediano_pct: r2(mediana(lucros)), lucro_acaso_p95_pct: r2(pct(lucros, 0.95)) } };
}

function outrosMercados(est, cfg, outras) {
  const res = outras.map((s) => ({ serie: s.nome, ...pick(backtest(s, est, { ...cfg.custos }).metricas) }));
  const ok = res.filter((r) => r.lucro_pct > 0).length;
  return { nome: "outros_mercados", titulo: "Outros mercados", passou: ok / res.length >= 0.5,
    regra: `a mesma regra, sem mudar nada, em ${res.length} outras séries: ≥ metade lucrativas`,
    numeros: { lucrativas: `${ok}/${res.length}` }, series: res };
}
const pick = (m) => ({ operacoes: m.operacoes, lucro_pct: m.lucro_pct, fator_lucro: m.fator_lucro, dd_max_pct: m.dd_max_pct });

export function atestar(serie, est, pedido = {}, outras = []) {
  validar(est);
  const cfg = { ...PADRAO, ...pedido };
  cfg.custos = { custo_pct: cfg.custo_pct, slippage_pct: cfg.slippage_pct };
  const corte = Math.floor(serie.n * cfg.fracao_is);
  const base = (cfg.semente * 2654435761) >>> 0;
  const completo = backtest(serie, est, { ...cfg.custos });
  const m = completo.metricas;
  const testes = [
    foraDaAmostra(serie, est, cfg, corte),
    walkForward(serie, est, cfg, criarAcaso(base ^ 1)),
    monteCarloOperacoes(completo.trades.map((t) => t.ret), m.dd_max_pct, criarAcaso(base ^ 2)),
    monteCarloReteste(serie, est, cfg, criarAcaso(base ^ 3)),
    estabilidadeParametros(serie, est, cfg, criarAcaso(base ^ 4), m),
    contraOAcaso(serie, est, cfg, criarAcaso(base ^ 5), m),
  ];
  if (outras.length) testes.push(outrosMercados(est, cfg, outras));
  const aprovados = testes.filter((t) => t.passou).length, frac = aprovados / testes.length;
  const nota = frac === 1 ? "A" : frac >= 0.8 ? "B" : frac >= 0.6 ? "C" : frac >= 0.4 ? "D" : "E";
  return { id: hash(chave(est)), serie: serie.nome, barras: serie.n, semente: cfg.semente,
    de: new Date(serie.tempo[0]).toISOString().slice(0, 10), ate: new Date(serie.tempo[serie.n - 1]).toISOString().slice(0, 10),
    custos: { custo_pct: cfg.custos.custo_pct ?? 0.05, slippage_pct: cfg.custos.slippage_pct ?? 0.02 },
    nota, aprovados, total: testes.length, metricas: m, testes };
}
