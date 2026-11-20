// Alfa Aberta: a página. Configura o pedido, distribui as ilhas em Web Workers (ou manda ao
// servidor), mostra a evolução ao vivo, o banco, o detalhe, o atestado e a exportação.
// O motor (public/motor) é de outra frente: aqui só se chama a API dele.
import { lerCsv } from "./motor/dados.js";
import { PADRAO, fecharBanco } from "./motor/gerador.js";
import { backtest } from "./motor/backtest.js";
import { descrever, chave } from "./motor/estrategia.js";
import { CATALOGO } from "./motor/indicadores.js";
import { $, $$, h, num, inteiro, pct, compacto, dataCurta, isoParaBr, guardar, lembrar, paraBase64url, deBase64url, copiar, baixar } from "./ui/util.js";
import { Dispersao, GraficoEquity, sparkline, linhasAptidao, reduzir } from "./ui/graficos.js";
import * as API from "./ui/servidor.js";

const NUCLEOS = Math.max(1, navigator.hardwareConcurrency || 4);
const ILHAS_PADRAO = Math.min(8, NUCLEOS);
const NOME_IND = { sma: ["MMS", "Média móvel simples"], ema: ["MME", "Média móvel exponencial"], bb_sup: ["Bollinger sup.", "Banda superior de Bollinger"],
  bb_inf: ["Bollinger inf.", "Banda inferior de Bollinger"], maxima_n: ["Máxima N", "Maior máxima das N barras anteriores"], minima_n: ["Mínima N", "Menor mínima das N barras anteriores"],
  rsi: ["IFR", "Índice de força relativa (RSI)"], estoc: ["Estocástico", "Oscilador estocástico"], cci: ["CCI", "Commodity Channel Index"], roc: ["ROC", "Taxa de variação"], macd: ["MACD", "MACD"] };
const DIRECAO = { ambas: "compra e venda", compra: "só compra", venda: "só venda" };
const MERCADO = { cripto: "Cripto", b3: "B3" };
const FORMATOS = [["python", "Python"], ["pine", "Pine (TradingView)"], ["mql5", "MQL5 (MetaTrader 5)"], ["ntsl", "NTSL (Profit)"]];

const est = {
  indice: {}, textos: new Map(), series: new Map(), enviados: new Map(),
  modo: lembrar("alfa.modo") === "servidor" ? "servidor" : "local",
  rodando: null, resultado: null, ordem: { col: "aptidao", dir: -1 }, soFora: false, eu: null,
};

// ---------- dados ----------
async function textoDaSerie(nome) {
  if (est.enviados.has(nome)) return est.enviados.get(nome);
  if (!est.textos.has(nome)) {
    est.textos.set(nome, fetch(`dados/${encodeURIComponent(nome)}.csv`).then((r) => {
      if (!r.ok) throw new Error(`não achei os dados de ${nome} (${r.status})`);
      return r.text();
    }));
  }
  return est.textos.get(nome);
}
async function serieLocal(nome) {
  if (!est.series.has(nome)) est.series.set(nome, textoDaSerie(nome).then((t) => lerCsv(t, nome)));
  return est.series.get(nome);
}
function outrasDoMercado(nome) {
  const m = est.indice[nome]?.mercado;
  if (!m) return [];
  return Object.keys(est.indice).filter((k) => k !== nome && est.indice[k].mercado === m).sort();
}
const custosDe = (p) => ({ custo_pct: p.custo_pct, slippage_pct: p.slippage_pct });

// ---------- tema e modo ----------
function iniciarTema() {
  const salvo = lembrar("alfa.tema");
  if (salvo) document.documentElement.dataset.theme = salvo;
  $("#tema").addEventListener("click", () => {
    const atual = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const novo = atual === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = novo; guardar("alfa.tema", novo);
    redesenharGraficos();
  });
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", redesenharGraficos);
}
let redesenhos = [];
function redesenharGraficos() { for (const f of redesenhos) try { f(); } catch { /* gráfico fora da tela */ } }

function iniciarModo() {
  for (const r of $$('input[name="modo"]')) {
    r.checked = r.value === est.modo;
    r.addEventListener("change", () => { est.modo = r.value; guardar("alfa.modo", est.modo); atualizarConta(); atualizarEstimativa(); });
  }
  atualizarConta();
}
async function atualizarConta() {
  const caixa = $("#conta"); caixa.replaceChildren();
  if (est.modo !== "servidor") return;
  caixa.append(h("span.carregando", {}, "servidor"));
  try {
    est.eu = await API.eu();
    caixa.replaceChildren(est.eu.logado
      ? h("span", {}, h("span", { texto: est.eu.email || "conectado" }), " · ", h("a", { href: "/sair" }, "Sair"))
      : est.eu.login_disponivel ? h("a", { href: "/entrar/google" }, "Entrar com Google") : h("span", {}, "servidor · acesso anônimo"));
  } catch (e) {
    est.eu = null;
    caixa.replaceChildren(h("span", { title: e.message, style: "color:var(--ruim)" }, "servidor indisponível"));
  }
  pintarChaveApi();
}

