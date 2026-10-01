import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "../config/env.js";
import { db } from "../db/index.js";

/** Cookie assinado com o id do usuário: vale para a API e para o handshake do WebSocket. */
export const COOKIE_SESSAO = "sessao";
/** Cabeçalho com o token da aba (tem prioridade sobre o cookie, que é um só por navegador). */
export const CABECALHO_SESSAO = "x-sessao";
export const DURACAO_SESSAO_MS = 8 * 3600_000;

const assinar = (dados: string) => createHmac("sha256", env.sessionSecret).update(dados).digest("base64url");

/**
 * Token de sessão da aba: `<id>.<expira em ms>.<assinatura>`. O cookie é compartilhado por todas as abas do
 * navegador; com o token, cada aba continua com o próprio usuário (a triagem não vira o solicitante de outra aba).
 */
export function tokenDaSessao(usuarioId: string) {
  const dados = `${usuarioId}.${Date.now() + DURACAO_SESSAO_MS}`;
  return `${dados}.${assinar(dados)}`;
}

/** Id do usuário de um token válido e não vencido; `null` em qualquer outro caso. */
export function idDoToken(token: unknown): string | null {
  if (typeof token !== "string") return null;
  const corte = token.lastIndexOf(".");
  if (corte < 0) return null;
  const dados = token.slice(0, corte);
  const recebida = Buffer.from(token.slice(corte + 1));
  const esperada = Buffer.from(assinar(dados));
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
  const [id, expira] = [dados.slice(0, dados.lastIndexOf(".")), Number(dados.slice(dados.lastIndexOf(".") + 1))];
  return id && Number.isFinite(expira) && expira > Date.now() ? id : null;
}

export interface Usuario {
  id: string;
  empresa_id: string;
  nome: string;
  perfil: "solicitante" | "analista";
}

/** Colunas públicas do usuário: nunca `select *`, que traria o hash da senha para a API e o WebSocket. */
const COLUNAS = "id, empresa_id, nome, perfil";

export async function buscarUsuario(id: string) {
  return db.one<Usuario>(`select ${COLUNAS} from usuarios where id = $1`, [id]);
}
