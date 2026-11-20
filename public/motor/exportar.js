// Exportadores: a mesma estratégia (JSON) vira código para quem quer rodar fora do site.
// - python: script autocontido (só biblioteca padrão) que refaz indicadores e motor de backtest.
//   É o exportador de referência: o teste de paridade cobra que ele dê as MESMAS operações do motor JS.
// - pine (TradingView), mql5 (MetaTrader 5) e ntsl (Profit, da Nelogica): gerados de forma
//   determinística, com os indicadores escritos à mão para seguir as nossas fórmulas (as funções
//   prontas das plataformas semeiam a EMA, o RSI e o ATR de outro jeito). Não dá para compilar essas
//   três aqui: cada arquivo leva os avisos do que pode divergir.
import { CATALOGO } from "./indicadores.js";
import { validar, descrever, espelhar, chave } from "./estrategia.js";
import { CUSTOS_PADRAO } from "./backtest.js";
import { hash } from "./gerador.js";

export const FORMATOS = {
  python: { nome: "Python 3", plataforma: "qualquer computador (só a biblioteca padrão)", extensao: ".py", linguagem: "python", verificado: true },
  pine: { nome: "Pine Script v6", plataforma: "TradingView", extensao: ".pine", linguagem: "pine", verificado: false },
  mql5: { nome: "MQL5", plataforma: "MetaTrader 5 (Expert Advisor)", extensao: ".mq5", linguagem: "mql5", verificado: false },
  ntsl: { nome: "NTSL", plataforma: "Profit (Nelogica)", extensao: ".ntsl", linguagem: "ntsl", verificado: false },
};

const AVISO_NAO_COMPILADO = (plat) =>
  `Arquivo gerado de forma determinística a partir da estratégia, mas ainda não compilado nem rodado no ${plat}: confira no backtest da plataforma antes de operar.`;

export function exportar(est, formato, opcoes = {}) {
  validar(est);
  const meta = FORMATOS[formato];
  if (!meta) throw new Error(`formato desconhecido: ${formato} (use ${Object.keys(FORMATOS).join(", ")})`);
  const id = hash(chave(est));
  const op = {
    custo_pct: opcoes.custo_pct ?? CUSTOS_PADRAO.custo_pct,
    slippage_pct: opcoes.slippage_pct ?? CUSTOS_PADRAO.slippage_pct,
    nome: opcoes.nome || `Alfa Aberta ${id}`,
  };
  const gerar = { python: gerarPython, pine: gerarPine, mql5: gerarMql5, ntsl: gerarNtsl }[formato];
  const { codigo, avisos } = gerar(est, op, id);
  const arquivo = { python: `alfa_${id}.py`, pine: `alfa_${id}.pine`, mql5: `AlfaAberta_${id}.mq5`, ntsl: `alfa_${id}.ntsl` }[formato];
  return { arquivo, linguagem: meta.linguagem, codigo, avisos };
}

function cabecalho(est, prefixo) {
  const linhas = [
    "Gerado pelo Alfa Aberta (licença MIT): gerador grátis de estratégias com testes de robustez.",
    "Resultado passado não garante resultado futuro. Teste antes de operar dinheiro de verdade.",
    "",
    ...quebrar(descrever(est), 100),
    "",
    "Estratégia (JSON):",
    JSON.stringify(est),
  ];
  return linhas.map((l) => (l ? `${prefixo} ${l}` : prefixo)).join("\n") + "\n";
}

function quebrar(texto, largura) {
  const out = []; let linha = "";
  for (const p of texto.split(" ")) {
    if (linha && (linha + " " + p).length > largura) { out.push(linha); linha = p; } else linha = linha ? `${linha} ${p}` : p;
  }
  if (linha) out.push(linha);
  return out;
}

const num = (x) => (Number.isInteger(x) ? `${x}.0` : String(x));

// Plano comum às plataformas: indicadores distintos (um nome cada) e as condições dos dois lados.
function plano(est) {
  const inds = new Map();
  const registrar = (o) => {
    if (o.k !== undefined) return { k: o.k };
    const k = o.ind === "preco" ? `preco:${o.campo || "fechamento"}` : `${o.ind}:${o.p.join(",")}`;
    if (!inds.has(k)) inds.set(k, { id: inds.size + 1, op: o });
    return { ref: inds.get(k) };
  };
  const lado = (conds) => conds.map((c) => ({ op: c.op, a: registrar(c.a), b: registrar(c.b) }));
  const compra = est.direcao !== "venda" ? lado(est.entrada) : [];
  const venda = est.direcao !== "compra" ? lado(est.entrada.map(espelhar)) : [];
  return { inds: [...inds.values()], compra, venda, s: est.saida };
}

// Barra a partir da qual o indicador existe (índice 0), igual ao NaN do motor JS.
function aquecimento(o) {
  const p = o.p;
  switch (o.ind) {
    case "preco": return 0;
    case "maxima_n": case "minima_n": case "roc": case "rsi": return p[0];
    case "macd": return Math.max(p[0], p[1]) - 1;
    default: return p[0] - 1;
  }
}

// ---------------------------------------------------------------- Python (referência)