// ---------- configurador ----------
const form = () => $("#configurador");
function pintarSeries() {
  const lista = $("#lista-series"); lista.replaceChildren();
  const grupos = { cripto: [], b3: [] };
  for (const [nome, m] of Object.entries(est.indice)) (grupos[m.mercado] ||= []).push(nome);
  const atual = est.serieNome;
  for (const [mercado, nomes] of Object.entries(grupos)) {
    const notas = [...new Set(nomes.map((n) => est.indice[n].nota).filter(Boolean))];
    lista.append(h("p.series-grupo", {}, MERCADO[mercado] || mercado, notas.length ? h("span", {}, ` · ${notas.join("; ")}`) : null));
    if (!nomes.length) { lista.append(h("p.vazio-b3", {}, mercado === "b3" ? "Nenhuma série da B3 publicada ainda. Envie o seu CSV abaixo." : "Nenhuma série.")); continue; }
    for (const nome of nomes) {
      const m = est.indice[nome];
      lista.append(opcaoSerie(nome, m.ativo || nome, m.periodo, `${inteiro(m.barras)} · ${anoDe(m.de)}–${String(anoDe(m.ate)).slice(-2)}`, nome === atual, m));
    }
  }
  if (est.enviados.size) {
    lista.append(h("p.series-grupo", {}, "Seus arquivos"));
    for (const [nome] of est.enviados) { const s = est.seriesEnviadas?.get(nome); lista.append(opcaoSerie(nome, nome, "csv", s ? `${inteiro(s.n)} · ${new Date(s.tempo[0]).getUTCFullYear()}–${new Date(s.tempo[s.n - 1]).getUTCFullYear()}` : "", nome === atual)); }
  }
}
// O índice traz as datas como epoch em segundos (cripto) ou ISO (B3): aceita os dois.
function anoDe(x) {
  const n = Number(x), d = Number.isFinite(n) && String(x).trim() !== "" ? new Date(n * 1000) : new Date(String(x));
  return Number.isFinite(d.getTime()) ? d.getUTCFullYear() : "?";
}
function opcaoSerie(nome, rotulo, tf, info, marcado, meta) {
  const input = h("input", { type: "radio", name: "serie", value: nome, checked: marcado });
  input.addEventListener("change", () => escolherSerie(nome));
  const titulo = meta ? [`${nome} · fonte ${meta.fonte || "—"}`, meta.ajustes?.length ? `ajustes: ${meta.ajustes.map((a) => `${isoParaBr(a.data)} ÷${a.razao}`).join(", ")}` : null].filter(Boolean).join("\n") : nome;
  return h("label.opcao-serie", { title: titulo }, input, h("span.radio"), h("b", {}, rotulo), h("span.tf", {}, tf), h("small", {}, info));
}
function escolherSerie(nome) {
  est.serieNome = nome;
  const m = est.indice[nome];
  if (m) { form().custo_pct.value = m.custo_pct; form().slippage_pct.value = m.slippage_pct; }
  atualizarEstimativa();
}
function pintarIndicadores(marcados) {
  const caixa = $("#indicadores"); caixa.replaceChildren();
  for (const k of Object.keys(CATALOGO).filter((x) => x !== "preco")) {
    const [curto, longo] = NOME_IND[k] || [k, k];
    caixa.append(h("label.ficha", { title: longo }, h("input", { type: "checkbox", name: "ind", value: k, checked: marcados.includes(k) }), h("span", {}, curto)));
  }
}
function preencherPadroes() {
  const f = form();
  f.populacao.value = PADRAO.populacao; f.geracoes.value = PADRAO.geracoes; f.ilhas.value = ILHAS_PADRAO;
  f.max_condicoes.value = PADRAO.max_condicoes; f.min_operacoes.value = PADRAO.min_operacoes; f.semente.value = PADRAO.semente;
  f.aptidao.value = PADRAO.aptidao; f.fracao_is.value = Math.round(PADRAO.fracao_is * 100);
  for (const r of $$('input[name="direcao"]')) r.checked = r.value === PADRAO.direcao;
  pintarIndicadores(PADRAO.indicadores);
  escolherSerie(est.serieNome);
  $("#fis-saida").textContent = f.fracao_is.value + "%";
  atualizarEstimativa();
}
const limitar = (v, a, b, padrao) => { const x = Number(v); return Number.isFinite(x) ? Math.min(b, Math.max(a, x)) : padrao; };
function lerPedido() {
  const f = form();
  const indicadores = $$('input[name="ind"]:checked').map((x) => x.value);
  return {
    populacao: Math.round(limitar(f.populacao.value, 10, 5000, PADRAO.populacao)),
    geracoes: Math.round(limitar(f.geracoes.value, 1, 1000, PADRAO.geracoes)),
    ilhas: Math.round(limitar(f.ilhas.value, 1, 64, ILHAS_PADRAO)),
    max_condicoes: Math.round(limitar(f.max_condicoes.value, 1, 6, PADRAO.max_condicoes)),
    min_operacoes: Math.round(limitar(f.min_operacoes.value, 1, 1000, PADRAO.min_operacoes)),
    semente: Math.round(limitar(f.semente.value, 0, 2 ** 31, PADRAO.semente)),
    aptidao: f.aptidao.value,
    direcao: $('input[name="direcao"]:checked')?.value || "ambas",
    fracao_is: limitar(f.fracao_is.value, 50, 90, 70) / 100,
    indicadores: indicadores.length ? indicadores : PADRAO.indicadores,
    custo_pct: limitar(f.custo_pct.value, 0, 5, 0.1),
    slippage_pct: limitar(f.slippage_pct.value, 0, 5, 0.02),
  };
}
function atualizarEstimativa() {
  const p = lerPedido();
  const total = p.populacao * (p.geracoes + 1) * p.ilhas;
  const onde = est.modo === "servidor" ? "no servidor" : `${p.ilhas} ${p.ilhas > 1 ? "ilhas" : "ilha"} em ${Math.min(NUCLEOS, p.ilhas)} de ${NUCLEOS} núcleos`;
  $("#estimativa").textContent = `até ${compacto(total)} avaliações · ${onde}`;
  pintarIlhasVazias(p.ilhas);
}
async function enviarCsv(arquivo) {
  const erro = $("#csv-erro"); erro.hidden = true;
  try {
    if (arquivo.size > 60e6) throw new Error("arquivo maior que 60 MB");
    const texto = await arquivo.text();
    const nome = arquivo.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").slice(0, 40) || "meu-csv";
    const s = lerCsv(texto, nome);
    if (s.n < 300) throw new Error(`só ${s.n} barras; o gerador precisa de pelo menos 300`);
    est.enviados.set(nome, texto); (est.seriesEnviadas ||= new Map()).set(nome, s); est.series.set(nome, Promise.resolve(s));
    est.serieNome = nome; pintarSeries(); atualizarEstimativa();
  } catch (e) { erro.textContent = `Não consegui ler o CSV: ${e.message}.`; erro.hidden = false; }
}

// ---------- evolução: placar, ilhas, gráficos ----------
let dispersao, vivo = null;
function pintarIlhasVazias(n) {
  if (est.rodando) return;
  const caixa = $("#ilhas"); if (!caixa || est.resultado) return;
  caixa.replaceChildren(...Array.from({ length: Math.min(n, 64) }, (_, i) => linhaIlha(i, 0, "—")));
}
function linhaIlha(i, frac, apt, pronta = false, rotulo) {
  return h("div.ilha" + (pronta ? ".pronta" : ""), { "data-ilha": i }, h("span", {}, rotulo || `ilha ${String(i + 1).padStart(2, "0")}`),
    h("span.barra", { role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(frac * 100), "aria-label": `Ilha ${i + 1}` }, h("i", { style: `width:${(frac * 100).toFixed(1)}%` })),
    h("span.apt", {}, apt));
}
function iniciarVivo(pedido, rotulos) {
  vivo = { t0: performance.now(), pedido, porIlha: Array.from({ length: pedido.ilhas }, () => []), contagem: new Array(pedido.ilhas).fill(0),
    geracao: new Array(pedido.ilhas).fill(0), historico: [], prontas: new Set() };
  dispersao.limpar();
  $("#ilhas").replaceChildren(...Array.from({ length: rotulos ? rotulos.length : pedido.ilhas }, (_, i) => linhaIlha(i, 0, "—", false, rotulos?.[i])));
  $("#p-avaliadas").textContent = "0"; $("#p-ritmo").textContent = "—"; $("#p-geracao").textContent = `0/${pedido.geracoes}`;
  $("#p-nucleos").textContent = est.modo === "servidor" ? "servidor" : `${Math.min(NUCLEOS, pedido.ilhas)} de ${NUCLEOS}`;
  linhasAptidao($("#g-aptidao"), [], pedido.geracoes);
  clearInterval(vivo.relogio);
  vivo.relogio = setInterval(tique, 250);
}
function tique() {
  if (!vivo) return;
  const t = (performance.now() - vivo.t0) / 1000, total = vivo.contagem.reduce((a, b) => a + b, 0);
  vivo.historico.push([t, total]); while (vivo.historico.length > 1 && t - vivo.historico[0][0] > 2) vivo.historico.shift();
  const [t0, c0] = vivo.historico[0], ritmo = t - t0 > 0.4 ? (total - c0) / (t - t0) : 0;
  $("#p-avaliadas").textContent = inteiro(total);
  $("#p-ritmo").textContent = ritmo > 0 ? inteiro(ritmo) : est.rodando ? "…" : "—";
  $("#p-tempo").textContent = t < 60 ? `${num(t, 1)} s` : `${Math.floor(t / 60)} min ${String(Math.floor(t % 60)).padStart(2, "0")} s`;
  const g = Math.min(...vivo.geracao); $("#p-geracao").textContent = `${g}/${vivo.pedido.geracoes}`;
}
function progressoIlha(p) {
  if (!vivo) return;
  vivo.geracao[p.ilha] = p.geracao; vivo.porIlha[p.ilha][p.geracao - 1] = p.melhor;
  if (p.avaliadas > vivo.contagem[p.ilha]) vivo.contagem[p.ilha] = p.avaliadas;
  const linha = $(`.ilha[data-ilha="${p.ilha}"]`);
  if (linha) {
    const frac = p.geracao / p.geracoes;
    linha.querySelector("i").style.width = `${(frac * 100).toFixed(1)}%`;
    linha.querySelector(".barra").setAttribute("aria-valuenow", Math.round(frac * 100));
    linha.querySelector(".apt").textContent = Number.isFinite(p.melhor) && p.melhor > -1 ? num(p.melhor, 2) : "—";
  }
  if (!vivo.agAptidao) { vivo.agAptidao = true; requestAnimationFrame(() => { vivo.agAptidao = false; linhasAptidao($("#g-aptidao"), vivo.porIlha, vivo.pedido.geracoes); }); }
}
function ilhaPronta(i) { vivo?.prontas.add(i); const l = $(`.ilha[data-ilha="${i}"]`); if (l) { l.classList.add("pronta"); l.querySelector("i").style.width = "100%"; } }
function estadoEvol(texto, classe) { const e = $("#estado-evol"); e.textContent = texto; e.className = "estado" + (classe ? " " + classe : ""); }
function mensagemEvol(conteudo, erro = false) { const m = $("#evol-msg"); if (!conteudo) { m.hidden = true; return; } m.replaceChildren(...[].concat(conteudo)); m.className = "msg" + (erro ? " erro" : ""); m.hidden = false; }

