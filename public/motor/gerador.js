// Gerador de estratégias por programação genética. Gerador burro, avaliador exato:
// sorteia e muta regras (estrategia.js), o backtest pontua e só o que sobrevive vai ao banco.
// Determinístico: mesma série + mesmo pedido + mesma semente = mesmo banco, em qualquer máquina.
import { criarAcaso } from "./acaso.js";
import { CATALOGO, indicador } from "./indicadores.js";
import { backtest } from "./backtest.js";
import { chave, arred, validar } from "./estrategia.js";

// Condição repetida não muda o sinal: sai, e a estratégia fica mais simples (e mais barata de ler).
export function normalizar(est) {
  const vistas = new Set();
  est.entrada = est.entrada.filter((c) => { const k = JSON.stringify(c); if (vistas.has(k)) return false; vistas.add(k); return true; });
  return est;
}

export const PADRAO = {
  populacao: 120, geracoes: 30, semente: 42, ilhas: 1,
  fracao_is: 0.7,             // 70% para evoluir (dentro da amostra), 30% guardados (fora da amostra)
  min_operacoes: 30,          // na parte de evolução
  max_condicoes: 3,
  direcao: "ambas",           // ou "compra" / "venda" / "livre" (o gerador escolhe)
  aptidao: "retorno_dd",      // métrica que guia a evolução
  indicadores: Object.keys(CATALOGO).filter((k) => k !== "preco"),
  banco_tamanho: 20,
  custo_pct: undefined, slippage_pct: undefined,
};

const OPS = [">", "<", "cruza_acima", "cruza_abaixo"];
const CAMPOS = ["fechamento", "abertura", "maxima", "minima"];

function sortearParams(A, ind) {
  return CATALOGO[ind].params.map(([a, b], i) => (ind.startsWith("bb") && i === 1 ? arred(a + A.real() * (b - a)) : A.inteiro(a, b)));
}
function sortearOperando(A, ind) {
  if (ind === "preco") return { ind, campo: A.escolher(CAMPOS) };
  return { ind, p: sortearParams(A, ind) };
}
function sortearConstante(A, ind, amostra) {
  const def = CATALOGO[ind];
  if (def.escala === "macd") return { k: 0 };
  // Faixa real dos valores do indicador nesta série: constante fora dela nunca dispara.
  if (amostra && def.escala !== "rsi" && def.escala !== "estoc") {
    const [lo, hi] = amostra;
    return { k: arred(lo + A.real() * (hi - lo)) };
  }
  const [lo, hi] = def.faixa;
  return { k: arred(Math.round(lo + A.real() * (hi - lo))) };
}