function gerarPython(est, op) {
  const centro = Object.fromEntries(Object.values(CATALOGO).filter((d) => d.centro !== undefined).map((d) => [d.escala, d.centro]));
  const escala = Object.fromEntries(Object.entries(CATALOGO).map(([k, d]) => [k, d.escala]));
  const lit = (x) => JSON.stringify(JSON.stringify(x)); // string JSON é literal válido em Python
  const codigo = `#!/usr/bin/env python3
${cabecalho(est, "#")}#
# Uso: python3 ${"estrategia.py"} dados.csv --custo ${op.custo_pct} --slippage ${op.slippage_pct}
# O CSV tem cabeçalho com t,o,h,l,c[,v] (ou time/open/high/low/close); t em segundos/ms ou data ISO.
# Saída: JSON com as métricas e a lista de operações, igual ao motor do site.
# Só biblioteca padrão. As fórmulas e as regras do motor são as do site, uma por uma.
import argparse
import json
import math
from datetime import datetime, timezone

ESTRATEGIA = json.loads(${lit(est)})
CENTRO = json.loads(${lit(centro)})
ESCALA = json.loads(${lit(escala)})
CUSTO_PADRAO = ${op.custo_pct}
SLIPPAGE_PADRAO = ${op.slippage_pct}
NAN = float("nan")


def js_round(x):
    # Math.round do JavaScript: empate vai para +infinito. O round() do Python vai para o par
    # e mudaria o sinal em empates; por isso a conta é refeita aqui.
    if x != x or math.isinf(x):
        return x
    f = math.floor(x)
    return float(f + 1 if x - f >= 0.5 else f)


def arred(x):
    return js_round(x * 100) / 100


def r6(x):
    # Compara com 6 casas: ruído de ponto flutuante não vira sinal diferente entre plataformas.
    return js_round(x * 1e6) / 1e6


# ---------------------------------------------------------------- dados

APELIDOS = {
    "t": ["t", "time", "date", "data", "datetime", "timestamp", "tempo", "open_time"],
    "o": ["open", "abertura", "o"], "h": ["high", "maxima", "máxima", "h"], "l": ["low", "minima", "mínima", "l"],
    "c": ["close", "fechamento", "c"], "v": ["volume", "vol", "v"],
}


def ler_tempo(x):
    x = x.strip()
    try:
        n = float(x) if x else None
    except ValueError:
        n = None
    if n is not None and math.isfinite(n):
        if n > 1e15:
            return math.floor(n / 1000)  # microssegundos
        if n > 1e11:
            return n  # milissegundos
        return n * 1000  # segundos
    texto = x.replace(" ", "T", 1)
    if "T" not in texto:
        texto += "T00:00:00"
    d = datetime.fromisoformat(texto.replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.timestamp() * 1000


def numero(x):
    return float(x) if x.strip() else 0.0


def ler_csv(caminho):
    with open(caminho, encoding="utf-8") as f:
        linhas = f.read().strip().splitlines()
    sep = ";" if ";" in linhas[0] else ","
    cab = [c.strip().lower().replace('"', "") for c in linhas[0].split(sep)]
    tem_cab = any(c in APELIDOS["c"] for c in cab)
    if tem_cab:
        idx = {k: next((i for i, c in enumerate(cab) if c in nomes), -1) for k, nomes in APELIDOS.items()}
        for k in "tohlc":
            if idx[k] < 0:
                raise SystemExit("coluna ausente: " + APELIDOS[k][0])
    else:
        idx = {"t": 0, "o": 1, "h": 2, "l": 3, "c": 4, "v": 5}
    barras = []
    for linha in linhas[1 if tem_cab else 0:]:
        if not linha.strip():
            continue
        p = [x.strip().replace('"', "") for x in linha.split(sep)]
        b = (ler_tempo(p[idx["t"]]), numero(p[idx["o"]]), numero(p[idx["h"]]), numero(p[idx["l"]]), numero(p[idx["c"]]))
        if not all(math.isfinite(v) for v in b[1:]):
            raise SystemExit("linha com preço inválido: " + linha[:80])
        barras.append(b)
    barras.sort(key=lambda b: b[0])  # estável, como o sort do JS
    return {
        "n": len(barras), "tempo": [b[0] for b in barras], "abertura": [b[1] for b in barras],
        "maxima": [b[2] for b in barras], "minima": [b[3] for b in barras], "fechamento": [b[4] for b in barras],
    }


# ---------------------------------------------------------------- indicadores (NaN no aquecimento)

def sma(x, p):
    r, s = [NAN] * len(x), 0.0
    for i in range(len(x)):
        s += x[i]
        if i >= p:
            s -= x[i - p]
        if i >= p - 1:
            r[i] = s / p
    return r


def ema(x, p):
    # Semente: média simples dos p primeiros valores.
    r, k, e = [NAN] * len(x), 2 / (p + 1), 0.0
    for i in range(len(x)):
        if i < p - 1:
            e += x[i]
            continue
        if i == p - 1:
            e = (e + x[i]) / p
        else:
            e = x[i] * k + e * (1 - k)
        r[i] = e
    return r


def rma(x, p, ini=0):
    # Média de Wilder, base do RSI e do ATR.
    r, e = [NAN] * len(x), 0.0
    for i in range(ini, len(x)):
        j = i - ini
        if j < p - 1:
            e += x[i]
            continue
        if j == p - 1:
            e = (e + x[i]) / p
        else:
            e = (e * (p - 1) + x[i]) / p
        r[i] = e
    return r


def rsi(c, p):
    n = len(c)
    up, dn = [0.0] * n, [0.0] * n
    for i in range(1, n):
        d = c[i] - c[i - 1]
        up[i] = d if d > 0 else 0.0
        dn[i] = -d if d < 0 else 0.0
    au, ad, r = rma(up, p, 1), rma(dn, p, 1), [NAN] * n
    for i in range(n):
        if au[i] == au[i]:
            r[i] = 100.0 if ad[i] == 0 else 100 - 100 / (1 + au[i] / ad[i])
    return r


def atr(h, l, c, p):
    n = len(c)
    tr = [0.0] * n
    if n:
        tr[0] = h[0] - l[0]
    for i in range(1, n):
        tr[i] = max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
    return rma(tr, p)


def bollinger(c, p, k, lado):
    m, n = sma(c, p), len(c)
    d = [NAN] * n
    for i in range(p - 1, n):
        s = 0.0
        for j in range(i - p + 1, i + 1):
            s += (c[j] - m[i]) ** 2
        d[i] = math.sqrt(s / p)  # desvio populacional
    return [m[i] + lado * k * d[i] for i in range(n)]


def maior_anterior(h, p):
    # Máxima das p barras ANTERIORES, sem a atual.
    r = [NAN] * len(h)
    for i in range(p, len(h)):
        m = -math.inf
        for j in range(i - p, i):
            if h[j] > m:
                m = h[j]
        r[i] = m
    return r


def menor_anterior(l, p):
    r = [NAN] * len(l)
    for i in range(p, len(l)):
        m = math.inf
        for j in range(i - p, i):
            if l[j] < m:
                m = l[j]
        r[i] = m
    return r


def estocastico(h, l, c, p):
    r = [NAN] * len(c)
    for i in range(p - 1, len(c)):
        hi, lo = -math.inf, math.inf
        for j in range(i - p + 1, i + 1):
            if h[j] > hi:
                hi = h[j]
            if l[j] < lo:
                lo = l[j]
        r[i] = 50.0 if hi == lo else (100 * (c[i] - lo)) / (hi - lo)
    return r


def cci(h, l, c, p):
    n = len(c)
    tp = [(h[i] + l[i] + c[i]) / 3 for i in range(n)]
    m, r = sma(tp, p), [NAN] * n
    for i in range(p - 1, n):
        s = 0.0
        for j in range(i - p + 1, i + 1):
            s += abs(tp[j] - m[i])
        md = s / p
        r[i] = 0.0 if md == 0 else (tp[i] - m[i]) / (0.015 * md)
    return r


def roc(c, p):
    r = [NAN] * len(c)
    for i in range(p, len(c)):
        r[i] = (100 * (c[i] - c[i - p])) / c[i - p]
    return r


def macd(c, rapida, lenta):
    a, b = ema(c, rapida), ema(c, lenta)
    return [a[i] - b[i] for i in range(len(c))]


CALC = {
    "sma": lambda s, p: sma(s["fechamento"], p[0]),
    "ema": lambda s, p: ema(s["fechamento"], p[0]),
    "bb_sup": lambda s, p: bollinger(s["fechamento"], p[0], p[1], 1),
    "bb_inf": lambda s, p: bollinger(s["fechamento"], p[0], p[1], -1),
    "maxima_n": lambda s, p: maior_anterior(s["maxima"], p[0]),
    "minima_n": lambda s, p: menor_anterior(s["minima"], p[0]),
    "rsi": lambda s, p: rsi(s["fechamento"], p[0]),
    "estoc": lambda s, p: estocastico(s["maxima"], s["minima"], s["fechamento"], p[0]),
    "cci": lambda s, p: cci(s["maxima"], s["minima"], s["fechamento"], p[0]),
    "roc": lambda s, p: roc(s["fechamento"], p[0]),
    "macd": lambda s, p: macd(s["fechamento"], p[0], p[1]),
}
_cache = {}


def indicador(s, o):
    if o["ind"] == "preco":
        return s[o.get("campo") or "fechamento"]
    k = o["ind"] + ":" + ",".join(str(x) for x in o["p"])
    if k not in _cache:
        _cache[k] = CALC[o["ind"]](s, o["p"])
    return _cache[k]


# ---------------------------------------------------------------- regras

OP_ESPELHO = {">": "<", "<": ">", "cruza_acima": "cruza_abaixo", "cruza_abaixo": "cruza_acima"}
IND_ESPELHO = {"bb_sup": "bb_inf", "bb_inf": "bb_sup", "maxima_n": "minima_n", "minima_n": "maxima_n"}
CAMPO_ESPELHO = {"maxima": "minima", "minima": "maxima"}


def espelhar(c):
    # A venda é o espelho da compra: > vira <, os cruzamentos trocam, constante de oscilador
    # reflete no centro da escala.
    esc = None
    for o in (c["a"], c["b"]):
        if "k" not in o:
            esc = ESCALA[o["ind"]]
            break
    centro = CENTRO.get(esc, 0) if esc else 0

    def op(o):
        if "k" in o:
            return {"k": arred(2 * centro - o["k"])}
        if o["ind"] in IND_ESPELHO:  # banda e máxima/mínima de N trocam de lado na venda
            return {**o, "ind": IND_ESPELHO[o["ind"]]}
        if o["ind"] == "preco" and o.get("campo") in CAMPO_ESPELHO:
            return {**o, "campo": CAMPO_ESPELHO[o["campo"]]}
        return o
    return {"op": OP_ESPELHO[c["op"]], "a": op(c["a"]), "b": op(c["b"])}


def sinais(s, conds):
    n = s["n"]
    r = [True] * n
    for c in conds:
        a = None if "k" in c["a"] else indicador(s, c["a"])
        b = None if "k" in c["b"] else indicador(s, c["b"])
        ka, kb = c["a"].get("k"), c["b"].get("k")
        for i in range(n):
            if not r[i]:
                continue
            x = r6(a[i] if a is not None else ka)
            y = r6(b[i] if b is not None else kb)
            if x != x or y != y:
                ok = False
            elif c["op"] == ">":
                ok = x > y
            elif c["op"] == "<":
                ok = x < y
            elif i == 0:
                ok = False
            else:
                x0 = r6(a[i - 1] if a is not None else ka)
                y0 = r6(b[i - 1] if b is not None else kb)
                if x0 != x0 or y0 != y0:
                    ok = False
                elif c["op"] == "cruza_acima":
                    ok = x0 <= y0 and x > y
                else:
                    ok = x0 >= y0 and x < y
            if not ok:
                r[i] = False
    return r


# ---------------------------------------------------------------- motor
# 1. Sinal no fechamento da barra i; entrada na abertura da i+1, com slippage contra.
# 2. Stop e alvo em múltiplos do ATR da barra do sinal, a partir da abertura (sem slippage).
# 3. Dentro da barra o stop vem antes do alvo; abertura além do stop/alvo (gap) executa na abertura.
# 4. barras_max: sai no fechamento da barra em que a posição completa N barras.
# 5. inverter: sinal contrário sai e entra do outro lado na abertura seguinte.
# 6. Uma posição por vez; compra e venda na mesma barra se anulam.
# 7. Fim da janela: posição aberta sai no fechamento da última barra.
# 8. Resultado em % do capital, notional 1x, custo e slippage em % por lado.

def backtest(s, est, custo, slippage, ini=0, fim=None):
    fim = s["n"] if fim is None else fim
    slip = slippage / 100
    n = s["n"]
    compra = sinais(s, est["entrada"]) if est["direcao"] != "venda" else [False] * n
    venda = sinais(s, [espelhar(c) for c in est["entrada"]]) if est["direcao"] != "compra" else [False] * n
    sd = est["saida"]
    stop_atr, alvo_atr, barras_max = sd.get("stop_atr"), sd.get("alvo_atr"), sd.get("barras_max")
    a_tr = atr(s["maxima"], s["minima"], s["fechamento"], sd["atr_p"])
    O, H, L, C = s["abertura"], s["maxima"], s["minima"], s["fechamento"]
    trades = []
    pos = None

    def sair(j, preco, motivo):
        nonlocal pos
        p_sai = preco * (1 - pos["dir"] * slip)
        ret = (pos["dir"] * (p_sai - pos["pEnt"]) / pos["pEnt"]) * 100 - 2 * custo
        trades.append({"dir": pos["dir"], "iEnt": pos["iEnt"], "iSai": j, "pEnt": pos["pEnt"], "pSai": p_sai, "ret": ret, "motivo": motivo})
        pos = None

    def entrar(j, d, i_sinal):
        nonlocal pos
        a = a_tr[i_sinal]
        if not (a > 0):
            return
        ref = O[j]
        pos = {"dir": d, "iEnt": j, "pEnt": ref * (1 + d * slip),
               "stop": ref - d * stop_atr * a if stop_atr else None,
               "alvo": ref + d * alvo_atr * a if alvo_atr else None}

    pendente, i_pendente = 0, -1
    for j in range(ini, fim):
        if pendente:
            if pos and pos["dir"] != pendente:
                sair(j, O[j], "inversao")
            if not pos:
                entrar(j, pendente, i_pendente)
            pendente = 0
        if pos:
            d, st, al = pos["dir"], pos["stop"], pos["alvo"]
            if st is not None and j > pos["iEnt"] and (O[j] <= st if d > 0 else O[j] >= st):
                sair(j, O[j], "stop")
            elif st is not None and (L[j] <= st if d > 0 else H[j] >= st):
                sair(j, st, "stop")
            elif al is not None and j > pos["iEnt"] and (O[j] >= al if d > 0 else O[j] <= al):
                sair(j, O[j], "alvo")
            elif al is not None and (H[j] >= al if d > 0 else L[j] <= al):
                sair(j, al, "alvo")
            elif barras_max and j - pos["iEnt"] + 1 >= barras_max:
                sair(j, C[j], "tempo")
        if j == fim - 1:
            if pos:
                sair(j, C[j], "fim")
        else:
            sinal = 1 if compra[j] and not venda[j] else -1 if venda[j] and not compra[j] else 0
            if sinal:
                if not pos:
                    pendente, i_pendente = sinal, j
                elif sd.get("inverter") and pos["dir"] != sinal:
                    pendente, i_pendente = sinal, j
    return trades


def data_iso(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def main():
    ap = argparse.ArgumentParser(description="Backtest da estratégia exportada pelo Alfa Aberta.")
    ap.add_argument("csv")
    ap.add_argument("--custo", type=float, default=CUSTO_PADRAO, help="custo em %% por lado")
    ap.add_argument("--slippage", type=float, default=SLIPPAGE_PADRAO, help="slippage em %% por lado")
    ap.add_argument("--ini", type=int, default=0, help="primeira barra da janela")
    ap.add_argument("--fim", type=int, default=None, help="barra seguinte à última da janela")
    args = ap.parse_args()
    s = ler_csv(args.csv)
    trades = backtest(s, ESTRATEGIA, args.custo, args.slippage, args.ini, args.fim)
    lucro = 0.0
    for t in trades:  # soma em ordem, como o reduce do JS (o sum() do Python compensa e daria outro número)
        lucro += t["ret"]
        t["tEnt"], t["tSai"] = data_iso(s["tempo"][t["iEnt"]]), data_iso(s["tempo"][t["iSai"]])
    ganhos = sum(1 for t in trades if t["ret"] > 0)
    print(json.dumps({
        "barras": s["n"],
        "metricas": {
            "operacoes": len(trades),
            "lucro_pct": js_round(lucro * 100) / 100,
            "lucro_pct_exato": lucro,
            "acerto_pct": js_round((1000 * ganhos / len(trades)) if trades else 0) / 10,
        },
        "operacoes": trades,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
`;
  return { codigo, avisos: [
    "Exportador de referência: o teste de paridade compara as operações deste script com as do motor do site (mesmas barras de entrada e saída, lucro igual até 1e-6).",
    "Não usa pandas nem numpy: roda em qualquer Python 3.8+ com a biblioteca padrão.",
  ] };
}

