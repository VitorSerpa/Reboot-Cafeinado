import { randomUUID } from "node:crypto";

import type { Conversation, Message, Role } from "./types.js";

/**
 * Store em memória: some a cada restart do processo.
 * Trocar por banco/redis antes de usar em produção.
 */
const conversations = new Map<string, Conversation>();
const messages = new Map<string, Message[]>();

export function createConversation(clientName: string, subject: string): Conversation {
  const now = new Date().toISOString();
  const conversation: Conversation = {
    id: randomUUID(),
    clientName,
    subject,
    status: "open",
    createdAt: now,
    lastMessageAt: now,
    unreadForSupport: 0,
    lastMessage: null,
  };

  conversations.set(conversation.id, conversation);
  messages.set(conversation.id, []);

  return conversation;
}

export function getConversation(id: string): Conversation | undefined {
  return conversations.get(id);
}

/** Fila do atendente: mais recentes primeiro. */
export function listConversations(): Conversation[] {
  return [...conversations.values()].sort((a, b) =>
    b.lastMessageAt.localeCompare(a.lastMessageAt),
  );
}

export function getMessages(conversationId: string): Message[] {
  return messages.get(conversationId) ?? [];
}

export function addMessage(input: {
  conversationId: string;
  from: Role | "system";
  authorName: string;
  body: string;
}): Message {
  const conversation = conversations.get(input.conversationId);
  if (!conversation) {
    throw new Error(`Conversa ${input.conversationId} não existe`);
  }

  const message: Message = {
    id: randomUUID(),
    conversationId: input.conversationId,
    from: input.from,
    authorName: input.authorName,
    body: input.body,
    sentAt: new Date().toISOString(),
  };

  messages.get(input.conversationId)!.push(message);

  conversation.lastMessageAt = message.sentAt;
  conversation.lastMessage = message.body;
  if (input.from === "client") {
    conversation.unreadForSupport += 1;
  }

  return message;
}

export function markReadBySupport(conversationId: string): Conversation | undefined {
  const conversation = conversations.get(conversationId);
  if (conversation) {
    conversation.unreadForSupport = 0;
  }
  return conversation;
}

export function closeConversation(conversationId: string): Conversation | undefined {
  const conversation = conversations.get(conversationId);
  if (conversation) {
    conversation.status = "closed";
  }
  return conversation;
}
