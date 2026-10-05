import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import * as chamados from "../dominio/chamados.js";
import * as triagem from "../dominio/triagem.js";
import type { Usuario } from "../dominio/usuarios.js";
import { comEmpresa, comoSistema, db, fecharBanco, iniciarBanco } from "./index.js";

// Banco em memória: a carga inicial traz as três empresas dos dossiês de dados/. Nunca toca o banco do .env.
const renata: Usuario = { id: "renata", empresa_id: "vitalis", nome: "Renata Alves", perfil: "analista" };
const bruna: Usuario = { id: "bruna", empresa_id: "aurora", nome: "Bruna Tavares", perfil: "analista" };
let idAurora = 0;
let idVitalis = 0;

before(async () => {
  await iniciarBanco({ memoria: true });
  await comoSistema(async () => {
    const novo = (empresa: string, solicitante: string, texto: string) =>
      db.one<{ id: number }>(
        `insert into chamados (empresa_id, solicitante_id, status, texto_inicial, enviado_em)
         values ($1, $2, 'aguardando_triagem', $3, now()) returning id`,
        [empresa, solicitante, texto],
      );
    idAurora = (await novo("aurora", "ana", "relato da aurora"))!.id;
    idVitalis = (await novo("vitalis", "paula", "relato da vitalis"))!.id;
    await db.query(`insert into turnos (chamado_id, papel, texto) values ($1, 'solicitante', 'turno aurora'), ($2, 'solicitante', 'turno vitalis')`, [
      idAurora,
      idVitalis,
    ]);
  });
});

after(() => fecharBanco());

test("sem contexto, o banco recusa a consulta", async () => {
  await assert.rejects(() => db.query("select 1"), /fora de contexto/);
  await assert.rejects(() => db.transacao(async () => 1), /fora de contexto/);
});

test("na empresa, o banco só devolve as linhas dela, mesmo sem where", async () => {
  await comEmpresa("vitalis", async () => {
    const empresas = await db.query<{ id: string }>("select id from empresas");
    assert.deepEqual(empresas.map((e) => e.id), ["vitalis"]);
    const daFila = await db.query<{ empresa_id: string }>("select empresa_id from chamados");
    assert.deepEqual(daFila.map((c) => c.empresa_id), ["vitalis"]);
    const conversa = await db.query<{ texto: string }>("select texto from turnos");
    assert.deepEqual(conversa.map((t) => t.texto), ["turno vitalis"]);
    for (const tabela of ["usuarios", "filas", "aplicacoes", "categorias", "procedimentos"]) {
      const linhas = await db.query<{ empresa_id: string }>(`select empresa_id from ${tabela}`);
      assert.ok(linhas.length > 0, tabela);
      assert.ok(linhas.every((l) => l.empresa_id === "vitalis"), tabela);
    }
  });
});

test("na empresa, não grava nem altera dados de outra", async () => {
  await comEmpresa("vitalis", async () => {
    await assert.rejects(
      () => db.query(`insert into chamados (empresa_id, solicitante_id, status, texto_inicial) values ('aurora', 'ana', 'qualificando', 'x')`),
      /row-level security/i,
    );
    await assert.rejects(
      () => db.query(`insert into turnos (chamado_id, papel, texto) values ($1, 'solicitante', 'invasão')`, [idAurora]),
      /row-level security/i,
    );
    const alterados = await db.query("update chamados set texto_inicial = 'alterado' where id = $1 returning id", [idAurora]);
    assert.equal(alterados.length, 0);
  });
  const original = await comoSistema(() => db.one<{ texto_inicial: string }>("select texto_inicial from chamados where id = $1", [idAurora]));
  assert.equal(original?.texto_inicial, "relato da aurora");
});

test("o papel das empresas não lê senha, e-mail, sessão nem token, e não muda o cadastro", async () => {
  await comEmpresa("aurora", async () => {
    for (const sql of [
      "select senha_hash from usuarios",
      "select email from usuarios",
      "select * from sessoes",
      "select * from tokens_conector",
      "update empresas set agente_id = 'x'",
      "delete from chamados",
    ]) {
      await assert.rejects(() => db.query(sql), /permission denied/i, sql);
    }
  });
});

test("transação na empresa também passa pelo RLS", async () => {
  const visto = await comEmpresa("aurora", () =>
    db.transacao(async () => (await db.query<{ empresa_id: string }>("select empresa_id from chamados")).map((c) => c.empresa_id)),
  );
  assert.deepEqual(visto, ["aurora"]);
});

test("pelo domínio: a analista da Vitalis não abre chamado da Aurora nem vê a fila dela", async () => {
  await comEmpresa("vitalis", async () => {
    await assert.rejects(() => chamados.carregarComAcesso(renata, idAurora), /não encontrado/i);
    // Mesmo pedindo a fila da Aurora (um bug no código), o banco devolve vazio.
    assert.equal((await triagem.filaDaEmpresa("aurora")).length, 0);
    assert.deepEqual((await triagem.filaDaEmpresa("vitalis")).map((c) => (c as { id: number }).id), [idVitalis]);
  });
  const daAurora = await comEmpresa("aurora", () => chamados.carregarComAcesso(bruna, idAurora));
  assert.equal(daAurora.id, idAurora);
});
