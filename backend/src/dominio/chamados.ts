import { randomUUID } from "node:crypto";

import { db } from "../db/index.js";
import { hub, HubIndisponivel, type ResultadoTurno, type ToolCall } from "../hub/index.js";
import { aplicarRegras, LIMITE_REJEICOES, lerContrato, semSentido, TETO_PERGUNTAS, type Contrato } from "./contrato.js";
import { ErroApp } from "./erros.js";
import { avisarChamado, eventos, type FaseAgente } from "./eventos.js";
import type { Usuario } from "./usuarios.js";

export interface Chamado {
  id: number;
  empresa_id: string;
  solicitante_id: string;
  status: "qualificando" | "aguardando_triagem" | "triado" | "rejeitado";
  texto_inicial: string;
  hub_session_id: string | null;
  n_perguntas: number;
  /** Vezes seguidas que o agente considerou o pedido fora do escopo. */
  rejeicoes: number;
  resultado: Contrato | null;
  ajustes: string[];
  qualificado_sem_ia: boolean;
  tokens_input: number;
  tokens_output: number;
  latencia_ms: number;
  criado_em: string;
  enviado_em: string | null;
}

/** Campos do formulário curto usado quando o Hub não responde. */
export const CAMPOS_CONTINGENCIA = [
  { chave: "aplicacao", rotulo: "Em qual sistema está o problema?", tipo: "aplicacao" },
  { chave: "o_que_tentava", rotulo: "O que você estava tentando fazer?", tipo: "texto" },
  { chave: "o_que_apareceu", rotulo: "O que apareceu na tela?", tipo: "texto" },
  { chave: "abrangencia", rotulo: "Acontece só com você ou com outros colegas também?", tipo: "abrangencia" },
] as const;

/** Uma linha por chamada ao Hub no terminal do backend — é o que copiar quando algo der errado. */
function registrarNoConsole(sessaoExterna: string, r: ResultadoTurno) {
  const ferramentas = r.toolCalls.map((t) => `${t.tool}${t.isError ? "(ERRO)" : ""}`).join(",") || "-";
  const tokens = r.tokens ? `${r.tokens.input}+${r.tokens.output}` : "?";
  console.log(
    `[hub] ${sessaoExterna} · sessão Hub ${r.sessionId ?? "?"} · ${r.latenciaMs ?? "?"} ms · tokens ${tokens} · ferramentas ${ferramentas}` +
      (r.erros.length ? ` · ERROS ${r.erros.map((e) => e.code).join(",")}` : ""),
  );
}

const MENSAGEM_FORMATO =
  "[Sistema: sua última resposta não veio no formato JSON combinado. Reenvie somente o objeto JSON, sem texto antes ou depois.]";

async function carregar(id: number): Promise<Chamado> {
  const c = await db.one<Chamado>("select * from chamados where id = $1", [id]);
  if (!c) throw new ErroApp(404, "nao_encontrado", "Chamado não encontrado.");
  return c;
}

/** Solicitante só vê os próprios chamados; analista, os da sua empresa. */
export async function carregarComAcesso(usuario: Usuario, id: number): Promise<Chamado> {
  const c = await carregar(id);
  const permitido =
    usuario.perfil === "analista" ? c.empresa_id === usuario.empresa_id : c.solicitante_id === usuario.id;
  if (!permitido) throw new ErroApp(404, "nao_encontrado", "Chamado não encontrado.");
  return c;
}

export async function turnos(chamadoId: number) {
  return db.query(
    `select t.*, u.nome as autor from turnos t left join usuarios u on u.id = t.autor_id
     where t.chamado_id = $1 order by t.id`,
    [chamadoId],
  );
}

/** Tamanho máximo de uma mensagem do chat com o suporte. */
export const MAX_MENSAGEM = 2000;

const AVISO_FILA = "Seu chamado está com o suporte. Um atendente vai responder aqui mesmo, nesta conversa.";

const AVISO_REJEITADO =
  "Este pedido foi encerrado sem ir para o suporte. Se for um problema com um sistema, um acesso ou um equipamento, abra um novo chamado e conte o que aconteceu.";

