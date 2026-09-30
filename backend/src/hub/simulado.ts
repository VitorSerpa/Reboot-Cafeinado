import { randomUUID } from "node:crypto";

import { HubIndisponivel, type ClienteHub, type ResultadoTurno, type ToolCall } from "./tipos.js";

/**
 * Hub simulado: responde no mesmo contrato do agente real, com regras fixas de palavra-chave.
 * Serve para desenvolver e testar sem API Key e sem custo. NÃO é o agente — não decide nada de verdade.
 * Palavras que disparam a falha, para testar os caminhos de erro:
 *   "#hub-fora"   → o Hub fica indisponível
 *   "#json-ruim"  → o agente responde fora do formato
 *   "#tool-erro"  → a consulta ao catálogo falha
 */
const sessoes = new Map<string, string[]>();

const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

function consulta(arquivo: string, erro = false): ToolCall {
  return {
    tool: "query_file_catalogo_triagem",
    arguments: { file_name: arquivo, filters: [] },
    result: erro ? "invalid literal for int() with base 10: ''" : { status: "ok", row_count: 5 },
    status: erro ? "error" : "success",
    isError: erro,
    latencyMs: 40,
  };
}

function decidir(textos: string[]) {
  const tudo = normalizar(textos.join(" \n "));
  const ultima = normalizar(textos.at(-1) ?? "");
  const perguntasFeitas = textos.length - 1;

  if (/invadid|hacke|acesso indevido|alguem entrou/.test(tudo)) {
    return {
      mensagem_ao_usuario:
        "Por segurança, não vou seguir com o chamado por aqui. Procure agora a equipe de Segurança da Informação e não compartilhe senhas ou códigos.",
      status: "seguranca",
      aplicacao: null,
      categoria: "acesso-login",
      fila_sugerida: "identidade-acessos",
      confianca: 0.9,
      duvida: null,
      resumo: "Suspeita de acesso indevido. Solicitante orientado a procurar Segurança da Informação.",
    };
  }

  const aplicacao = /portal|pagaflow|remessa/.test(tudo)
    ? "pagaflow"
    : /reembolso|despesa/.test(tudo)
      ? "despesacerta"
      : /fechamento|contab/.test(tudo)
        ? "contafechamento"
        : /financeiro/.test(tudo)
          ? "aurora-financeiro"
          : null;

  if (perguntasFeitas === 0) {
    return {
      mensagem_ao_usuario: "Entendi. Quando você tenta, o que aparece na tela?",
      status: "perguntando",
      aplicacao,
      categoria: /senha|login|bloque/.test(tudo) ? "acesso-login" : "processo-financeiro",
      fila_sugerida: null,
      confianca: 0.3,
      duvida: null,
      resumo: "",
    };
  }

  if (/nao sei/.test(ultima) && perguntasFeitas < 3) {
    return {
      mensagem_ao_usuario: "Sem problema. Outros colegas também estão com essa dificuldade, ou é só com você?",
      status: "perguntando",
      aplicacao,
      categoria: "processo-financeiro",
      fila_sugerida: null,
      confianca: 0.35,
      duvida: null,
      resumo: "",
    };
  }

  const regra = /recus|aprova|pendent|alcada/.test(tudo);
  const permissao = /permiss|autoriza|acesso negado/.test(tudo);
  const tecnico = /erro|trav|fech|caiu|nao carrega/.test(tudo);
  const fila = regra ? "operacoes-financeiras" : permissao ? "identidade-acessos" : tecnico ? "aplicacoes-corporativas" : null;

  return {
    mensagem_ao_usuario: "Obrigado! Já tenho o suficiente. Seu chamado vai para a revisão do suporte.",
    status: fila ? "pronto" : "abstencao",
    aplicacao,
    categoria: regra ? "processo-financeiro" : permissao ? "permissao-funcional" : "falha-aplicacao",
    informacoes: { relato: textos[0], o_que_o_sistema_respondeu: textos[1] ?? null },
    lacunas: [],
    discriminadores_sem_resposta: fila ? [] : ["existe_mensagem_de_erro_tecnico"],
    fila_sugerida: fila,
    confianca: fila ? 0.85 : 0.5,
    duvida: fila ? null : "Não deu para separar regra de negócio de falha técnica: o solicitante não soube dizer o que apareceu.",
    resumo: `(simulado) ${textos[0].slice(0, 160)}`,
  };
}

export const hubSimulado: ClienteHub = {
  modo: "simulado",

  async conversar({ mensagem, sessaoExterna, aoProgresso }): Promise<ResultadoTurno> {
    const id = sessaoExterna;
    const textos = sessoes.get(id) ?? [];
    const conteudo = mensagem.split("\n").filter((l) => !l.startsWith("[") && !/^(Relato inicial|Resposta) do solicitante:?$/.test(l.trim())).join("\n").trim();
    textos.push(conteudo);
    sessoes.set(id, textos);

    const n = normalizar(mensagem);
    if (n.includes("#hub-fora")) throw new HubIndisponivel("Hub simulado fora do ar", 503, "simulação");

    const toolErro = n.includes("#tool-erro");
    // Mesma ordem de eventos do runtime real, para a tela mostrar o progresso também no modo simulado.
    if (textos.length === 1) {
      await new Promise((r) => setTimeout(r, 300));
      aoProgresso?.({ fase: "consultando", ferramenta: "query_file_catalogo_triagem" });
    }
    await new Promise((r) => setTimeout(r, 400));
    aoProgresso?.({ fase: "escrevendo" });
    await new Promise((r) => setTimeout(r, 200));
    const texto = n.includes("#json-ruim") ? "Claro! Vou te ajudar com isso." : JSON.stringify(decidir(textos));

    return {
      sessionId: `sim-${randomUUID()}`,
      texto,
      toolCalls: textos.length === 1 ? [consulta("categorias", toolErro)] : [],
      tokens: { input: 1200, output: 150 },
      latenciaMs: 400,
      erros: [],
      avisos: [],
      eventos: ["session_started", "tool_call", "content", "completed"],
    };
  },
};
