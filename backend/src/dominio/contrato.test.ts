import assert from "node:assert/strict";
import { test } from "node:test";

import { aplicarRegras, lerContrato, MENSAGEM_PRONTO, type Contrato } from "./contrato.js";

const FILAS = ["aplicacoes-corporativas", "identidade-acessos", "infra-conectividade", "operacoes-financeiras"];

function contrato(parcial: Partial<Contrato>): Contrato {
  const lido = lerContrato(JSON.stringify({ mensagem_ao_usuario: "ok", status: "pronto", ...parcial }));
  assert.ok(lido.ok);
  return lido.contrato;
}

test("lê JSON cercado por texto e bloco de código", () => {
  const r = lerContrato('Aqui está:\n```json\n{"mensagem_ao_usuario":"Oi","status":"perguntando"}\n```');
  assert.ok(r.ok);
  assert.equal(r.contrato.status, "perguntando");
  assert.deepEqual(r.contrato.lacunas, []);
});

test("recusa resposta fora do formato", () => {
  assert.equal(lerContrato("Claro, vou ajudar!").ok, false);
  assert.equal(lerContrato('{"status":"talvez"}').ok, false);
});

test("pronto com confiança alta e fila válida passa sem ajuste", () => {
  const r = aplicarRegras(contrato({ fila_sugerida: "operacoes-financeiras", confianca: 0.9 }), {
    perguntasAntes: 1,
    toolCalls: [],
    filasValidas: FILAS,
  });
  assert.equal(r.contrato.status, "pronto");
  assert.deepEqual(r.ajustes, []);
});

test("discriminador sem resposta limita a confiança e leva à abstenção", () => {
  const r = aplicarRegras(
    contrato({ fila_sugerida: "operacoes-financeiras", confianca: 0.85, discriminadores_sem_resposta: ["ha_aprovacao_ou_pendencia"] }),
    { perguntasAntes: 2, toolCalls: [], filasValidas: FILAS },
  );
  assert.equal(r.contrato.status, "abstencao");
  assert.equal(r.contrato.confianca, 0.6);
  assert.equal(r.ajustes.length, 2);
});

test("fila fora do catálogo vira abstenção", () => {
  const r = aplicarRegras(contrato({ fila_sugerida: "financeiro", confianca: 0.95 }), {
    perguntasAntes: 0,
    toolCalls: [],
    filasValidas: FILAS,
  });
  assert.equal(r.contrato.status, "abstencao");
});

test("quarta pergunta é bloqueada pelo teto", () => {
  const r = aplicarRegras(contrato({ status: "perguntando" }), { perguntasAntes: 3, toolCalls: [], filasValidas: FILAS });
  assert.equal(r.contrato.status, "abstencao");
});

test("consulta com erro no turno impede 'pronto'", () => {
  const r = aplicarRegras(contrato({ fila_sugerida: "aplicacoes-corporativas", confianca: 0.9 }), {
    perguntasAntes: 1,
    toolCalls: [{ tool: "query_file_x", arguments: {}, result: "erro", status: "error", isError: true, latencyMs: 1 }],
    filasValidas: FILAS,
  });
  assert.equal(r.contrato.status, "abstencao");
});

test("falha de consulta num turno anterior ainda conta, a menos que a consulta tenha sido refeita", () => {
  const falha = { tool: "query_file_x", arguments: {}, result: "erro", status: "error", isError: true, latencyMs: 1 };
  const sucesso = { ...falha, result: "ok", status: "success", isError: false };
  const base = { perguntasAntes: 1, filasValidas: FILAS };
  const pronto = contrato({ fila_sugerida: "aplicacoes-corporativas", confianca: 0.9 });

  assert.equal(aplicarRegras(pronto, { ...base, toolCalls: [falha] }).contrato.status, "abstencao");
  assert.equal(aplicarRegras(pronto, { ...base, toolCalls: [falha, sucesso] }).contrato.status, "pronto");
});

test("mensagem final nunca revela a fila; o ajuste só aparece quando revelava", () => {
  const base = { perguntasAntes: 1, toolCalls: [], filasValidas: FILAS, nomesFilas: [...FILAS, "Operações Financeiras"] };
  const revelando = aplicarRegras(
    contrato({ fila_sugerida: "operacoes-financeiras", confianca: 0.9, mensagem_ao_usuario: "Vamos encaminhar para a equipe de Operações Financeiras." }),
    base,
  );
  assert.equal(revelando.contrato.mensagem_ao_usuario, MENSAGEM_PRONTO);
  assert.equal(revelando.ajustes.length, 1);

  const neutra = aplicarRegras(contrato({ fila_sugerida: "operacoes-financeiras", confianca: 0.9, mensagem_ao_usuario: "Obrigado!" }), base);
  assert.equal(neutra.contrato.mensagem_ao_usuario, MENSAGEM_PRONTO);
  assert.deepEqual(neutra.ajustes, []);
});

test("falha de ferramenta de memória não derruba a sugestão", () => {
  const memoria = { tool: "log_decision", arguments: {}, result: "erro", status: "error", isError: true, latencyMs: 1 };
  const r = aplicarRegras(contrato({ fila_sugerida: "aplicacoes-corporativas", confianca: 0.9 }), {
    perguntasAntes: 1,
    toolCalls: [memoria],
    filasValidas: FILAS,
  });
  assert.equal(r.contrato.status, "pronto");
});

test("segurança nunca é alterada", () => {
  const r = aplicarRegras(contrato({ status: "seguranca", confianca: 0.2 }), { perguntasAntes: 5, toolCalls: [], filasValidas: FILAS });
  assert.equal(r.contrato.status, "seguranca");
});
