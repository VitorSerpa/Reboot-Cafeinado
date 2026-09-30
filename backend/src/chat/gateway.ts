import type { Namespace, Server, Socket } from "socket.io";

import { env } from "../config/env.js";
import * as store from "./store.js";
import {
  MAX_MESSAGE_LENGTH,
  type Ack,
  type ClientToServerEvents,
  type Conversation,
  type ServerToClientEvents,
  type SocketData,
} from "./types.js";

type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;
type ChatNamespace = Namespace<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

const SUPPORT_ROOM = "support";
const conversationRoom = (id: string) => `conv:${id}`;

function fail<T>(ack: Ack<T> | undefined, error: string) {
  ack?.({ ok: false, error });
}

function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().slice(0, 80);
  return name.length > 0 ? name : null;
}

/** O atendente vê qualquer conversa; o cliente só a própria. */
function canAccess(socket: ChatSocket, conversationId: string): boolean {
  if (socket.data.role === "support") return true;
  return socket.data.role === "client" && socket.data.conversationId === conversationId;
}

/** Chat ao vivo entre cliente e atendente, no namespace padrão (`/`) do socket.io. */
export function createChatGateway(server: Server) {
  const io = server.of("/") as unknown as ChatNamespace;

  const notifySupport = (
    event: "conversation:created" | "conversation:updated",
    conversation: Conversation,
  ) => {
    io.to(SUPPORT_ROOM).emit(event, conversation);
  };

  io.on("connection", (socket: ChatSocket) => {
    socket.data.role = null;
    socket.data.name = "";
    socket.data.conversationId = null;

    socket.on("client:start", (payload, ack) => {
      const name = sanitizeName(payload?.name);
      if (!name) return fail(ack, "Informe seu nome para iniciar o atendimento");

      const existing = payload?.conversationId
        ? store.getConversation(payload.conversationId)
        : undefined;

      // Sem conversa válida informada, abre uma nova (reload do cliente reaproveita a antiga).
      const conversation =
        existing ?? store.createConversation(name, payload?.subject?.trim() || "Sem assunto");

      socket.data.role = "client";
      socket.data.name = name;
      socket.data.conversationId = conversation.id;
      socket.join(conversationRoom(conversation.id));

      notifySupport(existing ? "conversation:updated" : "conversation:created", conversation);
      socket
        .to(conversationRoom(conversation.id))
        .emit("presence:update", { conversationId: conversation.id, role: "client", online: true });

      ack({
        ok: true,
        data: { conversation, messages: store.getMessages(conversation.id) },
      });
    });

    socket.on("support:auth", (payload, ack) => {
      const name = sanitizeName(payload?.name);
      if (!name) return fail(ack, "Informe o nome do atendente");
      if (payload?.token !== env.supportToken) return fail(ack, "Token de suporte inválido");

      socket.data.role = "support";
      socket.data.name = name;
      socket.join(SUPPORT_ROOM);

      ack({ ok: true, data: { conversations: store.listConversations() } });
    });

    socket.on("support:join", (payload, ack) => {
      if (socket.data.role !== "support") return fail(ack, "Apenas o suporte pode entrar na fila");

      const conversationId = payload?.conversationId;
      const conversation = conversationId ? store.getConversation(conversationId) : undefined;
      if (!conversation) return fail(ack, "Conversa não encontrada");

      // Um atendente por vez: sai da conversa anterior antes de entrar na nova.
      if (socket.data.conversationId && socket.data.conversationId !== conversation.id) {
        socket.leave(conversationRoom(socket.data.conversationId));
      }

      socket.data.conversationId = conversation.id;
      socket.join(conversationRoom(conversation.id));
      store.markReadBySupport(conversation.id);

      socket
        .to(conversationRoom(conversation.id))
        .emit("presence:update", {
          conversationId: conversation.id,
          role: "support",
          online: true,
        });
      notifySupport("conversation:updated", conversation);

      ack({
        ok: true,
        data: { conversation, messages: store.getMessages(conversation.id) },
      });
    });

    socket.on("message:send", (payload, ack) => {
      const role = socket.data.role;
      if (!role) return fail(ack, "Identifique-se antes de enviar mensagens");

      const conversationId = payload?.conversationId;
      if (!conversationId || !canAccess(socket, conversationId)) {
        return fail(ack, "Sem acesso a esta conversa");
      }

      const conversation = store.getConversation(conversationId);
      if (!conversation) return fail(ack, "Conversa não encontrada");
      if (conversation.status === "closed") return fail(ack, "Esta conversa já foi encerrada");

      const body = typeof payload.body === "string" ? payload.body.trim() : "";
      if (!body) return fail(ack, "Mensagem vazia");
      if (body.length > MAX_MESSAGE_LENGTH) {
        return fail(ack, `Mensagem acima de ${MAX_MESSAGE_LENGTH} caracteres`);
      }

      const message = store.addMessage({
        conversationId,
        from: role,
        authorName: socket.data.name,
        body,
      });

      io.to(conversationRoom(conversationId)).emit("message:new", message);
      notifySupport("conversation:updated", conversation);

      ack({ ok: true, data: message });
    });

    socket.on("typing:set", (payload) => {
      const role = socket.data.role;
      const conversationId = payload?.conversationId;
      if (!role || !conversationId || !canAccess(socket, conversationId)) return;

      socket.to(conversationRoom(conversationId)).emit("typing:update", {
        conversationId,
        role,
        isTyping: Boolean(payload.isTyping),
      });
    });

    socket.on("conversation:close", (payload, ack) => {
      if (socket.data.role !== "support") return fail(ack, "Apenas o suporte pode encerrar");

      const conversationId = payload?.conversationId;
      const conversation = conversationId ? store.closeConversation(conversationId) : undefined;
      if (!conversation) return fail(ack, "Conversa não encontrada");

      const message = store.addMessage({
        conversationId: conversation.id,
        from: "system",
        authorName: "sistema",
        body: `Atendimento encerrado por ${socket.data.name}.`,
      });

      io.to(conversationRoom(conversation.id)).emit("message:new", message);
      // O cliente também precisa saber que fechou, para trocar o campo de envio pelo aviso.
      io.to(conversationRoom(conversation.id)).emit("conversation:updated", conversation);
      notifySupport("conversation:updated", conversation);

      ack({ ok: true, data: conversation });
    });

    socket.on("disconnect", () => {
      const { role, conversationId } = socket.data;
      if (!role || !conversationId) return;

      socket.to(conversationRoom(conversationId)).emit("presence:update", {
        conversationId,
        role,
        online: false,
      });
    });
  });

  return io;
}
