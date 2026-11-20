// Cliente da API REST do servidor. Toda falha vira um Error com mensagem em português e
// `status` (0 = não houve resposta), para a tela explicar sem mostrar pilha nem JSON cru.

export class ErroServidor extends Error {
  constructor(mensagem, status = 0) { super(mensagem); this.status = status; }
}

async function chamar(caminho, opcoes = {}) {
  let r;
  try {
    r = await fetch(caminho, { credentials: "same-origin", headers: { accept: "application/json", ...(opcoes.body ? { "content-type": "application/json" } : {}) }, ...opcoes });
  } catch {
    throw new ErroServidor("Não consegui falar com o servidor (sem conexão ou servidor fora do ar).", 0);
  }
  let corpo = null;
  const tipo = r.headers.get("content-type") || "";
  if (tipo.includes("json")) { try { corpo = await r.json(); } catch { corpo = null; } }
  if (!r.ok) {
    const detalhe = corpo && (corpo.erro || corpo.mensagem || corpo.message);
    if (r.status === 401 || r.status === 403) throw new ErroServidor(detalhe || "O servidor pede login para esta operação.", r.status);
    if (r.status === 429) throw new ErroServidor(detalhe || "Você chegou ao limite do servidor por agora.", r.status);
    if (r.status === 404) throw new ErroServidor("O servidor ainda não oferece esta operação (404).", r.status);
    throw new ErroServidor(detalhe || `O servidor respondeu ${r.status}.`, r.status);
  }
  if (!corpo) throw new ErroServidor("O servidor respondeu algo que não é JSON.", r.status);
  return corpo;
}

export const eu = () => chamar("/api/eu");
export const series = () => chamar("/api/series");
const postar = (caminho, dados) => chamar(caminho, { method: "POST", body: JSON.stringify(dados) });
export const exportar = (estrategia, formato) => postar("/api/exportar", { estrategia, formato });

// Cria a tarefa e acompanha até ficar pronta. aoProgresso recebe o objeto `progresso`.
export async function tarefa(caminho, dados, aoProgresso, sinal) {
  const { tarefa: id } = await postar(caminho, dados);
  if (!id) throw new ErroServidor("O servidor não devolveu o número da tarefa.");
  for (let espera = 400; ; espera = Math.min(2000, espera * 1.25)) {
    if (sinal && sinal.cancelado) throw new ErroServidor("Cancelado.");
    await new Promise((ok) => setTimeout(ok, espera));
    const t = await chamar(`/api/tarefas/${encodeURIComponent(id)}`);
    if (t.progresso && aoProgresso) aoProgresso(t.progresso, t.estado);
    if (t.estado === "pronta") return t.resultado;
    if (t.estado === "erro") throw new ErroServidor(t.erro || t.mensagem || "A tarefa falhou no servidor.");
  }
}
