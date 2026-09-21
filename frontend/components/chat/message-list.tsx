"use client";

import { useEffect, useRef } from "react";

import { formatTime } from "@/lib/chat/socket";
import type { Message, Role } from "@/lib/chat/types";

interface MessageListProps {
  messages: Message[];
  /** Papel de quem está olhando — define qual lado da conversa fica à direita. */
  viewerRole: Role;
  emptyHint?: string;
}

export function MessageList({ messages, viewerRole, emptyHint }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-zinc-500">
        {emptyHint ?? "Nenhuma mensagem ainda."}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      {messages.map((message) => {
        if (message.from === "system") {
          return (
            <p key={message.id} className="text-center text-xs text-zinc-500">
              {message.body}
            </p>
          );
        }

        const isMine = message.from === viewerRole;

        return (
          <div key={message.id} className={isMine ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                isMine
                  ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
              }`}
            >
              <span className="mb-0.5 block text-[11px] opacity-60">
                {message.authorName} · {formatTime(message.sentAt)}
              </span>
              <span className="whitespace-pre-wrap break-words">{message.body}</span>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
