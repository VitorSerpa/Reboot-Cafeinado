"use client";

import { useEffect, useRef, useState } from "react";

import { Composer } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";
import { createChatSocket, formatTime, request, type ChatSocket } from "@/lib/chat/socket";
import type { Conversation, Message } from "@/lib/chat/types";

function upsert(list: Conversation[], conversation: Conversation): Conversation[] {
  const others = list.filter((item) => item.id !== conversation.id);
  return [...others, conversation].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

export default function SupportPage() {
  const [socket, setSocket] = useState<ChatSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [clientTyping, setClientTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");

  const identity = useRef({ name: "", token: "" });
  const activeRef = useRef<string | null>(null);
  const socketRef = useRef<ChatSocket | null>(null);

  useEffect(
    () => () => {
      socketRef.current?.close();
    },
    [],
  );

  const openConversation = async (socketInstance: ChatSocket, conversationId: string) => {
    try {
      const { conversation, messages: history } = await request(socketInstance, "support:join", {
        conversationId,
      });
      activeRef.current = conversation.id;
      setActiveId(conversation.id);
      setMessages(history);
      setConversations((prev) => upsert(prev, conversation));
      setClientTyping(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível abrir a conversa");
    }
  };

  useEffect(() => {
    if (!socket) return;

    // Roda a cada (re)conexão: reautentica e volta para a conversa aberta.
    const authenticate = async () => {
      try {
        const { conversations: queue } = await request(socket, "support:auth", identity.current);
        setConversations(queue);
        setAuthed(true);
        setError(null);
        if (activeRef.current) await openConversation(socket, activeRef.current);
      } catch (err) {
        setAuthed(false);
        setError(err instanceof Error ? err.message : "Falha na autenticação");
        socket.close();
        socketRef.current = null;
        setSocket(null);
      }
    };

    const onConnect = () => {
      setConnected(true);
      void authenticate();
    };
    const onDisconnect = () => {
      setConnected(false);
      setClientTyping(false);
    };
    const onConnectError = () =>
      setError("Não foi possível conectar ao servidor de chat. Ele está rodando?");
    const onConversation = (conversation: Conversation) =>
      setConversations((prev) => upsert(prev, conversation));
    const onMessage = (message: Message) => {
      if (message.conversationId !== activeRef.current) return;
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    };
    const onTyping = (payload: { conversationId: string; role: string; isTyping: boolean }) => {
      if (payload.role === "client" && payload.conversationId === activeRef.current) {
        setClientTyping(payload.isTyping);
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("conversation:created", onConversation);
    socket.on("conversation:updated", onConversation);
    socket.on("message:new", onMessage);
    socket.on("typing:update", onTyping);

    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("conversation:created", onConversation);
      socket.off("conversation:updated", onConversation);
      socket.off("message:new", onMessage);
      socket.off("typing:update", onTyping);
    };
  }, [socket]);

  const handleLogin = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !token.trim()) {
      setError("Preencha nome e token");
      return;
    }

    identity.current = { name: trimmed, token: token.trim() };
    setError(null);

    const next = createChatSocket();
    socketRef.current = next;
    setSocket(next);
  };

  if (!authed) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-12">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Painel de suporte</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Entre para acompanhar a fila de atendimentos em tempo real.
          </p>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Seu nome
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Token de suporte
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
          </label>
          <button
            type="submit"
            disabled={Boolean(socket) && !error}
            className="mt-2 h-11 rounded-lg bg-zinc-900 text-sm font-medium text-zinc-50 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {socket && !error ? "Conectando…" : "Entrar"}
          </button>
        </form>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </main>
    );
  }

  const active = conversations.find((item) => item.id === activeId) ?? null;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Fila de atendimento</h1>
          <p className="text-xs text-zinc-500">
            {name.trim()} · {conversations.length} conversa(s)
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            connected
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          }`}
        >
          {connected ? "online" : "reconectando…"}
        </span>
      </header>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="grid flex-1 gap-4 md:grid-cols-[18rem_1fr]">
        <aside className="flex max-h-[28rem] flex-col gap-1 overflow-y-auto rounded-2xl border border-zinc-200 p-2 md:max-h-none dark:border-zinc-800">
          {conversations.length === 0 && (
            <p className="p-3 text-sm text-zinc-500">Nenhum atendimento aberto ainda.</p>
          )}
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              onClick={() => socket && void openConversation(socket, conversation.id)}
              className={`rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                conversation.id === activeId
                  ? "bg-zinc-100 dark:bg-zinc-800"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{conversation.clientName}</span>
                {conversation.unreadForSupport > 0 && conversation.id !== activeId && (
                  <span className="shrink-0 rounded-full bg-red-600 px-1.5 text-[11px] text-white">
                    {conversation.unreadForSupport}
                  </span>
                )}
              </span>
              <span className="mt-0.5 flex items-center justify-between gap-2 text-xs text-zinc-500">
                <span className="truncate">{conversation.lastMessage ?? conversation.subject}</span>
                <span className="shrink-0">{formatTime(conversation.lastMessageAt)}</span>
              </span>
              {conversation.status === "closed" && (
                <span className="text-[11px] text-zinc-400">encerrada</span>
              )}
            </button>
          ))}
        </aside>

        <section className="flex min-h-[24rem] flex-col overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
          {!active ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-zinc-500">
              Escolha uma conversa na lista.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{active.clientName}</h2>
                  <p className="truncate text-xs text-zinc-500">{active.subject}</p>
                </div>
                {active.status === "open" && (
                  <button
                    onClick={async () => {
                      if (!socket) return;
                      try {
                        const closed = await request(socket, "conversation:close", {
                          conversationId: active.id,
                        });
                        setConversations((prev) => upsert(prev, closed));
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Não foi possível encerrar");
                      }
                    }}
                    className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs dark:border-zinc-700"
                  >
                    Encerrar
                  </button>
                )}
              </div>

              <MessageList messages={messages} viewerRole="support" />

              {clientTyping && active.status === "open" && (
                <p className="px-4 pb-1 text-xs text-zinc-500">o cliente está digitando…</p>
              )}

              {active.status === "closed" ? (
                <p className="border-t border-zinc-200 p-3 text-center text-xs text-zinc-500 dark:border-zinc-800">
                  Atendimento encerrado.
                </p>
              ) : (
                <Composer
                  disabled={!connected}
                  placeholder="Responder ao cliente…"
                  onTypingChange={(isTyping) =>
                    socket?.emit("typing:set", { conversationId: active.id, isTyping })
                  }
                  onSend={async (body) => {
                    if (!socket) return;
                    try {
                      await request(socket, "message:send", {
                        conversationId: active.id,
                        body,
                      });
                      setError(null);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Não foi possível enviar");
                    }
                  }}
                />
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
