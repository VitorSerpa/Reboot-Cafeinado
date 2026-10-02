import { createHash, randomBytes } from "node:crypto";

import { db } from "../db/index.js";
import { eventos } from "./eventos.js";

/** Cookie com o token da sessão: vale para a API e para o handshake do WebSocket. */
export const COOKIE_SESSAO = "sessao";
/** Cabeçalho com o token da aba (tem prioridade sobre o cookie, que é um só por navegador). */
export const CABECALHO_SESSAO = "x-sessao";
export const DURACAO_SESSAO_MS = 8 * 3600_000;

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

/** O banco guarda só o hash: quem lê a tabela `sessoes` não consegue entrar como ninguém. */
export const hashDaSessao = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Abre uma sessão (no login). O token vai no cookie e na resposta: o frontend o guarda na aba (sessionStorage),
 * para cada aba continuar com o próprio usuário mesmo que outra aba do navegador entre com outro.
 */
export async function abrirSessao(usuarioId: string) {
  const token = randomBytes(32).toString("base64url");
  await db.query("delete from sessoes where expira_em < now() - interval '1 day'");
  await db.query(
    "insert into sessoes (hash, usuario_id, expira_em) values ($1, $2, now() + make_interval(secs => $3))",
    [hashDaSessao(token), usuarioId, DURACAO_SESSAO_MS / 1000],
  );
  return token;
}

/** Usuário de uma sessão aberta e dentro do prazo; `undefined` para token desconhecido, vencido ou encerrado. */
export async function usuarioDaSessao(token: unknown): Promise<Usuario | undefined> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  return db.one<Usuario>(
    `select u.id, u.empresa_id, u.nome, u.perfil
     from sessoes s join usuarios u on u.id = s.usuario_id
     where s.hash = $1 and s.encerrada_em is null and s.expira_em > now()`,
    [hashDaSessao(token)],
  );
}

/** Sair: encerra só esta sessão e derruba o WebSocket que estiver aberto com ela. */
export async function encerrarSessao(token: string) {
  const hash = hashDaSessao(token);
  await db.query("update sessoes set encerrada_em = now() where hash = $1 and encerrada_em is null", [hash]);
  eventos.emit("sessao", { sessao: hash });
}

/** Senha nova: nenhuma sessão antiga do usuário continua valendo. */
export async function encerrarSessoesDoUsuario(usuarioId: string) {
  await db.query("update sessoes set encerrada_em = now() where usuario_id = $1 and encerrada_em is null", [usuarioId]);
  eventos.emit("sessao", { usuarioId });
}
