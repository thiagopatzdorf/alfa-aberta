// Gráficos em canvas, à mão: nítidos em HiDPI, cores lidas das variáveis CSS (tema claro e
// escuro), uma cor para a estratégia (acento = dentro da amostra), âmbar só para o que é
// fora da amostra e cinza para contexto. Nada de arco-íris.
import { mesAno, dataHora, pct, compacto, menosMovimento } from "./util.js";

export function cores() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { tinta: v("--tinta"), tinta2: v("--tinta-2"), tinta3: v("--tinta-3"), grade: v("--grade"), eixo: v("--borda-forte"),
    acento: v("--acento"), fora: v("--fora"), fundo: v("--superficie"), bom: v("--bom"), ruim: v("--ruim"),
    mono: v("--fonte-mono") || "monospace" };
}

export function preparar(canvas, altura) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = Math.max(10, canvas.clientWidth), h = altura ?? Math.max(10, canvas.clientHeight);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h, dpr };
}

// Marcas "redondas" para eixos (1, 2, 2,5, 5 × 10^k).
export function marcas(min, max, alvo = 5) {
  if (!(max > min)) { max = min + 1; }
  const bruto = (max - min) / alvo, mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => bruto <= p) || 10 * mag;
  const r = []; for (let v = Math.ceil(min / passo) * passo; v <= max + passo * 1e-9; v += passo) r.push(Math.abs(v) < passo * 1e-9 ? 0 : v);
  return r;
}

const fmtEixo = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";

// Sparkline da curva de capital: acento até o corte, âmbar depois.
export function sparkline(canvas, valores, corteFracao = null) {
  const { ctx, w, h } = preparar(canvas);
  const C = cores();
  if (!valores || valores.length < 2) return;
  let lo = Infinity, hi = -Infinity; for (const v of valores) { if (v < lo) lo = v; if (v > hi) hi = v; }
  lo = Math.min(lo, 0); hi = Math.max(hi, 0); if (hi - lo < 1e-9) hi = lo + 1;
  const X = (i) => 1 + (i / (valores.length - 1)) * (w - 2), Y = (v) => h - 2 - ((v - lo) / (hi - lo)) * (h - 4);
  ctx.strokeStyle = C.grade; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, Math.round(Y(0)) + 0.5); ctx.lineTo(w, Math.round(Y(0)) + 0.5); ctx.stroke();
  const k = corteFracao == null ? valores.length : Math.round(corteFracao * (valores.length - 1));
  ctx.lineWidth = 1.25; ctx.lineJoin = "round";
  ctx.strokeStyle = C.acento; ctx.beginPath(); for (let i = 0; i <= Math.min(k, valores.length - 1); i++) i ? ctx.lineTo(X(i), Y(valores[i])) : ctx.moveTo(X(i), Y(valores[i])); ctx.stroke();
  if (k < valores.length - 1) { ctx.strokeStyle = C.fora; ctx.beginPath(); for (let i = k; i < valores.length; i++) i === k ? ctx.moveTo(X(i), Y(valores[i])) : ctx.lineTo(X(i), Y(valores[i])); ctx.stroke(); }
}

export function reduzir(arr, n = 80) {
  if (arr.length <= n) return Array.from(arr);
  const r = []; for (let i = 0; i < n; i++) r.push(arr[Math.round((i / (n - 1)) * (arr.length - 1))]);
  return r;
}

