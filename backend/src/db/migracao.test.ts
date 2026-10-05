import assert from "node:assert/strict";
import { test } from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { SCHEMA } from "./schema.js";

const EMPRESAS = `
create table empresas (id text primary key, nome text not null, mercado text not null, area text not null, agente_id text not null);
insert into empresas values ('aurora', 'Aurora', 'm', 'a', ''), ('vitalis', 'Vitalis', 'm', 'a', '');`;

const tabela = (nome: string) => `
create table ${nome} (
  empresa_id text not null references empresas(id), slug text not null, nome text not null, apelidos text not null,
  uso text not null default '', acesso text not null default '', observacao text not null default '',
  primary key (empresa_id, slug));`;

test("banco antigo: a tabela aplicacoes vira servicos, com os dados", async () => {
  const pg = new PGlite();
  await pg.exec(EMPRESAS + tabela("aplicacoes") + `insert into aplicacoes (empresa_id, slug, nome, apelidos) values ('aurora', 'pagaflow', 'PagaFlow', 'portal');`);
  await pg.exec(SCHEMA);
  const r = await pg.query<{ slug: string }>("select slug from servicos");
  assert.deepEqual(r.rows.map((x) => x.slug), ["pagaflow"]);
  assert.equal((await pg.query<{ t: string | null }>("select to_regclass('public.aplicacoes')::text as t")).rows[0].t, null);
  await pg.close();
});

test("renomeada à mão e a antiga voltou: junta as duas sem sobrescrever e apaga a antiga", async () => {
  const pg = new PGlite();
  await pg.exec(
    EMPRESAS +
      tabela("servicos") +
      tabela("aplicacoes") +
      `insert into servicos (empresa_id, slug, nome, apelidos) values ('aurora', 'pagaflow', 'PagaFlow', 'portal');
       insert into aplicacoes (empresa_id, slug, nome, apelidos) values ('vitalis', 'faturaplus', 'FaturaPlus', 'faturamento'),
                                                                       ('aurora', 'pagaflow', 'Duplicado', 'x');
       create schema hub_vitalis;
       create view hub_vitalis.aplicacoes as select * from public.aplicacoes where empresa_id = 'vitalis';`,
  );
  await pg.exec(SCHEMA);
  const r = await pg.query<{ empresa_id: string; slug: string; nome: string }>("select empresa_id, slug, nome from servicos order by 1, 2");
  assert.deepEqual(r.rows, [
    { empresa_id: "aurora", slug: "pagaflow", nome: "PagaFlow" },
    { empresa_id: "vitalis", slug: "faturaplus", nome: "FaturaPlus" },
  ]);
  assert.equal((await pg.query<{ t: string | null }>("select to_regclass('public.aplicacoes')::text as t")).rows[0].t, null);
  // Rodar de novo não muda nada.
  await pg.exec(SCHEMA);
  assert.equal((await pg.query("select 1 from servicos")).rows.length, 2);
  await pg.close();
});
