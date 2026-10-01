"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api, ErroApi, type Usuario } from "@/lib/api";
import { esquecerTokenDaAba, guardarTokenDaAba } from "@/lib/sessao";

/**
 * Carrega o usuário da sessão desta aba; sem sessão (ou perfil errado), volta para a tela de entrada.
 * Guarda o token que vem junto: a partir daí a aba fica com este usuário, mesmo que outra aba entre com outro.
 */
export function useSessao(perfil?: Usuario["perfil"]) {
  const router = useRouter();
  const [usuario, setUsuario] = useState<Usuario | null>(null);

  useEffect(() => {
    api<Usuario>("/auth/me")
      .then((u) => {
        guardarTokenDaAba(u.token);
        if (perfil && u.perfil !== perfil) router.replace(u.perfil === "analista" ? "/triagem" : "/chamado");
        else setUsuario(u);
      })
      .catch((e) => {
        if (e instanceof ErroApi && e.status === 401) router.replace("/");
      });
  }, [perfil, router]);

  return usuario;
}

/**
 * Cabeçalho de todas as telas. `conectado` mostra o estado do WebSocket; sem ele (undefined), o selo não aparece.
 */
export function Cabecalho({
  usuario,
  produto = "Chamado Pronto",
  conectado,
}: {
  usuario: Usuario | null;
  produto?: string;
  conectado?: boolean;
}) {
  const router = useRouter();

  async function sair() {
    await api("/auth/sair", { corpo: {} }).catch(() => undefined);
    esquecerTokenDaAba();
    router.replace("/");
  }

  return (
    <header className="cabecalho">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/kaffa-negativo.svg" alt="Kaffa" />
      <Link href="/" className="produto">
        {produto}
      </Link>
      {conectado !== undefined && (
        <span
          className={`selo ${conectado ? "verde" : "laranja"}`}
          title={conectado ? "Atualizações chegando pelo WebSocket" : "Sem conexão em tempo real; tentando de novo"}
        >
          {conectado ? "Tempo real" : "Reconectando…"}
        </span>
      )}
      {usuario?.hub && (
        <span
          className={`selo ${usuario.hub === "real" ? "verde" : "laranja"}`}
          title={usuario.hub === "real" ? "Conversando com o agente no Kaffa AI Hub" : "Respostas fixas, sem o agente real"}
        >
          Hub: {usuario.hub}
        </span>
      )}
      <span className="espaco" />
      {usuario && (
        <>
          <span className="usuario">
            {usuario.nome}
            <br />
            {usuario.perfil === "analista" ? "Suporte" : "Solicitante"} · Aurora Distribuição
          </span>
          <button onClick={sair}>Sair</button>
        </>
      )}
    </header>
  );
}
