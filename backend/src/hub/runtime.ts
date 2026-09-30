import { env } from "../config/env.js";
import { consolidarTurno, lerEventos } from "./sse.js";
import { HubIndisponivel, type ClienteHub, type ProgressoAgente, type ResultadoTurno } from "./tipos.js";
import type { EventoSse } from "./sse.js";

/** Traduz os eventos do SSE que interessam ao solicitante; o resto fica só no resultado do turno. */
function progressoDoEvento({ event, data }: EventoSse): ProgressoAgente | null {
  if (event === "tool_call") {
    const d = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const ferramenta = typeof d.tool === "string" ? d.tool : typeof d.name === "string" ? d.name : "desconhecida";
    return { fase: "consultando", ferramenta };
  }
  if (event === "content") return { fase: "escrevendo" };
  return null;
}

/**
 * Chat com o agente pela API de runtime do Hub:
 * POST /runtime/v1/chat/agents/{uuid} com X-API-Key, resposta em SSE.
 * O `session_id` enviado é o ID EXTERNO do chamado, o mesmo em todos os turnos — é por ele que o Hub
 * encontra a sessão e mantém o histórico.
 */
export const hubReal: ClienteHub = {
  modo: "real",

  async conversar({ agenteId, mensagem, sessaoExterna, aoProgresso }): Promise<ResultadoTurno> {
    const url = `${env.hub.baseUrl}/runtime/v1/chat/agents/${encodeURIComponent(agenteId)}`;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), env.hub.timeoutMs);

    try {
      let resposta: Response;
      try {
        resposta = await fetch(url, {
          method: "POST",
          headers: {
            "X-API-Key": env.hub.apiKey,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({ message: mensagem, session_id: sessaoExterna, variables: {} }),
          signal: abort.signal,
        });
      } catch (erro) {
        const motivo = abort.signal.aborted ? "tempo esgotado" : (erro as Error).message;
        throw new HubIndisponivel(`Falha ao chamar o Hub: ${motivo}`, null, motivo);
      }

      if (!resposta.ok || !resposta.body) {
        const corpo = await resposta.text().catch(() => "");
        throw new HubIndisponivel(`Hub respondeu ${resposta.status}`, resposta.status, corpo.slice(0, 500));
      }

      const tipo = resposta.headers.get("content-type") ?? "";
      if (!tipo.includes("text/event-stream")) {
        // Resposta não-SSE (JSON direto): tratamos como um único evento de conteúdo.
        const corpo = await resposta.text();
        return {
          sessionId: null,
          texto: corpo,
          toolCalls: [],
          tokens: null,
          latenciaMs: null,
          erros: [],
          avisos: [`Resposta do Hub veio como ${tipo || "sem content-type"}, não SSE`],
          eventos: [],
        };
      }

      return await consolidarTurno(lerEventos(resposta.body as unknown as AsyncIterable<Uint8Array>), (evento) => {
        const progresso = aoProgresso && progressoDoEvento(evento);
        if (progresso) aoProgresso!(progresso);
      });
    } catch (erro) {
      if (erro instanceof HubIndisponivel) throw erro;
      const motivo = abort.signal.aborted ? "tempo esgotado" : (erro as Error).message;
      throw new HubIndisponivel(`Falha ao ler a resposta do Hub: ${motivo}`, null, motivo);
    } finally {
      clearTimeout(timer);
    }
  },
};
