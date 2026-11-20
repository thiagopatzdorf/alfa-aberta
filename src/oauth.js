// Login com Google (OAuth 2.0, código + PKCE), sem biblioteca. Só vale e-mail VERIFICADO.
// O botão só aparece se GOOGLE_CLIENT_ID/_SECRET existem (cliente OAuth da Genesis, regra da casa).
import { createHash, randomBytes } from "node:crypto";

export const GOOGLE = { auth: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token",
  usuario: "https://openidconnect.googleapis.com/v1/userinfo", escopo: "openid email" };

// LOGIN_GOOGLE=desligado esconde o botão mesmo com as credenciais no pod: o Google recusa (redirect_uri_mismatch)
// enquanto o endereço de retorno não estiver cadastrado no cliente OAuth, e botão que dá erro é pior que nenhum.
export const configurado = (env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSAO_SEGREDO) && env.LOGIN_GOOGLE !== "desligado";
export const retorno = (base) => `${base}/entrar/google/retorno`;

export function iniciar(env, base, prov = GOOGLE) {
  const estado = randomBytes(18).toString("base64url"), verif = randomBytes(36).toString("base64url");
  const desafio = createHash("sha256").update(verif).digest("base64url");
  const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: retorno(base), response_type: "code", scope: prov.escopo,
    state: estado, code_challenge: desafio, code_challenge_method: "S256", prompt: "select_account" });
  return { url: `${prov.auth}?${q}`, cookie: `${estado}.${verif}` };
}

export async function identidade(env, base, codigo, verificador, prov = GOOGLE, f = fetch) {
  const corpo = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, code: codigo,
    redirect_uri: retorno(base), grant_type: "authorization_code", code_verifier: verificador });
  const tk = await f(prov.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: corpo });
  if (!tk.ok) throw new Error("o Google recusou o código de login");
  const { access_token } = await tk.json();
  const u = await (await f(prov.usuario, { headers: { authorization: `Bearer ${access_token}` } })).json();
  if (u.email_verified !== true || !u.email) throw new Error("e-mail do Google não verificado");
  return String(u.email).toLowerCase();
}
