import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { configPg } from "../db/index.js";
import { PROTECAO, SCHEMA } from "../db/schema.js";
import { dadosDeConexao, nomeAcesso, sqlPapel, sqlPermissoes, sqlVisoes, verificadorScram } from "./acessoBanco.js";
import { eFerramentaDeCatalogo } from "./contrato.js";

test("verificador SCRAM confere com o exemplo da RFC 7677", () => {
  // Troca completa da RFC 7677 (usuário "user", senha "pencil").
  const sal = Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64");
  const v = verificadorScram("pencil", sal, 4096);
  assert.ok(v.startsWith("SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$"));
  const [guardada, servidor] = v.split("$")[2].split(":").map((b) => Buffer.from(b, "base64"));

  const nonce = "rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0";
  const authMessage = `n=user,r=rOprNGfwEbeRWgbNEkqO,r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=${nonce}`;
  const hmac = (k: Buffer) => createHmac("sha256", k).update(authMessage).digest();

  // O que o Postgres faz: prova do cliente XOR assinatura → chave do cliente, cujo hash tem de ser a chave guardada.
  const prova = Buffer.from("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=", "base64");
  const assinatura = hmac(guardada);
  const chaveCliente = Buffer.from(prova.map((b, i) => b ^ assinatura[i]));
  assert.deepEqual(createHash("sha256").update(chaveCliente).digest(), guardada);
  assert.equal(hmac(servidor).toString("base64"), "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=");
});

test("papel do Hub só lê o contexto da própria empresa", async () => {
  const pg = new PGlite();
  await pg.exec(SCHEMA);
  await pg.exec(PROTECAO);
  for (const e of ["aurora", "vitalis"]) {
    await pg.exec(`
      insert into empresas (id, nome, mercado, area, agente_id) values ('${e}', '${e}', 'm', 'a', 'x');
      insert into usuarios (id, empresa_id, nome, perfil) values ('u_${e}', '${e}', 'U', 'solicitante');
      insert into filas (empresa_id, slug, nome, escopo) values ('${e}', 'fila-${e}', 'Fila ${e}', 'e');
      insert into categorias (empresa_id, slug, nome, fila_padrao, discriminadores, campos_obrigatorios, regra_de_roteamento)
        values ('${e}', 'cat', 'Cat', 'fila-${e}', '["o que aparece", "desde quando"]', '["aplicacao"]', 'r');
      insert into chamados (empresa_id, solicitante_id, status, texto_inicial, resultado, enviado_em)
        values ('${e}', 'u_${e}', 'aguardando_triagem', 'texto de ${e}', '{"aplicacao": "app-${e}", "resumo": "resumo ${e}"}', now());
      insert into tokens_conector (empresa_id, hash, prefixo) values ('${e}', 'hash-${e}', 'cpk_x');
    `);
    await pg.exec(sqlVisoes(e) + sqlPapel(e, verificadorScram("senha-de-teste")) + sqlPermissoes(e));
  }

  const config = await pg.query<{ rolconfig: string[]; rolcanlogin: boolean; rolinherit: boolean }>(
    "select rolconfig, rolcanlogin, rolinherit from pg_roles where rolname = 'hub_aurora'",
  );
  assert.equal(config.rows[0].rolcanlogin, true);
  assert.equal(config.rows[0].rolinherit, false);
  assert.ok(config.rows[0].rolconfig.includes("search_path=hub_aurora"));
  assert.ok(config.rows[0].rolconfig.includes("default_transaction_read_only=on"));

  await pg.exec("set role hub_aurora");
  const filas = await pg.query<{ slug: string }>("select slug from hub_aurora.filas");
  assert.deepEqual(filas.rows.map((f) => f.slug), ["fila-aurora"]);

  const cat = await pg.query<{ discriminadores: string }>("select discriminadores from hub_aurora.categorias");
  assert.equal(cat.rows[0].discriminadores, "o que aparece, desde quando");

  const recentes = await pg.query<Record<string, unknown>>("select * from hub_aurora.chamados_recentes");
  assert.equal(recentes.rows.length, 1);
  assert.equal(recentes.rows[0].aplicacao, "app-aurora");
  assert.ok(!("solicitante_id" in recentes.rows[0]) && !("texto_inicial" in recentes.rows[0]));

  const ctx = await pg.query<{ contexto: { filas: { slug: string }[]; categorias: unknown[]; empresa: { nome: string } } }>(
    "select contexto from hub_aurora.contexto",
  );
  assert.equal(ctx.rows.length, 1);
  assert.equal(ctx.rows[0].contexto.empresa.nome, "aurora");
  assert.deepEqual(ctx.rows[0].contexto.filas.map((f) => f.slug), ["fila-aurora"]);
  assert.equal(ctx.rows[0].contexto.categorias.length, 1);

  const bloqueado = async (sql: string) => assert.rejects(pg.query(sql), /permission denied/i, sql);
  await bloqueado("select * from hub_vitalis.filas");
  await bloqueado("select * from public.chamados");
  await bloqueado("select * from public.usuarios");
  await bloqueado("select * from public.tokens_conector");
  await bloqueado("select * from public.filas");
  await bloqueado("insert into hub_aurora.filas (slug, nome, escopo) values ('x', 'x', 'x')");
  await bloqueado("delete from hub_aurora.filas");
  await bloqueado("create table hub_aurora.nova (x int)");

  await pg.exec("reset role");
  await pg.close();
});

test("empresa inválida não vira SQL", () => {
  for (const ruim of ["aurora; drop table x", "Aurora", "a", "hub-aurora", "aurora'"]) {
    assert.throws(() => nomeAcesso(ruim), /inválida/, ruim);
  }
});

test("o Hub entra pelo mesmo host do app; no pooler, o usuário leva o projeto", () => {
  const pooler = dadosDeConexao("aurora", "postgresql://postgres.abcdefghij:s%40nha@aws-0-sa-east-1.pooler.supabase.com:5432/postgres");
  assert.equal(pooler.usuario, "hub_aurora.abcdefghij");
  assert.equal(pooler.host, "aws-0-sa-east-1.pooler.supabase.com");
  assert.equal(pooler.porta, 5432);
  assert.equal(pooler.banco, "postgres");
  assert.equal(pooler.schema, "hub_aurora");

  const direta = dadosDeConexao("aurora", "postgresql://postgres:senha@db.abcdefghij.supabase.co:5432/postgres");
  assert.equal(direta.usuario, "hub_aurora");
});

test("SSL: Supabase cifra sempre, localhost não, e a URL não sobrescreve a configuração", () => {
  const supa = configPg("postgresql://postgres.ref:x@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require", "");
  assert.deepEqual(supa.ssl, { rejectUnauthorized: false });
  assert.ok(!supa.connectionString.includes("sslmode"));
  assert.ok(supa.connectionString.includes("postgres.ref:x@"));

  assert.equal(configPg("postgres://u:p@localhost:5432/db", "").ssl, false);
  assert.equal(configPg("postgres://u:p@exemplo.com:5432/db?sslmode=disable", "").ssl, false);
});

test("ferramentas do conector PostgreSQL contam como consulta ao catálogo", () => {
  for (const nome of ["run_query", "run_query_contexto_aurora", "show_tables_contexto_aurora", "describe_table", "inspect_query_x"]) {
    assert.ok(eFerramentaDeCatalogo(nome), nome);
  }
  assert.equal(eFerramentaDeCatalogo("run_queryx"), false);
});
