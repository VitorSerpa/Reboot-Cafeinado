"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Cabecalho, useSessao, VerificandoSessao } from "@/components/Cabecalho";
import { Conversa } from "@/components/Conversa";
import { api, ErroApi, type CampoContingencia, type Catalogo, type Chamado, type Turno } from "@/lib/api";
import { camposInformados } from "@/lib/informacoes";
import { pedir, textoDaFase, useTempoReal } from "@/lib/tempo-real/socket";
import type { EstadoChamado, FaseAgente } from "@/lib/tempo-real/tipos";

const ABRANGENCIA = [
  ["so_eu", "Só comigo"],
  ["outros", "Com outros colegas também"],
  ["nao_sei", "Não sei"],
] as const;

/** Mesmo limite do backend (`MAX_MENSAGEM` em `dominio/chamados.ts`). */
const MAX_MENSAGEM = 2000;

interface MeuChamado {
  id: number;
  status: Chamado["status"];
  texto_inicial: string;
  criado_em: string;
}

const SITUACAO: Record<Chamado["status"], string> = {
  qualificando: "Com o assistente",
  aguardando_triagem: "Com o suporte",
  triado: "Encaminhado",
};

/** Turnos só crescem: um aviso atrasado (com menos turnos) não pode apagar o que já está na tela. */
const maisNovo = (atual: EstadoChamado | null, chegou: EstadoChamado) =>
  atual && atual.chamado.id === chegou.chamado.id && chegou.turnos.length < atual.turnos.length ? atual : chegou;

