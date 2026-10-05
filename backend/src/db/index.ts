import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync } from "node:fs";

import type { PoolClient } from "pg";

import { env } from "../config/env.js";
import { ISOLAMENTO, PROTECAO, SCHEMA } from "./schema.js";
import { semear } from "./seed.js";

type Linha = Record<string, unknown>;

interface Executor {
  query<T = Linha>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

/**
 * Dois jeitos de falar com o banco:
 * - `sistema`: o dono das tabelas. Migrações, cadastro de empresas, login, sessão e administração.
 * - `daEmpresa(id)`: o papel `app_runtime`, com `app.empresa_id` definido. O RLS só deixa ver e gravar linhas dessa empresa.
 */
interface Banco {
  sistema: Executor;
  daEmpresa(empresaId: string): Executor;
  transacao<T>(empresaId: string | null, fn: (tx: Executor) => Promise<T>): Promise<T>;
  fechar(): Promise<void>;
}

/** Papel sem login e sem BYPASSRLS: o backend o assume para tudo o que é de uma empresa (schema.ts, ISOLAMENTO). */
export const PAPEL_EMPRESA = "app_runtime";

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

const ERRO_PAPEL = (papel: unknown) =>
  new Error(`O isolamento por empresa não está ativo: a consulta rodaria como "${papel}", e não como ${PAPEL_EMPRESA}.`);

/** Postgres de verdade (Supabase ou outro): dois pools, um como dono e outro já no papel das empresas. */
async function abrirPostgres(url: string): Promise<{ banco: Banco; descricao: string }> {
  const { default: pg } = await import("pg");
  const config = configPg(url);
  const poolSistema = new pg.Pool({ ...config, max: 2 });
  const poolEmpresa = new pg.Pool({ ...config, max: 4 });
  for (const pool of [poolSistema, poolEmpresa]) {
    // O pooler derruba conexões ociosas; sem este handler, o erro derrubaria o processo.
    pool.on("error", (erro) => console.error(`[banco] conexão ociosa caiu: ${erro.message}`));
  }
  // Cada conexão do pool das empresas assume o papel ao abrir. Se não conseguir, a conferência abaixo recusa a consulta.
  poolEmpresa.on("connect", (cliente) => {
    cliente.query(`set role ${PAPEL_EMPRESA}`).catch((erro) => console.error(`[banco] set role ${PAPEL_EMPRESA} falhou: ${erro.message}`));
  });

  type Cliente = PoolClient;
  const executorDe = (c: Cliente): Executor => ({
    query: async <T>(sql: string, params?: unknown[]) => (await c.query(sql, params)).rows as T[],
    exec: async (sql) => {
      await c.query(sql);
    },
  });
  /** Define a empresa da conexão e confere o papel na mesma ida ao banco. Sem o papel certo, não roda nada. */
  async function prepararEmpresa(c: Cliente, empresaId: string, local: boolean) {
    const r = await c.query<{ papel: string }>("select set_config('app.empresa_id', $1, $2) as empresa, current_user as papel", [
      empresaId,
      local,
    ]);
    if (r.rows[0]?.papel !== PAPEL_EMPRESA) throw ERRO_PAPEL(r.rows[0]?.papel);
  }
  async function naEmpresa<T>(empresaId: string, fn: (c: Cliente) => Promise<T>) {
    const c = await poolEmpresa.connect();
    let quebrada = false;
    try {
      await prepararEmpresa(c, empresaId, false);
      return await fn(c);
    } catch (erro) {
      quebrada = erro instanceof Error && erro.message.startsWith("O isolamento");
      throw erro;
    } finally {
      // Conexão sem o papel certo não volta para o pool.
      c.release(quebrada);
    }
  }

  const host = new URL(url).hostname;
  const verificacao = config.ssl === false ? "sem SSL" : env.db.sslCa ? "SSL verificado" : "SSL sem verificar o certificado";
  return {
    banco: {
      sistema: {
        query: async <T>(sql: string, params?: unknown[]) => (await poolSistema.query(sql, params)).rows as T[],
        exec: async (sql) => {
          await poolSistema.query(sql);
        },
      },
      daEmpresa: (empresaId) => ({
        query: <T>(sql: string, params?: unknown[]) => naEmpresa(empresaId, (c) => executorDe(c).query<T>(sql, params)),
        exec: (sql) => naEmpresa(empresaId, (c) => executorDe(c).exec(sql)),
      }),
      async transacao(empresaId, fn) {
        const c = await (empresaId ? poolEmpresa : poolSistema).connect();
        try {
          await c.query("begin");
          if (empresaId) await prepararEmpresa(c, empresaId, true);
          const r = await fn(executorDe(c));
          await c.query("commit");
          return r;
        } catch (erro) {
          await c.query("rollback").catch(() => {});
          throw erro;
        } finally {
          c.release();
        }
      },
      fechar: async () => {
        await Promise.all([poolSistema.end(), poolEmpresa.end()]);
      },
    },
    descricao: `postgres (${host}, ${verificacao})`,
  };
}

/** Postgres embutido (PGlite): uma conexão só; cada consulta de empresa vira uma transação curta com o papel e a empresa. */
async function abrirPglite(dir: string | null): Promise<{ banco: Banco; descricao: string }> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dir) mkdirSync(dir, { recursive: true });
  const pglite = dir ? new PGlite(dir) : new PGlite();
  type Tx = Parameters<Parameters<typeof pglite.transaction>[0]>[0];
  const executorDe = (alvo: Tx | typeof pglite): Executor => ({
    query: async <T>(sql: string, params?: unknown[]) => (await alvo.query<T>(sql, params as never)).rows,
    exec: async (sql) => {
      await alvo.exec(sql);
    },
  });
  async function prepararEmpresa(tx: Tx, empresaId: string) {
    await tx.query(`set local role ${PAPEL_EMPRESA}`);
    await tx.query("select set_config('app.empresa_id', $1, true)", [empresaId]);
  }
  return {
    banco: {
      sistema: executorDe(pglite),
      daEmpresa: (empresaId) => ({
        query: <T>(sql: string, params?: unknown[]) =>
          pglite.transaction(async (tx) => {
            await prepararEmpresa(tx, empresaId);
            return executorDe(tx).query<T>(sql, params);
          }),
        exec: (sql) =>
          pglite.transaction(async (tx) => {
            await prepararEmpresa(tx, empresaId);
            await tx.exec(sql);
          }),
      }),
      transacao: (empresaId, fn) =>
        pglite.transaction(async (tx) => {
          if (empresaId) await prepararEmpresa(tx, empresaId);
          return fn(executorDe(tx));
        }),
      fechar: () => pglite.close(),
    },
    descricao: dir ? `pglite (${dir})` : "pglite (em memória)",
  };
}

