import assert from "node:assert/strict";
import { test } from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { origemPermitida } from "../config/cors.js";
import { SCHEMA } from "../db/schema.js";
import { DESCRICAO_AURORA, SQL_EMPRESA_AURORA } from "../db/seed.js";
import { validarAgenteId } from "./agentes.js";
import { criaSenhasNaSubida } from "./autenticacao.js";

test("CORS: em desenvolvimento aceita qualquer porta de localhost; fora dele, só a lista", () => {
  const lista = ["http://localhost:3000"];
  assert.equal(origemPermitida("http://localhost:3000", lista, "production"), true);
  assert.equal(origemPermitida("http://localhost:3001", lista, "production"), false);
  assert.equal(origemPermitida("http://localhost:3001", lista, "development"), true);
  assert.equal(origemPermitida("http://127.0.0.1:3002", lista, "development"), true);
  assert.equal(origemPermitida("http://exemplo.com", lista, "development"), false);
  assert.equal(origemPermitida("http://localhost.exemplo.com", lista, "development"), false);
  assert.equal(origemPermitida(undefined, lista, "production"), true);
});

test("senhas na subida: só com o banco local, em desenvolvimento", () => {
  assert.equal(criaSenhasNaSubida("development", false), true);
  assert.equal(criaSenhasNaSubida("development", true), false);
  assert.equal(criaSenhasNaSubida("production", false), false);
});

test("agente: só aceita UUID", () => {
  assert.equal(validarAgenteId(" 06ABC3A3-1c9f-785e-8000-519434bce89a "), "06abc3a3-1c9f-785e-8000-519434bce89a");
  for (const ruim of ["", "teste", "qualificador-aurora-banco", "06abc3a3-1c9f-785e-8000"]) {
    assert.throws(() => validarAgenteId(ruim), /UUID/, ruim);
  }
});

test("seed: o agente que está no banco não muda quando outro backend sobe com outro .env", async () => {
  const pg = new PGlite();
  await pg.exec(SCHEMA);
  const agente = async () => (await pg.query<{ agente_id: string }>("select agente_id from empresas where id = 'aurora'")).rows[0].agente_id;

  await pg.query(SQL_EMPRESA_AURORA, ["agente-do-primeiro", DESCRICAO_AURORA]);
  assert.equal(await agente(), "agente-do-primeiro");

  await pg.query(SQL_EMPRESA_AURORA, ["agente-de-outra-maquina", DESCRICAO_AURORA]);
  assert.equal(await agente(), "agente-do-primeiro");

  await pg.query("update empresas set agente_id = '' where id = 'aurora'");
  await pg.query(SQL_EMPRESA_AURORA, ["agente-novo", DESCRICAO_AURORA]);
  assert.equal(await agente(), "agente-novo");
  await pg.close();
});
