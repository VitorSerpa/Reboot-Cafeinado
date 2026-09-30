import { mkdirSync, readFileSync } from "node:fs";

import { env } from "../config/env.js";
import { PROTECAO, SCHEMA } from "./schema.js";
import { semear } from "./seed.js";

type Linha = Record<string, unknown>;

interface Banco {
  query<T = Linha>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

let banco: Banco | null = null;

const HOSTS_LOCAIS = ["localhost", "127.0.0.1", "::1", "[::1]"];

/**
 * Configuração do pg a partir de uma URL de Postgres (a do app ou a do acesso do Hub).
 * O Supabase exige SSL e assina o certificado com uma CA própria: com `DATABASE_SSL_CA`, o certificado é verificado;
 * sem ela, a conexão é cifrada mas não verificada. Os parâmetros `ssl*` saem da URL porque o pg deixaria
 * a URL sobrescrever esta configuração.
 */
export function configPg(url: string, caminhoCa = env.db.sslCa) {
  const u = new URL(url);
  const modo = u.searchParams.get("sslmode") ?? "";
  for (const p of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) u.searchParams.delete(p);
  const local = HOSTS_LOCAIS.includes(u.hostname);
  const ssl = caminhoCa
    ? { ca: readFileSync(caminhoCa, "utf8"), rejectUnauthorized: true }
    : modo === "disable" || (local && !modo)
      ? false
      : { rejectUnauthorized: false };
  return {
    connectionString: u.toString(),
    ssl,
    // O pooler do Supabase no plano gratuito tem poucas conexões por usuário.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: "chamado-pronto",
  };
}

/** Postgres de verdade com DATABASE_URL (Supabase ou outro); senão, Postgres embutido (PGlite) em disco. */
async function abrir(): Promise<{ banco: Banco; descricao: string }> {
  if (env.db.url) {
    const { default: pg } = await import("pg");
    const config = configPg(env.db.url);
    const pool = new pg.Pool(config);
    // O pooler derruba conexões ociosas; sem este handler, o erro derrubaria o processo.
    pool.on("error", (erro) => console.error(`[banco] conexão ociosa caiu: ${erro.message}`));
    const host = new URL(env.db.url).hostname;
    const verificacao = config.ssl === false ? "sem SSL" : env.db.sslCa ? "SSL verificado" : "SSL sem verificar o certificado";
    return {
      banco: {
        query: async (sql, params) => (await pool.query(sql, params)).rows,
        exec: async (sql) => {
          await pool.query(sql);
        },
      },
      descricao: `postgres (${host}, ${verificacao})`,
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  mkdirSync(env.db.pgliteDir, { recursive: true });
  const pglite = new PGlite(env.db.pgliteDir);
  return {
    banco: {
      query: async <T>(sql: string, params?: unknown[]) =>
        (await pglite.query<T>(sql, params as never)).rows,
      exec: async (sql) => {
        await pglite.exec(sql);
      },
    },
    descricao: `pglite (${env.db.pgliteDir})`,
  };
}

export async function iniciarBanco() {
  const aberto = await abrir();
  banco = aberto.banco;
  await banco.exec(SCHEMA);
  await banco.exec(PROTECAO);
  await semear();
  return aberto.descricao;
}

function atual(): Banco {
  if (!banco) throw new Error("Banco não iniciado");
  return banco;
}

export const db = {
  query: <T = Linha>(sql: string, params?: unknown[]) => atual().query<T>(sql, params),
  async one<T = Linha>(sql: string, params?: unknown[]): Promise<T | undefined> {
    return (await atual().query<T>(sql, params))[0];
  },
  exec: (sql: string) => atual().exec(sql),
};
