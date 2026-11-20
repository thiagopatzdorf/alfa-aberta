// Indicadores técnicos. Cada um devolve Float64Array do tamanho da série, NaN no aquecimento.
// A definição matemática daqui é o contrato: os exportadores (Python, Pine, MQL5, NTSL)
// reproduzem exatamente estas fórmulas, e o teste de paridade do Python cobra isso.

const nan = (n) => new Float64Array(n).fill(NaN);

export function sma(x, p) {
  const r = nan(x.length); let s = 0;
  for (let i = 0; i < x.length; i++) { s += x[i]; if (i >= p) s -= x[i - p]; if (i >= p - 1) r[i] = s / p; }
  return r;
}
// EMA semeada com a SMA dos p primeiros valores (convenção do MT5 e do Pine ta.ema não é igual; a nossa é esta e está escrita).
export function ema(x, p) {
  const r = nan(x.length); const k = 2 / (p + 1); let e = 0;
  for (let i = 0; i < x.length; i++) {
    if (i < p - 1) { e += x[i]; continue; }
    if (i === p - 1) { e = (e + x[i]) / p; r[i] = e; continue; }
    e = x[i] * k + e * (1 - k); r[i] = e;
  }
  return r;
}
// Média de Wilder (RMA), a base do RSI e do ATR.
function rma(x, p, ini = 0) {
  const r = nan(x.length); let e = 0;
  for (let i = ini; i < x.length; i++) {
    const j = i - ini;
    if (j < p - 1) { e += x[i]; continue; }
    if (j === p - 1) { e = (e + x[i]) / p; r[i] = e; continue; }
    e = (e * (p - 1) + x[i]) / p; r[i] = e;
  }
  return r;
}
export function rsi(c, p) {
  const n = c.length, up = new Float64Array(n), dn = new Float64Array(n);
  for (let i = 1; i < n; i++) { const d = c[i] - c[i - 1]; up[i] = d > 0 ? d : 0; dn[i] = d < 0 ? -d : 0; }
  const au = rma(up, p, 1), ad = rma(dn, p, 1), r = nan(n);
  for (let i = 0; i < n; i++) if (!Number.isNaN(au[i])) r[i] = ad[i] === 0 ? 100 : 100 - 100 / (1 + au[i] / ad[i]);
  return r;
}
export function atr(h, l, c, p) {
  const n = c.length, tr = new Float64Array(n);
  tr[0] = h[0] - l[0];
  for (let i = 1; i < n; i++) tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  return rma(tr, p);
}
function desvio(x, p, media) {
  const r = nan(x.length);
  for (let i = p - 1; i < x.length; i++) { let s = 0; for (let j = i - p + 1; j <= i; j++) s += (x[j] - media[i]) ** 2; r[i] = Math.sqrt(s / p); }
  return r;
}
export function bollinger(c, p, k, lado) {
  const m = sma(c, p), d = desvio(c, p, m), r = nan(c.length);
  for (let i = 0; i < c.length; i++) r[i] = m[i] + lado * k * d[i];
  return r;
}
// Máxima/mínima das p barras ANTERIORES (sem a atual): "fechou acima da máxima de 20" faz sentido.
export function maiorAnterior(h, p) {
  const r = nan(h.length);
  for (let i = p; i < h.length; i++) { let m = -Infinity; for (let j = i - p; j < i; j++) if (h[j] > m) m = h[j]; r[i] = m; }
  return r;
}
export function menorAnterior(l, p) {
  const r = nan(l.length);
  for (let i = p; i < l.length; i++) { let m = Infinity; for (let j = i - p; j < i; j++) if (l[j] < m) m = l[j]; r[i] = m; }
  return r;
}
export function estocastico(h, l, c, p) {
  const r = nan(c.length);
  for (let i = p - 1; i < c.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - p + 1; j <= i; j++) { if (h[j] > hi) hi = h[j]; if (l[j] < lo) lo = l[j]; }
    r[i] = hi === lo ? 50 : (100 * (c[i] - lo)) / (hi - lo);
  }
  return r;
}
export function cci(h, l, c, p) {
  const n = c.length, tp = new Float64Array(n);
  for (let i = 0; i < n; i++) tp[i] = (h[i] + l[i] + c[i]) / 3;
  const m = sma(tp, p), r = nan(n);
  for (let i = p - 1; i < n; i++) {
    let s = 0; for (let j = i - p + 1; j <= i; j++) s += Math.abs(tp[j] - m[i]);
    const md = s / p; r[i] = md === 0 ? 0 : (tp[i] - m[i]) / (0.015 * md);
  }
  return r;
}
export function roc(c, p) {
  const r = nan(c.length);
  for (let i = p; i < c.length; i++) r[i] = (100 * (c[i] - c[i - p])) / c[i - p];
  return r;
}
export function macd(c, rapida, lenta) {
  const a = ema(c, rapida), b = ema(c, lenta), r = nan(c.length);
  for (let i = 0; i < c.length; i++) r[i] = a[i] - b[i];
  return r;
}