// Aptidão da melhor estratégia por geração: uma linha fina por ilha, a melhor de todas no acento.
export function linhasAptidao(canvas, porIlha, geracoes) {
  const { ctx, w, h } = preparar(canvas);
  const C = cores();
  const m = { e: 34, d: 8, t: 8, b: 18 };
  const todas = porIlha.flat().filter(Number.isFinite);
  ctx.font = `10px ${C.mono}`; ctx.fillStyle = C.tinta3; ctx.textBaseline = "middle";
  if (!todas.length) { ctx.textAlign = "center"; ctx.fillText("aguardando a 1ª geração", w / 2, h / 2); return; }
  let lo = Math.min(0, ...todas), hi = Math.max(...todas); if (hi - lo < 1e-6) hi = lo + 1;
  const G = Math.max(2, geracoes);
  const X = (g) => m.e + ((g - 1) / (G - 1)) * (w - m.e - m.d), Y = (v) => h - m.b - ((v - lo) / (hi - lo)) * (h - m.t - m.b);
  const ys = marcas(lo, hi, 3);
  ctx.textAlign = "right"; ctx.lineWidth = 1;
  for (const v of ys) { const y = Math.round(Y(v)) + 0.5; ctx.strokeStyle = C.grade; ctx.beginPath(); ctx.moveTo(m.e, y); ctx.lineTo(w - m.d, y); ctx.stroke(); ctx.fillText(v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }), m.e - 6, y); }
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillText("geração 1", m.e, h - 4);
  ctx.textAlign = "right"; ctx.fillText(String(G), w - m.d, h - 4);
  const melhor = [];
  for (const serie of porIlha) serie.forEach((v, g) => { if (Number.isFinite(v)) melhor[g] = Math.max(melhor[g] ?? -Infinity, v); });
  ctx.lineJoin = "round";
  for (const serie of porIlha) {
    ctx.strokeStyle = C.tinta3; ctx.globalAlpha = 0.55; ctx.lineWidth = 1; ctx.beginPath();
    serie.forEach((v, g) => { if (!Number.isFinite(v)) return; g ? ctx.lineTo(X(g + 1), Y(v)) : ctx.moveTo(X(1), Y(v)); }); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.strokeStyle = C.acento; ctx.lineWidth = 2; ctx.beginPath();
  melhor.forEach((v, g) => (g ? ctx.lineTo(X(g + 1), Y(v)) : ctx.moveTo(X(1), Y(v)))); ctx.stroke();
  const g = melhor.length - 1; ctx.fillStyle = C.acento; ctx.beginPath(); ctx.arc(X(g + 1), Y(melhor[g]), 3, 0, 7); ctx.fill();
}

