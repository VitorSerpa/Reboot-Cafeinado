import assert from "node:assert/strict";
import { test } from "node:test";

import { consolidarTurno, lerEventos } from "./sse.js";

async function* pedacos(texto: string, tamanho: number) {
  const bytes = new TextEncoder().encode(texto);
  for (let i = 0; i < bytes.length; i += tamanho) yield bytes.slice(i, i + tamanho);
}

// Formato observado no Playground do Hub em 28/09 (mesmo backend do runtime).
const STREAM = [
  'event: session_started\ndata: {"session_id":"s-123","external_session_id":null}\n\n',
  'event: tool_call\ndata: {"tool":"query_file_catalogo_triagem","arguments":{"file_name":"filas"},"result":"{\\"status\\": \\"ok\\"}","status":"success","latency_ms":42}\n\n',
  'event: content\ndata: {"accumulated":"{\\"mensagem_ao_usuario\\":\\"Oi\\""}\n\n',
  'event: content\ndata: {"accumulated":"{\\"mensagem_ao_usuario\\":\\"Oi\\",\\"status\\":\\"perguntando\\"}"}\n\n',
  'event: completed\ndata: {"tokens":{"input":1800,"output":90},"latency_ms":5300}\n\n',
].join("");

test("consolida um turno lendo o stream em pedaços pequenos", async () => {
  const r = await consolidarTurno(lerEventos(pedacos(STREAM, 7)));
  assert.equal(r.sessionId, "s-123");
  assert.equal(r.texto, '{"mensagem_ao_usuario":"Oi","status":"perguntando"}');
  assert.equal(r.toolCalls.length, 1);
  assert.equal(r.toolCalls[0].tool, "query_file_catalogo_triagem");
  assert.equal(r.toolCalls[0].isError, false);
  assert.deepEqual(r.tokens, { input: 1800, output: 90 });
  assert.equal(r.latenciaMs, 5300);
  assert.deepEqual(r.eventos, ["session_started", "tool_call", "content", "content", "completed"]);
});

test("registra evento de erro e tool_call com falha", async () => {
  const stream =
    'event: tool_call\ndata: {"tool":"query_file_x","arguments":{},"result":"invalid literal","is_error":true}\n\n' +
    'event: error\ndata: {"code":"TOOL_FAILED","category":"tool","run_id":"r-9","message":"falhou"}\n\n';
  const r = await consolidarTurno(lerEventos(pedacos(stream, 50)));
  assert.equal(r.toolCalls[0].isError, true);
  assert.equal(r.erros[0].code, "TOOL_FAILED");
  assert.equal(r.erros[0].runId, "r-9");
});

test("aceita CRLF e stream sem linha em branco final", async () => {
  const r = await consolidarTurno(lerEventos(pedacos('event: content\r\ndata: {"accumulated":"x"}', 5)));
  assert.equal(r.texto, "x");
});
