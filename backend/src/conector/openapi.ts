/**
 * OpenAPI do conector, importado pelo conector "API REST" do Hub (ele procura /openapi.json).
 * Cada operationId vira uma ferramenta do agente: as descrições são escritas para o agente ler.
 */
export function openapi(urlBase: string) {
  const erro = { description: "Erro com mensagem para o agente", content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } } };
  const ok = (descricao: string) => ({ description: descricao, content: { "application/json": { schema: { type: "object" } } } });

  return {
    openapi: "3.0.3",
    info: {
      title: "Chamado Pronto: contexto da empresa",
      version: "1.0.0",
      description:
        "Contexto de triagem de UMA empresa: aplicações, filas, categorias e procedimentos, vindos do banco do Chamado Pronto. " +
        "A empresa é definida pelo token do conector; não é preciso (nem possível) escolher a empresa.",
    },
    servers: [{ url: urlBase }],
    security: [{ bearer: [] }, { chave: [] }],
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer" },
        chave: { type: "apiKey", in: "header", name: "X-API-Key" },
      },
      schemas: {
        Erro: { type: "object", properties: { erro: { type: "string" }, mensagem: { type: "string" } } },
      },
    },
    paths: {
      "/hub/v1/contexto": {
        get: {
          operationId: "obterContexto",
          summary: "Contexto completo da empresa numa chamada",
          description:
            "Devolve empresa, filas, aplicações (com apelidos), categorias (com discriminadores, campos obrigatórios e regra de roteamento) " +
            "e procedimentos de triagem. Chame UMA vez, no primeiro turno do chamado; o resultado continua na conversa.",
          responses: { "200": ok("Contexto da empresa"), "401": erro },
        },
      },
      "/hub/v1/categorias/{slug}": {
        get: {
          operationId: "obterCategoria",
          summary: "Ficha de uma categoria",
          description: "Discriminadores, campos obrigatórios, fila padrão e regra de roteamento de uma categoria. Use o slug que veio em obterContexto.",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" }, description: "Slug da categoria" }],
          responses: { "200": ok("Ficha da categoria"), "404": erro, "401": erro },
        },
      },
      "/hub/v1/aplicacoes": {
        get: {
          operationId: "buscarAplicacao",
          summary: "Identificar a aplicação pelo nome ou apelido",
          description:
            "Procura a aplicação pelo que o funcionário escreveu (nome, apelido ou uso). Se 'fora_do_catalogo' vier true, a aplicação não é da casa.",
          parameters: [{ name: "busca", in: "query", required: true, schema: { type: "string" }, description: "Texto como o funcionário escreveu, ex.: 'portal'" }],
          responses: { "200": ok("Aplicações encontradas, da mais para a menos relevante"), "400": erro, "401": erro },
        },
      },
      "/hub/v1/chamados-abertos": {
        get: {
          operationId: "listarChamadosAbertos",
          summary: "Outros chamados recentes sobre a mesma aplicação",
          description:
            "Quantos chamados foram enviados nas últimas horas sobre a aplicação. Use quando a abrangência importa para a fila " +
            "('é só com você ou com outros colegas?'). São relatos, não confirmação de indisponibilidade.",
          parameters: [
            { name: "aplicacao", in: "query", required: true, schema: { type: "string" }, description: "Slug da aplicação" },
            { name: "horas", in: "query", required: false, schema: { type: "integer", default: 24, minimum: 1, maximum: 168 } },
          ],
          responses: { "200": ok("Chamados recentes"), "400": erro, "401": erro },
        },
      },
    },
  };
}

/** Nomes das operações: usados para reconhecer, entre as ferramentas do agente, as que consultam o contexto. */
export const OPERACOES_DO_CONECTOR = ["obterContexto", "obterCategoria", "buscarAplicacao", "listarChamadosAbertos"];
