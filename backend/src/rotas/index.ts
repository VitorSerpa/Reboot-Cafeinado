import { Router, type NextFunction, type Request, type Response } from "express";

import { join } from "node:path";

import { env } from "../config/env.js";
import { DADOS_DIR } from "../dados/csv.js";
import * as catalogo from "../dominio/catalogo.js";
import * as chamados from "../dominio/chamados.js";
import * as acessoBanco from "../dominio/acessoBanco.js";
import * as agentes from "../dominio/agentes.js";
import * as tokens from "../dominio/tokens.js";
import { ErroApp } from "../dominio/erros.js";
import * as triagem from "../dominio/triagem.js";
import * as autenticacao from "../dominio/autenticacao.js";
import {
  abrirSessao,
  CABECALHO_SESSAO,
  COOKIE_SESSAO as COOKIE,
  DURACAO_SESSAO_MS,
  encerrarSessao,
  usuarioDaSessao,
  type Usuario,
} from "../dominio/usuarios.js";

declare module "express-serve-static-core" {
  interface Request {
    usuario?: Usuario;
    sessao?: string;
  }
}

/** Token da aba (cabeçalho `x-sessao`) ou, sem ele, o do cookie. O da aba vem antes: o cookie é um só por navegador. */
const tokenDe = (req: Request) => {
  const cabecalho = req.headers[CABECALHO_SESSAO];
  return typeof cabecalho === "string" && cabecalho ? cabecalho : req.cookies?.[COOKIE];
};

/**
 * Só passa com uma sessão aberta no banco (login feito, dentro das 8 horas, sem ter saído).
 * A empresa e o perfil saem sempre daqui, nunca do navegador.
 */
async function exigirLogin(req: Request, _res: Response, next: NextFunction) {
  const token = tokenDe(req);
  const usuario = await usuarioDaSessao(token);
  if (!usuario) return next(new ErroApp(401, "sem_sessao", "Sua sessão terminou. Entre com seu e-mail e senha."));
  req.usuario = usuario;
  req.sessao = token;
  next();
}

/** Depois de `exigirLogin`: só o tipo de login certo (o suporte é o perfil `analista`). */
const exigirPerfil = (perfil: Usuario["perfil"]) => (req: Request, _res: Response, next: NextFunction) =>
  req.usuario?.perfil === perfil
    ? next()
    : next(new ErroApp(403, "perfil", perfil === "analista" ? "Só o suporte acessa a triagem." : "Só solicitantes acessam esta área."));

const OPCOES_COOKIE = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.nodeEnv === "production",
  path: "/",
};

const idDe = (req: Request) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new ErroApp(400, "id", "Identificador inválido.");
  return id;
};

export const rotas = Router();

rotas.get("/status", (_req, res) => {
  res.json({ ok: true, hub: env.hub.modo });
});

// --- autenticação: e-mail e senha (colunas em `usuarios`), em dois tipos de login: solicitante e suporte ---
// A resposta traz o token da aba, além do cookie; o frontend guarda o token na própria aba (sessionStorage).
rotas.post("/auth/entrar", async (req, res) => {
  const email = String(req.body?.email ?? "");
  const senha = String(req.body?.senha ?? "");
  const perfil = req.body?.perfil;
  if (!email.trim() || !senha) throw new ErroApp(400, "credenciais", "Informe e-mail e senha.");
  if (perfil !== undefined && perfil !== "solicitante" && perfil !== "analista") {
    throw new ErroApp(400, "perfil", "Tipo de login inválido.");
  }
  const usuario = await autenticacao.entrar(email, senha, perfil);
  const token = await abrirSessao(usuario.id);
  res.cookie(COOKIE, token, { ...OPCOES_COOKIE, maxAge: DURACAO_SESSAO_MS });
  res.json({ ...usuario, token });
});

// Encerra a sessão desta aba no banco: o token deixa de valer mesmo que alguém o tenha guardado.
rotas.post("/auth/sair", async (req, res) => {
  const token = tokenDe(req);
  if (typeof token === "string" && token) await encerrarSessao(token);
  // O cookie só sai se for desta mesma sessão: o de outra aba (outro usuário) continua.
  if (!req.cookies?.[COOKIE] || req.cookies[COOKIE] === token) res.clearCookie(COOKIE, OPCOES_COOKIE);
  res.json({ ok: true });
});

// Devolve o token da sessão usada: a aba que chegou só com o cookie passa a ficar presa a este usuário.
rotas.get("/auth/me", exigirLogin, (req, res) => {
  res.json({ ...req.usuario, hub: env.hub.modo, token: req.sessao });
});

// --- catálogo da empresa do usuário ---
rotas.get("/catalogo", exigirLogin, async (req, res) => {
  const empresa = req.usuario!.empresa_id;
  const [filas, aplicacoes] = await Promise.all([catalogo.filas(empresa), catalogo.aplicacoes(empresa)]);
  res.json({ filas, aplicacoes: aplicacoes.map((a) => ({ ...a, apelidos: a.apelidos.join(", ") })) });
});

// --- administração do catálogo e dos tokens: só da própria máquina (loopback) ---
function soLocal(req: Request, _res: Response, next: NextFunction) {
  const origem = req.socket.remoteAddress ?? "";
  // O rewrite do Next (/api) também chega de 127.0.0.1, mas marca o pedido com x-forwarded-*: esse veio de fora.
  const repassado = Boolean(req.headers["x-forwarded-for"] || req.headers["x-forwarded-host"]);
  if (!repassado && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(origem)) return next();
  next(new ErroApp(403, "local", "Administração só pela própria máquina."));
}

