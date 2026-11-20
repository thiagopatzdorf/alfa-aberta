# Alfa Aberta

| | |
|---|---|
| **Stack** | Node 22 sem dependência de npm. O motor (`public/motor/*.js`) é um código só que roda no navegador (Web Workers) e no servidor (`worker_threads`) |
| **Rodar local** | `node src/servidor.mjs 8787` e abrir `http://localhost:8787` |
| **Testar** | `node --test test/*.test.mjs` |
| **Dados** | `python3 bin/baixar_dados.py` (Binance Vision e B3 COTAHIST, públicos e grátis) |
| **Docker** | `docker build -t alfa-aberta . && docker run --rm -p 8080:8080 --read-only alfa-aberta` |
| **No ar** | https://alfa.genesisinnovation.io |
| **Estado** | v0.1: motor, gerador, atestado, exportadores, tela, API e MCP |

Um gerador de estratégias de trading do nível dos pagos (que custam de US$ 1.500 a US$ 2.900), só que grátis,
aberto (MIT) e com API e MCP para agentes de IA. Feito pela [Genesis](https://genesisinnovation.io).

## Escrito do zero (sala limpa)

Nenhuma linha deste repositório vem de código de terceiros, descompilado ou não. O motor foi escrito a partir de
conhecimento público de domínio (backtest, programação genética, walk-forward, Monte Carlo). Não usamos nome, marca
nem material de nenhum produto comercial.

## Como funciona

    gerador (sorteia/muta/cruza regras)  ->  avaliador (backtest exato)  ->  banco  ->  atestado de robustez

1. **Estratégia é dado** (`estrategia.js`): condições de entrada (E lógico) sobre indicadores que têm a mesma escala.
   As saídas são stop e alvo em ATR, saída por tempo ou inversão. A venda é o espelho da compra.
2. **Backtest determinístico** (`backtest.js`): as 8 regras estão no cabeçalho do arquivo. Sinal no fechamento,
   execução na abertura seguinte com slippage contra. Se stop e alvo cabem na mesma barra, conta o stop. O gap executa
   na abertura. O resultado sai em % com custo por lado.
3. **Evolução em ilhas** (`gerador.js`): população por ilha, torneio, elitismo, mutação, cruzamento e sangue novo.
   Cada ilha tem semente própria. O resultado depende de semente e número de ilhas, **não de quantos núcleos a
   máquina tem**: navegador e servidor dão o mesmo banco (há teste disso).
4. **Fora da amostra é cego**: só os `fracao_is` iniciais guiam a evolução. O teste
   `dados_fora_da_amostra_nunca_influenciam_a_evolucao` embaralha o preço depois do corte e exige o mesmo banco.
   Ele pegou dois vazamentos reais na primeira versão (faixa de constante e remoção de clones olhavam a série
   inteira).
5. **Atestado** (`robustez.js`): sete testes, cada um com a regra de aprovação escrita no próprio resultado, e
   nota de A a E. Os testes são fora da amostra, walk-forward reotimizado, Monte Carlo das operações, Monte Carlo de
   custos piores e sinais perdidos, parâmetros vizinhos (±20%), contra o acaso (p-valor de entradas sorteadas) e
   outros mercados.
6. **Exportadores** (`exportar.js`): Python (reproduz o motor; o teste de paridade compara operação a operação),
   Pine v6, MQL5 e NTSL (Profit). Os três últimos são gerados de forma determinística, mas ainda não foram
   compilados nas plataformas: cada arquivo diz isso.

## Navegador ou servidor (água)

O mesmo motor roda nos dois lugares. A diferença entre um e outro é um número (`src/limites.js`), não outra regra.

| | navegador | servidor |
|---|---|---|
| quem paga a CPU | a pessoa | a Genesis |
| limite | nenhum | anônimo 12 mil backtests por tarefa; com login 200 mil, 3 tarefas simultâneas |
| API e MCP | não | sim (`/api/*`, `/mcp`) |
| velocidade medida (20/11, 1 núcleo) | ~380 backtests/s numa série de 17 mil barras de 4 h; ~1.900/s numa diária de 3 mil | igual por núcleo; o pod tem 2 |

**Por que ainda não é WebGPU:** a evolução avalia árvores de regras diferentes entre si, e a GPU rende quando a mesma
conta roda em milhares de variações em passo único. Esse é o caso do Monte Carlo e da varredura de parâmetros, que
são o candidato da v0.2. Para o gerador, núcleos de CPU em paralelo (Web Workers) são o caminho certo, e um
notebook de 8 núcleos já faz ~3 mil backtests/s.

## API e MCP

    GET  /api/series                    séries prontas
    POST /api/evoluir   {serie, pedido} -> {tarefa}
    POST /api/atestar   {serie, estrategia, pedido, outras} -> {tarefa}
    GET  /api/tarefas/<id>              estado, progresso, resultado
    POST /api/backtest  {serie, estrategia, pedido}
    POST /api/exportar  {estrategia, formato: python|pine|mql5|ntsl}
    POST /mcp                           JSON-RPC: alfa_series, alfa_evoluir, alfa_atestar, alfa_backtest, alfa_tarefa, alfa_exportar

`serie` é o nome de uma série pronta ou `{csv, nome}` com o CSV da pessoa. A chave de API (`Authorization: Bearer
aa_...`) aparece em `/api/eu` para quem entrou com Google. Ela é derivada do e-mail com HMAC, e trocar
`SESSAO_SEGREDO` revoga todas. No MCP, `alfa_evoluir` e `alfa_atestar` esperam até `esperar_segundos` (padrão 50) e
depois devolvem só o id.

## Dados

| série | fonte | observação |
|---|---|---|
| BTC, ETH, SOL (4 h), BTC (1 d) | data.binance.vision (arquivos públicos) | custo sugerido 0,1% por lado |
| PETR4, VALE3, ITUB4, BBAS3, WEGE3, BOVA11 (1 d) | B3, série histórica COTAHIST | preço sem proventos, com desdobramento detectado e ajustado (registrado em `indice.json`) |

Não há intraday grátis da B3 (mini-índice e mini-dólar): a pessoa envia o próprio CSV. A B3 devolve 403
intermitente para downloads seguidos, por isso `baixar_dados.py` espera e tenta de novo.

## O que não é

Não é recomendação de investimento, nem sinal de compra e venda, e não promete lucro. O atestado reduz o risco de
estratégia decorada, mas não o elimina. O app não executa ordens em corretora.

## Segurança

Raiz só leitura, processo sem root e sem disco. O corpo do pedido tem teto de 12 MB. Caminho de arquivo é normalizado
dentro de `public/`. O nome de série precisa estar na lista ou ser CSV enviado. A CSP não deixa script de fora. Login
só por Google com e-mail verificado (PKCE). A sessão é um cookie HttpOnly assinado.
