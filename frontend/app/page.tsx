"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Cabecalho } from "@/components/Cabecalho";
import { api, type Usuario } from "@/lib/api";

/** Entrada: escolher um usuário de teste do Chamado Pronto (sem senha) ou ir para o chat ao vivo. */
export default function Entrada() {
  const router = useRouter();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api<Usuario[]>("/auth/usuarios").then(setUsuarios).catch((e) => setErro(e.message));
  }, []);

  async function entrar(u: Usuario) {
    try {
      await api("/auth/entrar", { corpo: { usuarioId: u.id } });
      router.push(u.perfil === "analista" ? "/triagem" : "/chamado");
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <>
      <Cabecalho usuario={null} />
      <main className="conteudo" style={{ maxWidth: 640 }}>
        <div className="pilha">
          <h1>Entrar no protótipo</h1>
          <p className="suave">
            Empresa fictícia <strong>Aurora Distribuição</strong>. Escolha quem você quer ser: quem abre o chamado ou quem faz a triagem.
          </p>
          {erro && <div className="aviso erro">{erro}</div>}
          {usuarios.map((u) => (
            <button key={u.id} className="item-fila" onClick={() => entrar(u)}>
              <div className="linha">
                <strong>{u.nome}</strong>
                <span className={`selo ${u.perfil === "analista" ? "azul" : "laranja"}`}>
                  {u.perfil === "analista" ? "Analista de suporte" : "Solicitante"}
                </span>
              </div>
              <div className="resumo">
                {u.perfil === "analista"
                  ? "Revisa os chamados qualificados, responde ao solicitante no mesmo chat e confirma ou corrige a fila, tudo em tempo real."
                  : "Relata um problema, responde às perguntas do assistente e depois conversa com o suporte na mesma conversa."}
              </div>
            </button>
          ))}

          <h2 style={{ marginTop: 16 }}>Chat ao vivo</h2>
          <p className="suave">Conversa em tempo real entre um cliente e um atendente humano, sem o agente.</p>
          <div className="linha" style={{ alignItems: "stretch" }}>
            <Link href="/chat" className="item-fila" style={{ flex: "1 1 240px" }}>
              <strong>Falar com o suporte</strong>
              <div className="resumo">Abre um atendimento como cliente.</div>
            </Link>
            <Link href="/suporte" className="item-fila" style={{ flex: "1 1 240px" }}>
              <strong>Painel do atendente</strong>
              <div className="resumo">Acompanha a fila de atendimentos e responde (pede o token de suporte).</div>
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
