import { Router, type NextFunction, type Request, type Response } from "express";

import { comEmpresa, comoSistema } from "../db/index.js";
import * as catalogo from "../dominio/catalogo.js";
import { ErroApp } from "../dominio/erros.js";
import * as tokens from "../dominio/tokens.js";
import { openapi } from "./openapi.js";

/**
 * Rotas do conector (/hub/v1): o Hub consulta o contexto da empresa pelo conector API REST.
 * A empresa sai do token; nenhum parâmetro permite pedir dados de outra empresa.
 * Só são alcançáveis pelo Hub quando o app estiver publicado (D5); até lá, o agente lê o conector CSV.
 */

declare module "express-serve-static-core" {
  interface Request {
    empresaConector?: string;
  }
}

function tokenDaRequisicao(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const chave = req.headers["x-api-key"];
  return typeof chave === "string" ? chave.trim() : null;
}

async function autenticar(req: Request, _res: Response, next: NextFunction) {
  try {
    const empresa = await comoSistema(() => tokens.empresaDoToken(tokenDaRequisicao(req)));
    if (!empresa) return next(new ErroApp(401, "token", "Token do conector ausente, inválido ou revogado."));
    req.empresaConector = empresa;
    // Daqui em diante, só os dados da empresa do token (RLS).
    comEmpresa(empresa, () => next());
  } catch (erro) {
    next(erro);
  }
}

/** Endereço do app como o Hub o vê (atrás de um proxy da hospedagem, pelos cabeçalhos X-Forwarded-*). */
function urlBase(req: Request) {
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  return `${proto}://${host}`;
}

export const rotasConector = Router();

rotasConector.use((req, res, next) => {
  const inicio = Date.now();
  res.on("finish", () =>
    console.log(`[conector] ${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - inicio} ms)${req.empresaConector ? ` · ${req.empresaConector}` : ""}`),
  );
  next();
});

// O OpenAPI não tem dados de empresa: fica aberto para o Hub importar.
rotasConector.get("/openapi.json", (req, res) => {
  res.json(openapi(urlBase(req)));
});

rotasConector.use(autenticar);

rotasConector.get("/contexto", async (req, res) => {
  res.json(await catalogo.contexto(req.empresaConector!));
});

rotasConector.get("/categorias/:slug", async (req, res) => {
  res.json(await catalogo.categoria(req.empresaConector!, String(req.params.slug)));
});

rotasConector.get("/servicos", async (req, res) => {
  const busca = String(req.query.busca ?? "").trim();
  if (!busca) throw new ErroApp(400, "busca", "Informe 'busca' com o nome ou apelido que o funcionário usou.");
  res.json(await catalogo.buscarServicos(req.empresaConector!, busca));
});

rotasConector.get("/chamados-abertos", async (req, res) => {
  const aplicacao = String(req.query.aplicacao ?? "").trim();
  if (!aplicacao) throw new ErroApp(400, "aplicacao", "Informe 'aplicacao' com o slug da aplicação (ex.: pagaflow).");
  res.json(await catalogo.chamadosAbertos(req.empresaConector!, aplicacao, Number(req.query.horas ?? 24)));
});
