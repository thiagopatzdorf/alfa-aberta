// Água: o mesmo motor para todo mundo; a diferença entre quem chega é um número (peso), nunca
// um ramo no código. No navegador não há limite (a máquina é da pessoa). No servidor, a CPU é
// nossa e é dividida: quem entrou com login pesa mais que o anônimo.
export const PESOS = {
  anonimo: { simultaneas: 1, avaliacoes_max: 12_000, ilhas_max: 4, csv_max_bytes: 2_000_000, tarefas_hora: 30 },
  logado:  { simultaneas: 3, avaliacoes_max: 200_000, ilhas_max: 16, csv_max_bytes: 10_000_000, tarefas_hora: 300 },
};

// Custo de uma evolução em backtests: população × (gerações + 1) × ilhas.
export const custoEvolucao = (p) => (p.populacao ?? 120) * ((p.geracoes ?? 30) + 1) * (p.ilhas ?? 1);

export function conferirPedido(pedido = {}, peso) {
  const p = { ...pedido };
  for (const [k, [lo, hi]] of Object.entries({ populacao: [10, 2000], geracoes: [1, 500], ilhas: [1, 64], max_condicoes: [1, 6], banco_tamanho: [1, 100], min_operacoes: [1, 10000] })) {
    if (p[k] === undefined) continue;
    if (!Number.isInteger(p[k]) || p[k] < lo || p[k] > hi) throw new ErroPedido(`${k} precisa ser inteiro entre ${lo} e ${hi}`);
  }
  if (p.fracao_is !== undefined && !(p.fracao_is >= 0.3 && p.fracao_is <= 0.95)) throw new ErroPedido("fracao_is precisa estar entre 0,3 e 0,95");
  for (const k of ["custo_pct", "slippage_pct"]) if (p[k] !== undefined && !(p[k] >= 0 && p[k] <= 5)) throw new ErroPedido(`${k} precisa estar entre 0 e 5`);
  if (p.semente !== undefined && !(Number.isInteger(p.semente) && p.semente >= 0 && p.semente < 2 ** 32)) throw new ErroPedido("semente precisa ser inteiro de 32 bits");
  if ((p.ilhas ?? 1) > peso.ilhas_max) throw new ErroPedido(`no servidor, até ${peso.ilhas_max} ilhas para o seu acesso (no navegador não há limite)`, 403);
  const custo = custoEvolucao(p);
  if (custo > peso.avaliacoes_max) throw new ErroPedido(`pedido de ${custo} backtests passa do teto de ${peso.avaliacoes_max} do seu acesso no servidor; rode no navegador (sem limite) ou entre com o Google`, 403);
  return p;
}

export class ErroPedido extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