// ---------- evolução local (Web Workers) ----------
function novoTrabalhador() { return new Worker(new URL("./trabalhador.js", import.meta.url), { type: "module" }); }

async function evoluirLocal(pedido, nome) {
  const texto = await textoDaSerie(nome);
  const fila = Array.from({ length: pedido.ilhas }, (_, i) => i), resultados = new Array(pedido.ilhas);
  const nW = Math.min(NUCLEOS, pedido.ilhas);
  const trabs = Array.from({ length: nW }, novoTrabalhador);
  est.rodando.cancelar = () => trabs.forEach((w) => w.terminate());
  try {
    await Promise.all(trabs.map((w) => new Promise((ok, falha) => {
      est.rodando.rejeitar ||= []; est.rodando.rejeitar.push(falha);
      const proxima = () => {
        if (!fila.length) return ok();
        w.postMessage({ tipo: "evoluir", serie: nome, pedido, ilha: fila.shift() });
      };
      w.onmessage = ({ data: m }) => {
        if (m.tipo === "serie_ok") proxima();
        else if (m.tipo === "progresso") progressoIlha(m);
        else if (m.tipo === "pontos") { if (vivo) vivo.contagem[m.ilha] = Math.max(vivo.contagem[m.ilha], m.contadas); dispersao.adicionar(m.dados); }
        else if (m.tipo === "ilha") { resultados[m.ilha] = m.resultado; vivo.contagem[m.ilha] = m.resultado.avaliadas; ilhaPronta(m.ilha); proxima(); }
        else if (m.tipo === "erro") falha(new Error(m.mensagem));
      };
      w.onerror = (e) => { e.preventDefault?.(); falha(new Error(e.message || "o navegador não iniciou o trabalhador (Web Worker de módulo)")); };
      w.postMessage({ tipo: "serie", nome, csv: texto });
    })));
  } finally { trabs.forEach((w) => w.terminate()); }
  const serie = await serieLocal(nome);
  estadoEvol("fechando o banco", "rodando");
  await new Promise((ok) => setTimeout(ok, 20));
  return fecharBanco(serie, resultados, pedido);
}

async function evoluirServidor(pedido, nome) {
  const serie = est.enviados.has(nome) ? { csv: est.enviados.get(nome), nome } : nome;
  const sinal = { cancelado: false }; est.rodando.cancelar = () => { sinal.cancelado = true; };
  return API.tarefa("/api/evoluir", { serie, pedido }, (p, estado) => {
    estadoEvol(estado === "fila" ? "na fila do servidor" : "rodando no servidor", "rodando");
    if (!vivo) return;
    const ilhas = vivo.pedido.ilhas;
    for (let i = 0; i < ilhas; i++) { vivo.contagem[i] = (p.avaliadas || 0) / ilhas; }
    progressoIlha({ ilha: 0, geracao: p.geracao || 0, geracoes: p.geracoes || pedido.geracoes, melhor: p.melhor ?? NaN, avaliadas: p.avaliadas || 0 });
    for (let i = 1; i < ilhas; i++) vivo.geracao[i] = p.geracao || 0;
  }, sinal);
}

async function evoluir(ev) {
  ev?.preventDefault();
  if (est.rodando) return;
  const pedido = lerPedido(), nome = est.serieNome;
  if (!nome) return;
  est.rodando = { pedido, nome };
  const anterior = est.resultado;
  est.resultado = null; pintarBanco();
  $("#evoluir").disabled = true; $("#evoluir span").textContent = "Evoluindo…"; $("#cancelar").hidden = false;
  mensagemEvol(null); estadoEvol(est.modo === "servidor" ? "enviando ao servidor" : "rodando", "rodando");
  iniciarVivo(pedido, est.modo === "servidor" ? [`servidor · ${pedido.ilhas} ilhas`] : null);
  if (matchMedia("(max-width: 980px)").matches) $("#evolucao").scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const r = est.modo === "servidor" ? await evoluirServidor(pedido, nome) : await evoluirLocal(pedido, nome);
    if (!r || !Array.isArray(r.banco)) throw new Error("o resultado veio sem banco");
    est.resultado = { ...r, serie: nome, pedido };
    try { if (!est.enviados.has(nome)) sessionStorage.setItem("alfa.ultimo", JSON.stringify(est.resultado)); } catch { /* sem armazenamento */ }
    tique();
    const s = (performance.now() - vivo.t0) / 1000;
    estadoEvol(`pronta em ${num(s, 1)} s`, "pronta");
    vivo.contagem = vivo.contagem.map((x, i, a) => (i === 0 ? r.avaliadas : 0)); tique();
    const lucraram = r.banco.filter((b) => b.fora?.lucro_pct > 0).length;
    mensagemEvol([`${inteiro(r.avaliadas)} estratégias avaliadas; ${r.banco.length} no banco, ${lucraram} lucraram fora da amostra (a partir de ${isoParaBr(r.corte_data)}). `,
      h("a", { href: "#/banco" }, "Ver o banco")]);
    pintarBanco();
  } catch (e) {
    if (est.rodando?.cancelado) { estadoEvol("cancelada"); mensagemEvol("Evolução cancelada."); }
    else {
      estadoEvol("erro", "erro");
      const servidor = e instanceof API.ErroServidor;
      const partes = [servidor ? `Servidor: ${e.message} ` : `Falhou: ${e.message}. `];
      if (servidor && (e.status === 401 || e.status === 403) && est.eu?.login_disponivel) partes.push(h("a", { href: "/entrar/google" }, "Entrar com Google"), " ou ");
      if (servidor) partes.push(h("button.link-btn", { type: "button", onclick: () => trocarModo("local") }, "use o modo Seu computador"), " (grátis e sem limite).");
      mensagemEvol(partes, true);
    }
    if (anterior) { est.resultado = anterior; pintarBanco(); }
  } finally {
    clearInterval(vivo?.relogio);
    est.rodando = null;
    $("#evoluir").disabled = false; $("#evoluir span").textContent = "Evoluir"; $("#cancelar").hidden = true;
  }
}
function cancelar() {
  if (!est.rodando) return;
  est.rodando.cancelado = true; est.rodando.cancelar?.();
  for (const f of est.rodando.rejeitar || []) f(new Error("cancelado"));
}
function trocarModo(m) { const r = $(`input[name="modo"][value="${m}"]`); r.checked = true; r.dispatchEvent(new Event("change")); }

