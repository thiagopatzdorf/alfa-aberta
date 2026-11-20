// MCP remoto (JSON-RPC por HTTP). As ferramentas são as OPS: o mesmo caminho da API REST.
import { OPS } from "./ops.js";
import { ErroPedido } from "./limites.js";

export const VERSAO = "0.1.0";
export const FERRAMENTAS = OPS.map((o) => ({ name: `alfa_${o.nome}`, description: o.descricao, inputSchema: o.entrada,
  annotations: { readOnlyHint: Boolean(o.somenteLeitura), openWorldHint: false } }));

export async function tratarMcp(m, ctx) {
  const ok = (result) => ({ jsonrpc: "2.0", id: m.id ?? null, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id: m.id ?? null, error: { code, message } });
  if (m.method === "initialize") return ok({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "alfa-aberta", version: VERSAO },
    instructions: "Alfa Aberta: gere estratégias (alfa_evoluir), teste a robustez (alfa_atestar) e exporte (alfa_exportar). Tarefas longas devolvem um id: consulte com alfa_tarefa. Não é recomendação de investimento." });
  if (m.method?.startsWith("notifications/")) return null;
  if (m.method === "ping") return ok({});
  if (m.method === "tools/list") return ok({ tools: FERRAMENTAS });
  if (m.method === "tools/call") {
    const op = OPS.find((o) => `alfa_${o.nome}` === m.params?.name);
    if (!op) return err(-32602, `ferramenta desconhecida: ${m.params?.name}`);
    try {
      const r = await op.fn(m.params?.arguments || {}, { ...ctx, mcp: true });
      return ok({ content: [{ type: "text", text: JSON.stringify(r) }] });
    } catch (e) {
      if (!(e instanceof ErroPedido)) console.error("erro no MCP:", e?.message);
      return ok({ content: [{ type: "text", text: JSON.stringify({ erro: e instanceof ErroPedido ? e.message : "erro interno" }) }], isError: true });
    }
  }
  return err(-32601, `método não suportado: ${m.method}`);
}