const PECA_O_RELATO =
  "Não entendi o que aconteceu. Conte com suas palavras: qual sistema, o que você tentava fazer e o que apareceu.";

/** O agente terminou (ou o formulário curto foi preenchido): a partir daqui, a conversa é com o atendente. */
export async function avisarQueEntrouNaFila(chamadoId: number) {
  await db.query(`insert into turnos (chamado_id, papel, texto) values ($1, 'sistema', $2)`, [chamadoId, AVISO_FILA]);
}

async function filasDaEmpresa(empresaId: string) {
  return db.query<{ slug: string; nome: string }>("select slug, nome from filas where empresa_id = $1", [empresaId]);
}

const HOJE = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/**
 * Nota do sistema no fim de cada mensagem ao agente: a data de hoje (sem ela, o agente não avalia prazos e janelas,
 * como a de fechamento contábil) e quantas perguntas já foram feitas.
 */
export function notaDoSistema(perguntasFeitas: number, agora = new Date()) {
  const limite =
    perguntasFeitas >= TETO_PERGUNTAS
      ? ' Limite atingido: não faça mais perguntas; conclua com "pronto" ou "abstencao".'
      : "";
  return `[Sistema: hoje é ${HOJE.format(agora)}. Perguntas já feitas: ${perguntasFeitas} de ${TETO_PERGUNTAS}.${limite}]`;
}

const CABECALHO = {
  relato: "Relato inicial do solicitante:",
  novo_relato: "Novo relato do solicitante (a mensagem anterior estava fora do escopo):",
  resposta: "Resposta do solicitante:",
} as const;

function montarMensagem(tipo: keyof typeof CABECALHO, texto: string, perguntasFeitas: number) {
  const cabecalho = CABECALHO[tipo];
  return `${cabecalho}\n${texto}\n\n${notaDoSistema(perguntasFeitas)}`;
}

/** Chama o agente; se a resposta vier fora do formato, pede de novo uma vez na mesma sessão. */
async function chamarAgente(
  agenteId: string,
  mensagem: string,
  sessaoExterna: string,
  aoProgresso: (fase: FaseAgente) => void,
) {
  const primeiro = await hub.conversar({ agenteId, mensagem, sessaoExterna, aoProgresso });
  registrarNoConsole(sessaoExterna, primeiro);
  const lido = lerContrato(primeiro.texto);
  if (lido.ok) return { turnos: [primeiro], contrato: lido.contrato, erroFormato: null };

  console.warn(`[hub] ${sessaoExterna} resposta fora do formato (${lido.erro}); pedindo de novo`);
  aoProgresso({ fase: "tentando_de_novo" });
  const segundo = await hub.conversar({ agenteId, mensagem: MENSAGEM_FORMATO, sessaoExterna, aoProgresso });
  registrarNoConsole(sessaoExterna, segundo);
  const relido = lerContrato(segundo.texto);
  return {
    turnos: [primeiro, segundo],
    contrato: relido.ok ? relido.contrato : null,
    erroFormato: relido.ok ? null : relido.erro,
  };
}

