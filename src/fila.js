// Fila de tarefas sobre um pool de threads (um por núcleo). Uma evolução vira N tarefas de
// ilha que correm em paralelo; o fechamento do banco é mais uma tarefa. Resultado fica em
// memória por 1 h (nada vai para disco: a raiz do contêiner é só leitura).
import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { randomBytes } from "node:crypto";

const THREAD = new URL("./thread.mjs", import.meta.url);
const VIDA_MS = 3600e3;

export class Pool {
  constructor(n = availableParallelism()) {
    this.livres = []; this.espera = []; this.pendentes = new Map(); this.seq = 0; this.todos = [];
    for (let i = 0; i < n; i++) this.criar();
  }
  criar() {
    const w = new Worker(THREAD);
    w.on("message", (m) => {
      const p = this.pendentes.get(m.id); if (!p) return;
      if (m.progresso) return p.aoProgresso?.(m.progresso);
      this.pendentes.delete(m.id);
      m.erro ? p.rejeitar(new Error(m.erro)) : p.resolver(m.resultado);
      this.soltar(w);
    });
    // Thread que morre (memória, bug) não leva o servidor junto: a tarefa falha e outra thread nasce.
    w.on("error", (e) => {
      for (const [id, p] of this.pendentes) if (p.w === w) { this.pendentes.delete(id); p.rejeitar(e); }
      this.todos = this.todos.filter((x) => x !== w); this.livres = this.livres.filter((x) => x !== w);
      this.criar();
    });
    this.todos.push(w); this.soltar(w);
  }
  soltar(w) { const prox = this.espera.shift(); if (prox) prox(w); else this.livres.push(w); }
  pegar() { return this.livres.length ? Promise.resolve(this.livres.pop()) : new Promise((r) => this.espera.push(r)); }
  async rodar(msg, aoProgresso) {
    const w = await this.pegar();
    const id = ++this.seq;
    return new Promise((resolver, rejeitar) => { this.pendentes.set(id, { resolver, rejeitar, aoProgresso, w }); w.postMessage({ ...msg, id }); });
  }
  get tamanho() { return this.todos.length; }
  async fechar() { await Promise.all(this.todos.map((w) => w.terminate())); }
}

export class Tarefas {
  constructor(pool, agora = () => Date.now()) { this.pool = pool; this.mapa = new Map(); this.agora = agora; }
  limpar() { const t = this.agora(); for (const [id, x] of this.mapa) if (t - x.criada > VIDA_MS) this.mapa.delete(id); }
  ativasDe(dono) { let n = 0; for (const x of this.mapa.values()) if (x.dono === dono && (x.estado === "fila" || x.estado === "rodando")) n++; return n; }
  criadasNaHora(dono) { const t = this.agora(); let n = 0; for (const x of this.mapa.values()) if (x.dono === dono && t - x.criada < 3600e3) n++; return n; }
  nova(dono, tipo, executar) {
    this.limpar();
    const id = randomBytes(9).toString("base64url");
    const x = { id, dono, tipo, estado: "fila", progresso: null, resultado: null, erro: null, criada: this.agora() };
    this.mapa.set(id, x);
    x.promessa = (async () => {
      try { x.estado = "rodando"; x.resultado = await executar((p) => { x.progresso = p; }); x.estado = "pronta"; }
      catch (e) { x.estado = "erro"; x.erro = String(e?.message || e); }
      x.terminada = this.agora();
    })();
    return x;
  }
  ver(id) { const x = this.mapa.get(id); if (!x) return null; const { promessa, dono, ...pub } = x; return pub; }
}

// Evolução em ilhas paralelas: o progresso somado das ilhas vai para a tarefa.
export function evoluirNoPool(pool, serie, pedido) {
  return async (aoProgresso) => {
    const ilhas = pedido.ilhas ?? 1, prog = new Array(ilhas).fill(null);
    const resultados = await Promise.all(Array.from({ length: ilhas }, (_, i) =>
      pool.rodar({ tipo: "ilha", serie, pedido, ilha: i }, (p) => {
        prog[i] = p;
        const v = prog.filter(Boolean);
        aoProgresso({ geracao: Math.min(...v.map((x) => x.geracao)), geracoes: p.geracoes, avaliadas: v.reduce((a, x) => a + x.avaliadas, 0), ilhas: prog });
      })));
    return pool.rodar({ tipo: "fechar", serie, pedido, ilhas: resultados.map((r) => ({ banco: r.banco, avaliadas: r.avaliadas })) });
  };
}
