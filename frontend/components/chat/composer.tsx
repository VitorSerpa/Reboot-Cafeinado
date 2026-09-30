"use client";

import { useEffect, useRef, useState } from "react";

import { MAX_MESSAGE_LENGTH } from "@/lib/chat/types";

interface ComposerProps {
  onSend: (body: string) => Promise<void> | void;
  onTypingChange?: (isTyping: boolean) => void;
  disabled?: boolean;
  placeholder?: string;
}

const TYPING_IDLE_MS = 1500;

export function Composer({ onSend, onTypingChange, disabled, placeholder }: ComposerProps) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const typingRef = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mantém o callback atual acessível sem recriar os efeitos a cada render.
  const notifyRef = useRef(onTypingChange);

  useEffect(() => {
    notifyRef.current = onTypingChange;
  }, [onTypingChange]);

  // Sai de cena digitando? Avisa o outro lado antes de desmontar.
  useEffect(() => {
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (typingRef.current) {
        typingRef.current = false;
        notifyRef.current?.(false);
      }
    };
  }, []);

  const stopTyping = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (typingRef.current) {
      typingRef.current = false;
      notifyRef.current?.(false);
    }
  };

  const handleChange = (value: string) => {
    setBody(value);
    if (!notifyRef.current) return;

    if (!typingRef.current && value.length > 0) {
      typingRef.current = true;
      notifyRef.current(true);
    }

    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed || sending || disabled) return;

    setSending(true);
    try {
      await onSend(trimmed);
      setBody("");
      stopTyping();
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="flex items-end gap-2 border-t border-cinza-claro p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        value={body}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={(event) => {
          // Enter envia; Shift+Enter quebra linha.
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
        disabled={disabled}
        rows={2}
        maxLength={MAX_MESSAGE_LENGTH}
        placeholder={placeholder ?? "Escreva sua mensagem…"}
        className="campo flex-1 resize-none text-sm"
      />
      <button
        type="submit"
        disabled={disabled || sending || body.trim().length === 0}
        className="botao h-10"
      >
        {sending ? "…" : "Enviar"}
      </button>
    </form>
  );
}