// Só a parte de evolução (até o corte) entra na faixa: olhar a série inteira seria espiar o futuro.
function percentis(serie, op, fim) {
  const v = Array.from(indicador(serie, op).subarray(0, fim)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  return [v[Math.floor(v.length * 0.1)], v[Math.floor(v.length * 0.9)]];
}

export function sortearCondicao(A, serie, cfg) {
  const inds = cfg.indicadores;
  const ind = A.escolher(inds);
  const def = CATALOGO[ind];
  const op = A.escolher(OPS);
  if (def.escala === "preco") {
    // preço contra preço: um indicador de preço contra outro (ou contra o próprio preço)
    const a = A.chance(0.5) ? sortearOperando(A, "preco") : sortearOperando(A, A.escolher(inds.filter((k) => CATALOGO[k].escala === "preco")));
    const b = sortearOperando(A, ind);
    return { op, a, b };
  }
  const a = sortearOperando(A, ind);
  // oscilador contra constante (o caso comum) ou contra ele mesmo com outro período
  if (A.chance(0.75)) return { op, a, b: sortearConstante(A, ind, def.escala === "cci" || def.escala === "roc" ? percentis(serie, a, cfg._corte ?? serie.n) : null) };
  return { op, a, b: sortearOperando(A, ind) };
}

export function sortearSaida(A) {
  const s = { atr_p: A.escolher([7, 10, 14, 20]) };
  const tipo = A.inteiro(0, 3);
  if (tipo !== 1) s.stop_atr = arred(0.5 + A.real() * 4.5);
  if (tipo !== 2) s.alvo_atr = arred(0.5 + A.real() * 7.5);
  if (A.chance(0.4) || tipo === 3) s.barras_max = A.inteiro(3, 60);
  if (A.chance(0.15)) s.inverter = true;
  if (!s.stop_atr && !s.alvo_atr && !s.barras_max) s.barras_max = 20;
  return s;
}

export function sortearEstrategia(A, serie, cfg) {
  const n = A.inteiro(1, cfg.max_condicoes);
  const direcao = cfg.direcao === "livre" ? A.escolher(["ambas", "compra", "venda"]) : cfg.direcao;
  return { versao: 1, direcao, entrada: Array.from({ length: n }, () => sortearCondicao(A, serie, cfg)), saida: sortearSaida(A) };
}

const clonar = (x) => JSON.parse(JSON.stringify(x));

function mutarOperando(A, o) {
  if (o.k !== undefined) return { k: arred(o.k * (0.8 + A.real() * 0.4) + (A.real() - 0.5)) };
  if (o.ind === "preco") return { ind: "preco", campo: A.escolher(CAMPOS) };
  const def = CATALOGO[o.ind];
  return { ind: o.ind, p: o.p.map((v, i) => {
    const [a, b] = def.params[i];
    if (o.ind.startsWith("bb") && i === 1) return arred(Math.min(b, Math.max(a, v + (A.real() - 0.5))));
    return Math.min(b, Math.max(a, Math.round(v * (0.7 + A.real() * 0.6)) + A.inteiro(-1, 1)));
  }) };
}

export function mutar(A, est, serie, cfg) {
  const e = clonar(est);
  const r = A.real();
  if (r < 0.35) { const c = e.entrada[A.inteiro(0, e.entrada.length - 1)]; if (A.chance(0.5)) c.a = mutarOperando(A, c.a); else c.b = mutarOperando(A, c.b); }
  else if (r < 0.5) { const i = A.inteiro(0, e.entrada.length - 1); e.entrada[i] = sortearCondicao(A, serie, cfg); }
  else if (r < 0.6 && e.entrada.length < cfg.max_condicoes) e.entrada.push(sortearCondicao(A, serie, cfg));
  else if (r < 0.7 && e.entrada.length > 1) e.entrada.splice(A.inteiro(0, e.entrada.length - 1), 1);
  else if (r < 0.75) { const c = e.entrada[A.inteiro(0, e.entrada.length - 1)]; c.op = A.escolher(OPS); }
  else if (r < 0.95) {
    const s = e.saida;
    for (const k of ["stop_atr", "alvo_atr"]) if (s[k]) s[k] = arred(Math.min(20, Math.max(0.3, s[k] * (0.7 + A.real() * 0.6))));
    if (s.barras_max) s.barras_max = Math.max(1, Math.round(s.barras_max * (0.7 + A.real() * 0.6)));
    if (A.chance(0.2)) s.atr_p = A.escolher([7, 10, 14, 20]);
  } else e.saida = sortearSaida(A);
  return e;
}

export function cruzar(A, p1, p2, cfg) {
  const conds = [...p1.entrada, ...p2.entrada].filter(() => A.chance(0.5));
  const entrada = (conds.length ? conds : [A.escolher(p1.entrada)]).slice(0, cfg.max_condicoes);
  return clonar({ versao: 1, direcao: A.chance(0.5) ? p1.direcao : p2.direcao, entrada, saida: A.chance(0.5) ? p1.saida : p2.saida });
}

// Aptidão: a métrica pedida, zerada abaixo do mínimo de operações, com pena leve por condição
// (entre duas iguais, a mais simples ganha: menos chance de ter decorado o passado).
export function aptidao(m, cfg) {
  if (m.operacoes < cfg.min_operacoes || m.lucro_pct <= 0) return -1 + Math.min(m.operacoes, cfg.min_operacoes) / cfg.min_operacoes / 10;
  const base = { retorno_dd: m.retorno_dd, sharpe: m.sharpe, lucro: m.lucro_pct, fator_lucro: m.fator_lucro, sqn: m.sqn, estabilidade: m.estabilidade }[cfg.aptidao] ?? m.retorno_dd;
  return base * (m.estabilidade > 0 ? 0.5 + 0.5 * m.estabilidade : 0.5);
}

function avaliar(serie, est, cfg, corte) {
  const op = { ini: 0, fim: corte, custo_pct: cfg.custo_pct, slippage_pct: cfg.slippage_pct };
  const r = backtest(serie, est, op);
  const fit = aptidao(r.metricas, cfg) * (1 - 0.02 * (est.entrada.length - 1));
  return { est, fit, is: r.metricas };
}

function torneio(A, pop, k = 3) {
  let melhor = null;
  for (let i = 0; i < k; i++) { const x = A.escolher(pop); if (!melhor || x.fit > melhor.fit) melhor = x; }
  return melhor;
}

// Uma ilha: população própria, semente própria. Várias ilhas rodam em paralelo (workers) e o
// banco final junta as melhores; o resultado não depende de quantos núcleos a máquina tem.
// aoAvaliar(r) recebe cada estratégia nova avaliada ({est, fit, is}): é o que alimenta a nuvem ao vivo da tela.
export function evoluirIlha(serie, pedido = {}, aoProgresso = () => {}, ilha = 0, aoAvaliar = null) {
  const cfg = { ...PADRAO, ...pedido };
  const A = criarAcaso((cfg.semente * 1000003 + ilha * 7919) >>> 0);
  const corte = Math.floor(serie.n * cfg.fracao_is);
  cfg._corte = corte;
  const vistos = new Map();
  const avaliarUnico = (est) => {
    const k = chave(est);
    let r = vistos.get(k);
    if (!r) { try { normalizar(est); validar(est); r = avaliar(serie, est, cfg, corte); } catch { r = { est, fit: -2, is: null }; } vistos.set(k, r); if (aoAvaliar) aoAvaliar(r); }
    return r;
  };
  let pop = Array.from({ length: cfg.populacao }, () => avaliarUnico(sortearEstrategia(A, serie, cfg)));
  const elite = Math.max(2, Math.round(cfg.populacao * 0.05));
  for (let g = 0; g < cfg.geracoes; g++) {
    pop.sort((a, b) => b.fit - a.fit);
    aoProgresso({ ilha, geracao: g + 1, geracoes: cfg.geracoes, melhor: pop[0].fit, avaliadas: vistos.size });
    const nova = pop.slice(0, elite);
    while (nova.length < cfg.populacao) {
      const r = A.real();
      let filho;
      if (r < 0.45) filho = mutar(A, torneio(A, pop).est, serie, cfg);
      else if (r < 0.9) filho = cruzar(A, torneio(A, pop).est, torneio(A, pop).est, cfg);
      else filho = sortearEstrategia(A, serie, cfg); // sangue novo contra a convergência precoce
      nova.push(avaliarUnico(filho));
    }
    pop = nova;
  }
  // O banco da ilha: os melhores distintos com aptidão positiva.
  const banco = [...vistos.values()].filter((x) => x.fit > 0).sort((a, b) => b.fit - a.fit).slice(0, cfg.banco_tamanho * 2);
  return { banco, avaliadas: vistos.size, corte };
}

// Junta as ilhas, mede fora da amostra e ordena. O fora da amostra só é olhado aqui, no fim:
// nunca guia a evolução (senão deixa de ser fora da amostra).
export function fecharBanco(serie, ilhas, pedido = {}) {
  const cfg = { ...PADRAO, ...pedido };
  const corte = Math.floor(serie.n * cfg.fracao_is);
  const vistos = new Set(), comportamentos = new Set(), banco = [];
  const todos = ilhas.flatMap((i) => i.banco).sort((a, b) => b.fit - a.fit || (chave(a.est) < chave(b.est) ? -1 : 1));
  for (const x of todos) {
    const k = chave(x.est); if (vistos.has(k)) continue; vistos.add(k);
    // Duas regras com as mesmas operações (dentro da amostra: a escolha não pode olhar o futuro)
    // são a mesma estratégia para quem opera: fica a primeira.
    const dentro = backtest(serie, x.est, { ini: 0, fim: corte, custo_pct: cfg.custo_pct, slippage_pct: cfg.slippage_pct });
    const digital = hash(dentro.trades.map((t) => `${t.iEnt}:${t.dir}`).join(","));
    const tudo = backtest(serie, x.est, { custo_pct: cfg.custo_pct, slippage_pct: cfg.slippage_pct });
    if (comportamentos.has(digital)) continue; comportamentos.add(digital);
    const oos = backtest(serie, x.est, { ini: corte, fim: serie.n, custo_pct: cfg.custo_pct, slippage_pct: cfg.slippage_pct }).metricas;
    banco.push({ id: hash(k), estrategia: x.est, aptidao: Math.round(x.fit * 1000) / 1000, dentro: x.is, fora: oos, completo: tudo.metricas });
    if (banco.length >= cfg.banco_tamanho) break;
  }
  return { banco, avaliadas: ilhas.reduce((a, i) => a + i.avaliadas, 0), corte, barras: serie.n,
    corte_data: new Date(serie.tempo[corte]).toISOString().slice(0, 10) };
}

export function evoluir(serie, pedido = {}, aoProgresso) {
  const cfg = { ...PADRAO, ...pedido };
  const ilhas = Array.from({ length: cfg.ilhas }, (_, i) => evoluirIlha(serie, cfg, aoProgresso, i));
  return fecharBanco(serie, ilhas, cfg);
}

// FNV-1a de 32 bits: id curto e estável para a estratégia (aparece na URL e no atestado).
export function hash(texto) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36).padStart(7, "0");
}