rotas.post("/admin/catalogo/:empresa/recarregar", soLocal, async (req, res) => {
  const empresa = String(req.params.empresa);
  await catalogo.carregarDoCsv(empresa, { substituir: true });
  res.json({ ok: true, empresa, origem: `dados/${empresa}/*.csv` });
});

// Usuários e senhas: a senha só aparece nesta resposta (o banco guarda o hash).
rotas.get("/admin/usuarios", soLocal, async (_req, res) => {
  res.json(await autenticacao.listarLogins());
});

rotas.post("/admin/usuarios", soLocal, async (req, res) => {
  res.status(201).json(
    await autenticacao.criarUsuario({
      id: String(req.body?.id ?? ""),
      nome: String(req.body?.nome ?? ""),
      perfil: String(req.body?.perfil ?? ""),
      empresa: String(req.body?.empresa ?? "aurora"),
      email: req.body?.email ? String(req.body.email) : undefined,
    }),
  );
});

rotas.post("/admin/usuarios/:id/senha", soLocal, async (req, res) => {
  res.json(
    await autenticacao.definirSenha(String(req.params.id), {
      email: req.body?.email ? String(req.body.email) : undefined,
      senha: req.body?.senha ? String(req.body.senha) : undefined,
    }),
  );
});

// Agente da empresa: fica no banco e vale para todos os backends que usam o mesmo banco.
rotas.get("/admin/empresas/:empresa/agente", soLocal, async (req, res) => {
  const empresa = String(req.params.empresa);
  const achada = (await agentes.agentesPorEmpresa()).find((e) => e.id === empresa);
  if (!achada) throw new ErroApp(404, "empresa", `Empresa "${empresa}" não existe.`);
  res.json({ empresa, agente_id: achada.agente_id, env: env.hub.agenteAurora });
});

rotas.post("/admin/empresas/:empresa/agente", soLocal, async (req, res) => {
  res.json(await agentes.definirAgente(String(req.params.empresa), String(req.body?.agenteId ?? "")));
});

rotas.post("/admin/empresas/:empresa/tokens-conector", soLocal, async (req, res) => {
  res.status(201).json(await tokens.gerar(String(req.params.empresa), String(req.body?.descricao ?? "")));
});

rotas.get("/admin/tokens-conector", soLocal, async (req, res) => {
  res.json(await tokens.listar(req.query.empresa ? String(req.query.empresa) : undefined));
});

rotas.post("/admin/tokens-conector/:id/revogar", soLocal, async (req, res) => {
  res.json(await tokens.revogar(idDe(req)));
});

rotas.post("/admin/empresas/:empresa/acesso-banco", soLocal, async (req, res) => {
  res.status(201).json(await acessoBanco.liberar(String(req.params.empresa)));
});

rotas.post("/admin/empresas/:empresa/acesso-banco/diagnostico", soLocal, async (req, res) => {
  res.json(await acessoBanco.diagnosticar(String(req.params.empresa)));
});

rotas.post("/admin/empresas/:empresa/acesso-banco/revogar", soLocal, async (req, res) => {
  res.json(await acessoBanco.revogar(String(req.params.empresa)));
});

rotas.post("/admin/catalogo/:empresa/exportar", soLocal, async (req, res) => {
  const empresa = String(req.params.empresa);
  const arquivos = await catalogo.exportarCsv(empresa, join(DADOS_DIR, "..", "exportados", empresa));
  res.json({ ok: true, empresa, arquivos });
});

// --- jornada do solicitante ---
rotas.get("/chamados", exigirLogin, exigirPerfil("solicitante"), async (req, res) => {
  res.json(await chamados.meusChamados(req.usuario!));
});

rotas.post("/chamados", exigirLogin, exigirPerfil("solicitante"), async (req, res) => {
  res.status(201).json(await chamados.abrirChamado(req.usuario!, String(req.body?.texto ?? "")));
});

rotas.get("/chamados/:id", exigirLogin, async (req, res) => {
  const c = await chamados.carregarComAcesso(req.usuario!, idDe(req));
  res.json({ chamado: c, turnos: await chamados.turnos(c.id) });
});

rotas.post("/chamados/:id/mensagens", exigirLogin, exigirPerfil("solicitante"), async (req, res) => {
  res.json(await chamados.responder(req.usuario!, idDe(req), String(req.body?.texto ?? "")));
});

rotas.post("/chamados/:id/contingencia", exigirLogin, exigirPerfil("solicitante"), async (req, res) => {
  res.json(await chamados.contingencia(req.usuario!, idDe(req), req.body?.campos ?? {}));
});

// --- triagem ---
rotas.get("/triagem", exigirLogin, exigirPerfil("analista"), async (req, res) => {
  res.json(await triagem.fila(req.usuario!));
});

rotas.get("/triagem/:id", exigirLogin, exigirPerfil("analista"), async (req, res) => {
  res.json(await triagem.detalhe(req.usuario!, idDe(req)));
});

rotas.post("/triagem/:id/confirmar", exigirLogin, exigirPerfil("analista"), async (req, res) => {
  res.json(await triagem.confirmar(req.usuario!, idDe(req)));
});

rotas.post("/triagem/:id/corrigir", exigirLogin, exigirPerfil("analista"), async (req, res) => {
  res.json(await triagem.corrigir(req.usuario!, idDe(req), String(req.body?.fila ?? ""), String(req.body?.motivo ?? "")));
});
