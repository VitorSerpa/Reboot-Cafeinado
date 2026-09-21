/**
 * Espelho do contrato de eventos do backend (`backend/src/chat/types.ts`).
 * Ao mexer lá, atualize aqui — não há pacote compartilhado entre os dois projetos.
 */
export type Role = "client" | "support";

export interface Message {
  id: string;
  conversationId: string;
  from: Role | "system";
  authorName: string;
  body: string;
  sentAt: string;
}

export interface Conversation {
  id: string;
  clientName: string;
  subject: string;
  status: "open" | "closed";
  createdAt: string;
  lastMessageAt: string;
  unreadForSupport: number;
  lastMessage: string | null;
}

export type AckResult<T> = { ok: true; data: T } | { ok: false; error: string };
export type Ack<T> = (result: AckResult<T>) => void;

export interface ConversationWithMessages {
  conversation: Conversation;
  messages: Message[];
}

export interface ServerToClientEvents {
  "conversation:created": (conversation: Conversation) => void;
  "conversation:updated": (conversation: Conversation) => void;
  "message:new": (message: Message) => void;
  "presence:update": (payload: { conversationId: string; role: Role; online: boolean }) => void;
  "typing:update": (payload: { conversationId: string; role: Role; isTyping: boolean }) => void;
}

export interface ClientToServerEvents {
  "client:start": (
    payload: { name: string; subject?: string; conversationId?: string },
    ack: Ack<ConversationWithMessages>,
  ) => void;
  "support:auth": (
    payload: { name: string; token: string },
    ack: Ack<{ conversations: Conversation[] }>,
  ) => void;
  "support:join": (
    payload: { conversationId: string },
    ack: Ack<ConversationWithMessages>,
  ) => void;
  "message:send": (payload: { conversationId: string; body: string }, ack: Ack<Message>) => void;
  "typing:set": (payload: { conversationId: string; isTyping: boolean }) => void;
  "conversation:close": (payload: { conversationId: string }, ack: Ack<Conversation>) => void;
}

export const MAX_MESSAGE_LENGTH = 2000;