// ---------------------------------------------------------------- Pine Script v6 (TradingView)

const PINE_PRECO = { fechamento: "close", abertura: "open", maxima: "high", minima: "low" };

function pineInd(o) {
  const p = o.p;
  switch (o.ind) {
    case "preco": return PINE_PRECO[o.campo || "fechamento"];
    case "sma": return `f_sma(close, ${p[0]})`;
    case "ema": return `f_ema(close, ${p[0]})`;
    case "bb_sup": return `f_bb(close, ${p[0]}, ${num(p[1])}, 1.0)`;
    case "bb_inf": return `f_bb(close, ${p[0]}, ${num(p[1])}, -1.0)`;
    case "maxima_n": return `f_max_ant(high, ${p[0]})`;
    case "minima_n": return `f_min_ant(low, ${p[0]})`;
    case "rsi": return `f_rsi(close, ${p[0]})`;
    case "estoc": return `f_estoc(${p[0]})`;
    case "cci": return `f_cci(${p[0]})`;
    case "roc": return `f_roc(close, ${p[0]})`;
    case "macd": return `f_ema(close, ${p[0]}) - f_ema(close, ${p[1]})`;
  }
  throw new Error(`sem tradução para Pine: ${o.ind}`);
}

const PINE_FUNC = { ">": "f_maior", "<": "f_menor", cruza_acima: "f_cruza_acima", cruza_abaixo: "f_cruza_abaixo" };