/** Um turno completo: solicitante fala, agente responde, o app aplica as regras e grava tudo. */
async function rodarTurno(chamado: Chamado, mensagemAgente: string) {
  const empresa = await db.one<{ agente_id: string }>("select agente_id from empresas where id = $1", [chamado.empresa_id]);
  if (!empresa) throw new ErroApp(500, "empresa", "Empresa sem agente configurado.");

  // ID externo fixo do chamado: é ele que mantém a conversa na mesma sessão do Hub.
  // A empresa vai no ID: com uma conta só no Hub, as sessões de todas as empresas aparecem juntas em Monitorar → Sessões.
  const sessaoExterna = chamado.hub_session_id ?? `chamado-${chamado.empresa_id}-${chamado.id}-${randomUUID()}`;
  if (!chamado.hub_session_id) {
    await db.query("update chamados set hub_session_id = $2 where id = $1", [chamado.id, sessaoExterna]);
  }

  // Progresso ao vivo para o solicitante. Os eventos `content` chegam aos montes: só repassa quando a fase muda.
  let ultimaFase = "";
  const aoProgresso = (fase: FaseAgente) => {
    const chave = fase.fase === "consultando" ? `${fase.fase}:${fase.ferramenta}` : fase.fase;
    if (chave === ultimaFase) return;
    ultimaFase = chave;
    eventos.emit("agente", { chamadoId: chamado.id, solicitanteId: chamado.solicitante_id, ...fase });
  };

  let resposta: Awaited<ReturnType<typeof chamarAgente>>;
  aoProgresso({ fase: "pensando" });
  try {
    // Empresa ainda sem agente (em implantação): vira o formulário curto, e o chamado não se perde.
    if (!empresa.agente_id) {
      throw new HubIndisponivel("Empresa sem agente configurado", null, `npm run definir-agente -- ${chamado.empresa_id} <uuid>`);
    }
    resposta = await chamarAgente(empresa.agente_id, mensagemAgente, sessaoExterna, aoProgresso);
  } catch (erro) {
    aoProgresso({ fase: "concluido" });
    if (erro instanceof HubIndisponivel) {
      await db.query(
        `insert into turnos (chamado_id, papel, texto, bruto) values ($1, 'sistema', $2, $3)`,
        [chamado.id, "Assistente indisponível: oferecido o formulário curto.", `${erro.message} ${erro.detalhe}`.trim()],
      );
      avisarChamado(chamado);
      throw new ErroApp(503, "hub_indisponivel", "O assistente está indisponível agora. Preencha o formulário curto e seu chamado não se perde.", {
        chamadoId: chamado.id,
        campos: CAMPOS_CONTINGENCIA,
      });
    }
    throw erro;
  }
  aoProgresso({ fase: "concluido" });

  const toolCalls = resposta.turnos.flatMap((t: ResultadoTurno) => t.toolCalls);
  const anteriores = (
    await db.query<{ tool_calls: ToolCall[] }>(
      "select tool_calls from turnos where chamado_id = $1 and papel = 'agente' order by id",
      [chamado.id],
    )
  ).flatMap((t) => t.tool_calls);
  const sessaoHub = resposta.turnos.at(-1)?.sessionId ?? null;
  const tokensIn = resposta.turnos.reduce((s, t) => s + (t.tokens?.input ?? 0), 0);
  const tokensOut = resposta.turnos.reduce((s, t) => s + (t.tokens?.output ?? 0), 0);
  const latencia = resposta.turnos.reduce((s, t) => s + (t.latenciaMs ?? 0), 0);
  const bruto = resposta.turnos.map((t) => t.texto).join("\n\n--- nova tentativa ---\n\n");

  let contrato: Contrato;
  const ajustes: string[] = [];
  if (resposta.contrato) {
    const filas = await filasDaEmpresa(chamado.empresa_id);
    const r = aplicarRegras(resposta.contrato, {
      perguntasAntes: chamado.n_perguntas,
      toolCalls: [...anteriores, ...toolCalls],
      filasValidas: filas.map((f) => f.slug),
      nomesFilas: filas.flatMap((f) => [f.slug, f.nome]),
    });
    contrato = r.contrato;
    ajustes.push(...r.ajustes);
  } else {
    ajustes.push(`Resposta do agente fora do formato mesmo após nova tentativa (${resposta.erroFormato}).`);
    contrato = {
      mensagem_ao_usuario:
        "Obrigado! Já registrei o que você contou. Um analista do suporte vai revisar e encaminhar seu chamado.",
      status: "abstencao",
      aplicacao: null,
      categoria: null,
      informacoes: {},
      lacunas: [],
      discriminadores_sem_resposta: [],
      fila_sugerida: null,
      confianca: 0,
      duvida: "O agente respondeu fora do formato; a qualificação precisa ser feita pelo analista.",
      resumo: chamado.texto_inicial,
    };
  }
  if (resposta.turnos.length > 1) ajustes.push("O agente precisou de uma segunda tentativa para responder no formato.");
  for (const t of resposta.turnos) {
    for (const e of t.erros) ajustes.push(`Erro reportado pelo Hub: ${e.code} — ${e.mensagem}${e.runId ? ` (run ${e.runId})` : ""}`);
    for (const a of t.avisos) ajustes.push(`Aviso do Hub: ${a}`);
  }

  await db.query(
    `insert into turnos (chamado_id, papel, texto, bruto, tool_calls, tokens_input, tokens_output, latencia_ms, hub_sessao)
     values ($1, 'agente', $2, $3, $4, $5, $6, $7, $8)`,
    [chamado.id, contrato.mensagem_ao_usuario, bruto, JSON.stringify(toolCalls), tokensIn, tokensOut, latencia, sessaoHub],
  );

  const perguntou = contrato.status === "perguntando";
  // Fora do escopo: na primeira vez, o solicitante pode descrever de novo; na segunda seguida, o pedido é encerrado
  // sem ir para a fila. O que é chamado de verdade e o agente não soube qualificar é abstenção, e vai para o analista.
  const rejeitou = contrato.status === "fora_do_escopo";
  const encerrou = rejeitou && chamado.rejeicoes + 1 >= LIMITE_REJEICOES;
  // Sem passo de envio: quando o agente conclui, o chamado já entra na fila e o atendente assume o chat.
  const novoStatus = encerrou ? "rejeitado" : perguntou || rejeitou ? "qualificando" : "aguardando_triagem";

  await db.query(
    `update chamados set
       resultado = $2, ajustes = ajustes || $3::jsonb,
       n_perguntas = n_perguntas + $4, status = $5,
       tokens_input = tokens_input + $6, tokens_output = tokens_output + $7, latencia_ms = latencia_ms + $8,
       rejeicoes = case when $9 then rejeicoes + 1 else 0 end,
       enviado_em = case when $5 = 'aguardando_triagem' then now() else enviado_em end,
       atualizado_em = now()
     where id = $1`,
    [chamado.id, JSON.stringify(contrato), JSON.stringify(ajustes), perguntou ? 1 : 0, novoStatus, tokensIn, tokensOut, latencia, rejeitou],
  );
  if (novoStatus === "aguardando_triagem") await avisarQueEntrouNaFila(chamado.id);
  if (novoStatus === "rejeitado") {
    await db.query(`insert into turnos (chamado_id, papel, texto) values ($1, 'sistema', $2)`, [chamado.id, AVISO_REJEITADO]);
  }

  avisarChamado(chamado);
  return carregar(chamado.id);
}

