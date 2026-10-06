"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Cabecalho, useSessao, VerificandoSessao } from "@/components/Cabecalho";
import { Conversa } from "@/components/Conversa";
import { api, type Catalogo, type Chamado, type ToolCall, type Turno } from "@/lib/api";
import { camposInformados } from "@/lib/informacoes";
import { pedir, useTempoReal, type SocketChamados } from "@/lib/tempo-real/socket";
import type { EstadoChamado } from "@/lib/tempo-real/tipos";

/** Mesmo limite do backend (`MAX_MENSAGEM` em `dominio/chamados.ts`). */
const MAX_MENSAGEM = 2000;

interface ItemFila {
  id: number;
  status: Chamado["status"];
  texto_inicial: string;
  enviado_em: string | null;
  atualizado_em: string;
  qualificado_sem_ia: boolean;
  resultado_status: string | null;
  fila_sugerida: string | null;
  confianca: number | null;
  resumo: string | null;
  solicitante: string;
  fila_final: string | null;
  corrigiu: boolean | null;
}

interface Detalhe {
  chamado: Chamado;
  solicitante: string;
  turnos: Turno[];
  triagem: { fila_final: string; corrigiu: boolean; motivo: string | null; criado_em: string } | null;
}

/**
 * Ferramentas que consultam o contexto: conector CSV (`read_file_…`), conector PostgreSQL (`run_query_…`, `postgres_aurora_query`)
 * ou API do backend (`obterContexto`). Mesma regra de `eFerramentaDeCatalogo` em `backend/src/dominio/contrato.ts`.
 */
const eCatalogo = (nome: string) =>
  /^(list_files|describe_file|query_file|read_file)_/.test(nome) ||
  /^(show_tables|describe_table|summarize_table|inspect_query|run_query)(_|$)/.test(nome) ||
  /^postgres_[a-z0-9_]+$/.test(nome) ||
  /(obter_?contexto|obter_?categoria|buscar_?(aplicacao|servico)|listar_?chamados_?abertos)/i.test(nome);

const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

interface GrupoFila {
  /** `null`: sem fila definida (abstenção, segurança ou formulário curto ainda não triados). */
  slug: string | null;
  itens: ItemFila[];
  pendentes: number;
  triados: number;
}

/**
 * Agrupa os chats pela fila: a encaminhada, depois da triagem; antes dela, a sugerida pelo agente com confiança.
 * "Sem fila definida" vem primeiro (é o que mais precisa do atendente); as outras seguem a ordem do catálogo.
 * Dentro de cada grupo, a ordem da fila do backend (pendentes primeiro) se mantém.
 */
function agruparPorFila(fila: ItemFila[], catalogo: Catalogo | null): GrupoFila[] {
  const grupos = new Map<string | null, GrupoFila>();
  for (const f of fila) {
    const slug = f.fila_final ?? (f.resultado_status === "pronto" ? f.fila_sugerida : null);
    const g = grupos.get(slug) ?? { slug, itens: [], pendentes: 0, triados: 0 };
    g.itens.push(f);
    if (f.status === "triado") g.triados++;
    else g.pendentes++;
    grupos.set(slug, g);
  }
  const ordem = (slug: string | null) => {
    if (slug === null) return -1;
    const i = catalogo?.filas.findIndex((f) => f.slug === slug) ?? -1;
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...grupos.values()].sort((a, b) => ordem(a.slug) - ordem(b.slug));
}

function SeloSituacao({ item }: { item: Pick<ItemFila, "status" | "resultado_status" | "qualificado_sem_ia" | "corrigiu"> }) {
  if (item.status === "rejeitado") return <span className="selo">Rejeitado</span>;
  if (item.status === "triado") return <span className="selo">{item.corrigiu ? "Triado · corrigido" : "Triado · confirmado"}</span>;
  if (item.resultado_status === "seguranca") return <span className="selo vermelho">Segurança</span>;
  if (item.qualificado_sem_ia) return <span className="selo">Sem IA</span>;
  if (item.resultado_status === "abstencao") return <span className="selo laranja">IA se absteve</span>;
  return <span className="selo verde">Fila sugerida</span>;
}