function gerarPine(est, op) {
  const P = plano(est), s = P.s;
  const opnd = (x) => (x.k !== undefined ? num(x.k) : `ind${x.ref.id}`);
  const conds = (lista) => (lista.length ? lista.map((c) => `${PINE_FUNC[c.op]}(${opnd(c.a)}, ${opnd(c.b)})`).join(" and ") : "false");
  const exitArgs = [s.stop_atr ? "loss = ticks_stop" : null, s.alvo_atr ? "profit = ticks_alvo" : null].filter(Boolean).join(", ");
  const codigo = `//@version=6
${cabecalho(est, "//")}strategy("${op.nome}", overlay = true, process_orders_on_close = false, calc_on_every_tick = false,
     pyramiding = 0, default_qty_type = strategy.percent_of_equity, default_qty_value = 100,
     commission_type = strategy.commission.percent, commission_value = ${op.custo_pct}, slippage = 0)

// Parâmetros da saída (iguais aos do Alfa Aberta). O slippage do TradingView é em ticks, não em %:
// o site usou ${op.slippage_pct}% por lado; ajuste "slippage" acima em ticks do seu ativo se quiser.
ATR_P = input.int(${s.atr_p}, "Período do ATR")
STOP_ATR = input.float(${num(s.stop_atr ?? 0)}, "Stop (× ATR, 0 = sem stop)")
ALVO_ATR = input.float(${num(s.alvo_atr ?? 0)}, "Alvo (× ATR, 0 = sem alvo)")
BARRAS_MAX = input.int(${s.barras_max ?? 0}, "Sai após N barras (0 = nunca)")
INVERTER = input.bool(${s.inverter ? "true" : "false"}, "Inverte no sinal contrário")

// ---- indicadores escritos à mão: as funções ta.* semeiam EMA/RSI/ATR de outro jeito
f_sma(float x, int p) =>
    var float s = 0.0
    s += x
    if bar_index >= p
        s -= x[p]
    bar_index >= p - 1 ? s / p : na

// EMA semeada com a média simples dos p primeiros valores.
f_ema(float x, int p) =>
    var float e = 0.0
    var float saida = na
    k = 2.0 / (p + 1)
    if bar_index < p - 1
        e += x
    else if bar_index == p - 1
        e := (e + x) / p
        saida := e
    else
        e := x * k + e * (1 - k)
        saida := e
    saida

// Média de Wilder a partir da barra "ini".
f_rma(float x, int p, int ini) =>
    var float e = 0.0
    var float saida = na
    j = bar_index - ini
    if j >= 0
        if j < p - 1
            e += x
        else if j == p - 1
            e := (e + x) / p
            saida := e
        else
            e := (e * (p - 1) + x) / p
            saida := e
    saida

f_rsi(float c, int p) =>
    float d = bar_index > 0 ? c - c[1] : 0.0
    float au = f_rma(d > 0 ? d : 0.0, p, 1)
    float ad = f_rma(d < 0 ? -d : 0.0, p, 1)
    na(au) ? na : ad == 0 ? 100.0 : 100.0 - 100.0 / (1.0 + au / ad)

f_atr(int p) =>
    float tr = bar_index == 0 ? high - low : math.max(high - low, math.abs(high - close[1]), math.abs(low - close[1]))
    f_rma(tr, p, 0)

// Bollinger com desvio populacional.
f_bb(float c, int p, float k, float lado) =>
    float m = f_sma(c, p)
    float saida = na
    if not na(m)
        float s = 0.0
        for j = p - 1 to 0
            s += (c[j] - m) * (c[j] - m)
        saida := m + lado * k * math.sqrt(s / p)
    saida

// Máxima/mínima das p barras ANTERIORES (sem a atual).
f_max_ant(float x, int p) =>
    float m = na
    if bar_index >= p
        m := x[1]
        for j = 2 to p
            m := math.max(m, x[j])
    m

f_min_ant(float x, int p) =>
    float m = na
    if bar_index >= p
        m := x[1]
        for j = 2 to p
            m := math.min(m, x[j])
    m

f_estoc(int p) =>
    float saida = na
    if bar_index >= p - 1
        float hi = high
        float lo = low
        for j = 1 to p - 1
            hi := math.max(hi, high[j])
            lo := math.min(lo, low[j])
        saida := hi == lo ? 50.0 : 100.0 * (close - lo) / (hi - lo)
    saida

f_cci(int p) =>
    float tp = (high + low + close) / 3
    float m = f_sma(tp, p)
    float saida = na
    if not na(m)
        float s = 0.0
        for j = p - 1 to 0
            s += math.abs(tp[j] - m)
        float md = s / p
        saida := md == 0 ? 0.0 : (tp - m) / (0.015 * md)
    saida

f_roc(float c, int p) =>
    bar_index >= p ? 100.0 * (c - c[p]) / c[p] : na

// ---- comparações com 6 casas (o mesmo arredondamento do motor do site)
f_r6(float x) => math.round(x, 6)
f_maior(float a, float b) => not na(a) and not na(b) and f_r6(a) > f_r6(b)
f_menor(float a, float b) => not na(a) and not na(b) and f_r6(a) < f_r6(b)
f_cruza_acima(float a, float b) => not na(a) and not na(b) and not na(a[1]) and not na(b[1]) and f_r6(a[1]) <= f_r6(b[1]) and f_r6(a) > f_r6(b)
f_cruza_abaixo(float a, float b) => not na(a) and not na(b) and not na(a[1]) and not na(b[1]) and f_r6(a[1]) >= f_r6(b[1]) and f_r6(a) < f_r6(b)

// ---- operandos
${P.inds.map((x) => `float ind${x.id} = ${pineInd(x.op)}`).join("\n")}
float atrv = f_atr(ATR_P)

// ---- sinais no fechamento da barra (a venda é o espelho da compra)
bool compra = ${conds(P.compra)}
bool venda = ${conds(P.venda)}
int sinal = compra and not venda ? 1 : venda and not compra ? -1 : 0

// ---- saída por tempo: no fechamento da barra em que a posição completa BARRAS_MAX barras
bool saiu_tempo = false
if BARRAS_MAX > 0 and strategy.position_size != 0
    int barra_entrada = strategy.opentrades.entry_bar_index(strategy.opentrades - 1)
    if bar_index - barra_entrada + 1 >= BARRAS_MAX
        strategy.close_all(comment = "tempo", immediately = true)
        saiu_tempo := true

// ---- entrada: ordem a mercado agora, executada na abertura da próxima barra
bool zerado = strategy.position_size == 0 or saiu_tempo
int lado_atual = saiu_tempo ? 0 : int(math.sign(strategy.position_size))
if sinal != 0 and not na(atrv) and atrv > 0 and (zerado or (INVERTER and lado_atual != sinal))
    // Stop e alvo medidos do preço de entrada, com o ATR da barra do sinal.
    int ticks_stop = math.max(1, int(math.round(STOP_ATR * atrv / syminfo.mintick)))
    int ticks_alvo = math.max(1, int(math.round(ALVO_ATR * atrv / syminfo.mintick)))
    if sinal == 1
        strategy.entry("Compra", strategy.long)
${exitArgs ? `        strategy.exit("Saída compra", "Compra", ${exitArgs})\n` : ""}    else
        strategy.entry("Venda", strategy.short)
${exitArgs ? `        strategy.exit("Saída venda", "Venda", ${exitArgs})\n` : ""}
plot(atrv, "ATR", display = display.data_window)
`;
  return { codigo, avisos: [
    AVISO_NAO_COMPILADO("TradingView"),
    "No emulador de corretora do TradingView, quando stop e alvo cabem na mesma barra, a ordem vem do caminho intrabarra (abertura→máxima→mínima ou o inverso), não da regra pessimista do site (stop primeiro). O resultado pode ser melhor que o do site nessas barras.",
    "Stop e alvo são medidos a partir do preço de entrada do TradingView (que já inclui o slippage), arredondados em ticks; no site eles partem da abertura sem slippage.",
    `O slippage do TradingView é em ticks, não em %: o arquivo sai com slippage = 0 (o site usou ${op.slippage_pct}% por lado). A comissão de ${op.custo_pct}% por lado vai em commission_value.`,
    "Posição aberta na última barra continua aberta no TradingView; o site a fecha no fim da janela.",
    "As funções do Pine com 'var' guardam estado por chamada: os indicadores são calculados em toda barra, desde a primeira, como no site. Com histórico menor que o do site, EMA, RSI e ATR podem começar de outro ponto e diferir no início.",
    "default_qty_value = 100% do capital (notional 1x, como o site); ajuste para o tamanho que quer operar.",
  ] };
}

