// As operações do Alfa Aberta. Uma lista só vira a API REST (POST /api/<nome>) e as ferramentas
// do MCP (alfa_<nome>): regra num lugar, sem duplicar validação entre os dois caminhos.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validar } from "../public/motor/estrategia.js";
import { conferirPedido, ErroPedido } from "./limites.js";
import { evoluirNoPool } from "./fila.js";

const INDICE = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "dados", "indice.json"), "utf8"));

const SERIE = { description: `Nome de uma série pronta (${Object.keys(INDICE).join(", ")}) ou {csv, nome} com o seu próprio CSV (colunas t/time/date, open, high, low, close[, volume]).`,
  oneOf: [{ type: "string" }, { type: "object", properties: { csv: { type: "string" }, nome: { type: "string" } }, required: ["csv"] }] };
const PEDIDO = { type: "object", description: "Configuração (todas opcionais): populacao, geracoes, ilhas, semente, fracao_is (0,3 a 0,95), min_operacoes, max_condicoes, direcao (ambas|compra|venda|livre), aptidao (retorno_dd|sharpe|lucro|fator_lucro|sqn|estabilidade), indicadores (lista), banco_tamanho, custo_pct, slippage_pct (em % por lado)." };
const ESTRATEGIA = { type: "object", description: "Estratégia no formato do Alfa Aberta (versao 1), como sai do banco da evolução." };
const ESPERAR = { type: "integer", minimum: 0, maximum: 110, description: "Segundos para esperar o resultado antes de devolver só o id da tarefa (padrão 50)." };

function conferirSerie(serie, peso) {
  if (typeof serie === "string") { if (!INDICE[serie]) throw new ErroPedido(`série desconhecida: ${serie}; veja alfa_series`); return serie; }
  if (serie && typeof serie.csv === "string") {
    if (Buffer.byteLength(serie.csv) > peso.csv_max_bytes) throw new ErroPedido(`CSV passa de ${peso.csv_max_bytes / 1e6} MB para o seu acesso`, 413);
    return { csv: serie.csv, nome: String(serie.nome || "meu-csv").slice(0, 60) };
  }
  throw new ErroPedido("serie é obrigatória");
}
function custosPadrao(serie, pedido) {
  const meta = typeof serie === "string" ? INDICE[serie] : null;
  return { custo_pct: meta?.custo_pct, slippage_pct: meta?.slippage_pct, ...pedido };
}
function conferirCota(ctx) {
  if (ctx.tarefas.ativasDe(ctx.dono) >= ctx.peso.simultaneas) throw new ErroPedido(`você já tem ${ctx.peso.simultaneas} tarefa(s) rodando no servidor; espere terminar (no navegador não há fila)`, 429);
  if (ctx.tarefas.criadasNaHora(ctx.dono) >= ctx.peso.tarefas_hora) throw new ErroPedido("limite de tarefas por hora no servidor atingido", 429);
}
async function esperar(ctx, x, segundos = 50) {
  const s = Math.max(0, Math.min(110, segundos ?? 50));
  await Promise.race([x.promessa, new Promise((r) => setTimeout(r, s * 1000).unref?.())]);
  return ctx.tarefas.ver(x.id);
}