// Catálogo: nome -> como calcular, que escala tem (só se compara o que tem a mesma escala)
// e a faixa dos parâmetros que o gerador sorteia.
export const CATALOGO = {
  preco:   { escala: "preco", params: [], calc: (s, _p, campo = "fechamento") => s[campo] },
  sma:     { escala: "preco", params: [[5, 200]], calc: (s, [p]) => sma(s.fechamento, p) },
  ema:     { escala: "preco", params: [[5, 200]], calc: (s, [p]) => ema(s.fechamento, p) },
  bb_sup:  { escala: "preco", params: [[10, 50], [1, 3]], calc: (s, [p, k]) => bollinger(s.fechamento, p, k, 1) },
  bb_inf:  { escala: "preco", params: [[10, 50], [1, 3]], calc: (s, [p, k]) => bollinger(s.fechamento, p, k, -1) },
  maxima_n: { escala: "preco", params: [[5, 100]], calc: (s, [p]) => maiorAnterior(s.maxima, p) },
  minima_n: { escala: "preco", params: [[5, 100]], calc: (s, [p]) => menorAnterior(s.minima, p) },
  rsi:     { escala: "rsi", params: [[2, 30]], calc: (s, [p]) => rsi(s.fechamento, p), faixa: [5, 95], centro: 50 },
  estoc:   { escala: "estoc", params: [[5, 30]], calc: (s, [p]) => estocastico(s.maxima, s.minima, s.fechamento, p), faixa: [5, 95], centro: 50 },
  cci:     { escala: "cci", params: [[10, 50]], calc: (s, [p]) => cci(s.maxima, s.minima, s.fechamento, p), faixa: [-250, 250], centro: 0 },
  roc:     { escala: "roc", params: [[2, 50]], calc: (s, [p]) => roc(s.fechamento, p), faixa: [-10, 10], centro: 0 },
  macd:    { escala: "macd", params: [[5, 15], [20, 40]], calc: (s, [a, b]) => macd(s.fechamento, a, b), faixa: [0, 0], centro: 0 },
};

// Cache por série: o gerador avalia milhares de estratégias sobre os mesmos indicadores.
export function indicador(serie, op) {
  const def = CATALOGO[op.ind];
  if (!def) throw new Error(`indicador desconhecido: ${op.ind}`);
  if (op.ind === "preco") return serie[op.campo || "fechamento"];
  const chave = `${op.ind}:${op.p.join(",")}`;
  serie._cache ||= new Map();
  let v = serie._cache.get(chave);
  if (!v) { v = def.calc(serie, op.p); serie._cache.set(chave, v); }
  return v;
}
export function atrDaSerie(serie, p) {
  const chave = `atr:${p}`; serie._cache ||= new Map();
  let v = serie._cache.get(chave);
  if (!v) { v = atr(serie.maxima, serie.minima, serie.fechamento, p); serie._cache.set(chave, v); }
  return v;
}