// ---------------------------------------------------------------- MQL5 (MetaTrader 5)

function mql5Ind(o, alvo) {
  const p = o.p;
  switch (o.ind) {
    case "sma": return `Sma(C, ${p[0]}, ${alvo});`;
    case "ema": return `Ema(C, ${p[0]}, ${alvo});`;
    case "bb_sup": return `Bollinger(C, ${p[0]}, ${num(p[1])}, 1.0, ${alvo});`;
    case "bb_inf": return `Bollinger(C, ${p[0]}, ${num(p[1])}, -1.0, ${alvo});`;
    case "maxima_n": return `MaxAnterior(H, ${p[0]}, ${alvo});`;
    case "minima_n": return `MinAnterior(L, ${p[0]}, ${alvo});`;
    case "rsi": return `Rsi(C, ${p[0]}, ${alvo});`;
    case "estoc": return `Estocastico(H, L, C, ${p[0]}, ${alvo});`;
    case "cci": return `Cci(H, L, C, ${p[0]}, ${alvo});`;
    case "roc": return `Roc(C, ${p[0]}, ${alvo});`;
    case "macd": return `Macd(C, ${p[0]}, ${p[1]}, ${alvo});`;
  }
  throw new Error(`sem tradução para MQL5: ${o.ind}`);
}
const MQL5_PRECO = { fechamento: "C", abertura: "O", maxima: "H", minima: "L" };
const MQL5_FUNC = { ">": "Maior", "<": "Menor", cruza_acima: "CruzaAcima", cruza_abaixo: "CruzaAbaixo" };

