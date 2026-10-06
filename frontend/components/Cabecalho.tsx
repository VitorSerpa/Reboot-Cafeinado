"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api, ErroApi, type Usuario } from "@/lib/api";
import { aplicarMarca } from "@/lib/marcas";
import { esquecerTokenDaAba, guardarTokenDaAba, marcarSaida } from "@/lib/sessao";
import { useMarca } from "@/lib/useMarca";

/**
 * Carrega o usuário da sessão desta aba; sem sessão, volta para a tela de entrada, e com o perfil errado,
 * para a tela do perfil certo. Até conferir, `usuario` é null: a tela mostra só `<VerificandoSessao />`.
 * Guarda o token que vem junto: a partir daí a aba fica com este usuário, mesmo que outra aba entre com outro.
 * A tela ganha a marca da empresa do usuário (cores, logo, portal), que fica guardada na aba.
 */
export function useSessao(perfil?: Usuario["perfil"]) {
  const router = useRouter();
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api<Usuario>("/auth/me")
      .then((u) => {
        guardarTokenDaAba(u.token);
        aplicarMarca(u.empresa_id);
        if (perfil && u.perfil !== perfil) router.replace(u.perfil === "analista" ? "/triagem" : "/chamado");
        else setUsuario(u);
      })
      .catch((e) => {
        if (e instanceof ErroApi && e.status === 401) router.replace("/");
        else setErro(e instanceof Error ? e.message : "Não foi possível conferir a sessão.");
      });
  }, [perfil, router]);

  return { usuario, erro };
}

/** O que aparece numa tela protegida enquanto a sessão não foi conferida (nada do conteúdo vaza antes). */
export function VerificandoSessao({ erro }: { erro: string | null }) {
  return (
    <>
      <Cabecalho usuario={null} />
      <main className="conteudo" style={{ maxWidth: 520 }}>
        {erro ? (
          <div className="pilha">
            <p className="aviso erro">{erro}</p>
            <button className="botao secundario" onClick={() => window.location.reload()}>
              Tentar de novo
            </button>
          </div>
        ) : (
          <p className="suave">Conferindo sua sessão…</p>
        )}
      </main>
    </>
  );
}

/**
 * Cabeçalho de todas as telas. `conectado` mostra o estado do WebSocket; sem ele (undefined), o selo não aparece.
 * Com a marca de uma empresa, mostra o símbolo e o portal dela no lugar do logo Kaffa e do nome do produto.
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
  const marca = useMarca();

  async function sair() {
    marcarSaida();
    await api("/auth/sair", { corpo: {} }).catch(() => undefined);
    esquecerTokenDaAba();
    router.replace("/");
  }

  return (
    <header className="cabecalho">
      {marca ? (
        <span className="marca">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={marca.simbolo} alt="" />
          <span className="assinatura">{marca.assinatura}</span>
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/kaffa-negativo.svg" alt="Kaffa" />
      )}
      <Link href="/" className="produto">
        {marca?.portal ?? produto}
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
            {usuario.perfil === "analista" ? "Suporte" : "Solicitante"} · {usuario.empresa_nome ?? usuario.empresa_id}
          </span>
          <button onClick={sair}>Sair</button>
        </>
      )}
    </header>
  );
}
