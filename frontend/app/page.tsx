"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Cabecalho } from "@/components/Cabecalho";
import { api, type Usuario } from "@/lib/api";
import { guardarTokenDaAba } from "@/lib/sessao";

/** Os dois tipos de login. O suporte é o perfil `analista` no banco. */
const TIPOS = [
  { perfil: "solicitante", rotulo: "Solicitante", resumo: "Abra um chamado e converse com o assistente e depois com o suporte." },
  { perfil: "analista", rotulo: "Suporte", resumo: "Revise a fila de triagem e responda os solicitantes no chat do chamado." },
] as const;

const destino = (u: Usuario) => (u.perfil === "analista" ? "/triagem" : "/chamado");

/** Entrada: login com e-mail e senha, escolhendo o tipo (solicitante ou suporte). A sessão fica nesta aba. */
export default function Entrada() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Usuario["perfil"]>("solicitante");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [encerrada, setEncerrada] = useState(false);

  // Esta aba já tem sessão: vai direto para a tela do perfil.
  useEffect(() => {
    api<Usuario>("/auth/me")
      .then((u) => {
        guardarTokenDaAba(u.token);
        router.replace(destino(u));
      })
      // Sem sessão: se a tela anterior mandou para cá porque a sessão acabou, avisa.
      .catch(() => setEncerrada(new URLSearchParams(window.location.search).get("sessao") === "encerrada"));
  }, [router]);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      const u = await api<Usuario>("/auth/entrar", { corpo: { email, senha, perfil } });
      guardarTokenDaAba(u.token);
      router.push(destino(u));
    } catch (falha) {
      setErro((falha as Error).message);
      setSenha("");
      setEnviando(false);
    }
  }

  const tipo = TIPOS.find((t) => t.perfil === perfil)!;

  return (
    <>
      <Cabecalho usuario={null} />
      <main className="conteudo" style={{ maxWidth: 440 }}>
        <div className="pilha">
          <h1>Entrar</h1>
          <p className="suave">
            Chamado Pronto · <strong>Aurora Distribuição</strong>
          </p>

          <form className="cartao pilha" onSubmit={entrar}>
            <div role="radiogroup" aria-label="Tipo de login" className="grid grid-cols-2 gap-1 rounded-lg bg-fundo p-1">
              {TIPOS.map((t) => (
                <button
                  key={t.perfil}
                  type="button"
                  role="radio"
                  aria-checked={perfil === t.perfil}
                  onClick={() => {
                    setPerfil(t.perfil);
                    setErro(null);
                  }}
                  className={`cursor-pointer rounded-md px-3 py-2 font-titulo text-sm font-semibold transition-colors ${
                    perfil === t.perfil ? "bg-laranja text-white" : "text-cinza hover:text-texto"
                  }`}
                >
                  {t.rotulo}
                </button>
              ))}
            </div>
            <p className="suave">{tipo.resumo}</p>

            <div>
              <label className="rotulo" htmlFor="email">
                E-mail
              </label>
              <input
                id="email"
                className="campo"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="rotulo" htmlFor="senha">
                Senha
              </label>
              <input
                id="senha"
                className="campo"
                type="password"
                autoComplete="current-password"
                required
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
            </div>
            {erro && <div className="aviso erro">{erro}</div>}
            {!erro && encerrada && <div className="aviso info">Sua sessão terminou. Entre de novo para continuar.</div>}
            <button className="botao" type="submit" disabled={enviando || !email.trim() || !senha}>
              {enviando ? "Entrando…" : `Entrar como ${tipo.rotulo.toLowerCase()}`}
            </button>
          </form>
        </div>
      </main>
    </>
  );
}