function gerarMql5(est, op, id) {
  const P = plano(est), s = P.s;
  const arr = (x) => (x.ref.op.ind === "preco" ? MQL5_PRECO[x.ref.op.campo || "fechamento"] : `ind${x.ref.id}`);
  const val = (x, i) => (x.k !== undefined ? num(x.k) : `${arr(x)}[${i}]`);
  const cond = (c) => (c.op === ">" || c.op === "<"
    ? `${MQL5_FUNC[c.op]}(${val(c.a, "i")}, ${val(c.b, "i")})`
    : `${MQL5_FUNC[c.op]}(${val(c.a, "i - 1")}, ${val(c.b, "i - 1")}, ${val(c.a, "i")}, ${val(c.b, "i")})`);
  const conds = (lista) => (lista.length ? lista.map(cond).join("\n      && ") : "false");
  const calc = P.inds.filter((x) => x.op.ind !== "preco");
  const magia = parseInt(id, 36) % 2000000000;
  const codigo = `${cabecalho(est, "//")}#property copyright "Alfa Aberta (MIT)"
#property version   "1.00"
#property description "${op.nome}: gerado pelo Alfa Aberta. Teste no Strategy Tester antes de operar."

#include <Trade/Trade.mqh>

input double Lote = 0.01;                 // tamanho da ordem (lotes)
input ulong  Magico = ${magia};          // número mágico desta estratégia
input int    BarrasHistorico = 3000;      // barras fechadas usadas para calcular os indicadores
input int    DesvioPontos = 20;           // desvio máximo de preço na ordem a mercado (pontos)
input int    AtrPeriodo = ${s.atr_p};
input double StopAtr = ${num(s.stop_atr ?? 0)};    // 0 = sem stop
input double AlvoAtr = ${num(s.alvo_atr ?? 0)};    // 0 = sem alvo
input int    BarrasMax = ${s.barras_max ?? 0};     // 0 = sem saída por tempo
input bool   Inverter = ${s.inverter ? "true" : "false"};
// Custo usado no site: ${op.custo_pct}% por lado; slippage: ${op.slippage_pct}% por lado (configure no Strategy Tester).

#define NA EMPTY_VALUE

CTrade   trade;
datetime ultimaBarra = 0;
double   O[], H[], L[], C[];
${calc.map((x) => `double   ind${x.id}[];`).join("\n")}
double   atrv[];

// ---- indicadores à mão (iMA, iRSI e iATR semeiam de outro jeito; as fórmulas abaixo são as do site)
void Sma(const double &x[], int p, double &r[])
  {
   int n = ArraySize(x); ArrayResize(r, n); double s = 0;
   for(int i = 0; i < n; i++)
     { s += x[i]; if(i >= p) s -= x[i - p]; r[i] = (i >= p - 1) ? s / p : NA; }
  }
void Ema(const double &x[], int p, double &r[])
  {
   int n = ArraySize(x); ArrayResize(r, n); double k = 2.0 / (p + 1), e = 0;
   for(int i = 0; i < n; i++)
     {
      r[i] = NA;
      if(i < p - 1) { e += x[i]; continue; }
      if(i == p - 1) e = (e + x[i]) / p; else e = x[i] * k + e * (1 - k);
      r[i] = e;
     }
  }
void Rma(const double &x[], int p, int ini, double &r[])
  {
   int n = ArraySize(x); ArrayResize(r, n); double e = 0;
   for(int i = 0; i < n; i++) r[i] = NA;
   for(int i = ini; i < n; i++)
     {
      int j = i - ini;
      if(j < p - 1) { e += x[i]; continue; }
      if(j == p - 1) e = (e + x[i]) / p; else e = (e * (p - 1) + x[i]) / p;
      r[i] = e;
     }
  }
void Rsi(const double &c[], int p, double &r[])
  {
   int n = ArraySize(c); double up[], dn[], au[], ad[];
   ArrayResize(up, n); ArrayResize(dn, n); ArrayResize(r, n);
   if(n > 0) { up[0] = 0; dn[0] = 0; }
   for(int i = 1; i < n; i++) { double d = c[i] - c[i - 1]; up[i] = d > 0 ? d : 0; dn[i] = d < 0 ? -d : 0; }
   Rma(up, p, 1, au); Rma(dn, p, 1, ad);
   for(int i = 0; i < n; i++) r[i] = (au[i] == NA) ? NA : (ad[i] == 0 ? 100.0 : 100.0 - 100.0 / (1.0 + au[i] / ad[i]));
  }
void Atr(const double &h[], const double &l[], const double &c[], int p, double &r[])
  {
   int n = ArraySize(c); double tr[]; ArrayResize(tr, n);
   if(n > 0) tr[0] = h[0] - l[0];
   for(int i = 1; i < n; i++) tr[i] = MathMax(h[i] - l[i], MathMax(MathAbs(h[i] - c[i - 1]), MathAbs(l[i] - c[i - 1])));
   Rma(tr, p, 0, r);
  }
void Bollinger(const double &c[], int p, double k, double lado, double &r[])
  {
   int n = ArraySize(c); double m[]; Sma(c, p, m); ArrayResize(r, n);
   for(int i = 0; i < n; i++)
     {
      r[i] = NA; if(i < p - 1) continue;
      double s = 0; for(int j = i - p + 1; j <= i; j++) s += (c[j] - m[i]) * (c[j] - m[i]);
      r[i] = m[i] + lado * k * MathSqrt(s / p);   // desvio populacional
     }
  }
void MaxAnterior(const double &h[], int p, double &r[])   // p barras ANTERIORES, sem a atual
  {
   int n = ArraySize(h); ArrayResize(r, n);
   for(int i = 0; i < n; i++)
     { r[i] = NA; if(i < p) continue; double m = h[i - p]; for(int j = i - p + 1; j < i; j++) if(h[j] > m) m = h[j]; r[i] = m; }
  }
void MinAnterior(const double &l[], int p, double &r[])
  {
   int n = ArraySize(l); ArrayResize(r, n);
   for(int i = 0; i < n; i++)
     { r[i] = NA; if(i < p) continue; double m = l[i - p]; for(int j = i - p + 1; j < i; j++) if(l[j] < m) m = l[j]; r[i] = m; }
  }
void Estocastico(const double &h[], const double &l[], const double &c[], int p, double &r[])
  {
   int n = ArraySize(c); ArrayResize(r, n);
   for(int i = 0; i < n; i++)
     {
      r[i] = NA; if(i < p - 1) continue;
      double hi = h[i], lo = l[i];
      for(int j = i - p + 1; j <= i; j++) { if(h[j] > hi) hi = h[j]; if(l[j] < lo) lo = l[j]; }
      r[i] = (hi == lo) ? 50.0 : 100.0 * (c[i] - lo) / (hi - lo);
     }
  }
void Cci(const double &h[], const double &l[], const double &c[], int p, double &r[])
  {
   int n = ArraySize(c); double tp[], m[]; ArrayResize(tp, n); ArrayResize(r, n);
   for(int i = 0; i < n; i++) tp[i] = (h[i] + l[i] + c[i]) / 3;
   Sma(tp, p, m);
   for(int i = 0; i < n; i++)
     {
      r[i] = NA; if(i < p - 1) continue;
      double s = 0; for(int j = i - p + 1; j <= i; j++) s += MathAbs(tp[j] - m[i]);
      double md = s / p; r[i] = (md == 0) ? 0.0 : (tp[i] - m[i]) / (0.015 * md);
     }
  }
void Roc(const double &c[], int p, double &r[])
  {
   int n = ArraySize(c); ArrayResize(r, n);
   for(int i = 0; i < n; i++) r[i] = (i >= p) ? 100.0 * (c[i] - c[i - p]) / c[i - p] : NA;
  }
void Macd(const double &c[], int rapida, int lenta, double &r[])
  {
   int n = ArraySize(c); double a[], b[]; Ema(c, rapida, a); Ema(c, lenta, b); ArrayResize(r, n);
   for(int i = 0; i < n; i++) r[i] = (a[i] == NA || b[i] == NA) ? NA : a[i] - b[i];
  }

// ---- comparações com 6 casas, como o site
double R6(double x) { return MathRound(x * 1000000.0) / 1000000.0; }
bool Maior(double a, double b) { return a != NA && b != NA && R6(a) > R6(b); }
bool Menor(double a, double b) { return a != NA && b != NA && R6(a) < R6(b); }
bool CruzaAcima(double a0, double b0, double a, double b)
  { return a0 != NA && b0 != NA && a != NA && b != NA && R6(a0) <= R6(b0) && R6(a) > R6(b); }
bool CruzaAbaixo(double a0, double b0, double a, double b)
  { return a0 != NA && b0 != NA && a != NA && b != NA && R6(a0) >= R6(b0) && R6(a) < R6(b); }

// Posição desta estratégia: 1 comprado, -1 vendido, 0 zerado.
int Posicao(ulong &ticket)
  {
   for(int k = PositionsTotal() - 1; k >= 0; k--)
     {
      ulong t = PositionGetTicket(k);
      if(t == 0 || !PositionSelectByTicket(t)) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol || (ulong)PositionGetInteger(POSITION_MAGIC) != Magico) continue;
      ticket = t;
      return PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
     }
   ticket = 0;
   return 0;
  }

int OnInit()
  {
   trade.SetExpertMagicNumber(Magico);
   trade.SetDeviationInPoints(DesvioPontos);
   return INIT_SUCCEEDED;
  }

void OnTick()
  {
   // Só age uma vez por barra, na abertura da nova: a barra anterior acabou de fechar (o sinal)
   // e a ordem sai agora, na abertura seguinte, como no site.
   datetime agora = iTime(_Symbol, _Period, 0);
   if(agora == 0 || agora == ultimaBarra) return;
   ultimaBarra = agora;

   MqlRates r[];
   ArraySetAsSeries(r, false);
   int n = CopyRates(_Symbol, _Period, 1, BarrasHistorico, r);   // só barras fechadas, da mais antiga à mais nova
   if(n < 3) return;
   ArrayResize(O, n); ArrayResize(H, n); ArrayResize(L, n); ArrayResize(C, n);
   for(int k = 0; k < n; k++) { O[k] = r[k].open; H[k] = r[k].high; L[k] = r[k].low; C[k] = r[k].close; }
${calc.map((x) => `   ${mql5Ind(x.op, `ind${x.id}`)}`).join("\n")}
   Atr(H, L, C, AtrPeriodo, atrv);

   int i = n - 1;   // barra do sinal
   bool compra = ${conds(P.compra)};
   bool venda = ${conds(P.venda)};
   int sinal = (compra && !venda) ? 1 : (venda && !compra) ? -1 : 0;

   ulong ticket;
   int dir = Posicao(ticket);
   // Saída por tempo: a posição completou BarrasMax barras no fechamento da barra anterior.
   if(dir != 0 && BarrasMax > 0)
     {
      int barras = iBarShift(_Symbol, _Period, (datetime)PositionGetInteger(POSITION_TIME));
      if(barras >= BarrasMax && trade.PositionClose(ticket)) dir = 0;
     }
   if(sinal == 0 || atrv[i] == NA || atrv[i] <= 0) return;
   if(dir != 0 && !(Inverter && dir != sinal)) return;
   if(dir != 0 && !trade.PositionClose(ticket)) return;

   // Stop e alvo a partir da abertura desta barra, com o ATR da barra do sinal.
   double ref = iOpen(_Symbol, _Period, 0);
   double sl = StopAtr > 0 ? NormalizeDouble(ref - sinal * StopAtr * atrv[i], _Digits) : 0;
   double tp = AlvoAtr > 0 ? NormalizeDouble(ref + sinal * AlvoAtr * atrv[i], _Digits) : 0;
   if(sinal > 0) trade.Buy(Lote, _Symbol, 0, sl, tp, "Alfa Aberta ${id}");
   else          trade.Sell(Lote, _Symbol, 0, sl, tp, "Alfa Aberta ${id}");
  }
`;
  return { codigo, avisos: [
    AVISO_NAO_COMPILADO("MetaTrader 5"),
    "Os indicadores são recalculados a cada barra sobre as últimas BarrasHistorico barras fechadas: EMA, RSI e ATR dependem do ponto de partida e convergem para os do site quando o histórico é longo (padrão 3000).",
    "Stop e alvo vão no servidor (SL/TP da posição): quem decide a ordem dentro da barra é o MetaTrader, não a regra pessimista do site (stop primeiro).",
    "A saída por tempo acontece na abertura da barra seguinte (o EA só age em barra nova), não no fechamento da barra N como no site.",
    "Se o stop ou o alvo ficarem dentro do nível mínimo de stops da corretora (SYMBOL_TRADE_STOPS_LEVEL), a ordem é recusada.",
    `Custo (${op.custo_pct}% por lado) e slippage (${op.slippage_pct}%) não estão no código: configure comissão e spread no Strategy Tester.`,
  ] };
}

