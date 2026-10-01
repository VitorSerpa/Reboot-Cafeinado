import { z } from "zod";

import type { ToolCall } from "../hub/tipos.js";

export const MENSAGEM_PRONTO =
  "Obrigado! Já tenho o que o suporte precisa. Seu chamado vai para a revisão de um analista.";

/**
 * Ferramentas que consultam o contexto da empresa:
 * - conector CSV: `list_files_<slug>`, `describe_file_<slug>`, `query_file_<slug>`, `read_file_<slug>`;
 * - conector PostgreSQL (Agno): `show_tables`, `describe_table`, `summarize_table`, `inspect_query`, `run_query`, com ou sem `_<slug>`;
 * - conector Database do Hub: `postgres_<slug>_<operação>` (ex.: `postgres_aurora_query`);
 * - conector API REST do backend: as operações do OpenAPI (`obterContexto` etc.), com ou sem prefixo, em camelCase ou snake_case.
 */
export const eFerramentaDeCatalogo = (nome: string) =>
  /^(list_files|describe_file|query_file|read_file)_/.test(nome) ||
  /^(show_tables|describe_table|summarize_table|inspect_query|run_query)(_|$)/.test(nome) ||
  /^postgres_[a-z0-9_]+$/.test(nome) ||
  /(obter_?contexto|obter_?categoria|buscar_?aplicacao|listar_?chamados_?abertos)/i.test(nome);

const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export const TETO_PERGUNTAS = 3;
export const LIMIAR_CONFIANCA = 0.7;
/** Com discriminador sem resposta, a confiança não passa disto (força abstenção). */
export const TETO_SEM_DISCRIMINADOR = 0.6;

const textoOuNulo = z.string().nullish().transform((v) => (v && v.trim() ? v.trim() : null));

/** Contrato de saída do agente (§3.6 do plano principal). Tolerante a campos ausentes. */
export const ContratoAgente = z.object({
  mensagem_ao_usuario: z.string().min(1),
  status: z.enum(["perguntando", "pronto", "abstencao", "seguranca"]),
  aplicacao: textoOuNulo,
  categoria: textoOuNulo,
  informacoes: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
  lacunas: z.array(z.string()).nullish().transform((v) => v ?? []),
  discriminadores_sem_resposta: z.array(z.string()).nullish().transform((v) => v ?? []),
  fila_sugerida: textoOuNulo,
  confianca: z.coerce.number().min(0).max(1).catch(0),
  duvida: textoOuNulo,
  resumo: z.string().nullish().transform((v) => v ?? ""),
});

export type Contrato = z.output<typeof ContratoAgente>;