export default function Triagem() {
  const { usuario, erro: erroSessao } = useSessao("analista");
  const { socket, conectado } = useTempoReal(usuario?.id ?? null);
  const [fila, setFila] = useState<ItemFila[]>([]);
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const selecionadoRef = useRef<number | null>(null);

  const carregarFila = useCallback(() => {
    api<ItemFila[]>("/triagem")
      .then(setFila)
      .catch((e) => setErro((e as Error).message));
  }, []);

  useEffect(() => {
    if (!usuario) return;
    api<Catalogo>("/catalogo").then(setCatalogo).catch(() => undefined);
  }, [usuario]);

  // A fila chega por push no WebSocket. Ao conectar e a cada reconexão, busca pela API o que pode ter mudado enquanto estava fora.
  useEffect(() => {
    if (!socket) return;
    const aoFila = (novaFila: unknown[]) => setFila(novaFila as ItemFila[]);
    const aoChamado = ({ chamadoId }: { chamadoId: number }) => {
      if (chamadoId !== selecionadoRef.current) return;
      api<Detalhe>(`/triagem/${chamadoId}`).then(setDetalhe).catch(() => undefined);
    };
    socket.on("triagem:fila", aoFila);
    socket.on("triagem:chamado", aoChamado);
    socket.io.on("reconnect", carregarFila);
    carregarFila();
    return () => {
      socket.off("triagem:fila", aoFila);
      socket.off("triagem:chamado", aoChamado);
      socket.io.off("reconnect", carregarFila);
    };
  }, [socket, carregarFila]);

  useEffect(() => {
    selecionadoRef.current = selecionado;
    if (selecionado === null) return;
    api<Detalhe>(`/triagem/${selecionado}`).then(setDetalhe).catch((e) => setErro(e.message));
  }, [selecionado]);

  function selecionar(id: number) {
    if (id === selecionado) return;
    setDetalhe(null);
    setSelecionado(id);
  }

  const nomeFila = (slug: string | null) => catalogo?.filas.find((f) => f.slug === slug)?.nome ?? slug ?? "—";
  const pendentes = fila.filter((f) => f.status === "aguardando_triagem").length;
  // Rejeitados (fora do escopo) ficam à parte: não são trabalho da fila, mas o analista confere e pode trazer de volta.
  const naFila = fila.filter((f) => f.status !== "rejeitado");
  const rejeitados = fila.filter((f) => f.status === "rejeitado");
  const item = (f: ItemFila, semFila: boolean) => (
    <button key={f.id} className={`item-fila ${selecionado === f.id ? "ativo" : ""}`} onClick={() => selecionar(f.id)}>
      <div className="linha" style={{ justifyContent: "space-between" }}>
        <strong>#{f.id}</strong>
        <SeloSituacao item={f} />
      </div>
      <div className="resumo">{f.resumo || f.texto_inicial}</div>
      <div className="suave">
        {f.solicitante} · {hora(f.enviado_em ?? f.atualizado_em)}
        {semFila && f.fila_sugerida ? ` · candidata ${nomeFila(f.fila_sugerida)}` : ""}
      </div>
    </button>
  );
  // Nada da tela aparece antes de a sessão ser conferida (e do perfil certo).
  if (!usuario) return <VerificandoSessao erro={erroSessao} />;

  return (
    <>
      <Cabecalho usuario={usuario} conectado={usuario ? conectado : undefined} />
      <main className="conteudo">
        <div className="pilha">
          <div className="linha" style={{ justifyContent: "space-between" }}>
            <h1>Triagem</h1>
            <span className="suave">
              {pendentes} aguardando · {conectado ? "a lista atualiza em tempo real" : "reconectando…"}
            </span>
          </div>
          {erro && <div className="aviso erro">{erro}</div>}

          <div className="triagem">
            <div className="pilha">
              {naFila.length === 0 && <div className="cartao suave">Nenhum chamado enviado ainda.</div>}
              {agruparPorFila(naFila, catalogo).map((g) => (
                <details key={g.slug ?? "sem-fila"} open className="flex flex-col gap-2">
                  <summary
                    className={`flex cursor-pointer list-none items-baseline justify-between gap-2 border-l-[3px] py-1.5 pl-2.5 font-titulo text-[15px] font-semibold [&::-webkit-details-marker]:hidden ${
                      g.slug ? "border-laranja" : "border-cinza"
                    }`}
                  >
                    <span>{g.slug ? nomeFila(g.slug) : "Sem fila definida"}</span>
                    <span className="suave whitespace-nowrap font-sans text-xs font-normal">
                      {[g.pendentes && `${g.pendentes} aguardando`, g.triados && `${g.triados} triado${g.triados > 1 ? "s" : ""}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </summary>
                  <div className="pilha mt-2" style={{ gap: 8 }}>
                    {g.itens.map((f) => item(f, !g.slug))}
                  </div>
                </details>
              ))}
              {rejeitados.length > 0 && (
                <details className="flex flex-col gap-2">
                  <summary className="flex cursor-pointer list-none items-baseline justify-between gap-2 border-l-[3px] border-cinza py-1.5 pl-2.5 font-titulo text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
                    <span>Rejeitados pelo assistente</span>
                    <span className="suave whitespace-nowrap font-sans text-xs font-normal">{rejeitados.length} fora do escopo</span>
                  </summary>
                  <p className="suave mt-2">Não foram para a fila. Confira se nenhum é chamado de verdade: dá para trazer de volta.</p>
                  <div className="pilha mt-2" style={{ gap: 8 }}>
                    {rejeitados.map((f) => item(f, false))}
                  </div>
                </details>
              )}
            </div>

            <div>
              {!selecionado && <div className="cartao suave">Selecione um chamado para revisar.</div>}
              {selecionado && !detalhe && <div className="cartao suave">Carregando…</div>}
              {detalhe && (
                <PainelDetalhe
                  key={detalhe.chamado.id}
                  detalhe={detalhe}
                  catalogo={catalogo}
                  nomeFila={nomeFila}
                  socket={socket}
                  aoConversar={(novo) =>
                    setDetalhe((atual) =>
                      atual && atual.chamado.id === novo.chamado.id && novo.turnos.length >= atual.turnos.length
                        ? { ...atual, chamado: novo.chamado, turnos: novo.turnos }
                        : atual,
                    )
                  }
                  aoDecidir={async (acao) => {
                    setErro(null);
                    try {
                      // A fila atualiza pelo push do WebSocket; o detalhe vem na resposta da própria decisão.
                      setDetalhe(await acao());
                    } catch (e) {
                      setErro((e as Error).message);
                    }
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

function PainelDetalhe({
  detalhe,
  catalogo,
  nomeFila,
  socket,
  aoDecidir,
  aoConversar,
}: {
  detalhe: Detalhe;
  catalogo: Catalogo | null;
  nomeFila: (slug: string | null) => string;
  socket: SocketChamados | null;
  aoDecidir: (acao: () => Promise<Detalhe>) => Promise<void>;
  aoConversar: (estado: EstadoChamado) => void;
}) {
  const { chamado, turnos, triagem } = detalhe;
  const r = chamado.resultado;
  const [fila, setFila] = useState(r?.fila_sugerida ?? "");
  const [motivo, setMotivo] = useState("");
  const [texto, setTexto] = useState("");
  const [pendente, setPendente] = useState<string | null>(null);
  const [erroMensagem, setErroMensagem] = useState<string | null>(null);

  /** Resposta do atendente no mesmo chat em que o agente qualificou; o solicitante recebe pelo WebSocket. */
  async function responder() {
    const mensagem = texto.trim();
    if (!mensagem || pendente || !socket) return;
    setErroMensagem(null);
    setPendente(mensagem);
    setTexto("");
    try {
      aoConversar(await pedir(socket, "chamado:mensagem", { chamadoId: chamado.id, texto: mensagem }));
    } catch (e) {
      setErroMensagem((e as Error).message);
      setTexto(mensagem);
    } finally {
      setPendente(null);
    }
  }
  const ferramentas = turnos.flatMap((t) => t.tool_calls ?? []);
  const consultas = ferramentas.filter((c) => eCatalogo(c.tool));
  const outras = ferramentas.filter((c) => !eCatalogo(c.tool));
  const confianca = Math.round((r?.confianca ?? 0) * 100);
  const podeConfirmar = r?.status === "pronto" && !!r.fila_sugerida;
  const rejeitado = chamado.status === "rejeitado";
  const nomeApp = (slug: string | null) => catalogo?.servicos.find((a) => a.slug === slug)?.nome ?? slug ?? "—";

  return (
    <div className="cartao pilha">
      <div className="linha" style={{ justifyContent: "space-between" }}>
        <h2>Chamado #{chamado.id}</h2>
        <span className="suave">
          {detalhe.solicitante} · enviado {hora(chamado.enviado_em)}
        </span>
      </div>

      <section className="secao">
        <h3>Sugestão do agente</h3>
        {r?.status === "pronto" && (
          <div className="linha">
            <span className="selo verde">{nomeFila(r.fila_sugerida)}</span>
            <div className="barra" title={`Confiança ${confianca}%`}>
              <span style={{ width: `${confianca}%`, background: confianca >= 70 ? "var(--verde)" : "var(--amarelo)" }} />
            </div>
            <span className="suave">confiança {confianca}%</span>
          </div>
        )}
        {r?.status === "abstencao" && (
          <div className="aviso atencao">
            <strong>{chamado.qualificado_sem_ia ? "Qualificado sem IA." : "O agente se absteve de sugerir a fila."}</strong>{" "}
            {r.duvida}
            {r.fila_sugerida && <> · Candidata: {nomeFila(r.fila_sugerida)} ({confianca}%)</>}
          </div>
        )}
        {r?.status === "seguranca" && <div className="aviso erro">Possível incidente de segurança. {r.resumo}</div>}
        {r?.status === "fora_do_escopo" && (
          <div className="aviso atencao">
            <strong>O assistente considerou o pedido fora do escopo do suporte</strong>
            {rejeitado ? " e o encerrou sem enviar para a fila." : "."} {r.duvida && <>Motivo: {r.duvida}</>}
          </div>
        )}
      </section>

      <section className="secao">
        <h3>Chamado</h3>
        <dl className="grade">
          <dt>Resumo</dt>
          <dd>{r?.resumo || chamado.texto_inicial}</dd>
          <dt>Relato original</dt>
          <dd>{chamado.texto_inicial}</dd>
          <dt>Sistema</dt>
          <dd>{nomeApp(r?.aplicacao ?? null)}</dd>
          <dt>Categoria</dt>
          <dd>{r?.categoria ?? "—"}</dd>
          {camposInformados(r?.informacoes).map(([rotulo, valor]) => (
            <Info key={rotulo} rotulo={rotulo} valor={valor} />
          ))}
          {!!r?.lacunas?.length && (
            <>
              <dt>Ficou faltando</dt>
              <dd>{r.lacunas.join(", ")}</dd>
            </>
          )}
          <dt>Perguntas feitas</dt>
          <dd>{chamado.n_perguntas}</dd>
        </dl>
      </section>

      <section className="secao">
        <h3>Conversa com o solicitante</h3>
        <p className="suave">
          {rejeitado
            ? "A conversa foi encerrada. Se trouxer o pedido de volta para a fila, você responde aqui mesmo."
            : "O assistente qualificou o chamado nesta conversa. Daqui em diante, você responde aqui mesmo e o solicitante vê na hora."}
        </p>
        <div className="chat" style={{ minHeight: 0 }}>
          <Conversa turnos={turnos} visao="analista" />
          {pendente && <div className="bolha analista propria">{pendente}</div>}
        </div>
        {!rejeitado && (
          <div className="pilha" style={{ marginTop: 12 }}>
            <textarea
              className="campo"
              rows={2}
              maxLength={MAX_MENSAGEM}
              placeholder={`Responder para ${detalhe.solicitante}…`}
              value={texto}
              disabled={!!pendente}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  responder();
                }
              }}
            />
            {erroMensagem && <div className="aviso erro">{erroMensagem}</div>}
            <div className="linha" style={{ justifyContent: "space-between" }}>
              <span className="suave">{socket ? "Enter envia · Shift+Enter quebra linha" : "Sem conexão em tempo real. Tentando reconectar…"}</span>
              <button className="botao" onClick={responder} disabled={!texto.trim() || !!pendente || !socket}>
                Enviar
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="secao">
        <h3>Decisão</h3>
        {triagem ? (
          <div className="aviso ok">
            Encaminhado para <strong>{nomeFila(triagem.fila_final)}</strong>
            {triagem.corrigiu ? " (corrigido pelo analista)" : " (sugestão confirmada)"}
            {triagem.motivo && <> — {triagem.motivo}</>}
          </div>
        ) : rejeitado ? (
          <div className="pilha">
            <p className="suave">Se for um chamado de verdade, traga de volta: ele entra na fila como abstenção, e você escolhe a fila.</p>
            <button
              className="botao secundario"
              onClick={() => aoDecidir(() => api<Detalhe>(`/triagem/${chamado.id}/resgatar`, { corpo: {} }))}
            >
              Mandar para a fila
            </button>
          </div>
        ) : (
          <div className="pilha">
            {podeConfirmar && (
              <button
                className="botao"
                onClick={() => aoDecidir(() => api<Detalhe>(`/triagem/${chamado.id}/confirmar`, { corpo: {} }))}
              >
                Confirmar: {nomeFila(r!.fila_sugerida)}
              </button>
            )}
            <div className="linha">
              <select className="campo" style={{ flex: "1 1 220px" }} value={fila} onChange={(e) => setFila(e.target.value)}>
                <option value="">Escolha a fila…</option>
                {catalogo?.filas.map((f) => (
                  <option key={f.slug} value={f.slug}>
                    {f.nome}
                  </option>
                ))}
              </select>
              <input
                className="campo"
                style={{ flex: "2 1 280px" }}
                placeholder="Por que esta é a fila certa? (uma frase)"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
              <button
                className="botao secundario"
                disabled={!fila || !motivo.trim()}
                onClick={() => aoDecidir(() => api<Detalhe>(`/triagem/${chamado.id}/corrigir`, { corpo: { fila, motivo } }))}
              >
                {podeConfirmar ? "Corrigir e encaminhar" : "Encaminhar"}
              </button>
            </div>
          </div>
        )}
      </section>

      {chamado.ajustes.length > 0 && (
        <section className="secao">
          <h3>O que o app ajustou</h3>
          <ul>
            {chamado.ajustes.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="secao">
        <h3>Consultas do agente ao catálogo ({consultas.length})</h3>
        {consultas.length === 0 && <p className="suave">O agente não consultou o catálogo neste chamado.</p>}
        <div className="pilha" style={{ gap: 6 }}>
          {consultas.map((c, i) => (
            <Consulta key={i} c={c} />
          ))}
        </div>
      </section>

      {outras.length > 0 && (
        <section className="secao">
          <h3>Outras ferramentas do agente ({outras.length})</h3>
          <p className="suave">
            Não são consultas ao catálogo. <code>log_decision</code> e semelhantes vêm do Aprendizado do agente, que grava memória entre conversas.
          </p>
          <div className="pilha" style={{ gap: 6 }}>
            {outras.map((c, i) => (
              <Consulta key={i} c={c} />
            ))}
          </div>
        </section>
      )}

      <p className="suave">
        Agente: {chamado.tokens_input + chamado.tokens_output} tokens · {(chamado.latencia_ms / 1000).toFixed(1)} s
      </p>
    </div>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <>
      <dt>{rotulo}</dt>
      <dd>{valor}</dd>
    </>
  );
}

function Consulta({ c }: { c: ToolCall }) {
  const texto = (v: unknown) => {
    if (typeof v !== "string") return JSON.stringify(v, null, 2);
    try {
      return JSON.stringify(JSON.parse(v), null, 2);
    } catch {
      return v;
    }
  };
  return (
    <details className={`consulta ${c.isError ? "falhou" : ""}`}>
      <summary style={{ cursor: "pointer" }}>
        <code>{c.tool}</code> {c.isError ? <span className="selo vermelho">falhou</span> : <span className="selo verde">ok</span>}{" "}
        {c.latencyMs !== null && <span className="suave">{c.latencyMs} ms</span>}
      </summary>
      <div className="suave">Argumentos</div>
      <pre>{texto(c.arguments)}</pre>
      <div className="suave">Resultado</div>
      <pre>{texto(c.result)}</pre>
    </details>
  );
}