// ---------------------------------------------------------------- NTSL (Profit, Nelogica)

const NTSL_PRECO = { fechamento: "Close", abertura: "Open", maxima: "High", minima: "Low" };

// Cada indicador vira variáveis próprias e um trecho que roda a cada barra.
function ntslInd(x) {
  const o = x.op, p = o.p, v = `ind${x.id}`, vars = [`${v} : Float;`];
  const media = (serie, alvo, per) => [`  soma := 0;`, `  for j := 0 to ${per - 1} do soma := soma + ${serie}[j];`, `  ${alvo} := soma / ${per};`];
  const emaDe = (alvo, per) => [
    `if CurrentBar = ${per - 1} then`, `begin`, ...media("Close", alvo, per), `end`,
    `else if CurrentBar >= ${per} then ${alvo} := Close * ${2 / (per + 1)} + ${alvo}[1] * (1 - ${2 / (per + 1)});`];
  const W = aquecimento(o);
  let corpo;
  switch (o.ind) {
    case "sma": corpo = [`if CurrentBar >= ${W} then`, `begin`, ...media("Close", v, p[0]), `end;`]; break;
    case "ema": corpo = [...emaDe(v, p[0])]; break;
    case "bb_sup": case "bb_inf": {
      const lado = o.ind === "bb_sup" ? "+" : "-";
      corpo = [`if CurrentBar >= ${W} then`, `begin`, ...media("Close", "m", p[0]),
        `  soma2 := 0;`, `  for j := 0 to ${p[0] - 1} do soma2 := soma2 + (Close[j] - m) * (Close[j] - m);`,
        `  ${v} := m ${lado} ${num(p[1])} * Sqrt(soma2 / ${p[0]});`, `end;`];
      break;
    }
    case "maxima_n": case "minima_n": {
      const [serie, fn] = o.ind === "maxima_n" ? ["High", "Max"] : ["Low", "Min"];
      corpo = [`if CurrentBar >= ${W} then`, `begin`, `  ${v} := ${serie}[1];`, `  for j := 2 to ${p[0]} do ${v} := ${fn}(${v}, ${serie}[j]);`, `end;`];
      break;
    }
    case "rsi": {
      vars.push(`${v}up, ${v}dn, ${v}au, ${v}ad : Float;`);
      corpo = [`if CurrentBar >= 1 then`, `begin`,
        `  ${v}up := Max(Close - Close[1], 0);`, `  ${v}dn := Max(Close[1] - Close, 0);`, `end;`,
        `if CurrentBar = ${p[0]} then`, `begin`,
        `  soma := 0; soma2 := 0;`, `  for j := 0 to ${p[0] - 1} do begin soma := soma + ${v}up[j]; soma2 := soma2 + ${v}dn[j]; end;`,
        `  ${v}au := soma / ${p[0]};`, `  ${v}ad := soma2 / ${p[0]};`, `end`,
        `else if CurrentBar > ${p[0]} then`, `begin`,
        `  ${v}au := (${v}au[1] * ${p[0] - 1} + ${v}up) / ${p[0]};`, `  ${v}ad := (${v}ad[1] * ${p[0] - 1} + ${v}dn) / ${p[0]};`, `end;`,
        `if CurrentBar >= ${W} then`, `begin`,
        `  if ${v}ad = 0 then ${v} := 100 else ${v} := 100 - 100 / (1 + ${v}au / ${v}ad);`, `end;`];
      break;
    }
    case "estoc":
      corpo = [`if CurrentBar >= ${W} then`, `begin`, `  hi := High; lo := Low;`,
        `  for j := 1 to ${p[0] - 1} do begin hi := Max(hi, High[j]); lo := Min(lo, Low[j]); end;`,
        `  if hi = lo then ${v} := 50 else ${v} := 100 * (Close - lo) / (hi - lo);`, `end;`];
      break;
    case "cci":
      vars.push(`${v}tp : Float;`);
      corpo = [`${v}tp := (High + Low + Close) / 3;`, `if CurrentBar >= ${W} then`, `begin`, ...media(`${v}tp`, "m", p[0]),
        `  soma2 := 0;`, `  for j := 0 to ${p[0] - 1} do soma2 := soma2 + Abs(${v}tp[j] - m);`,
        `  if soma2 = 0 then ${v} := 0 else ${v} := (${v}tp - m) / (0.015 * (soma2 / ${p[0]}));`, `end;`];
      break;
    case "roc": corpo = [`if CurrentBar >= ${W} then ${v} := 100 * (Close - Close[${p[0]}]) / Close[${p[0]}];`]; break;
    case "macd":
      vars.push(`${v}r, ${v}l : Float;`);
      corpo = [...emaDe(`${v}r`, p[0]), ...emaDe(`${v}l`, p[1]), `if CurrentBar >= ${W} then ${v} := ${v}r - ${v}l;`];
      break;
    default: throw new Error(`sem tradução para NTSL: ${o.ind}`);
  }
  return { vars, corpo };
}

