// Grava o vídeo de lançamento com o PRODUTO REAL rodando (nenhuma tela é montada à mão):
// sobe o servidor local, dirige a página com Playwright e põe só as legendas por cima.
// Uso: node bin/gravar_video.cjs <pasta-de-saida>   (depois: ffmpeg, ver o fim do arquivo)
// Requer playwright e ffmpeg. O MP4 não entra no Git (regra da casa para vídeo).
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const SAIDA = path.resolve(process.argv[2] || "video");
const PORTA = 8811;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Legendas e cartões: texto curto, uma ideia por vez. Nenhum número digitado aqui: os da
// tela são os que o motor calculou na hora.
const CSS = `
#leg{position:fixed;left:50%;bottom:56px;transform:translateX(-50%);z-index:99999;max-width:1100px;padding:16px 28px;border-radius:14px;
 background:rgba(8,10,16,.88);color:#fff;font:600 30px/1.3 Inter,system-ui,sans-serif;letter-spacing:-.01em;text-align:center;
 box-shadow:0 20px 60px rgba(0,0,0,.45);transition:opacity .35s;opacity:0;pointer-events:none}
#leg.on{opacity:1} #leg b{color:#7aa2ff}
#cartao{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;background:#07090f;color:#fff;transition:opacity .5s;opacity:0;pointer-events:none;
 font-family:Inter,system-ui,sans-serif;text-align:center}
#cartao.on{opacity:1} #cartao h1{font-size:76px;letter-spacing:-.035em;margin:0 0 18px;font-weight:700} #cartao p{font-size:34px;color:#a9b1c6;margin:8px 0}
#cartao .ac{color:#7aa2ff} #cartao small{display:block;margin-top:34px;font-size:22px;color:#6b7280}`;

async function legenda(p, html, ms) {
  await p.evaluate((h) => { const e = document.getElementById("leg"); e.innerHTML = h; e.classList.add("on"); }, html);
  if (ms) { await espera(ms); await p.evaluate(() => document.getElementById("leg").classList.remove("on")); await espera(350); }
}
async function cartao(p, html, ms) {
  await p.evaluate((h) => { const e = document.getElementById("cartao"); e.innerHTML = `<div>${h}</div>`; e.classList.add("on"); }, html);
  await espera(ms);
  await p.evaluate(() => document.getElementById("cartao").classList.remove("on"));
  await espera(500);
}
async function rolar(p, seletor) {
  await p.evaluate((s) => document.querySelector(s)?.scrollIntoView({ behavior: "smooth", block: "start" }), seletor);
  await espera(900);
}

(async () => {
  fs.mkdirSync(SAIDA, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "src", "servidor.mjs"), String(PORTA)], { stdio: "ignore" });
  await espera(800);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, colorScheme: "dark",
    recordVideo: { dir: SAIDA, size: { width: 1920, height: 1080 } } });
  const p = await ctx.newPage();
  const preparar = async () => {
    await p.addStyleTag({ content: CSS });
    await p.evaluate(() => { for (const id of ["leg", "cartao"]) { const d = document.createElement("div"); d.id = id; document.body.append(d); } });
  };
  try {
    await p.goto(`http://127.0.0.1:${PORTA}/`);
    await p.waitForSelector("#lista-series input");
    await preparar();
    await p.evaluate(() => document.getElementById("cartao").classList.add("on"));
    await cartao(p, `<h1>Geradores de estratégia profissionais<br>custam até <span class="ac">US$ 2.900</span>.</h1><p>Fizemos um do zero. Grátis. Código aberto (MIT).</p>`, 3600);
    await cartao(p, `<h1>Alfa <span class="ac">Aberta</span></h1><p>gera, testa e destrói milhares de estratégias de trading</p><p>no seu navegador · no nosso servidor · pelo seu agente de IA</p>`, 3200);

    await legenda(p, "Escolha o mercado: <b>cripto</b> ou <b>B3</b>, ou envie o seu CSV.", 2600);
    await p.fill("input[name=populacao]", "200"); await p.fill("input[name=geracoes]", "20"); await p.fill("input[name=ilhas]", "4");
    await legenda(p, "4 ilhas evoluindo em paralelo, uma por núcleo do seu computador.");
    await p.click("#evoluir");
    await espera(2500);
    await legenda(p, "Cada ponto é uma estratégia <b>sorteada, mutada e testada</b>. Milhares em segundos.");
    await p.waitForFunction(() => /pronta/.test(document.getElementById("estado-evol").textContent), null, { timeout: 180000 });
    await espera(1500);
    await legenda(p, "Só os primeiros 70% dos dados guiam a evolução. O resto fica <b>trancado</b>.", 3200);

    await rolar(p, "#banco");
    await legenda(p, "No banco, a verdade: a maioria <b>morre fora da amostra</b>.", 3200);
    await p.check("#so-fora");
    await legenda(p, "Ficamos só com as que lucraram nos dados que nunca viram.", 3000);
    await p.locator("#tabela-banco tbody tr").first().click();
    await p.waitForSelector("#vista-estrategia:not([hidden])");
    await espera(800);
    await legenda(p, "Toda estratégia vira <b>regra em português</b> e um JSON que qualquer um refaz.", 3400);
    await p.getByRole("button", { name: "Atestar robustez" }).scrollIntoViewIfNeeded();
    await espera(600);
    await legenda(p, "Agora o <b>atestado de robustez</b>: walk-forward, Monte Carlo, parâmetros vizinhos e teste contra o acaso.");
    await p.getByRole("button", { name: "Atestar robustez" }).click();
    await p.waitForSelector(".nota-cab", { timeout: 120000 });
    await espera(400);
    await rolar(p, ".nota-cab");
    await espera(1200);
    await legenda(p, "Nota de A a E, com a regra de cada teste escrita. Não confie: <b>o link refaz tudo no seu navegador</b>.", 4200);
    await espera(1500);
    for (const [aba, texto] of [["NTSL (Profit)", "Exporta para o <b>Profit</b>"], ["MQL5 (MetaTrader 5)", "para o <b>MetaTrader 5</b>"], ["Pine (TradingView)", "para o <b>TradingView</b>"], ["Python", "e para <b>Python</b>, que reproduz o motor operação por operação."]]) {
      const t = p.getByRole("tab", { name: aba });
      await t.scrollIntoViewIfNeeded(); await t.click();
      await legenda(p, texto, 2100);
    }
    await p.goto(`http://127.0.0.1:${PORTA}/#/agentes`);
    await p.waitForSelector("#agentes");
    await preparar();
    await rolar(p, "#agentes");
    await legenda(p, "<b>API e MCP</b>: o seu Claude ou ChatGPT gera e atesta estratégias enquanto você dorme.", 4200);
    await cartao(p, `<h1>Alfa <span class="ac">Aberta</span></h1><p>Grátis. MIT. Sem cadastro para usar no navegador.</p><p class="ac">alfa.genesisinnovation.io</p><small>Não é recomendação de investimento. Resultado passado não garante resultado futuro.</small>`, 4500);
  } finally {
    const v = p.video();
    await ctx.close(); await b.close(); srv.kill();
    const webm = await v.path();
    const mp4 = path.join(SAIDA, "alfa-aberta-16x9.mp4");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-ss", "0.6", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4]);
    console.log(mp4);
  }
})();
