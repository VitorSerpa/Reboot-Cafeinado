import { io, type Socket } from "socket.io-client";

import { urlDoBackend } from "@/lib/backend";

import type {
  AckResult,
  ClientToServerEvents,
  Conversation,
  ConversationWithMessages,
  Message,
  ServerToClientEvents,
} from "./types";

export type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createChatSocket(): ChatSocket {
  return io(urlDoBackend(), { transports: ["websocket"] });
}

/** Eventos com ack: `[payload, resposta]`. */
type RequestMap = {
  "client:start": [{ name: string; subject?: string; conversationId?: string }, ConversationWithMessages];
  "support:auth": [{ name: string; token: string }, { conversations: Conversation[] }];
  "support:join": [{ conversationId: string }, ConversationWithMessages];
  "message:send": [{ conversationId: string; body: string }, Message];
  "conversation:close": [{ conversationId: string }, Conversation];
};

const REQUEST_TIMEOUT_MS = 8000;

/** Emite um evento e resolve/rejeita com o ack do servidor. */
export function request<E extends keyof RequestMap>(
  socket: ChatSocket,
  event: E,
  payload: RequestMap[E][0],
): Promise<RequestMap[E][1]> {
  type Data = RequestMap[E][1];

  return new Promise<Data>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("O servidor não respondeu. Tente novamente.")),
      REQUEST_TIMEOUT_MS,
    );

    // bind: `emit` depende do `this` do socket.
    const emit = socket.emit.bind(socket) as unknown as (
      event: string,
      payload: unknown,
      ack: (result: AckResult<Data> | undefined) => void,
    ) => void;

    emit(event, payload, (result) => {
      clearTimeout(timer);
      if (result?.ok) {
        resolve(result.data);
      } else {
        reject(new Error(result?.error ?? "Falha na comunicação com o servidor"));
      }
    });
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