// --- contexto: toda consulta diz de quem é ---

type Contexto = ({ empresaId: string } | { sistema: true }) & { tx?: Executor };

const contexto = new AsyncLocalStorage<Contexto>();
const SLUG_EMPRESA = /^[a-z][a-z0-9_]{1,30}$/;

/** Roda `fn` com os dados de uma empresa: as consultas passam pelo RLS e só enxergam essa empresa. */
export function comEmpresa<T>(empresaId: string, fn: () => T): T {
  if (!SLUG_EMPRESA.test(empresaId)) throw new Error(`Empresa inválida para o contexto do banco: "${empresaId}".`);
  return contexto.run({ empresaId }, fn);
}

/** Roda `fn` como a plataforma (dono das tabelas): migrações, cadastro de empresas, login, sessão e administração. */
export function comoSistema<T>(fn: () => T): T {
  return contexto.run({ sistema: true }, fn);
}

/** A empresa do contexto atual, ou null (plataforma ou fora de contexto). */
export function empresaDoContexto(): string | null {
  const ctx = contexto.getStore();
  return ctx && "empresaId" in ctx ? ctx.empresaId : null;
}

function atual(): Banco {
  if (!banco) throw new Error("Banco não iniciado");
  return banco;
}

function executor(): Executor {
  const ctx = contexto.getStore();
  if (!ctx) {
    throw new Error(
      "Consulta ao banco fora de contexto. Use comEmpresa(id, ...) para dados de uma empresa ou comoSistema(...) para a plataforma.",
    );
  }
  if (ctx.tx) return ctx.tx;
  return "sistema" in ctx ? atual().sistema : atual().daEmpresa(ctx.empresaId);
}

export const db = {
  // async: sem contexto, a promise é rejeitada (não lança na hora), como qualquer erro do banco.
  query: async <T = Linha>(sql: string, params?: unknown[]) => executor().query<T>(sql, params),
  async one<T = Linha>(sql: string, params?: unknown[]): Promise<T | undefined> {
    return (await executor().query<T>(sql, params))[0];
  },
  exec: async (sql: string) => executor().exec(sql),
  /** Várias consultas numa transação só, no contexto atual (empresa ou plataforma). Dentro de outra, reaproveita. */
  transacao<T>(fn: () => Promise<T>): Promise<T> {
    const ctx = contexto.getStore();
    if (!ctx) return Promise.reject(new Error("Transação fora de contexto: use comEmpresa(...) ou comoSistema(...)."));
    if (ctx.tx) return fn();
    const empresaId = "empresaId" in ctx ? ctx.empresaId : null;
    return atual().transacao(empresaId, (tx) => contexto.run({ ...ctx, tx }, fn));
  },
};

/**
 * Abre o banco, aplica o schema, as proteções e o isolamento por empresa, carrega os dados iniciais e confere
 * que as consultas de empresa rodam mesmo como `app_runtime`. `memoria` é para os testes: nunca toca o banco do .env.
 */
export async function iniciarBanco(opcoes: { memoria?: boolean } = {}) {
  const aberto = opcoes.memoria ? await abrirPglite(null) : env.db.url ? await abrirPostgres(env.db.url) : await abrirPglite(env.db.pgliteDir);
  banco = aberto.banco;
  const local = Boolean(opcoes.memoria) || !env.db.url;
  await comoSistema(async () => {
    await db.exec(SCHEMA);
    await db.exec(PROTECAO);
    await db.exec(ISOLAMENTO);
    await semear({ local });
  });
  const papel = await comEmpresa("verificacao", () => db.one<{ papel: string }>("select current_user as papel"));
  if (papel?.papel !== PAPEL_EMPRESA) throw ERRO_PAPEL(papel?.papel);
  return aberto.descricao;
}

export async function fecharBanco() {
  await banco?.fechar();
  banco = null;
}
