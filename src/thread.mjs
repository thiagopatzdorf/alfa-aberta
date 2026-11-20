// Thread de cálculo: roda o MESMO motor do navegador (public/motor). As séries do disco ficam em
// cache por thread; CSV enviado pela pessoa chega como texto e não fica guardado.
import { parentPort } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { lerCsv } from "../public/motor/dados.js";
import { evoluirIlha, fecharBanco } from "../public/motor/gerador.js";
import { atestar } from "../public/motor/robustez.js";
import { backtest } from "../public/motor/backtest.js";

const DADOS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "dados");
const cache = new Map();
export function carregarSerie(ref) {
  if (typeof ref === "object" && ref?.csv) return lerCsv(ref.csv, String(ref.nome || "csv").slice(0, 60));
  const nome = String(ref);
  if (!/^[A-Z0-9]{2,20}-[0-9a-z]{2,4}$/.test(nome)) throw new Error(`série desconhecida: ${nome}`);
  if (!cache.has(nome)) cache.set(nome, lerCsv(readFileSync(path.join(DADOS, `${nome}.csv`), "utf8"), nome));
  return cache.get(nome);
}

const reduzir = (eq, max = 400) => { const passo = Math.max(1, Math.ceil(eq.length / max)); const r = []; for (let i = 0; i < eq.length; i += passo) r.push(Math.round(eq[i] * 100) / 100); return r; };

export function executar(msg, progresso = () => {}) {
  const serie = carregarSerie(msg.serie);
  if (msg.tipo === "ilha") return evoluirIlha(serie, msg.pedido, progresso, msg.ilha);
  if (msg.tipo === "fechar") return fecharBanco(serie, msg.ilhas, msg.pedido);
  if (msg.tipo === "atestar") return atestar(serie, msg.estrategia, msg.pedido, (msg.outras || []).map(carregarSerie));
  if (msg.tipo === "backtest") {
    const r = backtest(serie, msg.estrategia, msg.pedido || {});
    return { metricas: r.metricas, operacoes: r.trades.slice(-500).map((t) => ({ ...t, entrada: new Date(serie.tempo[t.iEnt]).toISOString(), saida: new Date(serie.tempo[t.iSai]).toISOString() })), capital: reduzir(r.equity) };
  }
  throw new Error(`tipo desconhecido: ${msg.tipo}`);
}

if (parentPort) parentPort.on("message", (msg) => {
  let ultimo = 0;
  try {
    const r = executar(msg, (p) => { const t = Date.now(); if (t - ultimo > 250) { ultimo = t; parentPort.postMessage({ id: msg.id, progresso: p }); } });
    parentPort.postMessage({ id: msg.id, resultado: r });
  } catch (e) { parentPort.postMessage({ id: msg.id, erro: String(e?.message || e) }); }
});