export default function AbrirChamado() {
  const { usuario, erro: erroSessao } = useSessao("solicitante");
  const { socket, conectado } = useTempoReal(usuario?.id ?? null);
  const [estado, setEstado] = useState<EstadoChamado | null>(null);
  const [texto, setTexto] = useState("");
  const [pendente, setPendente] = useState<string | null>(null);
  const [fase, setFase] = useState<FaseAgente | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [contingencia, setContingencia] = useState<{ chamadoId: number; campos: CampoContingencia[] } | null>(null);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [meus, setMeus] = useState<MeuChamado[]>([]);
  const fim = useRef<HTMLDivElement>(null);
  /** Chamado desta tela; os avisos de outros chamados do mesmo usuário (outra aba) são ignorados. */
  const chamadoAtual = useRef<number | null>(null);
  /** Relato enviado e chamado ainda sem id: o primeiro aviso que chegar é o dele. */
  const abrindo = useRef(false);

  const aplicar = useCallback((novo: EstadoChamado) => {
    chamadoAtual.current = novo.chamado.id;
    setEstado((atual) => maisNovo(atual, novo));
  }, []);

  const recarregar = useCallback(
    async (id: number) => aplicar(await api<{ chamado: Chamado; turnos: Turno[] }>(`/chamados/${id}`)),
    [aplicar],
  );

  useEffect(() => {
    if (usuario) api<Catalogo>("/catalogo").then(setCatalogo).catch(() => undefined);
  }, [usuario]);

  // Sem chamado aberto na tela: lista os anteriores, para voltar à conversa com o suporte.
  useEffect(() => {
    if (usuario && !estado) api<MeuChamado[]>("/chamados").then(setMeus).catch(() => undefined);
  }, [usuario, estado]);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [estado, pendente, fase]);

  // Avisos do WebSocket: estado do chamado a cada mudança e o que o agente está fazendo agora.
  useEffect(() => {
    if (!socket) return;
    const eDesteChamado = (id: number) => id === chamadoAtual.current || (chamadoAtual.current === null && abrindo.current);

    const aoAtualizar = (novo: EstadoChamado) => {
      if (eDesteChamado(novo.chamado.id)) aplicar(novo);
    };
    const aoAgente = (p: { chamadoId: number } & FaseAgente) => {
      if (eDesteChamado(p.chamadoId)) setFase(p.fase === "concluido" ? null : p);
    };
    // Depois de uma queda, busca o que pode ter mudado enquanto estava desconectado.
    const aoReconectar = () => {
      if (chamadoAtual.current) recarregar(chamadoAtual.current).catch(() => undefined);
    };

    socket.on("chamado:atualizado", aoAtualizar);
    socket.on("chamado:agente", aoAgente);
    socket.io.on("reconnect", aoReconectar);
    return () => {
      socket.off("chamado:atualizado", aoAtualizar);
      socket.off("chamado:agente", aoAgente);
      socket.io.off("reconnect", aoReconectar);
    };
  }, [socket, aplicar, recarregar]);

  async function falar() {
    const mensagem = texto.trim();
    if (!mensagem || pendente || !socket) return;
    setErro(null);
    setPendente(mensagem);
    setTexto("");
    abrindo.current = !estado;
    try {
      // Enquanto qualifica, fala com o agente; depois, a mesma conversa segue com o atendente.
      const novo = !estado
        ? await pedir(socket, "chamado:abrir", { texto: mensagem })
        : estado.chamado.status === "qualificando"
          ? await pedir(socket, "chamado:responder", { chamadoId: estado.chamado.id, texto: mensagem })
          : await pedir(socket, "chamado:mensagem", { chamadoId: estado.chamado.id, texto: mensagem });
      aplicar(novo);
    } catch (e) {
      if (e instanceof ErroApi && e.codigo === "hub_indisponivel") {
        const chamadoId = Number(e.corpo.chamadoId);
        setContingencia({ chamadoId, campos: e.corpo.campos as CampoContingencia[] });
        await recarregar(chamadoId).catch(() => undefined);
      } else {
        setErro((e as Error).message);
        setTexto(mensagem);
      }
    } finally {
      abrindo.current = false;
      setPendente(null);
      setFase(null);
    }
  }

  function novo() {
    chamadoAtual.current = null;
    setEstado(null);
    setContingencia(null);
    setErro(null);
    setTexto("");
  }

  const chamado = estado?.chamado;
  const r = chamado?.resultado;
  const nomeApp = (slug: string | null) => catalogo?.servicos.find((a) => a.slug === slug)?.nome ?? slug;
  /** O agente concluiu: a conversa agora é com o atendente. */
  const comSuporte = !!chamado && chamado.status !== "qualificando";
  // A mensagem pendente sai da tela quando o aviso do WebSocket já trouxe o turno gravado.
  const ultimo = estado?.turnos.at(-1);
  const mostrarPendente = pendente && !(ultimo?.papel === "solicitante" && ultimo.texto === pendente);

  // Nada da tela aparece antes de a sessão ser conferida (e do perfil certo).
  if (!usuario) return <VerificandoSessao erro={erroSessao} />;

  return (
    <>
      <Cabecalho usuario={usuario} conectado={usuario ? conectado : undefined} />
      <main className="conteudo" style={{ maxWidth: 760 }}>
        <div className="pilha">
          <div className="linha" style={{ justifyContent: "space-between" }}>
            <h1>{chamado ? `Chamado #${chamado.id}` : "Abrir um chamado"}</h1>
            {chamado && (
              <button className="botao secundario" onClick={novo} disabled={!!pendente}>
                Novo chamado
              </button>
            )}
          </div>

          <div className="cartao pilha">
            {!estado && !pendente && (
              <p className="suave">
                Conte o que está acontecendo do jeito que você falaria com um colega. Não precisa saber o nome técnico nem a equipe certa: o assistente
                pergunta só o que faltar.
              </p>
            )}

            <div className="chat">
              {estado && <Conversa turnos={estado.turnos} visao="solicitante" />}
              {mostrarPendente && <div className="bolha solicitante propria">{pendente}</div>}
              {pendente && !comSuporte && <div className="digitando">{textoDaFase(fase)}</div>}
            </div>

            {erro && <div className="aviso erro">{erro}</div>}

            {chamado && r?.status === "seguranca" && (
              <div className="aviso atencao">
                Encaminhamos o caso ao suporte como possível incidente de segurança. Siga a orientação acima.
              </div>
            )}
            {chamado?.status === "triado" && (
              <div className="aviso ok">
                <strong>Chamado #{chamado.id} encaminhado.</strong> Um analista revisou e mandou para a equipe responsável. Você pode continuar
                conversando por aqui.
              </div>
            )}

            {contingencia && !comSuporte && (
              <FormularioContingencia
                campos={contingencia.campos}
                catalogo={catalogo}
                aoEnviar={async (campos) => {
                  try {
                    await api(`/chamados/${contingencia.chamadoId}/contingencia`, { corpo: { campos } });
                    setContingencia(null);
                    await recarregar(contingencia.chamadoId);
                  } catch (e) {
                    setErro((e as Error).message);
                  }
                }}
              />
            )}

            {!contingencia && (
              <div className="pilha">
                <textarea
                  className="campo"
                  rows={chamado ? 2 : 4}
                  maxLength={comSuporte ? MAX_MENSAGEM : undefined}
                  placeholder={
                    comSuporte
                      ? "Mensagem para o suporte…"
                      : chamado
                        ? "Sua resposta…"
                        : "Ex.: não consigo lançar o pagamento de um fornecedor no portal"
                  }
                  value={texto}
                  disabled={!!pendente}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      falar();
                    }
                  }}
                />
                <div className="linha" style={{ justifyContent: "space-between" }}>
                  <span className="suave">
                    {conectado || !usuario
                      ? "Enter envia · Shift+Enter quebra linha · nunca informe senhas ou códigos"
                      : "Sem conexão em tempo real com o servidor. Tentando reconectar…"}
                  </span>
                  <button className="botao" onClick={falar} disabled={!texto.trim() || !!pendente || !conectado}>
                    {comSuporte ? "Enviar" : chamado ? "Responder" : "Enviar relato"}
                  </button>
                </div>
              </div>
            )}

            {comSuporte && r && !chamado.qualificado_sem_ia && (
              <details>
                <summary className="suave" style={{ cursor: "pointer" }}>
                  O que o suporte recebeu
                </summary>
                <dl className="grade" style={{ marginTop: 8 }}>
                  <dt>Resumo</dt>
                  <dd>{r.resumo || chamado.texto_inicial}</dd>
                  {r.aplicacao && (
                    <>
                      <dt>Sistema</dt>
                      <dd>{nomeApp(r.aplicacao)}</dd>
                    </>
                  )}
                  {camposInformados(r.informacoes).map(([rotulo, valor]) => (
                    <InfoLinha key={rotulo} rotulo={rotulo} valor={valor} />
                  ))}
                </dl>
              </details>
            )}
            <div ref={fim} />
          </div>

          {!estado && !pendente && meus.length > 0 && (
            <div className="pilha">
              <h2>Meus chamados</h2>
              {meus.map((m) => (
                <button
                  key={m.id}
                  className="item-fila"
                  onClick={() => recarregar(m.id).catch((e) => setErro((e as Error).message))}
                >
                  <div className="linha" style={{ justifyContent: "space-between" }}>
                    <strong>#{m.id}</strong>
                    <span className={`selo ${m.status === "aguardando_triagem" ? "azul" : m.status === "qualificando" ? "laranja" : ""}`}>
                      {SITUACAO[m.status] ?? m.status}
                    </span>
                  </div>
                  <div className="resumo">{m.texto_inicial}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}

function InfoLinha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <>
      <dt>{rotulo}</dt>
      <dd>{valor}</dd>
    </>
  );
}

function FormularioContingencia({
  campos,
  catalogo,
  aoEnviar,
}: {
  campos: CampoContingencia[];
  catalogo: Catalogo | null;
  aoEnviar: (campos: Record<string, string>) => Promise<void>;
}) {
  const [valores, setValores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const definir = (k: string, v: string) => setValores((atual) => ({ ...atual, [k]: v }));

  return (
    <div className="pilha">
      <div className="aviso atencao">
        <strong>O assistente está indisponível agora.</strong> Responda estas quatro perguntas e seu chamado segue para o suporte do mesmo jeito.
      </div>
      {campos.map((c) => (
        <div key={c.chave}>
          <label className="rotulo">{c.rotulo}</label>
          {c.tipo === "aplicacao" ? (
            <select className="campo" value={valores[c.chave] ?? ""} onChange={(e) => definir(c.chave, e.target.value)}>
              <option value="">Selecione…</option>
              {catalogo?.servicos.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.nome} ({a.apelidos})
                </option>
              ))}
              <option value="outra">Outro sistema / não sei</option>
            </select>
          ) : c.tipo === "abrangencia" ? (
            <select className="campo" value={valores[c.chave] ?? ""} onChange={(e) => definir(c.chave, e.target.value)}>
              <option value="">Selecione…</option>
              {ABRANGENCIA.map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          ) : (
            <input className="campo" value={valores[c.chave] ?? ""} onChange={(e) => definir(c.chave, e.target.value)} />
          )}
        </div>
      ))}
      <div className="linha" style={{ justifyContent: "flex-end" }}>
        <button
          className="botao"
          disabled={enviando}
          onClick={async () => {
            setEnviando(true);
            await aoEnviar(valores);
            setEnviando(false);
          }}
        >
          Registrar chamado
        </button>
      </div>
    </div>
  );
}
