// Métricas de um backtest. Tudo em % do capital (notional fixo 1x).
export function barrasPorAno(serie) {
  const n = Math.min(serie.n, 500); if (n < 3) return 252;
  const dif = []; for (let i = 1; i < n; i++) dif.push(serie.tempo[i] - serie.tempo[i - 1]);
  dif.sort((a, b) => a - b);
  const med = dif[Math.floor(dif.length / 2)];
  if (med >= 20 * 3600e3) { // diário: conta pregões reais por ano
    const anos = (serie.tempo[serie.n - 1] - serie.tempo[0]) / (365.25 * 864e5);
    return anos > 0.5 ? serie.n / anos : 252;
  }
  const anos = (serie.tempo[serie.n - 1] - serie.tempo[0]) / (365.25 * 864e5);
  return anos > 0.1 ? serie.n / anos : (365.25 * 864e5) / med;
}

export function maxDrawdown(eq) {
  let pico = 0, dd = 0;
  for (const v of eq) { if (v > pico) pico = v; if (pico - v > dd) dd = pico - v; }
  return dd;
}

export function metricas({ trades, equity }, serie, barrasNoMercado = 0) {
  const n = trades.length, rets = trades.map((t) => t.ret);
  const lucro = rets.reduce((a, b) => a + b, 0);
  const ganhos = rets.filter((x) => x > 0), perdas = rets.filter((x) => x <= 0);
  const somaG = ganhos.reduce((a, b) => a + b, 0), somaP = -perdas.reduce((a, b) => a + b, 0);
  const media = n ? lucro / n : 0;
  const dp = n > 1 ? Math.sqrt(rets.reduce((a, x) => a + (x - media) ** 2, 0) / (n - 1)) : 0;
  const dd = maxDrawdown(equity);
  // Sharpe anualizado pelas variações da curva de capital barra a barra.
  const bpa = barrasPorAno(serie);
  let sm = 0, sq = 0; const m = equity.length;
  for (let i = 1; i < m; i++) { const d = equity[i] - equity[i - 1]; sm += d; sq += d * d; }
  const md = m > 1 ? sm / (m - 1) : 0, vd = m > 2 ? sq / (m - 1) - md * md : 0;
  const sharpe = vd > 0 ? (md / Math.sqrt(vd)) * Math.sqrt(bpa) : 0;
  // Estabilidade: R² da reta que melhor explica a curva (1 = sobe sem tropeço).
  let r2 = 0;
  if (m > 2) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < m; i++) { const y = equity[i]; sx += i; sy += y; sxx += i * i; sxy += i * y; syy += y * y; }
    const cov = sxy - (sx * sy) / m, vx = sxx - (sx * sx) / m, vy = syy - (sy * sy) / m;
    r2 = vx > 0 && vy > 0 ? (cov * cov) / (vx * vy) : 0;
    if (cov < 0) r2 = -r2;
  }
  const anos = m / bpa;
  const r = (x, c = 2) => Math.round(x * 10 ** c) / 10 ** c;
  return {
    operacoes: n,
    lucro_pct: r(lucro),
    lucro_ano_pct: r(anos > 0 ? lucro / anos : 0),
    fator_lucro: r(somaP > 0 ? somaG / somaP : somaG > 0 ? 99 : 0),
    acerto_pct: r(n ? (100 * ganhos.length) / n : 0, 1),
    media_pct: r(media, 3),
    dd_max_pct: r(dd),
    retorno_dd: r(dd > 0 ? lucro / dd : lucro > 0 ? 99 : 0),
    sharpe: r(sharpe),
    sqn: r(dp > 0 ? (Math.sqrt(Math.min(n, 100)) * media) / dp : 0),
    estabilidade: r(r2, 3),
    exposicao_pct: r(m ? (100 * barrasNoMercado) / m : 0, 1),
    anos: r(anos, 2),
  };
}