// ---------- banco ----------
const COLUNAS = [
  ["id", "ID", (b) => b.id, "esq"], ["direcao", "Direção", (b) => b.estrategia.direcao, "esq"], ["aptidao", "Aptidão", (b) => b.aptidao],
  ["d_ano", "Lucro/ano", (b) => b.dentro.lucro_ano_pct], ["d_dd", "DD máx.", (b) => b.dentro.dd_max_pct], ["d_rdd", "Ret./DD", (b) => b.dentro.retorno_dd],
  ["f_lucro", "Lucro", (b) => b.fora.lucro_pct], ["f_fl", "F. lucro", (b) => b.fora.fator_lucro], ["f_ops", "Operações", (b) => b.fora.operacoes],
  ["curva", "Curva completa", null],
];
function pintarCabecalho() {
  $("#cab-banco").replaceChildren(...COLUNAS.map(([k, rot, f, cls]) => {
    const th = h("th" + (cls ? "." + cls : ""), { scope: "col" });
    if (!f) { th.textContent = rot; th.className = "esq"; return th; }
    if (est.ordem.col === k) th.setAttribute("aria-sort", est.ordem.dir < 0 ? "descending" : "ascending");
    th.append(h("button", { type: "button", onclick: () => { est.ordem = { col: k, dir: est.ordem.col === k ? -est.ordem.dir : (k === "d_dd" || k === "id" || k === "direcao" ? 1 : -1) }; pintarBanco(); } }, rot));
    return th;
  }));
}
const curvas = new Map();
async function pintarBanco() {
  pintarCabecalho();
  // Quando o banco fecha, ele aparece por cima da nuvem: dentro (acento) ligado ao fora (âmbar).
  dispersao?.definirBanco(est.resultado ? pontosDoBanco(est.resultado) : []);
  const corpo = $("#tabela-banco tbody"), r = est.resultado;
  if (!r) { corpo.replaceChildren(h("tr", {}, h("td.vazio", { colspan: COLUNAS.length }, est.rodando ? "Evoluindo… o banco aparece quando todas as ilhas terminarem." : "Nenhuma estratégia ainda. Configure e aperte Evoluir."))); $("#banco-sub").textContent = "Rode uma evolução para encher o banco. As melhores de todas as ilhas, sem repetir comportamento, medidas fora da amostra só aqui no fim."; return; }
  const col = COLUNAS.find((c) => c[0] === est.ordem.col) || COLUNAS[2];
  let itens = r.banco.map((b, i) => ({ ...b, rank: i + 1 }));
  if (est.soFora) itens = itens.filter((b) => b.fora.lucro_pct > 0);
  itens.sort((a, b) => { const x = col[2](a), y = col[2](b); return (x < y ? -1 : x > y ? 1 : 0) * est.ordem.dir; });
  $("#banco-sub").textContent = `${r.banco.length} estratégias de ${inteiro(r.avaliadas)} avaliadas em ${est.indice[r.serie] ? r.serie : r.serie + " (seu CSV)"} · dentro da amostra até ${isoParaBr(r.corte_data)}, fora depois · aptidão: ${r.pedido.aptidao.replace("_", "/")} · semente ${r.pedido.semente}, ${r.pedido.ilhas} ilhas.`;
  if (!itens.length) { corpo.replaceChildren(h("tr", {}, h("td.vazio", { colspan: COLUNAS.length }, "Nenhuma estratégia do banco lucrou fora da amostra. Isso também é resultado: o mercado não deixou passar."))); return; }
  const sinal = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
  corpo.replaceChildren(...itens.map((b) => {
    const tr = h("tr", { onclick: (e) => { if (!e.target.closest("a")) location.hash = `#/estrategia/${b.id}`; } },
      h("td.esq", {}, h("span.rank", {}, b.rank), h("a", { href: `#/estrategia/${b.id}` }, b.id)),
      h("td.esq", {}, DIRECAO[b.estrategia.direcao]),
      h("td", {}, num(b.aptidao, 2)),
      h("td", { class: sinal(b.dentro.lucro_ano_pct) }, pct(b.dentro.lucro_ano_pct)),
      h("td", {}, num(b.dentro.dd_max_pct, 1) + "%"),
      h("td", {}, num(b.dentro.retorno_dd, 2)),
      h("td", { class: sinal(b.fora.lucro_pct) }, pct(b.fora.lucro_pct)),
      h("td", {}, num(b.fora.fator_lucro, 2)),
      h("td", {}, inteiro(b.fora.operacoes)),
      h("td.esq", {}, h("canvas", { "data-id": b.id, role: "img", "aria-label": `Curva de capital de ${b.id}` })));
    return tr;
  }));
  const serie = await serieLocal(r.serie).catch(() => null);
  if (!serie) return;
  const desenhar = () => {
    for (const c of $$("#tabela-banco canvas")) {
      const b = r.banco.find((x) => x.id === c.dataset.id); if (!b) continue;
      const k = `${r.serie}|${b.id}`;
      if (!curvas.has(k)) curvas.set(k, reduzir(backtest(serie, b.estrategia, custosDe(r.pedido)).equity, 120));
      sparkline(c, curvas.get(k), r.corte / serie.n);
    }
  };
  desenhar(); redesenhos = redesenhos.filter((f) => f.nome !== "banco"); desenhar.nome = "banco"; redesenhos.push(desenhar);
}

// ---------- detalhe ----------
let vistaAtual = null;
function mostrarVista(qual) {
  $("#vista-inicio").hidden = qual !== "inicio";
  $("#vista-estrategia").hidden = qual !== "estrategia";
  vistaAtual = qual;
}

