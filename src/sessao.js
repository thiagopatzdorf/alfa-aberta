// Sessão e chave de API sem banco: tudo é assinado com HMAC (SESSAO_SEGREDO). A sessão expira em
// 30 dias; a chave de API é derivada do e-mail (trocar o segredo revoga todas de uma vez).
import { createHmac, timingSafeEqual } from "node:crypto";

const b64 = (s) => Buffer.from(s).toString("base64url");
const de64 = (s) => Buffer.from(s, "base64url").toString();
const assinar = (segredo, texto) => createHmac("sha256", segredo).update(texto).digest("base64url");
const igual = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function criarSessao(segredo, email, agora = Date.now()) {
  const corpo = b64(JSON.stringify({ email, exp: agora + 30 * 864e5 }));
  return `${corpo}.${assinar(segredo, "s:" + corpo)}`;
}
export function lerSessao(segredo, valor, agora = Date.now()) {
  if (!segredo || !valor || !valor.includes(".")) return null;
  const [corpo, sig] = valor.split(".");
  if (!igual(sig, assinar(segredo, "s:" + corpo))) return null;
  try { const d = JSON.parse(de64(corpo)); return d.exp > agora ? d.email : null; } catch { return null; }
}
export function chaveApi(segredo, email) {
  const corpo = b64(email);
  return `aa_${corpo}.${assinar(segredo, "k:" + corpo)}`;
}
export function lerChaveApi(segredo, valor) {
  if (!segredo || !valor?.startsWith("aa_") || !valor.includes(".")) return null;
  const [corpo, sig] = valor.slice(3).split(".");
  return igual(sig, assinar(segredo, "k:" + corpo)) ? de64(corpo) : null;
}
export function cookies(cabecalho = "") {
  return Object.fromEntries(cabecalho.split(";").map((c) => c.trim().split("=")).filter((p) => p.length === 2));
}