// Nuvem de estratégias avaliadas: drawdown × lucro dentro da amostra. Os pontos novos chegam
// no acento e esfriam para cinza; o banco final aparece por cima, dentro (acento) ligado ao
// fora da amostra (âmbar) da mesma estratégia.
export class Dispersao {
  constructor(canvas, legendaTotal) {
    this.canvas = canvas; this.total = legendaTotal;
    this.base = document.createElement("canvas");
    this.limpar();
    new ResizeObserver(() => this.redesenharTudo()).observe(canvas);
  }
  limpar() {
    this.x = new Float32Array(8192); this.y = new Float32Array(8192); this.f = new Float32Array(8192); this.n = 0;
    this.lotes = []; this.assentados = 0; this.banco = []; this.dom = { x: 30, ylo: -30, yhi: 60 }; this.nDom = 0;
    this.redesenharTudo();
  }
  adicionar(trincas) {
    const k = trincas.length / 3; if (!k) return;
    if (this.n + k > this.x.length) {
      const cap = Math.max(this.x.length * 2, this.n + k);
      for (const c of ["x", "y", "f"]) { const novo = new Float32Array(cap); novo.set(this[c].subarray(0, this.n)); this[c] = novo; }
    }
    for (let i = 0; i < k; i++) { this.y[this.n + i] = trincas[3 * i]; this.x[this.n + i] = trincas[3 * i + 1]; this.f[this.n + i] = trincas[3 * i + 2]; }
    this.lotes.push({ ini: this.n, fim: this.n + k, t: performance.now() });
    this.n += k;
    if (this.n > this.nDom * 1.35 + 50) this.ajustarDominio();
    this.pedir();
  }
  definirBanco(itens) { this.banco = itens; this.pedir(); }
  ajustarDominio() {
    this.nDom = this.n;
    const passo = Math.max(1, Math.floor(this.n / 3000)), xs = [], ys = [];
    for (let i = 0; i < this.n; i += passo) { xs.push(this.x[i]); ys.push(this.y[i]); }
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
    // Domínio robusto: a maioria das estratégias aleatórias é ruim e algumas são absurdas
    // (drawdown de milhares de %); os extremos encostam na borda em vez de achatar a nuvem.
    const novo = { x: Math.max(20, q(xs, 0.9) * 1.25), ylo: Math.min(-20, q(ys, 0.04) * 1.15), yhi: Math.max(40, q(ys, 0.985) * 1.1) };
    for (const b of this.banco) { novo.x = Math.max(novo.x, b.dx * 1.1, b.fx * 1.1); novo.yhi = Math.max(novo.yhi, b.dy * 1.1, b.fy * 1.1); novo.ylo = Math.min(novo.ylo, b.fy * 1.1); }
    const mudou = Math.abs(novo.x - this.dom.x) / this.dom.x > 0.04 || Math.abs(novo.yhi - this.dom.yhi) / this.dom.yhi > 0.04 || Math.abs(novo.ylo - this.dom.ylo) / Math.abs(this.dom.ylo) > 0.04;
    if (mudou) { this.dom = novo; this.redesenharBase(); }
  }
  geom() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, m = { e: 52, d: 12, t: 22, b: 34 };
    const { x, ylo, yhi } = this.dom;
    return { w, h, m, X: (v) => m.e + (Math.min(Math.max(v, 0), x) / x) * (w - m.e - m.d), Y: (v) => h - m.b - ((Math.min(Math.max(v, ylo), yhi) - ylo) / (yhi - ylo)) * (h - m.t - m.b) };
  }
  redesenharTudo() { this.redesenharBase(); this.pedir(); }
  redesenharBase() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const { w, h, m, X, Y } = this.geom();
    if (w < 10 || h < 10) return;
    this.base.width = Math.round(w * dpr); this.base.height = Math.round(h * dpr);
    const ctx = this.base.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const C = (this.C = cores());
    ctx.font = `10px ${C.mono}`; ctx.lineWidth = 1;
    ctx.fillStyle = C.tinta3; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (const v of marcas(this.dom.ylo, this.dom.yhi, 5)) {
      const y = Math.round(Y(v)) + 0.5; ctx.strokeStyle = v === 0 ? C.eixo : C.grade;
      ctx.beginPath(); ctx.moveTo(m.e, y); ctx.lineTo(w - m.d, y); ctx.stroke(); ctx.fillText(fmtEixo(v), m.e - 6, y);
    }
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (const v of marcas(0, this.dom.x, 6)) { const x = Math.round(X(v)) + 0.5; ctx.strokeStyle = C.grade; ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, h - m.b); ctx.stroke(); ctx.fillText(v.toLocaleString("pt-BR") + "%", x, h - m.b + 5); }
    ctx.fillStyle = C.tinta2; ctx.textAlign = "right"; ctx.fillText("drawdown máximo →", w - m.d, h - 13);
    ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText("↑ lucro dentro da amostra", m.e + 6, 2);
    this.assentados = 0; this.assentar(ctx, this.fimAssentado());
  }
  fimAssentado() { return this.lotes.length ? this.lotes[0].ini : this.n; }
  assentar(ctx, ate) {
    const { X, Y } = this.geom(), C = this.C || cores();
    for (let i = this.assentados; i < ate; i++) {
      const bom = this.f[i] > 0;
      ctx.globalAlpha = bom ? 0.55 : 0.28; ctx.fillStyle = bom ? C.tinta2 : C.tinta3;
      ctx.fillRect(X(this.x[i]) - 1, Y(this.y[i]) - 1, 2, 2);
    }
    ctx.globalAlpha = 1; this.assentados = Math.max(this.assentados, ate);
  }
  pedir() { if (!this.agendado) { this.agendado = true; requestAnimationFrame(() => { this.agendado = false; this.desenhar(); }); } }
  desenhar() {
    const { ctx, w, h } = preparar(this.canvas);
    if (w < 10) return;
    const agora = performance.now(), vida = menosMovimento() ? 0 : 900;
    // Lotes que já esfriaram vão para a camada de base (desenhada uma vez só).
    while (this.lotes.length && agora - this.lotes[0].t >= vida) this.lotes.shift();
    if (this.fimAssentado() > this.assentados) this.assentar(this.base.getContext("2d"), this.fimAssentado());
    if (!this.base.width) this.redesenharBase();
    if (this.base.width) ctx.drawImage(this.base, 0, 0, w, h);
    const { X, Y } = this.geom(), C = this.C || cores();
    for (const l of this.lotes) {
      const a = 1 - (agora - l.t) / vida; ctx.fillStyle = C.acento; ctx.globalAlpha = 0.25 + 0.75 * a;
      for (let i = l.ini; i < l.fim; i++) ctx.fillRect(X(this.x[i]) - 1.5, Y(this.y[i]) - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    if (this.banco.length) {
      ctx.lineWidth = 1;
      for (const b of this.banco) { ctx.strokeStyle = C.tinta3; ctx.beginPath(); ctx.moveTo(X(b.dx), Y(b.dy)); ctx.lineTo(X(b.fx), Y(b.fy)); ctx.stroke(); }
      for (const b of this.banco) {
        ctx.fillStyle = C.fora; ctx.beginPath(); ctx.arc(X(b.fx), Y(b.fy), 3.5, 0, 7); ctx.fill();
        ctx.fillStyle = C.acento; ctx.beginPath(); ctx.arc(X(b.dx), Y(b.dy), 3.5, 0, 7); ctx.fill();
        ctx.strokeStyle = C.fundo; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    if (this.total) this.total.textContent = this.n.toLocaleString("pt-BR");
    if (this.lotes.length) this.pedir();
  }
}

// Curva de capital completa: acento dentro da amostra, âmbar fora, faixa do fora sombreada,
// datas reais no eixo, preço opcional num painel próprio (nunca dois eixos y no mesmo gráfico).
export class GraficoEquity {
  constructor(canvas, dica) {
    this.canvas = canvas; this.dica = dica; this.cursor = null;
    new ResizeObserver(() => this.desenhar()).observe(canvas);
    canvas.addEventListener("pointermove", (e) => { const r = canvas.getBoundingClientRect(); this.mover(e.clientX - r.left); });
    canvas.addEventListener("pointerleave", () => { this.cursor = null; this.desenhar(); });
    canvas.addEventListener("keydown", (e) => {
      if (!this.d) return;
      const n = this.d.equity.length, passo = Math.max(1, Math.round(n / 100)) * (e.shiftKey ? 10 : 1);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); this.cursor = Math.min(n - 1, Math.max(0, (this.cursor ?? (e.key === "ArrowRight" ? -1 : n)) + (e.key === "ArrowRight" ? passo : -passo))); this.desenhar(); }
      else if (e.key === "Escape") { this.cursor = null; this.desenhar(); }
    });
    canvas.addEventListener("blur", () => { this.cursor = null; this.desenhar(); });
  }
  definir(d) { this.d = d; this.desenhar(); }
  geom() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, m = { e: 56, d: 14, t: 22, b: 26 };
    const preco = this.d && this.d.mostrarPreco && this.d.preco;
    const hEq = preco ? Math.round((h - m.t - m.b) * 0.66) : h - m.t - m.b;
    return { w, h, m, hEq, preco, hPr: preco ? h - m.t - m.b - hEq - 18 : 0 };
  }
  mover(px) {
    if (!this.d) return;
    const { w, m } = this.geom(), n = this.d.equity.length;
    this.cursor = Math.round(Math.min(1, Math.max(0, (px - m.e) / (w - m.e - m.d))) * (n - 1));
    this.desenhar();
  }
  desenhar() {
    const { ctx } = preparar(this.canvas);
    if (!this.d) return;
    const C = cores(), { tempo, equity, corte } = this.d, n = equity.length;
    const { w, m, hEq, preco, hPr } = this.geom(), largura = w - m.e - m.d;
    let lo = 0, hi = 0; for (const v of equity) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const folga = (hi - lo) * 0.06 || 1; lo -= folga; hi += folga;
    const X = (i) => m.e + (i / (n - 1)) * largura, Y = (v) => m.t + hEq - ((v - lo) / (hi - lo)) * hEq;
    // faixa fora da amostra
    if (corte != null && corte < n) {
      ctx.fillStyle = C.fora; ctx.globalAlpha = 0.07; ctx.fillRect(X(corte), m.t, X(n - 1) - X(corte), hEq + (preco ? hPr + 18 : 0)); ctx.globalAlpha = 1;
    }
    ctx.font = `10.5px ${C.mono}`; ctx.lineWidth = 1;
    ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillStyle = C.tinta3;
    for (const v of marcas(lo, hi, 5)) { const y = Math.round(Y(v)) + 0.5; ctx.strokeStyle = v === 0 ? C.eixo : C.grade; ctx.beginPath(); ctx.moveTo(m.e, y); ctx.lineTo(w - m.d, y); ctx.stroke(); ctx.fillText(fmtEixo(v), m.e - 8, y); }
    // anos no eixo x
    const anos = []; let ultimo = null;
    for (let i = 0; i < n; i++) { const a = new Date(tempo[i]).getUTCFullYear(); if (a !== ultimo) { if (ultimo !== null) anos.push([i, a]); ultimo = a; } }
    const pulo = Math.max(1, Math.ceil(anos.length / Math.max(2, Math.floor(largura / 70))));
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const base = this.canvas.clientHeight - m.b;
    anos.forEach(([i, a], k) => { if (k % pulo) return; const x = Math.round(X(i)) + 0.5; ctx.strokeStyle = C.grade; ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, base + 4); ctx.stroke(); ctx.fillStyle = C.tinta3; ctx.fillText(String(a), x, base + 7); });
    // linha da curva: mínimo e máximo por coluna de pixel, para 17 mil barras não virarem borrão
    const linha = (ini, fim, cor) => {
      ctx.strokeStyle = cor; ctx.lineWidth = 1.5; ctx.lineJoin = "round"; ctx.beginPath();
      const porPx = (n - 1) / largura; let primeiro = true;
      if (porPx <= 1) { for (let i = ini; i <= fim; i++) primeiro ? (ctx.moveTo(X(i), Y(equity[i])), (primeiro = false)) : ctx.lineTo(X(i), Y(equity[i])); }
      else for (let px = Math.floor((ini / (n - 1)) * largura); px <= Math.ceil((fim / (n - 1)) * largura); px++) {
        const a = Math.max(ini, Math.floor(px * porPx)), b = Math.min(fim, Math.floor((px + 1) * porPx)); if (a > b) continue;
        let mn = Infinity, mx = -Infinity; for (let i = a; i <= b; i++) { const v = equity[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
        const x = m.e + px; if (primeiro) { ctx.moveTo(x, Y(equity[a])); primeiro = false; }
        ctx.lineTo(x, Y(mn)); ctx.lineTo(x, Y(mx));
      }
      ctx.stroke();
    };
    const k = corte != null && corte < n ? corte : n - 1;
    linha(0, k, C.acento); if (k < n - 1) linha(k, n - 1, C.fora);
    if (corte != null && corte < n) {
      const x = Math.round(X(corte)) + 0.5; ctx.strokeStyle = C.fora; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, m.t - 6); ctx.lineTo(x, m.t + hEq + (preco ? hPr + 18 : 0)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.tinta2; ctx.textBaseline = "bottom"; ctx.font = `10.5px ${C.mono}`;
      const rot = `corte ${new Date(tempo[corte]).toISOString().slice(0, 10).split("-").reverse().join("/")}`;
      ctx.textAlign = X(corte) > w - 160 ? "right" : "left"; ctx.fillText(ctx.textAlign === "left" ? `${rot} · fora da amostra →` : `← dentro · ${rot}`, x + (ctx.textAlign === "left" ? 6 : -6), m.t - 6);
    }
    // painel de preço (log), em cinza: contexto, não protagonista
    let YP = null;
    if (preco) {
      const top = m.t + hEq + 18; let pl = Infinity, ph = -Infinity; for (const v of preco) { if (v > 0 && v < pl) pl = v; if (v > ph) ph = v; }
      const L = Math.log, lpl = L(pl), lph = L(ph);
      YP = (v) => top + hPr - ((L(Math.max(v, pl)) - lpl) / (lph - lpl || 1)) * hPr;
      ctx.strokeStyle = C.grade; ctx.beginPath(); ctx.moveTo(m.e, top - 9.5); ctx.lineTo(w - m.d, top - 9.5); ctx.stroke();
      ctx.fillStyle = C.tinta3; ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.font = `10.5px ${C.mono}`;
      for (const v of [pl, Math.sqrt(pl * ph), ph]) ctx.fillText(compacto(v), m.e - 8, YP(v));
      ctx.textAlign = "left"; ctx.fillText("preço (log)", m.e + 4, top + 2);
      ctx.strokeStyle = C.tinta2; ctx.lineWidth = 1; ctx.beginPath();
      const passo = Math.max(1, Math.floor((n - 1) / largura));
      for (let i = 0; i < n; i += passo) i ? ctx.lineTo(X(i), YP(preco[i])) : ctx.moveTo(X(i), YP(preco[i]));
      ctx.stroke();
    }
    // cursor + dica
    if (this.cursor != null) {
      const i = this.cursor, x = Math.round(X(i)) + 0.5, cor = corte != null && i >= corte ? C.fora : C.acento;
      ctx.strokeStyle = C.tinta3; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, this.canvas.clientHeight - m.b); ctx.stroke();
      ctx.fillStyle = cor; ctx.beginPath(); ctx.arc(X(i), Y(equity[i]), 4, 0, 7); ctx.fill(); ctx.strokeStyle = C.fundo; ctx.lineWidth = 1.5; ctx.stroke();
      if (YP) { ctx.fillStyle = C.tinta2; ctx.beginPath(); ctx.arc(X(i), YP(preco[i]), 3, 0, 7); ctx.fill(); }
      if (this.dica) {
        const fora = corte != null && i >= corte;
        this.dica.hidden = false;
        this.dica.innerHTML = `<b>${dataHora(tempo[i])}</b><span>capital <em style="color:${cor}">${pct(equity[i], 2)}</em></span>${preco ? `<span>preço ${preco[i].toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</span>` : ""}<span class="mudo">${fora ? "fora da amostra" : "dentro da amostra"}</span>`;
        const dw = this.dica.offsetWidth, px = X(i) + 12 + dw > w ? X(i) - 12 - dw : X(i) + 12;
        this.dica.style.transform = `translate(${Math.round(px)}px, ${Math.round(Math.max(4, Math.min(Y(equity[i]) - 20, this.canvas.clientHeight - 80)))}px)`;
      }
    } else if (this.dica) this.dica.hidden = true;
    this.canvas.setAttribute("aria-label", `Curva de capital de ${mesAno(tempo[0])} a ${mesAno(tempo[n - 1])}: termina em ${pct(equity[n - 1], 1)}. Setas movem o cursor.`);
  }
}
