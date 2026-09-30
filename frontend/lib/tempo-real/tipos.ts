/**
 * Espelho do contrato do namespace `/chamados` (`backend/src/tempo-real/tipos.ts`).
 * Ao mexer lá, atualize aqui — não há pacote compartilhado entre os dois projetos.
 */
import type { Chamado, Turno } from "@/lib/api";

export type Resposta<T> =
  | { ok: true; data: T }
  | { ok: false; erro: string; mensagem: string; extra?: Record<string, unknown> };
export type Ack<T> = (resposta: Resposta<T>) => void;

export interface EstadoChamado {
  chamado: Chamado;
  turnos: Turno[];
}

/** O que o agente está fazendo no turno em andamento. */
export type FaseAgente =
  | { fase: "pensando" }
  | { fase: "consultando"; ferramenta: string }
  | { fase: "escrevendo" }
  | { fase: "tentando_de_novo" }
  | { fase: "concluido" };

export interface ServidorParaCliente {
  "chamado:atualizado": (estado: EstadoChamado) => void;
  "chamado:agente": (progresso: { chamadoId: number } & FaseAgente) => void;
  "triagem:fila": (fila: unknown[]) => void;
  "triagem:chamado": (aviso: { chamadoId: number }) => void;
}

export interface ClienteParaServidor {
  "chamado:abrir": (payload: { texto: string }, ack: Ack<EstadoChamado>) => void;
  "chamado:responder": (payload: { chamadoId: number; texto: string }, ack: Ack<EstadoChamado>) => void;
  "chamado:mensagem": (payload: { chamadoId: number; texto: string }, ack: Ack<EstadoChamado>) => void;
}
