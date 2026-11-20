// Utilidades da interface: formatação pt-BR, DOM e o link verificável (base64url de JSON).

const nf = (min, max) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: min, maximumFractionDigits: max });
const F0 = nf(0, 0), F1 = nf(1, 1), F2 = nf(2, 2), F3 = nf(3, 3);

export const num = (x, casas = 2) => (x == null || !Number.isFinite(+x) ? "—" : (casas === 0 ? F0 : casas === 1 ? F1 : casas === 3 ? F3 : F2).format(x));
export const inteiro = (x) => (x == null || !Number.isFinite(+x) ? "—" : F0.format(Math.round(x)));
export const pct = (x, casas = 1, sinal = true) => {
  if (x == null || !Number.isFinite(+x)) return "—";
  const s = sinal && x > 0 ? "+" : x < 0 ? "−" : "";
  return s + num(Math.abs(x), casas) + "%";
};
export const compacto = (x) => new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(x);

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const dataCurta = (ms) => { const d = new Date(ms); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`; };
export const dataHora = (ms) => { const d = new Date(ms); return `${dataCurta(ms)} ${String(d.getUTCHours()).padStart(2, "0")}h`; };
export const mesAno = (ms) => { const d = new Date(ms); return `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
export const isoParaBr = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

// h("div.classe", {atributos}, ...filhos): DOM sem innerHTML para texto que vem de fora.
export function h(tag, attrs = {}, ...filhos) {
  const [nome, ...classes] = tag.split(".");
  const el = document.createElement(nome);
  if (classes.length) el.className = classes.join(" ");
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "texto") el.textContent = v;
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  return el;
}

export function guardar(chave, valor) { try { localStorage.setItem(chave, valor); } catch { /* armazenamento bloqueado: segue sem lembrar */ } }
export function lembrar(chave) { try { return localStorage.getItem(chave); } catch { return null; } }

// Link verificável: JSON -> UTF-8 -> base64url. Sem compressão para qualquer um decodificar à mão.
export function paraBase64url(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function deBase64url(txt) {
  const b64 = txt.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((txt.length + 3) % 4);
  const bin = atob(b64);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

export async function copiar(texto, botao) {
  try { await navigator.clipboard.writeText(texto); }
  catch {
    const ta = h("textarea", { style: "position:fixed;opacity:0" }); ta.value = texto; document.body.append(ta); ta.select();
    try { document.execCommand("copy"); } catch { /* sem área de transferência */ } ta.remove();
  }
  if (botao) { const antes = botao.textContent; botao.textContent = "Copiado"; botao.classList.add("ok"); setTimeout(() => { botao.textContent = antes; botao.classList.remove("ok"); }, 1400); }
}

export function baixar(nome, texto, tipo = "text/plain") {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo + ";charset=utf-8" }));
  const a = h("a", { href: url, download: nome }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const menosMovimento = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