async function abrirEstrategia({ nome, estrategia, pedido, item, conferir }) {
  mostrarVista("estrategia");
  const raiz = $("#vista-estrategia");
  raiz.replaceChildren(h("p.carregando", {}, "carregando a série e refazendo o backtest"));
  window.scrollTo({ top: 0 });
  let serie;
  try { serie = await serieLocal(nome); }
  catch (e) { raiz.replaceChildren(h("a.voltar", { href: "#/" }, "← Início"), h("p.msg.erro", {}, `Não consegui carregar ${nome}: ${e.message}`)); return; }
  const custos = custosDe(pedido), corte = Math.floor(serie.n * pedido.fracao_is);
  const completo = backtest(serie, estrategia, custos);
  const dentro = item?.dentro || backtest(serie, estrategia, { ...custos, ini: 0, fim: corte }).metricas;
  const fora = item?.fora || backtest(serie, estrategia, { ...custos, ini: corte, fim: serie.n }).metricas;
  const id = item?.id || (await import("./motor/gerador.js")).hash(chave(estrategia));
  const outras = outrasDoMercado(nome);
  const linkPedido = { semente: pedido.semente, custo_pct: pedido.custo_pct, slippage_pct: pedido.slippage_pct, fracao_is: pedido.fracao_is, min_operacoes: pedido.min_operacoes ?? PADRAO.min_operacoes, aptidao: pedido.aptidao ?? PADRAO.aptidao };
  document.title = `${id} · Alfa Aberta`;

  const ic = (d) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${d}"/></svg>`;
  const linkCaixa = h("div.painel", { hidden: true, style: "padding:12px 16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap" });
  const botaoLink = h("button.secundario", { type: "button", html: ic("M6.5 9.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.8.8M9.5 6.5a3 3 0 0 0-4.2 0L3 8.8a3 3 0 0 0 4.2 4.2l.8-.8") + "Link do atestado" });
  botaoLink.addEventListener("click", () => {
    const url = `${location.origin}${location.pathname}#/conferir/${paraBase64url({ v: 1, serie: nome, estrategia, pedido: linkPedido, outras })}`;
    const campo = h("input", { type: "text", readonly: true, value: url, "aria-label": "Link verificável", style: "flex:1;min-width:0;height:32px;padding:0 9px;border-radius:7px;border:1px solid var(--borda);background:var(--superficie-2);color:var(--tinta);font:12px var(--fonte-mono)" });
    const bc = h("button.mini", { type: "button", onclick: () => copiar(url, bc) }, "Copiar");
    linkCaixa.replaceChildren(h("span", { style: "font-size:12.5px;color:var(--tinta-2);width:100%" }, est.enviados.has(nome) ? "Atenção: a série é um CSV seu; quem abrir o link vai precisar do mesmo arquivo." : "Quem abrir este link refaz o backtest e o atestado no próprio navegador, com a mesma semente e os mesmos custos."), campo, bc);
    linkCaixa.hidden = false; copiar(url, botaoLink);
  });
  const botaoAtestar = h("button.primario", { type: "button", html: ic("M8 1.5 2.5 4v4c0 3.2 2.4 5.6 5.5 6.5 3.1-.9 5.5-3.3 5.5-6.5V4z M5.5 8l1.8 1.8L10.8 6.3") + "<span>Atestar robustez</span>" });

  const metricasLinhas = [
    ["Lucro total", "lucro_pct", (v) => pct(v), true], ["Lucro por ano", "lucro_ano_pct", (v) => pct(v), true], ["Drawdown máx.", "dd_max_pct", (v) => num(v, 1) + "%"],
    ["Retorno ÷ DD", "retorno_dd", (v) => num(v, 2)], ["Fator de lucro", "fator_lucro", (v) => num(v, 2)], ["Acerto", "acerto_pct", (v) => num(v, 1) + "%"],
    ["Operações", "operacoes", inteiro], ["Média por operação", "media_pct", (v) => pct(v, 2), true], ["Sharpe", "sharpe", (v) => num(v, 2)],
    ["SQN", "sqn", (v) => num(v, 2)], ["Estabilidade (R²)", "estabilidade", (v) => num(v, 2)], ["Exposição", "exposicao_pct", (v) => num(v, 1) + "%"], ["Anos", "anos", (v) => num(v, 1)],
  ];
  const cls = (v, colorir) => (colorir ? (v > 0 ? "pos" : v < 0 ? "neg" : "") : "");
  const tabMetricas = h("table.metricas-tab", {}, h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Métrica"), h("th.c-dentro", { scope: "col" }, "Dentro"), h("th.c-fora", { scope: "col" }, "Fora"), h("th", { scope: "col" }, "Completo"))),
    h("tbody", {}, metricasLinhas.map(([rot, k, f, c]) => h("tr", {}, h("td", {}, rot), h("td", { class: cls(dentro[k], c) }, f(dentro[k])), h("td", { class: cls(fora[k], c) }, f(fora[k])), h("td", { class: cls(completo.metricas[k], c) }, f(completo.metricas[k]))))));

  const canvasEq = h("canvas", { tabindex: 0 }), dica = h("div.dica", { hidden: true, "aria-hidden": "true" });
  const chavePreco = h("input", { type: "checkbox" });
  const json = JSON.stringify(estrategia, null, 2);
  const bJson = h("button.mini", { type: "button", onclick: () => copiar(json, bJson) }, "Copiar JSON");

  const atestadoCorpo = h("div.atestado-vazio", {},
    h("p", {}, `Roda 6 testes de robustez${outras.length ? ` e mais 1 em ${outras.length} outras séries do mesmo mercado (${outras.join(", ")})` : ""}: fora da amostra, walk-forward, Monte Carlo das operações, custos piores, parâmetros vizinhos e contra entradas aleatórias. Determinístico pela semente ${pedido.semente}. Leva alguns segundos e roda ${est.modo === "servidor" ? "no servidor" : "no seu navegador"}.`),
    botaoAtestar);

  raiz.replaceChildren(...[
    h("div.det-topo", {}, h("a.voltar", { href: conferir ? "#/" : "#/banco" }, conferir ? "← Alfa Aberta" : "← Banco")),
    conferir ? h("div.conferir-faixa", { html: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 2.5 4v4c0 3.2 2.4 5.6 5.5 6.5 3.1-.9 5.5-3.3 5.5-6.5V4z"/><path d="M5.5 8l1.8 1.8L10.8 6.3"/></svg><div><b>Não confie, confira.</b>Este link traz só a regra, a série, a semente e os custos. O backtest e o atestado abaixo estão sendo refeitos agora, no seu navegador, com o mesmo motor aberto.</div>` }) : null,
    h("div.det-cab", {},
      h("div", {}, h("h1", {}, `estratégia ${id}`),
        h("div.det-meta", {}, h("span.etiqueta.acento", {}, nome), h("span.etiqueta", {}, DIRECAO[estrategia.direcao]), h("span.etiqueta", {}, `${estrategia.entrada.length} ${estrategia.entrada.length > 1 ? "condições" : "condição"}`),
          h("span.etiqueta", {}, `${dataCurta(serie.tempo[0])} – ${dataCurta(serie.tempo[serie.n - 1])}`), h("span.etiqueta", {}, `custo ${num(pedido.custo_pct, 2)}% + slip ${num(pedido.slippage_pct, 2)}%`),
          h("span.etiqueta", {}, `semente ${pedido.semente}`), item ? h("span.etiqueta", {}, `aptidão ${num(item.aptidao, 2)}`) : null)),
      h("div.det-acoes", {}, botaoLink, h("button.secundario", { type: "button", onclick: () => baixar(`alfa-${id}.json`, json, "application/json") }, "Baixar JSON"))),
    linkCaixa,
    h("section.painel", { "aria-label": "Regra" }, h("p.regra", {}, descrever(estrategia)),
      h("div.regra-rodape", {}, h("details.json", {}, h("summary", {}, "A estratégia como dado (JSON)"), h("pre", {}, h("code", {}, json))), bJson)),
    h("div.det-grade", {},
      h("section.painel.curva", { "aria-labelledby": "t-curva" },
        h("div.painel-cab", {}, h("h2", { id: "t-curva" }, "Curva de capital"),
          h("span.legenda", {}, h("i.lg.dentro"), " dentro da amostra ", h("i.lg.fora"), ` fora (desde ${dataCurta(serie.tempo[corte])})`),
          h("label.chave", {}, chavePreco, h("span", {}, "preço"))),
        h("div.curva-canvas", {}, canvasEq, dica)),
      h("section.painel", { "aria-labelledby": "t-met" }, h("div.painel-cab", {}, h("h2", { id: "t-met" }, "Métricas")), tabMetricas)),
    h("section.painel.atestado", { "aria-labelledby": "t-atest" }, h("div.painel-cab", {}, h("h2", { id: "t-atest" }, "Atestado de robustez")), atestadoCorpo),
    painelExportar(estrategia, id, custos),
    painelOperacoes(serie, completo.trades, corte)].filter(Boolean));

  const graf = new GraficoEquity(canvasEq, dica);
  const definir = () => { canvasEq.classList.toggle("com-preco", chavePreco.checked); graf.definir({ tempo: serie.tempo, equity: completo.equity, corte, preco: serie.fechamento, mostrarPreco: chavePreco.checked }); };
  chavePreco.addEventListener("change", definir); definir();
  redesenhos = redesenhos.filter((f) => f.nome !== "equity"); const rd = () => graf.desenhar(); rd.nome = "equity"; redesenhos.push(rd);

  const rodarAtestado = async () => {
    botaoAtestar.disabled = true; botaoAtestar.querySelector("span").textContent = "Atestando…";
    atestadoCorpo.replaceChildren(h("p.carregando", {}, `rodando os testes ${est.modo === "servidor" && !conferir ? "no servidor" : "no seu navegador"} (walk-forward, Monte Carlo, acaso, vizinhos${outras.length ? ", outros mercados" : ""})`));
    const t0 = performance.now();
    try {
      const r = est.modo === "servidor" && !conferir
        ? await API.tarefa("/api/atestar", { serie: est.enviados.has(nome) ? { csv: est.enviados.get(nome), nome } : nome, estrategia, pedido: linkPedido, outras }, null)
        : await atestarLocal(nome, estrategia, linkPedido, outras);
      atestadoCorpo.className = ""; atestadoCorpo.replaceChildren(...pintarAtestado(r, (performance.now() - t0) / 1000, conferir || est.modo !== "servidor"));
    } catch (e) {
      const servidor = e instanceof API.ErroServidor;
      atestadoCorpo.replaceChildren(h("p", { style: "color:var(--ruim)" }, `${servidor ? "Servidor" : "Falhou"}: ${e.message}`),
        servidor ? h("button.secundario", { type: "button", onclick: () => { trocarModo("local"); rodarAtestado(); } }, "Rodar no meu navegador") : botaoAtestar);
      botaoAtestar.disabled = false; botaoAtestar.querySelector("span").textContent = "Tentar de novo";
    }
  };
  botaoAtestar.addEventListener("click", rodarAtestado);
  if (conferir) rodarAtestado();
}

function atestarLocal(nome, estrategia, pedido, outras) {
  return new Promise(async (ok, falha) => {
    const w = novoTrabalhador();
    w.onerror = (e) => { e.preventDefault?.(); w.terminate(); falha(new Error(e.message || "o trabalhador não iniciou")); };
    w.onmessage = ({ data: m }) => {
      if (m.tipo === "atestado") { w.terminate(); ok(m.resultado); }
      else if (m.tipo === "erro") { w.terminate(); falha(new Error(m.mensagem)); }
    };
    try {
      for (const n of [nome, ...outras]) w.postMessage({ tipo: "serie", nome: n, csv: await textoDaSerie(n) });
      w.postMessage({ tipo: "atestar", serie: nome, estrategia, pedido, outras });
    } catch (e) { w.terminate(); falha(e); }
  });
}

const ROTULOS = {
  operacoes: "operações", lucro_pct: "lucro", fator_lucro: "fator de lucro", dd_max_pct: "drawdown máx.", janelas_lucrativas: "janelas lucrativas",
  lucro_fora_total_pct: "lucro fora (soma)", eficiencia: "eficiência", lucro_p5_pct: "lucro no pior 5%", lucro_mediano_pct: "lucro mediano",
  dd_p95_pct: "drawdown no pior 5%", dd_original_pct: "drawdown original", lucrativos_pct: "retestes lucrativos", lucrativas_pct: "variações lucrativas",
  retorno_dd_mediano: "retorno/DD mediano", retorno_dd_original: "retorno/DD original", p_valor: "p-valor", lucro_real_pct: "lucro da estratégia",
  lucro_acaso_mediano_pct: "lucro mediano do acaso", lucro_acaso_p95_pct: "lucro do acaso (p95)", lucrativas: "séries lucrativas",
};
const fmtNumero = (k, v) => (typeof v === "string" ? v : k.endsWith("_pct") ? (k === "lucrativos_pct" || k === "lucrativas_pct" || k.startsWith("dd_") ? num(v, 1) + "%" : pct(v, 1)) : k === "p_valor" ? num(v, 3) : k === "operacoes" ? inteiro(v) : num(v, 2));

function pintarAtestado(r, segundos, local) {
  const frase = { A: "passou em todos os testes", B: "passou em quase todos", C: "passou na maioria", D: "falhou em vários testes", E: "falhou na maior parte" }[r.nota] || "";
  const partes = [
    h("div.nota-cab", {}, h("div.letra", { "data-nota": r.nota, role: "img", "aria-label": `Nota ${r.nota}` }, r.nota),
      h("div.nota-texto", {}, h("h3", {}, `Nota ${r.nota}: ${frase}`),
        h("p", {}, `${r.aprovados} de ${r.total} testes aprovados. A = todos; B ≥ 80%; C ≥ 60%; D ≥ 40%; E abaixo disso. Nota alta não é promessa: é a regra sobrevivendo ao que tentamos para derrubá-la.`),
        h("div.trilha", { "aria-hidden": "true" }, r.testes.map((t) => h("i" + (t.passou ? ".ok" : ""), { title: t.titulo }))))),
    h("div.testes", {}, r.testes.map((t) => h("article.teste", {},
      h("div.teste-cab", {}, h("h4", {}, t.titulo), h("span.selo-teste" + (t.passou ? ".ok" : ".nao"), {}, t.passou ? "passou" : "não passou")),
      h("p.regra-teste", {}, t.regra),
      h("dl", {}, Object.entries(t.numeros || {}).flatMap(([k, v]) => [h("dt", {}, ROTULOS[k] || k.replace(/_/g, " ")), h("dd", {}, fmtNumero(k, v))]))))),
  ];
  const mc = r.testes.find((t) => t.nome === "monte_carlo_operacoes"), rt = r.testes.find((t) => t.nome === "monte_carlo_reteste");
  if (mc || rt) {
    const n = mc?.numeros || {}, m = rt?.numeros || {};
    partes.push(h("div.sub-tab", {}, h("h4", {}, "Monte Carlo, em uma frase"),
      h("p", { style: "margin:0;padding:0 16px 14px;font-size:13px;color:var(--tinta-2)" },
        mc ? `Embaralhando e pulando 10% das operações 1.000 vezes, o lucro mediano é ${pct(n.lucro_mediano_pct)} e o pior 5% termina em ${pct(n.lucro_p5_pct)}; o drawdown no pior 5% chega a ${num(n.dd_p95_pct, 1)}% (o original foi ${num(n.dd_original_pct, 1)}%). ` : "",
        rt ? `Com custos até 2×, slippage até 3× e 10% dos sinais perdidos, ${num(m.lucrativos_pct, 0)}% dos retestes lucraram.` : "")));
  }
  const wf = r.testes.find((t) => t.nome === "walk_forward");
  if (wf?.janelas?.length) {
    partes.push(h("div.sub-tab", {}, h("h4", {}, "Walk-forward: janela a janela (só o resultado cego conta)"),
      h("div.tabela-rolo", { tabindex: 0 }, h("table.tabela", {}, h("thead", {}, h("tr", {}, ["Janela", "De", "Até", "Lucro/ano dentro", "Lucro fora", "Lucro/ano fora", "Operações fora"].map((c, i) => h("th" + (i < 3 ? ".esq" : ""), { scope: "col" }, c)))),
        h("tbody", {}, wf.janelas.map((j) => h("tr", { style: "cursor:default" }, h("td.esq", {}, j.janela), h("td.esq", {}, isoParaBr(j.de)), h("td.esq", {}, isoParaBr(j.ate)),
          h("td", {}, pct(j.lucro_dentro_ano)), h("td", { class: j.lucro_fora > 0 ? "pos" : "neg" }, pct(j.lucro_fora)), h("td", {}, pct(j.lucro_fora_ano)), h("td", {}, inteiro(j.operacoes_fora)))))))));
  }
  const om = r.testes.find((t) => t.nome === "outros_mercados");
  if (om?.series?.length) {
    partes.push(h("div.sub-tab", {}, h("h4", {}, "Outros mercados: a mesma regra, sem mudar nada"),
      h("div.tabela-rolo", { tabindex: 0 }, h("table.tabela", {}, h("thead", {}, h("tr", {}, ["Série", "Operações", "Lucro", "Fator de lucro", "DD máx."].map((c, i) => h("th" + (i < 1 ? ".esq" : ""), { scope: "col" }, c)))),
        h("tbody", {}, om.series.map((s) => h("tr", { style: "cursor:default" }, h("td.esq", {}, s.serie), h("td", {}, inteiro(s.operacoes)), h("td", { class: s.lucro_pct > 0 ? "pos" : "neg" }, pct(s.lucro_pct)), h("td", {}, num(s.fator_lucro, 2)), h("td", {}, num(s.dd_max_pct, 1) + "%"))))))));
  }
  partes.push(h("p.recalc", {}, `${r.serie} · ${inteiro(r.barras)} barras de ${isoParaBr(r.de)} a ${isoParaBr(r.ate)} · semente ${r.semente} · custo ${num(r.custos.custo_pct, 2)}% + slippage ${num(r.custos.slippage_pct, 2)}% por lado · id ${r.id} · calculado em ${num(segundos, 1)} s ${local ? "no seu navegador" : "no servidor"}.`));
  return partes;
}

// ---------- exportar ----------
let exportador = null;
const carregarExportador = () => (exportador ??= import("./motor/exportar.js").catch(() => null));
function painelExportar(estrategia, id, custos) {
  const abas = h("div.abas", { role: "tablist", "aria-label": "Formato de exportação" });
  const corpo = h("div.codigo", { role: "tabpanel", id: "export-corpo", tabindex: 0 });
  const botoes = FORMATOS.map(([f, rot], i) => h("button", { role: "tab", type: "button", "aria-selected": i === 0 ? "true" : "false", tabindex: i === 0 ? 0 : -1, "aria-controls": "export-corpo", "data-formato": f }, rot));
  abas.append(...botoes);
  const escolher = async (b) => {
    for (const x of botoes) { const s = x === b; x.setAttribute("aria-selected", s); x.tabIndex = s ? 0 : -1; }
    corpo.replaceChildren(h("p.carregando", { style: "padding:16px;margin:0" }, "gerando o código"));
    const formato = b.dataset.formato;
    try {
      let r;
      const mod = await carregarExportador();
      if (mod?.exportar) r = await mod.exportar(estrategia, formato, custos);
      else if (est.modo === "servidor") r = await API.exportar(estrategia, formato);
      else throw new Error("O exportador ainda não está nesta versão da página. Ligue o modo Servidor ou tente mais tarde.");
      const meta = mod?.FORMATOS?.[formato];
      const arquivo = r.arquivo || `alfa-${id}.${{ python: "py", pine: "pine", mql5: "mq5", ntsl: "txt" }[formato]}`;
      const bc = h("button.mini", { type: "button", onclick: () => copiar(r.codigo, bc) }, "Copiar");
      corpo.replaceChildren(
        h("div.export-barra", {}, h("span.arquivo", {}, arquivo), meta ? h("span", {}, `${meta.nome} · ${meta.plataforma}${meta.verificado ? " · paridade testada com o motor" : ""}`) : null, bc, h("button.mini", { type: "button", onclick: () => baixar(arquivo, r.codigo) }, "Baixar")),
        r.avisos?.length ? h("ul.avisos", {}, r.avisos.map((a) => h("li", {}, a))) : null,
        h("pre", {}, h("code", {}, r.codigo)));
    } catch (e) { corpo.replaceChildren(h("p", { style: "padding:16px;margin:0;color:var(--tinta-2)" }, e.message)); }
  };
  abas.addEventListener("click", (e) => { const b = e.target.closest("[role=tab]"); if (b) escolher(b); });
  abas.addEventListener("keydown", (e) => {
    const i = botoes.indexOf(document.activeElement); if (i < 0) return;
    const j = e.key === "ArrowRight" ? (i + 1) % botoes.length : e.key === "ArrowLeft" ? (i - 1 + botoes.length) % botoes.length : -1;
    if (j >= 0) { e.preventDefault(); botoes[j].focus(); escolher(botoes[j]); }
  });
  escolher(botoes[0]);
  return h("section.painel.export", { "aria-labelledby": "t-exp" }, h("div.painel-cab", {}, h("h2", { id: "t-exp" }, "Exportar"), h("span", { style: "font-size:12px;color:var(--tinta-3)" }, "mesma regra, mesmas fórmulas; confira os avisos de cada plataforma")), abas, corpo);
}

// ---------- operações ----------
function painelOperacoes(serie, trades, corte) {
  const MOTIVO = { stop: "stop", alvo: "alvo", tempo: "tempo", inversao: "inversão", fim: "fim do teste" };
  const fp = (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: v < 10 ? 4 : 2 });
  const linhas = [...trades].reverse();
  const LIM = 200;
  const tbody = h("tbody");
  const pintar = (n) => tbody.replaceChildren(...linhas.slice(0, n).map((t, k) => h("tr", { style: "cursor:default" },
    h("td.esq", {}, trades.length - k), h("td.esq", {}, t.dir > 0 ? "compra" : "venda"),
    h("td.esq", {}, dataCurta(serie.tempo[t.iEnt])), h("td.esq", {}, dataCurta(serie.tempo[t.iSai])),
    h("td", {}, fp(t.pEnt)), h("td", {}, fp(t.pSai)), h("td", { class: t.ret > 0 ? "pos" : "neg" }, pct(t.ret, 2)),
    h("td", {}, inteiro(t.iSai - t.iEnt + 1)), h("td.esq", {}, MOTIVO[t.motivo] || t.motivo),
    h("td.esq", { style: `color:${t.iEnt >= corte ? "var(--fora)" : "var(--tinta-3)"}` }, t.iEnt >= corte ? "fora" : "dentro"))));
  pintar(LIM);
  const mais = trades.length > LIM ? h("button.link-btn", { type: "button", style: "margin:10px 16px", onclick: (e) => { pintar(trades.length); e.target.remove(); } }, `mostrar todas as ${inteiro(trades.length)}`) : null;
  return h("section.painel", { "aria-labelledby": "t-ops" }, h("div.painel-cab", {}, h("h2", { id: "t-ops" }, "Operações"), h("span", { style: "font-size:12px;color:var(--tinta-3)" }, `${inteiro(trades.length)} no período inteiro, mais recentes primeiro`)),
    h("div.trades-rolo", { tabindex: 0, "aria-label": "Lista de operações" }, h("table.tabela", {}, h("thead", {}, h("tr", {}, ["#", "Lado", "Entrada", "Saída", "Preço ent.", "Preço saída", "Resultado", "Barras", "Motivo", "Amostra"].map((c, i) => h("th" + ([0, 1, 2, 3, 8, 9].includes(i) ? ".esq" : ""), { scope: "col" }, c)))), tbody)), mais);
}

// ---------- agentes ----------
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const realcar = (txt) => esc(txt).split("\n").map((l) => (/^\s*(#|\/\/)/.test(l) ? `<span class="c">${l}</span>` : l.replace(/("[^"]*")/g, '<span class="s">$1</span>'))).join("\n");
function pintarAgentes() {
  const o = location.origin && location.origin !== "null" ? location.origin : "https://alfa-aberta.exemplo";
  $("#url-mcp").textContent = `${o}/mcp`; $("#url-api").textContent = `${o}/api`;
  const ex = {
    "ex-curl": `# séries disponíveis
curl -s ${o}/api/series

# evoluir: devolve {"tarefa": "..."}
# com login, mais limite: exporte ALFA_CHAVE (em /api/eu) e mande no cabeçalho authorization
curl -s -X POST ${o}/api/evoluir \\
  -H "content-type: application/json" \\
  -d '{"serie":"BTCUSDT-4h","pedido":{"populacao":120,"geracoes":30,"ilhas":4,"semente":42}}'

# acompanhar até "estado": "pronta"
curl -s ${o}/api/tarefas/ID_DA_TAREFA

# atestar uma estratégia do banco
curl -s -X POST ${o}/api/atestar \\
  -H "content-type: application/json" \\
  -d '{"serie":"BTCUSDT-4h","estrategia":{...},"pedido":{"semente":42},"outras":["ETHUSDT-4h","SOLUSDT-4h"]}'

# exportar: python | pine | mql5 | ntsl
curl -s -X POST ${o}/api/exportar \\
  -H "content-type: application/json" \\
  -d '{"estrategia":{...},"formato":"pine"}'`,
    "ex-claude": `# Claude Code
claude mcp add --transport http alfa-aberta ${o}/mcp

# Claude (web e app): Configurações > Conectores >
# Adicionar conector personalizado, URL:
#   ${o}/mcp

# Claude Desktop, claude_desktop_config.json
{
  "mcpServers": {
    "alfa-aberta": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${o}/mcp"]
    }
  }
}`,
    "ex-chatgpt": `# ChatGPT: Configurações > Apps e conectores > Modo desenvolvedor >
# Criar conector, URL do servidor MCP:
#   ${o}/mcp

# API da OpenAI (Responses), ferramenta MCP remota
{
  "model": "<seu modelo>",
  "tools": [{
    "type": "mcp",
    "server_label": "alfa_aberta",
    "server_url": "${o}/mcp",
    "require_approval": "never"
  }],
  "input": "Evolua estratégias em BTCUSDT-4h e atesta a melhor."
}`,
  };
  for (const [id, txt] of Object.entries(ex)) { const p = $("#" + id); p.querySelector("code").innerHTML = realcar(txt); const b = p.querySelector(".copiar"); b.onclick = () => copiar(txt, b); }
  const abas = $$("#agentes [role=tab]");
  const sel = (b) => { for (const x of abas) { const s = x === b; x.setAttribute("aria-selected", s); x.tabIndex = s ? 0 : -1; $("#" + x.getAttribute("aria-controls")).hidden = !s; } };
  for (const b of abas) b.addEventListener("click", () => sel(b));
  $("#agentes .abas").addEventListener("keydown", (e) => {
    const i = abas.indexOf(document.activeElement); if (i < 0) return;
    const j = e.key === "ArrowRight" ? (i + 1) % abas.length : e.key === "ArrowLeft" ? (i - 1 + abas.length) % abas.length : -1;
    if (j >= 0) { e.preventDefault(); abas[j].focus(); sel(abas[j]); }
  });
  for (const b of $$("[data-copiar]")) b.addEventListener("click", () => copiar($(b.dataset.copiar).textContent, b));
  pintarChaveApi();
}
function pintarChaveApi() {
  const c = $("#chave-api"); if (!c) return;
  const eu = est.eu;
  if (!eu) { c.replaceChildren(h("span", {}, "A API e o MCP rodam o mesmo motor desta página. No modo Seu computador nada sai do navegador; no modo Servidor, o servidor pode pedir login e ter limites.")); return; }
  const lim = Object.entries(eu.limites || {}).map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ");
  const partes = [eu.logado ? `Conectado como ${eu.email || "você"}.` : "Sem login: limites menores."];
  if (lim) partes.push(` Limites: ${lim}.`);
  c.replaceChildren(h("span", {}, partes.join("")));
  if (eu.chave_api) {
    const code = h("code", { style: "padding:4px 8px;background:var(--superficie-2);border:1px solid var(--borda);border-radius:6px" }, "•".repeat(12) + String(eu.chave_api).slice(-4));
    const b = h("button.mini", { type: "button", onclick: () => copiar(eu.chave_api, b) }, "Copiar chave");
    c.append(h("div", { style: "display:flex;gap:8px;align-items:center;margin-top:8px" }, h("span", {}, "Sua chave de API:"), code, b));
  }
}

// ---------- rotas ----------
async function rota() {
  const hsh = location.hash || "#/";
  for (const a of $$(".navega a")) a.toggleAttribute("aria-current", a.getAttribute("href") === (hsh.startsWith("#/estrategia") || hsh.startsWith("#/conferir") ? "" : hsh));
  for (const a of $$(".navega a")) if (a.hasAttribute("aria-current")) a.setAttribute("aria-current", "page");
  let m;
  if ((m = hsh.match(/^#\/estrategia\/([\w-]+)/))) {
    const r = est.resultado, item = r?.banco.find((b) => b.id === m[1]);
    if (!item) { mostrarVista("estrategia"); $("#vista-estrategia").replaceChildren(h("a.voltar", { href: "#/" }, "← Início"), h("p.msg", {}, `A estratégia ${m[1]} não está no banco desta sessão. Rode a evolução de novo (mesma semente, mesmas ilhas: o banco volta igual) ou abra um link de atestado.`)); return; }
    return abrirEstrategia({ nome: r.serie, estrategia: item.estrategia, pedido: r.pedido, item });
  }
  if ((m = hsh.match(/^#\/conferir\/([\w-]+)/))) {
    let dado;
    try { dado = deBase64url(m[1]); if (!dado.estrategia || !dado.serie) throw new Error("faltam campos"); }
    catch (e) { mostrarVista("estrategia"); $("#vista-estrategia").replaceChildren(h("a.voltar", { href: "#/" }, "← Início"), h("p.msg.erro", {}, `Link de atestado inválido: ${e.message}.`)); return; }
    if (!est.indice[dado.serie] && !est.enviados.has(dado.serie)) {
      mostrarVista("estrategia");
      const inp = h("input", { type: "file", accept: ".csv,text/csv" });
      inp.addEventListener("change", async () => { const f = inp.files[0]; if (!f) return; const t = await f.text(); est.enviados.set(dado.serie, t); est.series.delete(dado.serie); rota(); });
      $("#vista-estrategia").replaceChildren(h("a.voltar", { href: "#/" }, "← Início"), h("div.painel", { style: "padding:16px" }, h("p", {}, `Este atestado usa a série "${dado.serie}", que não é pública. Envie o mesmo CSV para refazer o cálculo:`), inp));
      return;
    }
    return abrirEstrategia({ nome: dado.serie, estrategia: dado.estrategia, pedido: { ...PADRAO, ...dado.pedido }, conferir: true });
  }
  document.title = "Alfa Aberta — gere, teste e destrua estratégias de trading";
  const voltando = vistaAtual === "estrategia";
  mostrarVista("inicio");
  if (voltando) requestAnimationFrame(() => { redesenharGraficos(); dispersao.redesenharTudo(); });
  const alvo = { "#/banco": "#banco", "#/agentes": "#agentes" }[hsh];
  if (alvo) requestAnimationFrame(() => $(alvo).scrollIntoView({ block: "start" }));
  else if (voltando) window.scrollTo({ top: 0 });
}

// ---------- início ----------
async function iniciar() {
  iniciarTema();
  dispersao = new Dispersao($("#dispersao"), $("#n-pontos"));
  try { est.indice = await (await fetch("dados/indice.json")).json(); }
  catch { est.indice = {}; $("#lista-series").append(h("p.erro-campo", {}, "Não consegui ler dados/indice.json. Envie um CSV.")); }
  est.serieNome = Object.keys(est.indice).find((k) => k === "BTCUSDT-4h") || Object.keys(est.indice)[0];
  pintarSeries(); preencherPadroes(); iniciarModo(); pintarAgentes();
  const f = form();
  f.addEventListener("submit", evoluir);
  f.addEventListener("input", (e) => { if (e.target.name === "fracao_is") $("#fis-saida").textContent = e.target.value + "%"; atualizarEstimativa(); });
  f.addEventListener("change", atualizarEstimativa);
  $("#cancelar").addEventListener("click", cancelar);
  $("#restaurar").addEventListener("click", preencherPadroes);
  $("#todos-ind").addEventListener("click", () => { const caixas = $$('input[name="ind"]'); const todos = caixas.every((c) => c.checked); caixas.forEach((c) => (c.checked = !todos)); if (todos) caixas[0].checked = true; });
  $("#csv").addEventListener("change", (e) => e.target.files[0] && enviarCsv(e.target.files[0]));
  $("#so-fora").addEventListener("change", (e) => { est.soFora = e.target.checked; pintarBanco(); });
  linhasAptidao($("#g-aptidao"), [], PADRAO.geracoes);
  redesenhos.push(() => { if (vivo) linhasAptidao($("#g-aptidao"), vivo.porIlha, vivo.pedido.geracoes); else linhasAptidao($("#g-aptidao"), [], PADRAO.geracoes); }, () => dispersao.redesenharTudo());
  try {
    const salvo = JSON.parse(sessionStorage.getItem("alfa.ultimo") || "null");
    if (salvo?.banco && est.indice[salvo.serie]) {
      est.resultado = salvo; estadoEvol("da sessão anterior");
      dispersao.definirBanco(pontosDoBanco(salvo));
    }
  } catch { /* nada salvo */ }
  pintarBanco();
  window.addEventListener("hashchange", rota);
  rota();
}
function pontosDoBanco(r) { return r.banco.map((b) => ({ dx: b.dentro.dd_max_pct, dy: b.dentro.lucro_pct, fx: b.fora.dd_max_pct, fy: b.fora.lucro_pct })); }

iniciar();
