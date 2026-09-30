import type { HubErroEvento, ResultadoTurno, ToolCall } from "./tipos.js";

export interface EventoSse {
  event: string;
  data: unknown;
}

/**
 * Lê um corpo `text/event-stream` e devolve os eventos na ordem.
 * Blocos separados por linha em branco; `data:` em várias linhas é concatenado.
 */
export async function* lerEventos(corpo: AsyncIterable<Uint8Array>): AsyncGenerator<EventoSse> {
  const decoder = new TextDecoder();
  let buffer = "";
  let evento = "message";
  let dados: string[] = [];

  const emitir = (): EventoSse | null => {
    if (dados.length === 0) return null;
    const bruto = dados.join("\n");
    dados = [];
    const tipo = evento;
    evento = "message";
    try {
      return { event: tipo, data: JSON.parse(bruto) };
    } catch {
      return { event: tipo, data: bruto };
    }
  };

  const processarLinha = (linha: string): EventoSse | null => {
    if (linha === "") return emitir();
    if (linha.startsWith(":")) return null;
    if (linha.startsWith("event:")) evento = linha.slice(6).trim();
    else if (linha.startsWith("data:")) dados.push(linha.slice(5).replace(/^ /, ""));
    return null;
  };

  for await (const pedaco of corpo) {
    buffer += decoder.decode(pedaco, { stream: true });
    let quebra: number;
    while ((quebra = buffer.indexOf("\n")) >= 0) {
      const linha = buffer.slice(0, quebra).replace(/\r$/, "");
      buffer = buffer.slice(quebra + 1);
      const e = processarLinha(linha);
      if (e) yield e;
    }
  }
  buffer += decoder.decode();
  if (buffer) {
    const e = processarLinha(buffer.replace(/\r$/, ""));
    if (e) yield e;
  }
  const ultimo = emitir();
  if (ultimo) yield ultimo;
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

/**
 * Consolida os eventos de um turno no formato que o domínio usa.
 * `aoEvento` recebe cada evento assim que chega, para quem quiser acompanhar o turno ao vivo.
 */
export async function consolidarTurno(
  eventos: AsyncIterable<EventoSse>,
  aoEvento?: (evento: EventoSse) => void,
): Promise<ResultadoTurno> {
  const r: ResultadoTurno = {
    sessionId: null,
    texto: "",
    toolCalls: [],
    tokens: null,
    latenciaMs: null,
    erros: [],
    avisos: [],
    eventos: [],
  };

  for await (const evento of eventos) {
    const { event, data } = evento;
    aoEvento?.(evento);
    r.eventos.push(event);
    const d = obj(data);

    switch (event) {
      case "session_started":
        r.sessionId = str(d.session_id) ?? r.sessionId;
        break;
      case "content": {
        const acumulado = str(d.accumulated);
        if (acumulado !== null) r.texto = acumulado;
        else if (str(d.delta)) r.texto += str(d.delta);
        else if (typeof data === "string") r.texto += data;
        break;
      }
      case "tool_call": {
        const tc: ToolCall = {
          tool: str(d.tool) ?? str(d.name) ?? "desconhecida",
          arguments: d.arguments ?? null,
          result: d.result ?? null,
          status: str(d.status),
          isError: d.is_error === true || d.status === "error",
          latencyMs: num(d.latency_ms),
        };
        // O Playground emite o mesmo tool_call mais de uma vez (início e fim): fica o último.
        const anterior = r.toolCalls.findIndex(
          (t) => t.tool === tc.tool && JSON.stringify(t.arguments) === JSON.stringify(tc.arguments) && t.result === null,
        );
        if (anterior >= 0) r.toolCalls[anterior] = tc;
        else r.toolCalls.push(tc);
        break;
      }
      case "completed": {
        const tokens = obj(d.tokens);
        if (num(tokens.input) !== null || num(tokens.output) !== null) {
          r.tokens = { input: num(tokens.input) ?? 0, output: num(tokens.output) ?? 0 };
        }
        r.latenciaMs = num(d.latency_ms) ?? r.latenciaMs;
        r.sessionId ??= str(d.session_id);
        break;
      }
      case "error": {
        const e: HubErroEvento = {
          code: str(d.code) ?? "UNKNOWN_ERROR",
          category: str(d.category),
          runId: str(d.run_id),
          mensagem: str(d.message) ?? str(d.detail) ?? (typeof data === "string" ? data : JSON.stringify(data)),
        };
        r.erros.push(e);
        break;
      }
      case "warning":
        r.avisos.push(str(d.message) ?? str(d.code) ?? JSON.stringify(data));
        break;
      case "input_required":
        r.avisos.push("O agente pediu intervenção humana (HITL), que está fora do fluxo.");
        break;
      default:
        break;
    }
  }

  return r;
}
