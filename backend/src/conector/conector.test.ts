import assert from "node:assert/strict";
import { test } from "node:test";

import { pontuarAplicacao } from "../dominio/catalogo.js";
import { eFerramentaDeCatalogo } from "../dominio/contrato.js";
import { hashDoToken } from "../dominio/tokens.js";

test("hash do token é estável e não revela o token", () => {
  const token = "cpk_" + "a".repeat(32);
  assert.equal(hashDoToken(token), hashDoToken(token));
  assert.notEqual(hashDoToken(token), hashDoToken(token + "b"));
  assert.equal(hashDoToken(token).length, 64);
  assert.ok(!hashDoToken(token).includes("aaaa"));
});

test("busca de aplicação: nome e apelido antes de uso", () => {
  const pagaflow = { slug: "pagaflow", nome: "PagaFlow", apelidos: ["portal de pagamentos", "portal", "pagamento"], uso: "Remessas e acompanhamento de pagamentos" };
  assert.equal(pontuarAplicacao("PagaFlow", pagaflow), 100);
  assert.equal(pontuarAplicacao("portal", pagaflow), 90);
  assert.ok(pontuarAplicacao("o portal de pagamentos travou", pagaflow) >= 60);
  assert.equal(pontuarAplicacao("SAP", pagaflow), 0);
});

test("ferramentas do conector API contam como consulta ao catálogo", () => {
  for (const nome of ["obterContexto", "catalogo_aurora_obterContexto", "obter_contexto", "buscarAplicacao", "listarChamadosAbertos", "read_file_catalogo_triagem"]) {
    assert.ok(eFerramentaDeCatalogo(nome), nome);
  }
  assert.equal(eFerramentaDeCatalogo("log_decision"), false);
});