function gerarNtsl(est, op) {
  const P = plano(est), s = P.s;
  const nome = (x) => (x.ref.op.ind === "preco" ? NTSL_PRECO[x.ref.op.campo || "fechamento"] : `ind${x.ref.id}`);
  const r6 = (e) => `(Round(${e} * 1000000) / 1000000)`;
  const val0 = (x, atras) => (x.k !== undefined ? num(x.k) : atras ? `${nome(x)}[1]` : nome(x));
  // Constante já tem no máximo 2 casas: não passa pelo Round.
  const val = (x, atras) => (x.k !== undefined ? num(x.k) : r6(val0(x, atras)));
  const pronto = (x, extra) => (x.k !== undefined ? null : `(CurrentBar >= ${aquecimento(x.ref.op) + extra})`);
  const cond = (c) => {
    const cruz = c.op.startsWith("cruza");
    const guarda = [pronto(c.a, cruz ? 1 : 0), pronto(c.b, cruz ? 1 : 0)].filter(Boolean);
    const agora = c.op === ">" || c.op === "cruza_acima" ? ">" : "<";
    let e = `(${val(c.a)} ${agora} ${val(c.b)})`;
    if (cruz) e = `(${val(c.a, true)} ${c.op === "cruza_acima" ? "<=" : ">="} ${val(c.b, true)}) and ${e}`;
    return [...guarda, e].join(" and ");
  };
  const conds = (lista) => (lista.length ? lista.map(cond).join("\n    and ") : "False");
  const calc = P.inds.filter((x) => x.op.ind !== "preco").map(ntslInd);
  const linhas = (arr, ind) => arr.map((l) => ind + l).join("\n");
  const codigo = `${cabecalho(est, "//")}// Custo usado no site: ${op.custo_pct}% por lado; slippage: ${op.slippage_pct}% por lado
// (configure corretagem e slippage na janela de backtest do Profit).
input
  StopAtr(${num(s.stop_atr ?? 0)});
  AlvoAtr(${num(s.alvo_atr ?? 0)});
  BarrasMax(${s.barras_max ?? 0});
  Inverter(${s.inverter ? "True" : "False"});
var
${linhas(calc.flatMap((c) => c.vars), "  ")}
  trv, atrv, atrSinal : Float;
  soma, soma2, m, hi, lo : Float;
  j, sinal, barraEntrada : Integer;
  compra, venda, saiuTempo, zerado : Boolean;
begin
  // Estado que precisa atravessar as barras.
  if CurrentBar > 0 then
  begin
    atrSinal := atrSinal[1];
    barraEntrada := barraEntrada[1];
  end;

  // ---- indicadores à mão (as fórmulas do site; as funções prontas semeiam de outro jeito)
${linhas(calc.flatMap((c) => c.corpo), "  ")}

  // ---- ATR(${s.atr_p}) de Wilder
  if CurrentBar = 0 then trv := High - Low
  else trv := Max(High - Low, Max(Abs(High - Close[1]), Abs(Low - Close[1])));
  if CurrentBar = ${s.atr_p - 1} then
  begin
    soma := 0;
    for j := 0 to ${s.atr_p - 1} do soma := soma + trv[j];
    atrv := soma / ${s.atr_p};
  end
  else if CurrentBar >= ${s.atr_p} then atrv := (atrv[1] * ${s.atr_p - 1} + trv) / ${s.atr_p};

  // ---- sinais no fechamento da barra (a venda é o espelho da compra), com 6 casas
  compra := ${conds(P.compra)};
  venda := ${conds(P.venda)};
  sinal := 0;
  if compra and not venda then sinal := 1;
  if venda and not compra then sinal := -1;

  // ---- stop e alvo: reenviados a cada barra, a partir do preço de entrada
  if IsBought then
  begin
    if StopAtr > 0 then SellToCoverStop(BuyPrice - StopAtr * atrSinal);
    if AlvoAtr > 0 then SellToCoverLimit(BuyPrice + AlvoAtr * atrSinal);
  end;
  if IsSold then
  begin
    if StopAtr > 0 then BuyToCoverStop(SellPrice + StopAtr * atrSinal);
    if AlvoAtr > 0 then BuyToCoverLimit(SellPrice - AlvoAtr * atrSinal);
  end;

  // ---- saída por tempo
  saiuTempo := False;
  if (BarrasMax > 0) and (IsBought or IsSold) and (CurrentBar - barraEntrada + 1 >= BarrasMax) then
  begin
    ClosePosition;
    saiuTempo := True;
  end;

  // ---- entrada a mercado (executa na abertura da próxima barra)
  zerado := saiuTempo or not (IsBought or IsSold);
  if (sinal <> 0) and (CurrentBar >= ${s.atr_p - 1}) and (atrv > 0) then
  begin
    if (sinal = 1) and (zerado or (Inverter and IsSold)) then
    begin
      if IsSold and not saiuTempo then BuyToCoverAtMarket;
      BuyAtMarket;
      atrSinal := atrv;
      barraEntrada := CurrentBar + 1;
    end;
    if (sinal = -1) and (zerado or (Inverter and IsBought)) then
    begin
      if IsBought and not saiuTempo then SellToCoverAtMarket;
      SellShortAtMarket;
      atrSinal := atrv;
      barraEntrada := CurrentBar + 1;
    end;
  end;
end;
`;
  return { codigo, avisos: [
    AVISO_NAO_COMPILADO("Profit (NTSL)"),
    "Nomes de funções não conferidos no editor do Profit: CurrentBar (se começa em 0 ou 1), Round (se devolver inteiro de 32 bits, preço × 1.000.000 estoura: troque por comparação sem arredondar), Max, Min, Abs, Sqrt, ClosePosition, SellToCoverLimit/BuyToCoverLimit e se variável declarada guarda o valor da barra anterior (o código copia atrSinal[1] e barraEntrada[1] para não depender disso).",
    "Comentários com // (sem { } por causa do JSON no cabeçalho): se o seu Profit não aceitar //, troque por { }.",
    "Stop e alvo só ficam ativos a partir da barra seguinte à entrada (são reenviados barra a barra); no site eles valem já na barra da entrada.",
    "ClosePosition (saída por tempo) executa na abertura da barra seguinte, não no fechamento da barra N como no site.",
    "Stop e alvo partem de BuyPrice/SellPrice (preço executado, com slippage); no site partem da abertura sem slippage. Custo e slippage se configuram no backtest do Profit.",
  ] };
}
