import { tokenDaAba } from "@/lib/sessao";

/** Chamada ao backend pelo mesmo domínio (/api é repassado pelo Next ao Express). */
export class ErroApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    message: string,
    readonly corpo: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function api<T>(rota: string, opcoes: { metodo?: string; corpo?: unknown } = {}): Promise<T> {
  let resposta: Response;
  const token = tokenDaAba();
  const headers: Record<string, string> = {};
  if (opcoes.corpo !== undefined) headers["Content-Type"] = "application/json";
  // A sessão desta aba vem antes do cookie (que é compartilhado por todas as abas).
  if (token) headers["x-sessao"] = token;
  try {
    resposta = await fetch(`/api${rota}`, {
      method: opcoes.metodo ?? (opcoes.corpo === undefined ? "GET" : "POST"),
      headers,
      body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
      credentials: "same-origin",
    });
  } catch {
    throw new ErroApi(0, "rede", "Sem conexão com o servidor. Confira se o backend está rodando.", {});
  }

  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new ErroApi(resposta.status, corpo.erro ?? "erro", corpo.mensagem ?? `Erro ${resposta.status}`, corpo);
  }
  return corpo as T;
}

export interface Usuario {
  id: string;
  nome: string;
  perfil: "solicitante" | "analista";
  empresa_id: string;
  empresa_nome?: string;
  hub?: "real" | "simulado";
  /** Token de sessão da aba, devolvido por /auth/entrar e /auth/me. */
  token?: string;
}

export interface ToolCall {
  tool: string;
  arguments: unknown;
  result: unknown;
  status: string | null;
  isError: boolean;
  latencyMs: number | null;
}

export interface Resultado {
  mensagem_ao_usuario: string;
  status: "perguntando" | "pronto" | "abstencao" | "seguranca";
  aplicacao: string | null;
  categoria: string | null;
  informacoes: Record<string, unknown>;
  lacunas: string[];
  discriminadores_sem_resposta: string[];
  fila_sugerida: string | null;
  confianca: number;
  duvida: string | null;
  resumo: string;
}

export interface Chamado {
  id: number;
  status: "qualificando" | "aguardando_triagem" | "triado";
  texto_inicial: string;
  n_perguntas: number;
  resultado: Resultado | null;
  ajustes: string[];
  qualificado_sem_ia: boolean;
  tokens_input: number;
  tokens_output: number;
  latencia_ms: number;
  criado_em: string;
  enviado_em: string | null;
}

export interface Turno {
  id: number;
  papel: "solicitante" | "agente" | "analista" | "sistema";
  texto: string;
  /** Nome de quem escreveu, nas mensagens do chat com o suporte. */
  autor: string | null;
  bruto: string | null;
  tool_calls: ToolCall[];
  tokens_input: number | null;
  tokens_output: number | null;
  latencia_ms: number | null;
  criado_em: string;
}

export interface CampoContingencia {
  chave: string;
  rotulo: string;
  tipo: "texto" | "aplicacao" | "abrangencia";
}

export interface Catalogo {
  filas: { slug: string; nome: string; escopo: string }[];
  aplicacoes: { slug: string; nome: string; apelidos: string }[];
}
