import { createHash, randomBytes } from "node:crypto";

import { db } from "../db/index.js";
import { ErroApp } from "./erros.js";

/**
 * Tokens do conector por empresa, no banco. O valor completo só existe no momento em que é gerado;
 * o banco guarda o hash (SHA-256 basta: o token é aleatório, com 192 bits) e um prefixo para identificar.
 */

export const hashDoToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

const PREFIXO = "cpk_";

export async function gerar(empresa: string, descricao = "") {
  const existe = await db.one("select 1 from empresas where id = $1", [empresa]);
  if (!existe) throw new ErroApp(404, "empresa", `Empresa "${empresa}" não existe.`);

  const token = PREFIXO + randomBytes(24).toString("base64url");
  const novo = await db.one<{ id: number; criado_em: string }>(
    `insert into tokens_conector (empresa_id, hash, prefixo, descricao) values ($1, $2, $3, $4) returning id, criado_em`,
    [empresa, hashDoToken(token), token.slice(0, 12), descricao],
  );
  return { id: novo!.id, empresa, token, prefixo: token.slice(0, 12), criado_em: novo!.criado_em };
}

/** Empresa dona de um token ativo, ou null. Registra o último uso. */
export async function empresaDoToken(token: string | null): Promise<string | null> {
  if (!token || !token.startsWith(PREFIXO)) return null;
  const achado = await db.one<{ id: number; empresa_id: string }>(
    "select id, empresa_id from tokens_conector where hash = $1 and revogado_em is null",
    [hashDoToken(token)],
  );
  if (!achado) return null;
  await db.query("update tokens_conector set ultimo_uso = now() where id = $1", [achado.id]);
  return achado.empresa_id;
}

export async function listar(empresa?: string) {
  return db.query(
    `select id, empresa_id, prefixo, descricao, criado_em, ultimo_uso, revogado_em
     from tokens_conector ${empresa ? "where empresa_id = $1" : ""} order by id`,
    empresa ? [empresa] : [],
  );
}

export async function revogar(id: number) {
  const r = await db.one<{ id: number }>(
    "update tokens_conector set revogado_em = now() where id = $1 and revogado_em is null returning id",
    [id],
  );
  if (!r) throw new ErroApp(404, "token", "Token não encontrado ou já revogado.");
  return { ok: true, id };
}

export async function ativosPorEmpresa() {
  return db.query<{ empresa_id: string; total: number }>(
    "select empresa_id, count(*)::int as total from tokens_conector where revogado_em is null group by empresa_id order by empresa_id",
  );
}