export async function abrirChamado(usuario: Usuario, texto: string) {
  if (usuario.perfil !== "solicitante") throw new ErroApp(403, "perfil", "Só solicitantes abrem chamados.");
  const relato = texto.trim();
  if (relato.length < 5) throw new ErroApp(400, "relato_curto", "Conte um pouco mais sobre o que está acontecendo.");
  // Sem letras, não há o que qualificar: recusa antes de abrir o chamado e de gastar o agente.
  if (semSentido(relato)) throw new ErroApp(400, "relato_sem_sentido", PECA_O_RELATO);

  const novo = await db.one<Chamado>(
    `insert into chamados (empresa_id, solicitante_id, status, texto_inicial) values ($1, $2, 'qualificando', $3) returning *`,
    [usuario.empresa_id, usuario.id, relato],
  );
  await db.query(`insert into turnos (chamado_id, papel, texto) values ($1, 'solicitante', $2)`, [novo!.id, relato]);
  avisarChamado(novo!);
  return rodarTurno(novo!, montarMensagem("relato", relato, 0));
}

/** Responder ao assistente e preencher o formulário curto é do dono do chamado, não do suporte. */
function exigirSolicitante(usuario: Usuario) {
  if (usuario.perfil !== "solicitante") throw new ErroApp(403, "perfil", "Só o solicitante responde ao assistente.");
}

