// Série de preços (OHLCV) em arrays tipados e os leitores das fontes grátis.
// Uma série é { nome, tempo: Float64Array (ms UTC), abertura, maxima, minima, fechamento, volume }.

export function criarSerie(nome, barras) {
  const n = barras.length;
  const s = { nome, n, tempo: new Float64Array(n), abertura: new Float64Array(n), maxima: new Float64Array(n),
    minima: new Float64Array(n), fechamento: new Float64Array(n), volume: new Float64Array(n), ajustes: [] };
  barras.forEach((b, i) => {
    s.tempo[i] = b.t; s.abertura[i] = b.o; s.maxima[i] = b.h; s.minima[i] = b.l; s.fechamento[i] = b.c; s.volume[i] = b.v || 0;
  });
  return s;
}

// CSV genérico: cabeçalho com time/date, open, high, low, close[, volume] (qualquer caixa, PT ou EN).
const APELIDOS = { t: ["t", "time", "date", "data", "datetime", "timestamp", "tempo", "open_time"], o: ["open", "abertura", "o"],
  h: ["high", "maxima", "máxima", "h"], l: ["low", "minima", "mínima", "l"], c: ["close", "fechamento", "c"], v: ["volume", "vol", "v"] };

function lerTempo(x) {
  const num = Number(x);
  if (Number.isFinite(num) && x.trim() !== "") {
    if (num > 1e15) return Math.floor(num / 1000); // microssegundos (Binance desde 2025)
    if (num > 1e11) return num;                     // milissegundos
    return num * 1000;                              // segundos
  }
  const d = Date.parse(x.includes("T") || x.includes(" ") ? x.replace(" ", "T") + (/[zZ+]/.test(x.slice(10)) ? "" : "Z") : x + "T00:00:00Z");
  if (!Number.isFinite(d)) throw new Error(`data ilegível: ${x}`);
  return d;
}

export function lerCsv(texto, nome = "serie") {
  const linhas = texto.trim().split(/\r?\n/);
  const sep = linhas[0].includes(";") ? ";" : ",";
  const cab = linhas[0].split(sep).map((x) => x.trim().toLowerCase().replace(/"/g, ""));
  const temCab = cab.some((c) => APELIDOS.c.includes(c));
  const idx = {};
  if (temCab) {
    for (const [k, nomes] of Object.entries(APELIDOS)) idx[k] = cab.findIndex((c) => nomes.includes(c));
    for (const k of ["t", "o", "h", "l", "c"]) if (idx[k] < 0) throw new Error(`coluna ausente: ${APELIDOS[k][0]}`);
  } else Object.assign(idx, { t: 0, o: 1, h: 2, l: 3, c: 4, v: 5 }); // formato Binance: sem cabeçalho
  const barras = [];
  for (const linha of linhas.slice(temCab ? 1 : 0)) {
    if (!linha.trim()) continue;
    const p = linha.split(sep).map((x) => x.trim().replace(/"/g, ""));
    const b = { t: lerTempo(p[idx.t]), o: +p[idx.o], h: +p[idx.h], l: +p[idx.l], c: +p[idx.c], v: idx.v >= 0 ? +p[idx.v] || 0 : 0 };
    if (![b.o, b.h, b.l, b.c].every(Number.isFinite)) throw new Error(`linha com preço inválido: ${linha.slice(0, 80)}`);
    barras.push(b);
  }
  barras.sort((a, b) => a.t - b.t);
  return criarSerie(nome, barras);
}

// COTAHIST da B3 (layout fixo de 245 colunas, preços com 2 casas implícitas).
// Só o mercado à vista (TPMERC 010) e o papel pedido.
export function lerCotahist(texto, papel) {
  const barras = [];
  for (const l of texto.split(/\r?\n/)) {
    if (!l.startsWith("01") || l.slice(24, 27) !== "010") continue;
    if (l.slice(12, 24).trim() !== papel) continue;
    const d = l.slice(2, 10);
    const preco = (ini) => Number(l.slice(ini, ini + 13)) / 100;
    barras.push({ t: Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)), o: preco(56), h: preco(69), l: preco(82),
      c: preco(108), v: Number(l.slice(170, 188)) / 100 });
  }
  barras.sort((a, b) => a.t - b.t);
  return barras;
}

// O COTAHIST não ajusta desdobramento nem grupamento. Um salto noturno que bate com uma razão
// limpa (2, 3, 4, 5, 8, 10, 20, 100 e os inversos) e passa de 35% é tratado como evento
// societário: os preços anteriores são divididos pela razão. Cada ajuste fica registrado.
const RAZOES = [2, 3, 4, 5, 8, 10, 20, 100];
export function ajustarEventos(barras) {
  const ajustes = [];
  for (let i = barras.length - 1; i > 0; i--) {
    const r = barras[i - 1].c / barras[i].o;
    if (Math.abs(Math.log(r)) < Math.log(1.35)) continue;
    const cand = [...RAZOES, ...RAZOES.map((x) => 1 / x)].find((x) => Math.abs(r / x - 1) < 0.12);
    if (!cand) continue;
    for (let j = 0; j < i; j++) { const b = barras[j]; b.o /= cand; b.h /= cand; b.l /= cand; b.c /= cand; b.v *= cand; }
    ajustes.push({ data: new Date(barras[i].t).toISOString().slice(0, 10), razao: Math.round(cand * 1000) / 1000 });
  }
  return ajustes.reverse();
}
