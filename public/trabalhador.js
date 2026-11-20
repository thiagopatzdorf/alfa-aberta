// Trabalhador (Web Worker de módulo): roda UMA ilha da evolução, ou um atestado, fora da
// thread da página. Cada ilha tem semente própria (semente + número da ilha), então o banco
// final depende só da semente e do número de ilhas, nunca de quantos núcleos a máquina tem.
import { lerCsv } from "./motor/dados.js";
import { evoluirIlha } from "./motor/gerador.js";
import { atestar } from "./motor/robustez.js";

const series = new Map(); // nome -> série já lida (o CSV é lido uma vez por trabalhador)

function serieDe(nome) {
  const s = series.get(nome);
  if (!s) throw new Error(`série não carregada no trabalhador: ${nome}`);
  return s;
}

function evoluir({ serie, pedido, ilha }) {
  const s = serieDe(serie);
  let buf = [], contadas = 0, ultimo = performance.now();
  const despejar = (forcar) => {
    const agora = performance.now();
    if (!forcar && agora - ultimo < 90) return;
    ultimo = agora;
    const dados = Float32Array.from(buf);
    buf = [];
    postMessage({ tipo: "pontos", ilha, contadas, dados }, [dados.buffer]);
  };
  const aoAvaliar = (v) => {
    contadas++;
    if (v.is) buf.push(v.is.lucro_pct, v.is.dd_max_pct, v.fit);
    despejar(false);
  };
  const r = evoluirIlha(s, pedido, (p) => { postMessage({ tipo: "progresso", ...p }); despejar(true); }, ilha, aoAvaliar);
  despejar(true);
  postMessage({ tipo: "ilha", ilha, resultado: r });
}

onmessage = (ev) => {
  const m = ev.data;
  try {
    if (m.tipo === "serie") {
      if (!series.has(m.nome)) series.set(m.nome, lerCsv(m.csv, m.nome));
      postMessage({ tipo: "serie_ok", nome: m.nome });
    } else if (m.tipo === "evoluir") {
      evoluir(m);
    } else if (m.tipo === "atestar") {
      const t0 = performance.now();
      const r = atestar(serieDe(m.serie), m.estrategia, m.pedido, (m.outras || []).map(serieDe));
      postMessage({ tipo: "atestado", resultado: r, ms: Math.round(performance.now() - t0) });
    }
  } catch (e) {
    postMessage({ tipo: "erro", mensagem: e && e.message ? e.message : String(e), ilha: m.ilha });
  }
};
