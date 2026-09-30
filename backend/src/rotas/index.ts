import { Router, type NextFunction, type Request, type Response } from "express";

import { join } from "node:path";

import { env } from "../config/env.js";
import { DADOS_DIR } from "../dados/csv.js";
import * as catalogo from "../dominio/catalogo.js";
import * as chamados from "../dominio/chamados.js";
import * as acessoBanco from "../dominio/acessoBanco.js";
import * as tokens from "../dominio/tokens.js";
import { ErroApp } from "../dominio/erros.js";
import * as triagem from "../dominio/triagem.js";
import { buscarUsuario, COOKIE_SESSAO as COOKIE, listarUsuariosDeTeste, type Usuario } from "../dominio/usuarios.js";

declare module "express-serve-static-core" {
  interface Request {
    usuario?: Usuario;
  }
}

/** Resolve o usuário pelo cookie assinado. A empresa sai sempre daqui, nunca do navegador. */
async function exigirLogin(req: Request, _res: Response, next: NextFunction) {
  const id = req.signedCookies?.[COOKIE];
  const usuario = typeof id === "string" ? await buscarUsuario(id) : undefined;
  if (!usuario) return next(new ErroApp(401, "sem_sessao", "Entre com um usuário de teste."));
  req.usuario = usuario;
  next();
}

const idDe = (req: Request) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new ErroApp(400, "id", "Identificador inválido.");
  return id;
};

export const rotas = Router();

rotas.get("/status", (_req, res) => {
  res.json({ ok: true, hub: env.hub.modo });
});

// --- autenticação (protótipo: escolher um usuário de teste, sem senha) ---
rotas.get("/auth/usuarios", async (_req, res) => {
  res.json(await listarUsuariosDeTeste());
});

rotas.post("/auth/entrar", async (req, res) => {
  const usuario = await buscarUsuario(String(req.body?.usuarioId ?? ""));
  if (!usuario) throw new ErroApp(400, "usuario", "Usuário de teste não encontrado.");
  res.cookie(COOKIE, usuario.id, { signed: true, httpOnly: true, sameSite: "lax", secure: false, maxAge: 8 * 3600_000 });
  res.json(usuario);
});

rotas.post("/auth/sair", (_req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

rotas.get("/auth/me", exigirLogin, (req, res) => {
  res.json({ ...req.usuario, hub: env.hub.modo });
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
  if (["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(origem)) return next();
  next(new ErroApp(403, "local", "Administração do catálogo só pela própria máquina."));
}

rotas.post("/admin/catalogo/:empresa/recarregar", soLocal, async (req, res) => {
  const empresa = String(req.params.empresa);
  await catalogo.carregarDoCsv(empresa, { substituir: true });
  res.json({ ok: true, empresa, origem: `dados/${empresa}/*.csv` });
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
rotas.get("/chamados", exigirLogin, async (req, res) => {
  res.json(await chamados.meusChamados(req.usuario!));
});

rotas.post("/chamados", exigirLogin, async (req, res) => {
  res.status(201).json(await chamados.abrirChamado(req.usuario!, String(req.body?.texto ?? "")));
});

rotas.get("/chamados/:id", exigirLogin, async (req, res) => {
  const c = await chamados.carregarComAcesso(req.usuario!, idDe(req));
  res.json({ chamado: c, turnos: await chamados.turnos(c.id) });
});

rotas.post("/chamados/:id/mensagens", exigirLogin, async (req, res) => {
  res.json(await chamados.responder(req.usuario!, idDe(req), String(req.body?.texto ?? "")));
});

rotas.post("/chamados/:id/contingencia", exigirLogin, async (req, res) => {
  res.json(await chamados.contingencia(req.usuario!, idDe(req), req.body?.campos ?? {}));
});

// --- triagem ---
rotas.get("/triagem", exigirLogin, async (req, res) => {
  res.json(await triagem.fila(req.usuario!));
});

rotas.get("/triagem/:id", exigirLogin, async (req, res) => {
  res.json(await triagem.detalhe(req.usuario!, idDe(req)));
});

rotas.post("/triagem/:id/confirmar", exigirLogin, async (req, res) => {
  res.json(await triagem.confirmar(req.usuario!, idDe(req)));
});

rotas.post("/triagem/:id/corrigir", exigirLogin, async (req, res) => {
  res.json(await triagem.corrigir(req.usuario!, idDe(req), String(req.body?.fila ?? ""), String(req.body?.motivo ?? "")));
});
