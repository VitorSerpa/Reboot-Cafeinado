import { EventEmitter } from "node:events";

import type { ProgressoAgente } from "../hub/tipos.js";

/** Um chamado mudou: novo turno, envio, contingência ou decisão da triagem. */
export interface ChamadoMudou {
  chamadoId: number;
  empresaId: string;
  solicitanteId: string;
}

/**
 * Fase do agente durante um turno. `pensando` abre o turno, `tentando_de_novo` marca a segunda tentativa
 * por resposta fora do formato e `concluido` fecha (com ou sem sucesso).
 */
export type FaseAgente =
  | { fase: "pensando" }
  | ProgressoAgente
  | { fase: "tentando_de_novo" }
  | { fase: "concluido" };

export type AgenteTrabalhando = { chamadoId: number; solicitanteId: string } & FaseAgente;

/** Sessão encerrada (sair) ou todas as de um usuário (senha nova): o WebSocket aberto com elas cai. */
export type SessaoEncerrada = { sessao: string } | { usuarioId: string };

interface Mapa {
  chamado: [ChamadoMudou];
  agente: [AgenteTrabalhando];
  sessao: [SessaoEncerrada];
}

/**
 * Barramento em memória: o domínio avisa o que mudou, e o gateway do WebSocket repassa a quem está olhando.
 * O domínio não conhece o socket.io; sem ninguém ouvindo, os avisos só se perdem.
 */
export const eventos = new EventEmitter<Mapa>();

export function avisarChamado(c: { id: number; empresa_id: string; solicitante_id: string }) {
  eventos.emit("chamado", { chamadoId: c.id, empresaId: c.empresa_id, solicitanteId: c.solicitante_id });
}
