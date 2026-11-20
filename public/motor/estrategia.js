// A estratégia é um dado (JSON), não código: o gerador muta, o motor avalia, os exportadores
// traduzem. Forma:
// { versao: 1, direcao: "ambas"|"compra"|"venda",
//   entrada: [ { op: ">"|"<"|"cruza_acima"|"cruza_abaixo", a: Operando, b: Operando }, ... ]  (E lógico)
//   saida: { stop_atr, alvo_atr, barras_max, atr_p, inverter } }
// Operando: { ind: "sma", p: [20] } | { ind: "preco", campo: "fechamento" } | { k: 70 }
// A venda é o espelho da compra (> vira <, cruza acima vira cruza abaixo, constante de
// oscilador reflete no centro): uma regra só para os dois lados, como fazem os geradores do mercado.
import { CATALOGO, indicador } from "./indicadores.js";

const OP_ESPELHO = { ">": "<", "<": ">", cruza_acima: "cruza_abaixo", cruza_abaixo: "cruza_acima" };

export function escalaDe(op) { return op.k !== undefined ? null : CATALOGO[op.ind].escala; }

// Indicador de lado também espelha: na venda, "acima da banda superior" vira "abaixo da inferior"
// e "máxima de N" vira "mínima de N" (sem isso a venda de uma regra de rompimento nunca disparava).
const IND_ESPELHO = { bb_sup: "bb_inf", bb_inf: "bb_sup", maxima_n: "minima_n", minima_n: "maxima_n" };
const CAMPO_ESPELHO = { maxima: "minima", minima: "maxima" };
function espelharOperando(o, escala) {
  if (o.k === undefined) {
    if (IND_ESPELHO[o.ind]) return { ...o, ind: IND_ESPELHO[o.ind] };
    if (o.ind === "preco" && CAMPO_ESPELHO[o.campo]) return { ...o, campo: CAMPO_ESPELHO[o.campo] };
    return o;
  }
  const centro = CATALOGO_CENTRO[escala] ?? 0;
  return { k: arred(2 * centro - o.k) };
}
const CATALOGO_CENTRO = Object.fromEntries(Object.values(CATALOGO).filter((d) => d.centro !== undefined).map((d) => [d.escala, d.centro]));

export function espelhar(cond) {
  const escala = escalaDe(cond.a) || escalaDe(cond.b);
  return { op: OP_ESPELHO[cond.op], a: espelharOperando(cond.a, escala), b: espelharOperando(cond.b, escala) };
}

export const arred = (x) => Math.round(x * 100) / 100;

function valores(serie, o) {
  if (o.k !== undefined) return null;
  return indicador(serie, o);
}

// Sinal booleano (Uint8Array) de uma lista de condições: 1 onde TODAS valem no fechamento da barra.
export function sinais(serie, conds) {
  const n = serie.n, r = new Uint8Array(n).fill(1);
  for (const c of conds) {
    const a = valores(serie, c.a), b = valores(serie, c.b);
    const va = (i) => (a ? a[i] : c.a.k), vb = (i) => (b ? b[i] : c.b.k);
    // Arredondar a 6 casas antes de comparar: evita que ruído de ponto flutuante vire sinal
    // diferente entre JS, Python e as plataformas (regra aprendida na reconciliação do motor de referência).
    const r6 = (x) => Math.round(x * 1e6) / 1e6;
    for (let i = 0; i < n; i++) {
      if (!r[i]) continue;
      const x = r6(va(i)), y = r6(vb(i));
      let ok;
      if (Number.isNaN(x) || Number.isNaN(y)) ok = false;
      else if (c.op === ">") ok = x > y;
      else if (c.op === "<") ok = x < y;
      else {
        if (i === 0) { ok = false; } else {
          const x0 = r6(va(i - 1)), y0 = r6(vb(i - 1));
          if (Number.isNaN(x0) || Number.isNaN(y0)) ok = false;
          else ok = c.op === "cruza_acima" ? x0 <= y0 && x > y : x0 >= y0 && x < y;
        }
      }
      if (!ok) r[i] = 0;
    }
  }
  return r;
}

export function sinaisDaEstrategia(serie, est) {
  const compra = est.direcao !== "venda" ? sinais(serie, est.entrada) : new Uint8Array(serie.n);
  const venda = est.direcao !== "compra" ? sinais(serie, est.entrada.map(espelhar)) : new Uint8Array(serie.n);
  return { compra, venda };
}