/** Tira cerca de código e texto em volta, e devolve o primeiro objeto JSON do texto. */
export function extrairJson(texto: string): unknown {
  const semCerca = texto.replace(/```(?:json)?/gi, "").trim();
  const inicio = semCerca.indexOf("{");
  const fim = semCerca.lastIndexOf("}");
  if (inicio < 0 || fim <= inicio) throw new Error("sem objeto JSON na resposta");
  return JSON.parse(semCerca.slice(inicio, fim + 1));
}

export function lerContrato(texto: string): { ok: true; contrato: Contrato } | { ok: false; erro: string } {
  try {
    const parse = ContratoAgente.safeParse(extrairJson(texto));
    if (!parse.success) {
      return { ok: false, erro: parse.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    }
    return { ok: true, contrato: parse.data };
  } catch (erro) {
    return { ok: false, erro: (erro as Error).message };
  }
}

export interface ContextoRegras {
  /** Perguntas que o agente já tinha feito antes deste turno. */
  perguntasAntes: number;
  /** Todas as chamadas de ferramenta do chamado, em ordem (turnos anteriores + este). */
  toolCalls: ToolCall[];
  filasValidas: string[];
  /** Slugs e nomes das filas, para detectar quando o agente revela a fila ao solicitante. */
  nomesFilas?: string[];
}

/**
 * Regras que o app aplica por cima da resposta do agente — o agente sugere, o app garante.
 * Devolve o contrato ajustado e a lista de ajustes, que a triagem mostra ao analista.
 */
export function aplicarRegras(original: Contrato, ctx: ContextoRegras): { contrato: Contrato; ajustes: string[] } {
  const c: Contrato = { ...original };
  const ajustes: string[] = [];

  const abster = (motivo: string, duvida?: string) => {
    if (c.status !== "abstencao") ajustes.push(motivo);
    c.status = "abstencao";
    if (!c.duvida) c.duvida = duvida ?? motivo;
    c.mensagem_ao_usuario =
      "Obrigado! Já registrei o que você contou. Um analista do suporte vai revisar e encaminhar seu chamado.";
  };

  if (c.status === "seguranca") return { contrato: c, ajustes };

  if (c.status === "perguntando" && ctx.perguntasAntes >= TETO_PERGUNTAS) {
    abster(`Limite de ${TETO_PERGUNTAS} perguntas atingido; o app encerrou a conversa.`, "Informações insuficientes após o limite de perguntas.");
  }

  if (c.status === "pronto") {
    if (c.discriminadores_sem_resposta.length > 0 && c.confianca > TETO_SEM_DISCRIMINADOR) {
      ajustes.push(
        `Confiança reduzida de ${c.confianca} para ${TETO_SEM_DISCRIMINADOR}: há discriminador sem resposta (${c.discriminadores_sem_resposta.join(", ")}).`,
      );
      c.confianca = TETO_SEM_DISCRIMINADOR;
    }
    if (!c.fila_sugerida) {
      abster("O agente marcou 'pronto' sem sugerir fila.");
    } else if (!ctx.filasValidas.includes(c.fila_sugerida)) {
      abster(`Fila sugerida fora do catálogo: "${c.fila_sugerida}".`);
    } else if (c.confianca < LIMIAR_CONFIANCA) {
      abster(`Confiança ${c.confianca} abaixo do limiar ${LIMIAR_CONFIANCA}.`);
    }
  }

  // Uma ferramenta do catálogo cuja última chamada falhou deixa a decisão sem confirmação,
  // mesmo que a falha tenha sido num turno anterior. Ferramentas de memória não contam.
  const ultimaPorFerramenta = new Map<string, ToolCall>();
  for (const t of ctx.toolCalls.filter((t) => eFerramentaDeCatalogo(t.tool))) ultimaPorFerramenta.set(t.tool, t);
  const falhas = [...ultimaPorFerramenta.values()].filter((t) => t.isError).map((t) => t.tool);
  if (falhas.length > 0 && (c.status === "pronto" || c.status === "abstencao")) {
    abster(`Consulta ao catálogo falhou (${falhas.join(", ")}) e não foi refeita com sucesso; a sugestão não foi confirmada no catálogo.`);
  }

  // Sem nenhuma consulta ao catálogo que deu certo, a fila foi adivinhada: o agente não leu filas nem regras.
  if (c.status === "pronto" && !ctx.toolCalls.some((t) => eFerramentaDeCatalogo(t.tool) && !t.isError)) {
    abster(
      "O agente não consultou o catálogo (nenhuma ferramenta do catálogo neste chamado); a sugestão não foi confirmada.",
      "O agente sugeriu a fila sem consultar o catálogo. Confira se o conector do contexto está ligado ao agente no Hub.",
    );
  }

  // O solicitante nunca fica sabendo a fila antes da confirmação do analista.
  if (c.status === "pronto") {
    const texto = normalizar(c.mensagem_ao_usuario);
    if ((ctx.nomesFilas ?? []).some((n) => n && texto.includes(normalizar(n)))) {
      ajustes.push("A mensagem final do agente revelava a fila ao solicitante; o app usou a mensagem padrão.");
    }
    c.mensagem_ao_usuario = MENSAGEM_PRONTO;
  }

  return { contrato: c, ajustes };
}
