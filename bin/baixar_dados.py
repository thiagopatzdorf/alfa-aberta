#!/usr/bin/env python3
"""Baixa as séries de demonstração do Alfa Aberta das fontes públicas e grátis.

- Cripto: data.binance.vision (klines mensais, arquivos públicos da Binance).
- B3: COTAHIST anual (série histórica pública da B3), mercado à vista, com desdobramentos
  detectados e ajustados pelo mesmo critério do motor (public/motor/dados.js: ajustarEventos).

Saída: public/dados/<nome>.csv (t,o,h,l,c,v) + public/dados/indice.json. Rodar de novo
sobrescreve; o cache dos zips fica em $ALFA_CACHE (padrão: pasta temporária do sistema).
Uso: python3 bin/baixar_dados.py [--so cripto|b3]
"""
import argparse, io, json, math, os, sys, tempfile, time, urllib.error, urllib.request, zipfile
from pathlib import Path

AQUI = Path(__file__).resolve().parent.parent
SAIDA = AQUI / "public" / "dados"
CACHE = Path(os.environ.get("ALFA_CACHE", Path(tempfile.gettempdir()) / "alfa-cache"))
CRIPTO = [("BTCUSDT", "4h", 2019), ("ETHUSDT", "4h", 2019), ("SOLUSDT", "4h", 2021), ("BTCUSDT", "1d", 2018)]
B3 = ["PETR4", "VALE3", "ITUB4", "BBAS3", "WEGE3", "BOVA11"]
ANO_B3 = 2012
ATE = (2026, 10)
RAZOES = [2, 3, 4, 5, 8, 10, 20, 100]


def baixar(url, destino):
    destino.parent.mkdir(parents=True, exist_ok=True)
    if destino.exists():
        return destino.read_bytes()
    req = urllib.request.Request(url, headers={"User-Agent": "alfa-aberta-dados/1"})
    # A B3 devolve 403 intermitente para downloads seguidos (medido em 20/11): espera e tenta de novo.
    for tentativa in range(6):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                corpo = r.read()
            break
        except urllib.error.HTTPError as e:
            if e.code not in (403, 429, 503) or tentativa == 5 or "binance" in url:
                raise
            time.sleep(30 * (tentativa + 1))
    destino.write_bytes(corpo)
    return corpo


def cripto(par, tf, ano0):
    linhas = []
    for ano in range(ano0, ATE[0] + 1):
        for mes in range(1, 13):
            if (ano, mes) > ATE:
                break
            nome = f"{par}-{tf}-{ano}-{mes:02d}"
            url = f"https://data.binance.vision/data/spot/monthly/klines/{par}/{tf}/{nome}.zip"
            try:
                z = zipfile.ZipFile(io.BytesIO(baixar(url, CACHE / "binance" / f"{nome}.zip")))
            except Exception as e:  # mês que ainda não existe na fonte
                print(f"  sem {nome}: {e}", file=sys.stderr)
                continue
            for l in z.read(z.namelist()[0]).decode().splitlines():
                p = l.split(",")
                if not p[0].isdigit():
                    continue
                t = int(p[0])
                t = t // 1000 if t > 1e15 else t  # a Binance passou a usar microssegundos em 2025
                linhas.append((t // 1000, *(float(x) for x in p[1:6])))
    linhas = sorted(set(linhas))
    return linhas


def ajustar(barras):
    ajustes = []
    for i in range(len(barras) - 1, 0, -1):
        r = barras[i - 1][4] / barras[i][1]
        if abs(math.log(r)) < math.log(1.35):
            continue
        cand = next((x for x in RAZOES + [1 / x for x in RAZOES] if abs(r / x - 1) < 0.12), None)
        if not cand:
            continue
        for j in range(i):
            t, o, h, l, c, v = barras[j]
            barras[j] = (t, o / cand, h / cand, l / cand, c / cand, v * cand)
        ajustes.append({"data": barras[i][0], "razao": round(cand, 3)})
    return list(reversed(ajustes))


def b3():
    series = {p: [] for p in B3}
    for ano in range(ANO_B3, ATE[0] + 1):
        url = f"https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_A{ano}.ZIP"
        z = zipfile.ZipFile(io.BytesIO(baixar(url, CACHE / "b3" / f"COTAHIST_A{ano}.ZIP")))
        with z.open(z.namelist()[0]) as f:
            for bl in f:
                l = bl.decode("latin-1")
                if not l.startswith("01") or l[24:27] != "010":
                    continue
                papel = l[12:24].strip()
                if papel not in series:
                    continue
                d = l[2:10]
                pr = lambda i: int(l[i:i + 13]) / 100
                series[papel].append((f"{d[:4]}-{d[4:6]}-{d[6:]}", pr(56), pr(69), pr(82), pr(108), int(l[170:188]) / 100))
        print(f"  COTAHIST {ano} lido", file=sys.stderr)
    return series


def gravar(nome, barras, meta, indice):
    SAIDA.mkdir(parents=True, exist_ok=True)
    casas = 6 if barras and barras[-1][4] < 10 else 4
    with open(SAIDA / f"{nome}.csv", "w") as f:
        f.write("t,o,h,l,c,v\n")
        for t, o, h, l, c, v in barras:
            f.write(f"{t},{round(o, casas)},{round(h, casas)},{round(l, casas)},{round(c, casas)},{round(v)}\n")
    data = lambda t: t if isinstance(t, str) else time.strftime("%Y-%m-%d", time.gmtime(t))
    indice[nome] = {**meta, "barras": len(barras), "de": data(barras[0][0]), "ate": data(barras[-1][0])}
    print(f"{nome}: {len(barras)} barras", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--so", choices=["cripto", "b3"])
    a = ap.parse_args()
    arq_indice = SAIDA / "indice.json"
    indice = json.loads(arq_indice.read_text()) if arq_indice.exists() else {}
    if a.so != "b3":
        for par, tf, ano0 in CRIPTO:
            gravar(f"{par}-{tf}", cripto(par, tf, ano0),
                   {"mercado": "cripto", "ativo": par, "periodo": tf, "fonte": "data.binance.vision", "custo_pct": 0.1, "slippage_pct": 0.02}, indice)
    if a.so != "cripto":
        for papel, barras in b3().items():
            barras.sort()
            aj = ajustar(barras)
            gravar(f"{papel}-1d", barras, {"mercado": "b3", "ativo": papel, "periodo": "1d", "fonte": "B3 COTAHIST",
                                           "custo_pct": 0.03, "slippage_pct": 0.05, "ajustes": aj,
                                           "nota": "preço sem proventos; desdobramentos ajustados pela razão detectada"}, indice)
    arq_indice.write_text(json.dumps(indice, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main()