// Chave canônica: duas estratégias iguais têm a mesma chave (o banco não guarda repetida).
export function chave(est) { return JSON.stringify([est.direcao, est.entrada, est.saida]); }

function txtOperando(o) {
  if (o.k !== undefined) return String(o.k);
  if (o.ind === "preco") return { fechamento: "fechamento", abertura: "abertura", maxima: "máxima", minima: "mínima" }[o.campo || "fechamento"];
  const nomes = { sma: "MMS", ema: "MME", bb_sup: "Bollinger sup", bb_inf: "Bollinger inf", maxima_n: "máxima", minima_n: "mínima",
    rsi: "IFR", estoc: "Estocástico", cci: "CCI", roc: "ROC", macd: "MACD" };
  if (o.ind === "maxima_n") return `máxima das ${o.p[0]} barras anteriores`;
  if (o.ind === "minima_n") return `mínima das ${o.p[0]} barras anteriores`;
  return `${nomes[o.ind]}(${o.p.join(", ")})`;
}
const TXT_OP = { ">": "maior que", "<": "menor que", cruza_acima: "cruza para cima", cruza_abaixo: "cruza para baixo" };

export function descrever(est) {
  const conds = est.entrada.map((c) => `${txtOperando(c.a)} ${TXT_OP[c.op]} ${txtOperando(c.b)}`).join(" E ");
  const s = est.saida, dir = { ambas: "Compra", compra: "Compra", venda: "Vende" }[est.direcao];
  const partes = [`${dir} quando ${conds}, na abertura da barra seguinte.`];
  if (est.direcao === "ambas") partes.push("A venda é o espelho: a mesma regra com os sinais trocados.");
  const saidas = [];
  if (s.stop_atr) saidas.push(`stop em ${s.stop_atr}×ATR(${s.atr_p})`);
  if (s.alvo_atr) saidas.push(`alvo em ${s.alvo_atr}×ATR(${s.atr_p})`);
  if (s.barras_max) saidas.push(`sai após ${s.barras_max} barras`);
  if (s.inverter) saidas.push("inverte no sinal contrário");
  partes.push(`Sai por ${saidas.join(", ") || "fim do teste"}.`);
  return partes.join(" ");
}

export function validar(est) {
  if (!est || est.versao !== 1) throw new Error("estratégia sem versao 1");
  if (!["ambas", "compra", "venda"].includes(est.direcao)) throw new Error("direcao inválida");
  if (!Array.isArray(est.entrada) || est.entrada.length < 1 || est.entrada.length > 6) throw new Error("entrada precisa de 1 a 6 condições");
  for (const c of est.entrada) {
    if (!OP_ESPELHO[c.op]) throw new Error(`operador inválido: ${c.op}`);
    for (const o of [c.a, c.b]) {
      if (o.k !== undefined) { if (!Number.isFinite(o.k)) throw new Error("constante inválida"); continue; }
      const d = CATALOGO[o.ind];
      if (!d) throw new Error(`indicador desconhecido: ${o.ind}`);
      if (o.ind !== "preco" && (!Array.isArray(o.p) || o.p.length !== d.params.length || !o.p.every((x, i) => x >= 1 && x <= 500 && (i > 0 && o.ind.startsWith("bb") ? true : Number.isInteger(x)))))
        throw new Error(`parâmetros inválidos em ${o.ind}`);
      if (o.ind === "preco" && !["abertura", "maxima", "minima", "fechamento"].includes(o.campo || "fechamento")) throw new Error("campo de preço inválido");
    }
    if (c.a.k !== undefined && c.b.k !== undefined) throw new Error("condição compara duas constantes");
    const ea = escalaDe(c.a), eb = escalaDe(c.b);
    if (ea && eb && ea !== eb) throw new Error(`escalas diferentes: ${ea} x ${eb}`);
  }
  const s = est.saida || {};
  if (!Number.isInteger(s.atr_p) || s.atr_p < 2 || s.atr_p > 100) throw new Error("atr_p inválido");
  for (const k of ["stop_atr", "alvo_atr"]) if (s[k] != null && !(s[k] > 0 && s[k] <= 20)) throw new Error(`${k} inválido`);
  if (s.barras_max != null && !(Number.isInteger(s.barras_max) && s.barras_max >= 1 && s.barras_max <= 1000)) throw new Error("barras_max inválido");
  if (!s.stop_atr && !s.alvo_atr && !s.barras_max && !s.inverter) throw new Error("estratégia sem nenhuma saída");
  return est;
}
