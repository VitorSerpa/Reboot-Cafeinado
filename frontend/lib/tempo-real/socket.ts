"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { ErroApi } from "@/lib/api";
import { urlDoBackend } from "@/lib/backend";
import { tokenDaAba } from "@/lib/sessao";

import type { ClienteParaServidor, EstadoChamado, FaseAgente, Resposta, ServidorParaCliente } from "./tipos";

export type SocketChamados = Socket<ServidorParaCliente, ClienteParaServidor>;

/** Eventos com ack: `[payload, resposta]`. */
type Pedidos = {
  "chamado:abrir": [{ texto: string }, EstadoChamado];
  "chamado:responder": [{ chamadoId: number; texto: string }, EstadoChamado];
  "chamado:mensagem": [{ chamadoId: number; texto: string }, EstadoChamado];
};

/** Um turno do agente pode levar até duas chamadas ao Hub (a segunda, se a resposta vier fora do formato). */
const TEMPO_TURNO_MS = 200_000;
/** Mensagem no chat com o suporte: só grava e avisa, sem o agente. */
const TEMPO_MENSAGEM_MS = 10_000;

/**
 * Emite um pedido e resolve com o ack. O erro vira `ErroApi`, igual ao da API REST,
 * para a tela tratar os dois do mesmo jeito (ex.: `hub_indisponivel` abre o formulário curto).
 */
export function pedir<E extends keyof Pedidos>(socket: SocketChamados, evento: E, payload: Pedidos[E][0]): Promise<Pedidos[E][1]> {
  return new Promise((resolve, reject) => {
    const mensagem = evento === "chamado:mensagem";
    const timer = setTimeout(
      () =>
        reject(
          new ErroApi(
            0,
            "tempo",
            mensagem ? "O servidor não confirmou a mensagem. Tente de novo." : "O assistente demorou demais para responder. Tente de novo.",
            {},
          ),
        ),
      mensagem ? TEMPO_MENSAGEM_MS : TEMPO_TURNO_MS,
    );
    // bind: `emit` depende do `this` do socket.
    const emitir = socket.emit.bind(socket) as unknown as (
      evento: string,
      payload: unknown,
      ack: (r: Resposta<Pedidos[E][1]> | undefined) => void,
    ) => void;

    emitir(evento, payload, (r) => {
      clearTimeout(timer);
      if (r?.ok) resolve(r.data);
      else reject(new ErroApi(0, r?.erro ?? "erro", r?.mensagem ?? "Falha na comunicação com o servidor", r?.extra ?? {}));
    });
  });
}

/**
 * Conexão com o namespace `/chamados` para o usuário desta tela (em geral: depois de a sessão carregar).
 * O handshake manda o token desta aba, lido de novo a cada reconexão; sem token, o backend usa o cookie.
 * Sem o token, uma reconexão (backend reiniciado, rede caiu) chegaria com o cookie do último login do navegador:
 * a triagem viraria o solicitante de outra aba e pararia de receber a fila.
 * `socket` só aparece depois da primeira conexão e continua o mesmo nas reconexões.
 */
export function useTempoReal(usuarioId: string | null) {
  const [socket, setSocket] = useState<SocketChamados | null>(null);
  const [conectado, setConectado] = useState(false);

  useEffect(() => {
    if (!usuarioId) return;
    const s: SocketChamados = io(`${urlDoBackend()}/chamados`, {
      transports: ["websocket"],
      withCredentials: true,
      auth: (cb) => cb({ token: tokenDaAba() }),
    });
    const caiu = () => setConectado(false);
    s.on("connect", () => {
      setSocket(s);
      setConectado(true);
    });
    s.on("disconnect", caiu);
    s.on("connect_error", caiu);
    return () => {
      s.close();
      setSocket(null);
      setConectado(false);
    };
  }, [usuarioId]);

  return { socket, conectado };
}

/** Texto que o solicitante vê enquanto o agente trabalha. */
export function textoDaFase(fase: FaseAgente | null): string {
  switch (fase?.fase) {
    case "consultando":
      return /(catalogo|contexto|query|run_query|read_file|obter)/i.test(fase.ferramenta)
        ? "O assistente está consultando o catálogo da Aurora…"
        : "O assistente está usando uma ferramenta…";
    case "escrevendo":
      return "O assistente está escrevendo…";
    case "tentando_de_novo":
      return "O assistente está organizando a resposta…";
    default:
      return "O assistente está analisando seu relato…";
  }
}
