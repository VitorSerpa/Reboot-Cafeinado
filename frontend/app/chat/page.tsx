"use client";

import { useEffect, useRef, useState } from "react";

import { Cabecalho } from "@/components/Cabecalho";
import { Composer } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";
import { createChatSocket, request, type ChatSocket } from "@/lib/chat/socket";
import type { Conversation, Message } from "@/lib/chat/types";

const STORAGE_KEY = "chat:client";

type Stored = { name: string; conversationId: string };

function loadStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

export default function ClientChatPage() {
  const [socket, setSocket] = useState<ChatSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [supportTyping, setSupportTyping] = useState(false);
  const [supportOnline, setSupportOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Identidade usada tanto no primeiro `client:start` quanto nas reconexões. */
  const identity = useRef<{ name: string; subject: string; conversationId?: string }>({
    name: "",
    subject: "",
  });
  const socketRef = useRef<ChatSocket | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Retoma nome/conversa de uma sessão anterior neste navegador.
  useEffect(() => {
    const stored = loadStored();
    if (!stored) return;

    identity.current.name = stored.name;
    identity.current.conversationId = stored.conversationId;
    if (nameInputRef.current) nameInputRef.current.value = stored.name;
  }, []);

  useEffect(
    () => () => {
      socketRef.current?.close();
    },
    [],
  );

  useEffect(() => {
    if (!socket) return;

    // Roda a cada (re)conexão: reabre ou retoma a conversa e volta para a sala.
    const start = async () => {
      try {
        const { conversation: conv, messages: history } = await request(socket, "client:start", {
          name: identity.current.name,
          subject: identity.current.subject,
          conversationId: identity.current.conversationId,
        });
        identity.current.conversationId = conv.id;
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              name: identity.current.name,
              conversationId: conv.id,
            } satisfies Stored),
          );
        } catch {
          // localStorage indisponível (aba privada): segue sem retomar depois.
        }
        setConversation(conv);
        setMessages(history);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Falha ao iniciar o atendimento");
      }
    };

    const onConnect = () => {
      setConnected(true);
      void start();
    };
    const onDisconnect = () => {
      setConnected(false);
      setSupportTyping(false);
    };
    const onConnectError = () =>
      setError("Não foi possível conectar ao servidor de chat. Ele está rodando?");
    const onMessage = (message: Message) =>
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    const onUpdated = (conv: Conversation) =>
      setConversation((prev) => (prev && prev.id === conv.id ? conv : prev));
    const onTyping = (payload: { role: string; isTyping: boolean }) => {
      if (payload.role === "support") setSupportTyping(payload.isTyping);
    };
    const onPresence = (payload: { role: string; online: boolean }) => {
      if (payload.role === "support") setSupportOnline(payload.online);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("message:new", onMessage);
    socket.on("conversation:updated", onUpdated);
    socket.on("typing:update", onTyping);
    socket.on("presence:update", onPresence);

    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("message:new", onMessage);
      socket.off("conversation:updated", onUpdated);
      socket.off("typing:update", onTyping);
      socket.off("presence:update", onPresence);
    };
  }, [socket]);

  const handleStart = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const trimmed = String(form.get("name") ?? "").trim();
    if (!trimmed) {
      setError("Informe seu nome");
      return;
    }

    identity.current.name = trimmed;
    identity.current.subject = String(form.get("subject") ?? "").trim();
    setError(null);

    const next = createChatSocket();
    socketRef.current = next;
    setSocket(next);
  };

  const handleNewConversation = () => {
    identity.current.conversationId = undefined;
    setMessages([]);
    setConversation(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // sem localStorage não há nada para limpar
    }
    socketRef.current?.close();
    socketRef.current = null;
    setSocket(null);
    setConnected(false);
  };

  if (!conversation) {
    return (
      <>
        <Cabecalho
          usuario={null}
          produto="Suporte ao vivo"
          conectado={socket ? connected : undefined}
        />
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-12">
          <div>
            <h1 className="titulo">Falar com o suporte</h1>
            <p className="mt-1 text-sm text-cinza">
              Abrimos um atendimento em tempo real com um de nossos atendentes.
            </p>
          </div>

          <form onSubmit={handleStart} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Seu nome
              <input
                ref={nameInputRef}
                name="name"
                defaultValue=""
                maxLength={80}
                className="campo"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Assunto <span className="text-cinza">(opcional)</span>
              <input
                name="subject"
                defaultValue=""
                maxLength={120}
                placeholder="Ex.: pedido atrasado"
                className="campo"
              />
            </label>
            <button type="submit" disabled={Boolean(socket) && !error} className="botao mt-2">
              {socket && !error ? "Conectando…" : "Iniciar atendimento"}
            </button>
          </form>

          {error && <p className="aviso erro">{error}</p>}
        </main>
      </>
    );
  }

  const closed = conversation.status === "closed";

  return (
    <>
      <Cabecalho
        usuario={null}
        produto="Suporte ao vivo"
        conectado={socket ? connected : undefined}
      />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-6">
        <div className="flex flex-1 flex-col overflow-hidden rounded-[10px] bg-white shadow-cartao">
          <header className="flex items-center justify-between gap-3 border-b border-cinza-claro px-4 py-3">
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">Suporte · {conversation.subject}</h1>
              <p className="text-xs text-cinza">
                {closed
                  ? "Atendimento encerrado"
                  : supportOnline
                    ? "Atendente na conversa"
                    : "Aguardando um atendente"}
              </p>
            </div>
            <span className={`shrink-0 ${connected ? "selo verde" : "selo laranja"}`}>
              {connected ? "online" : "reconectando…"}
            </span>
          </header>

          <MessageList
            messages={messages}
            viewerRole="client"
            emptyHint="Conte o que aconteceu — um atendente responde por aqui."
          />

          {supportTyping && !closed && (
            <p className="px-4 pb-1 text-xs text-cinza">o atendente está digitando…</p>
          )}
          {error && <p className="px-4 pb-1 text-xs text-vermelho">{error}</p>}

          {closed ? (
            <div className="border-t border-cinza-claro p-3">
              <button onClick={handleNewConversation} className="botao secundario h-10 w-full">
                Abrir novo atendimento
              </button>
            </div>
          ) : (
            <Composer
              disabled={!connected}
              onTypingChange={(isTyping) =>
                socket?.emit("typing:set", { conversationId: conversation.id, isTyping })
              }
              onSend={async (body) => {
                if (!socket) return;
                try {
                  await request(socket, "message:send", { conversationId: conversation.id, body });
                  setError(null);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Não foi possível enviar");
                }
              }}
            />
          )}
        </div>
      </main>
    </>
  );
}
