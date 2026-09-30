/** Uma chamada de ferramenta feita pelo agente no turno (evento `tool_call` do SSE). */
export interface ToolCall {
  tool: string;
  arguments: unknown;
  result: unknown;
  status: string | null;
  isError: boolean;
  latencyMs: number | null;
}

export interface HubErroEvento {
  code: string;
  category: string | null;
  runId: string | null;
  mensagem: string;
}

/** O que sai de um turno de conversa com o agente. */
export interface ResultadoTurno {
  /**
   * ID interno da sessão no Hub (o que aparece na URL de Monitorar → Sessões). Só para diagnóstico:
   * para continuar a conversa, o runtime espera o ID EXTERNO que o app envia em `session_id`.
   */
  sessionId: string | null;
  texto: string;
  toolCalls: ToolCall[];
  tokens: { input: number; output: number } | null;
  latenciaMs: number | null;
  erros: HubErroEvento[];
  avisos: string[];
  /** Tipos de evento recebidos, na ordem — ajuda a depurar o formato do runtime. */
  eventos: string[];
}

/**
 * Sinal de progresso durante um turno, repassado ao solicitante pelo WebSocket enquanto o agente trabalha.
 * Não tem conteúdo da resposta: o texto final só vale depois de validado contra o contrato.
 */
export type ProgressoAgente = { fase: "consultando"; ferramenta: string } | { fase: "escrevendo" };

export interface ClienteHub {
  modo: "real" | "simulado";
  /**
   * `sessaoExterna`: ID gerado pelo app, fixo por chamado. O runtime usa o `session_id` da requisição
   * como identificador externo: se já existe uma sessão com ele, continua; se não, abre uma nova.
   * Verificado em 28/09 — mandar o ID interno devolvido pelo Hub abre uma sessão nova a cada turno.
   */
  conversar(args: {
    agenteId: string;
    mensagem: string;
    sessaoExterna: string;
    aoProgresso?: (progresso: ProgressoAgente) => void;
  }): Promise<ResultadoTurno>;
}

/** Falha de transporte ou HTTP ao falar com o Hub (rede, 401, 429, 5xx, timeout). */
export class HubIndisponivel extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly detalhe: string,
  ) {
    super(message);
    this.name = "HubIndisponivel";
  }
}