export const OPS = [
  { nome: "series", descricao: "Lista as séries de preços prontas (cripto da Binance e ações da B3), com período, quantidade de barras e custos sugeridos.",
    entrada: { type: "object", properties: {} }, somenteLeitura: true,
    fn: async () => INDICE },
  { nome: "evoluir", descricao: "Gera estratégias por evolução genética sobre uma série: sorteia, muta e cruza regras, avalia cada uma por backtest nos primeiros fracao_is% dos dados e devolve o banco das melhores com o resultado também na parte final nunca vista (fora da amostra). Determinístico pela semente.",
    entrada: { type: "object", properties: { serie: SERIE, pedido: PEDIDO, esperar_segundos: ESPERAR }, required: ["serie"] },
    fn: async (a, ctx) => {
      const serie = conferirSerie(a.serie, ctx.peso);
      const pedido = custosPadrao(serie, conferirPedido(a.pedido, ctx.peso));
      conferirCota(ctx);
      const x = ctx.tarefas.nova(ctx.dono, "evoluir", evoluirNoPool(ctx.pool, serie, pedido));
      return ctx.mcp ? esperar(ctx, x, a.esperar_segundos) : { tarefa: x.id };
    } },
  { nome: "atestar", descricao: "Atestado de robustez de uma estratégia: fora da amostra, walk-forward reotimizado, Monte Carlo das operações, Monte Carlo de custos piores e sinais perdidos, parâmetros vizinhos, teste contra entradas aleatórias (p-valor) e outros mercados. Devolve nota A a E e cada teste com a regra de aprovação escrita.",
    entrada: { type: "object", properties: { serie: SERIE, estrategia: ESTRATEGIA, pedido: PEDIDO, outras: { type: "array", items: { type: "string" }, description: "Outras séries prontas para o teste de outros mercados." }, esperar_segundos: ESPERAR }, required: ["serie", "estrategia"] },
    fn: async (a, ctx) => {
      const serie = conferirSerie(a.serie, ctx.peso);
      try { validar(a.estrategia); } catch (e) { throw new ErroPedido(`estratégia inválida: ${e.message}`); }
      const outras = (a.outras || []).slice(0, 8).map((s) => conferirSerie(s, ctx.peso));
      const pedido = custosPadrao(serie, conferirPedido(a.pedido, ctx.peso));
      conferirCota(ctx);
      const x = ctx.tarefas.nova(ctx.dono, "atestar", () => ctx.pool.rodar({ tipo: "atestar", serie, estrategia: a.estrategia, pedido, outras }));
      return ctx.mcp ? esperar(ctx, x, a.esperar_segundos) : { tarefa: x.id };
    } },
  { nome: "backtest", descricao: "Backtest de uma estratégia numa série: métricas, curva de capital (reduzida) e as últimas 500 operações.",
    entrada: { type: "object", properties: { serie: SERIE, estrategia: ESTRATEGIA, pedido: PEDIDO }, required: ["serie", "estrategia"] }, somenteLeitura: true,
    fn: async (a, ctx) => {
      const serie = conferirSerie(a.serie, ctx.peso);
      try { validar(a.estrategia); } catch (e) { throw new ErroPedido(`estratégia inválida: ${e.message}`); }
      return ctx.pool.rodar({ tipo: "backtest", serie, estrategia: a.estrategia, pedido: custosPadrao(serie, a.pedido || {}) });
    } },
  { nome: "tarefa", descricao: "Estado e resultado de uma tarefa (evoluir ou atestar): fila, rodando (com progresso), pronta (com resultado) ou erro.",
    entrada: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }, somenteLeitura: true,
    fn: async (a, ctx) => { const x = ctx.tarefas.ver(String(a.id)); if (!x) throw new ErroPedido("tarefa não encontrada (somem 1 h depois de criadas)", 404); return x; } },
  { nome: "exportar", descricao: "Traduz a estratégia para código de plataforma: python (script que reproduz o motor), pine (TradingView), mql5 (MetaTrader 5) ou ntsl (Profit da Nelogica).",
    entrada: { type: "object", properties: { estrategia: ESTRATEGIA, formato: { type: "string", enum: ["python", "pine", "mql5", "ntsl"] }, custo_pct: { type: "number" }, slippage_pct: { type: "number" } }, required: ["estrategia", "formato"] }, somenteLeitura: true,
    fn: async (a) => {
      const { exportar } = await import("../public/motor/exportar.js");
      try { return exportar(a.estrategia, a.formato, { custo_pct: a.custo_pct, slippage_pct: a.slippage_pct }); } catch (e) { throw new ErroPedido(e.message); }
    } },
];
