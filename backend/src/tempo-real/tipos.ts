import type { Chamado } from "../dominio/chamados.js";
import type { FaseAgente } from "../dominio/eventos.js";
import type { Usuario } from "../dominio/usuarios.js";

/**
 * Contrato do namespace `/chamados` do socket.io (espelhado em `frontend/lib/tempo-real/tipos.ts`).
 * O erro tem o mesmo formato do corpo de erro da API REST, para a tela tratar os dois do mesmo jeito.
 */
export type Resposta<T> =
  | { ok: true; data: T }
  | { ok: false; erro: string; mensagem: string; extra?: Record<string, unknown> };
export type Ack<T> = (resposta: Resposta<T>) => void;

export interface EstadoChamado {
  chamado: Chamado;
  turnos: Record<string, unknown>[];
}

export interface ServidorParaCliente {
  /** Estado completo de um chamado do solicitante, a cada mudança (novo turno, mensagem do atendente, triagem). */
  "chamado:atualizado": (estado: EstadoChamado) => void;
  /** O que o agente está fazendo no turno em andamento. */
  "chamado:agente": (progresso: { chamadoId: number } & FaseAgente) => void;
  /** Fila de triagem da empresa, já ordenada, sempre que um chamado entra nela ou é triado. */
  "triagem:fila": (fila: Record<string, unknown>[]) => void;
  /** Um chamado da fila mudou (inclusive mensagem nova no chat): quem estiver com ele aberto recarrega o detalhe. */
  "triagem:chamado": (aviso: { chamadoId: number }) => void;
}

export interface ClienteParaServidor {
  /** Abre o chamado com o relato; a resposta chega quando o agente termina o turno. */
  "chamado:abrir": (payload: { texto: string }, ack: Ack<EstadoChamado>) => void;
  /** Responde à pergunta do agente. */
  "chamado:responder": (payload: { chamadoId: number; texto: string }, ack: Ack<EstadoChamado>) => void;
  /** Mensagem no chat com o suporte, depois que o agente concluiu. Vale para o solicitante e para o atendente. */
  "chamado:mensagem": (payload: { chamadoId: number; texto: string }, ack: Ack<EstadoChamado>) => void;
}

export interface DadosSocket {
  usuario: Usuario;
}
