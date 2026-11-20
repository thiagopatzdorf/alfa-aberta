// Motor de backtest determinístico. Regras (o contrato que os exportadores seguem):
// 1. Sinal no FECHAMENTO da barra i; entrada na ABERTURA da barra i+1, com slippage contra.
// 2. Stop e alvo em múltiplos do ATR da barra do sinal, a partir da abertura de entrada (sem slippage).
// 3. Dentro da barra, o stop é conferido antes do alvo (se os dois cabem na mesma barra, conta o stop:
//    a hipótese pessimista). Abertura além do stop/alvo (gap) executa na abertura.
// 4. barras_max: sai no fechamento da barra em que a posição completa N barras.
// 5. inverter: sinal contrário no fechamento sai (e entra do outro lado) na abertura seguinte.
// 6. Uma posição por vez; sinais de compra e venda na mesma barra se anulam.
// 7. Fim da janela: posição aberta sai no fechamento da última barra.
// 8. Resultado em % do capital, notional fixo de 1x por operação, custo e slippage em % por lado.
import { sinaisDaEstrategia } from "./estrategia.js";
import { atrDaSerie } from "./indicadores.js";
import { metricas } from "./metricas.js";

export const CUSTOS_PADRAO = { custo_pct: 0.05, slippage_pct: 0.02 };

export function backtest(serie, est, opcoes = {}) {
  const ini = opcoes.ini ?? 0, fim = opcoes.fim ?? serie.n;
  const custo = opcoes.custo_pct ?? CUSTOS_PADRAO.custo_pct, slip = (opcoes.slippage_pct ?? CUSTOS_PADRAO.slippage_pct) / 100;
  const pular = opcoes.pular; // (indiceDoSinal) => true para ignorar aquele sinal (Monte Carlo de reteste)
  const { compra, venda } = opcoes.sinais || sinaisDaEstrategia(serie, est);
  const s = est.saida, atr = atrDaSerie(serie, s.atr_p);
  const { abertura: O, maxima: H, minima: L, fechamento: C } = serie;
  const trades = [], equity = new Float64Array(fim - ini);
  let pos = null, fechado = 0, barrasNoMercado = 0;

  const sair = (j, preco, motivo) => {
    const pSai = preco * (1 - pos.dir * slip);
    const ret = (pos.dir * (pSai - pos.pEnt) / pos.pEnt) * 100 - 2 * custo;
    trades.push({ dir: pos.dir, iEnt: pos.iEnt, iSai: j, pEnt: pos.pEnt, pSai, ret, motivo });
    fechado += ret; pos = null;
  };
  const entrar = (j, dir, iSinal) => {
    const a = atr[iSinal];
    if (!(a > 0)) return;
    const ref = O[j];
    pos = { dir, iEnt: j, pEnt: ref * (1 + dir * slip),
      stop: s.stop_atr ? ref - dir * s.stop_atr * a : null, alvo: s.alvo_atr ? ref + dir * s.alvo_atr * a : null };
  };

  let pendente = 0, iPendente = -1; // ordem para a abertura da barra atual
  for (let j = ini; j < fim; j++) {
    if (pendente) {
      if (pos && pos.dir !== pendente) sair(j, O[j], "inversao");
      if (!pos) entrar(j, pendente, iPendente);
      pendente = 0;
    }
    if (pos) {
      barrasNoMercado++;
      const d = pos.dir;
      if (pos.stop !== null && j > pos.iEnt && (d > 0 ? O[j] <= pos.stop : O[j] >= pos.stop)) sair(j, O[j], "stop");
      else if (pos.stop !== null && (d > 0 ? L[j] <= pos.stop : H[j] >= pos.stop)) sair(j, pos.stop, "stop");
      else if (pos.alvo !== null && j > pos.iEnt && (d > 0 ? O[j] >= pos.alvo : O[j] <= pos.alvo)) sair(j, O[j], "alvo");
      else if (pos.alvo !== null && (d > 0 ? H[j] >= pos.alvo : L[j] <= pos.alvo)) sair(j, pos.alvo, "alvo");
      else if (s.barras_max && j - pos.iEnt + 1 >= s.barras_max) sair(j, C[j], "tempo");
    }
    if (j === fim - 1) { if (pos) sair(j, C[j], "fim"); }
    else {
      const sinal = compra[j] && !venda[j] ? 1 : venda[j] && !compra[j] ? -1 : 0;
      if (sinal && !(pular && pular(j))) {
        if (!pos) { pendente = sinal; iPendente = j; }
        else if (s.inverter && pos.dir !== sinal) { pendente = sinal; iPendente = j; }
      }
    }
    equity[j - ini] = fechado + (pos ? (pos.dir * (C[j] - pos.pEnt) / pos.pEnt) * 100 - custo : 0);
  }
  const r = { trades, equity, ini, fim };
  r.metricas = metricas(r, serie, barrasNoMercado);
  return r;
}