export async function responder(usuario: Usuario, id: number, texto: string) {
  exigirSolicitante(usuario);
  const chamado = await carregarComAcesso(usuario, id);
  if (chamado.status !== "qualificando") throw new ErroApp(409, "fora_de_fluxo", "Este chamado não está mais esperando resposta.");
  const resposta = texto.trim();
  if (!resposta) throw new ErroApp(400, "vazio", "Escreva uma resposta.");
  // Depois de uma rejeição, a mensagem é um relato novo, e vale a mesma checagem da abertura.
  // Respostas às perguntas do agente ("sim", "2") podem ser curtas.
  const novoRelato = chamado.resultado?.status === "fora_do_escopo";
  if (novoRelato && semSentido(resposta)) throw new ErroApp(400, "relato_sem_sentido", PECA_O_RELATO);

  await db.query(`insert into turnos (chamado_id, papel, texto) values ($1, 'solicitante', $2)`, [id, resposta]);
  avisarChamado(chamado);
  return rodarTurno(chamado, montarMensagem(novoRelato ? "novo_relato" : "resposta", resposta, chamado.n_perguntas));
}

/**
 * Mensagem no chat do chamado depois que o agente concluiu: o solicitante e os atendentes (analistas da empresa)
 * conversam na mesma conversa em que o agente qualificou. O agente não participa mais.
 */
export async function enviarMensagem(usuario: Usuario, id: number, texto: string) {
  const chamado = await carregarComAcesso(usuario, id);
  if (chamado.status === "qualificando") {
    throw new ErroApp(409, "fora_de_fluxo", "O assistente ainda está qualificando este chamado.");
  }
  if (chamado.status === "rejeitado") {
    throw new ErroApp(409, "fora_de_fluxo", "Este pedido foi encerrado sem ir para o suporte. Abra um novo chamado.");
  }
  const mensagem = texto.trim();
  if (!mensagem) throw new ErroApp(400, "vazio", "Escreva uma mensagem.");
  if (mensagem.length > MAX_MENSAGEM) throw new ErroApp(400, "longa", `A mensagem passa de ${MAX_MENSAGEM} caracteres.`);

  await db.query(`insert into turnos (chamado_id, papel, texto, autor_id) values ($1, $2, $3, $4)`, [
    id,
    usuario.perfil,
    mensagem,
    usuario.id,
  ]);
  await db.query("update chamados set atualizado_em = now() where id = $1", [id]);
  avisarChamado(chamado);
  return carregar(id);
}

export async function contingencia(usuario: Usuario, id: number, campos: Record<string, string>) {
  exigirSolicitante(usuario);
  const chamado = await carregarComAcesso(usuario, id);
  if (chamado.status !== "qualificando") {
    throw new ErroApp(409, "fora_de_fluxo", chamado.status === "rejeitado" ? "Este pedido foi encerrado. Abra um novo chamado." : "Este chamado já foi enviado.");
  }
  const informacoes = Object.fromEntries(CAMPOS_CONTINGENCIA.map((c) => [c.chave, (campos[c.chave] ?? "").trim() || null]));
  const resultado: Contrato = {
    mensagem_ao_usuario: "Chamado registrado pelo formulário curto.",
    status: "abstencao",
    aplicacao: informacoes.aplicacao,
    categoria: null,
    informacoes,
    lacunas: CAMPOS_CONTINGENCIA.filter((c) => !informacoes[c.chave]).map((c) => c.chave),
    discriminadores_sem_resposta: [],
    fila_sugerida: null,
    confianca: 0,
    duvida: "Qualificado sem IA: o assistente estava indisponível.",
    resumo: chamado.texto_inicial,
  };
  await db.query(
    `update chamados set status = 'aguardando_triagem', qualificado_sem_ia = true, resultado = $2,
       ajustes = ajustes || $3::jsonb, enviado_em = now(), atualizado_em = now()
     where id = $1`,
    [id, JSON.stringify(resultado), JSON.stringify(["Chamado qualificado pelo formulário de contingência (Hub indisponível)."])],
  );
  await db.query(`insert into turnos (chamado_id, papel, texto) values ($1, 'sistema', $2)`, [
    id,
    `Formulário curto preenchido: ${JSON.stringify(informacoes)}`,
  ]);
  await avisarQueEntrouNaFila(id);
  avisarChamado(chamado);
  return carregar(id);
}

export async function meusChamados(usuario: Usuario) {
  return db.query(
    `select id, status, texto_inicial, criado_em, enviado_em, resultado->>'status' as resultado_status
     from chamados where solicitante_id = $1 order by id desc limit 20`,
    [usuario.id],
  );
}
