import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

// Antes de importar o app: banco em memória, Hub simulado ("#fora" faz o agente rejeitar). Nada sai desta máquina.
process.env.DATABASE_URL = "";
process.env.HUB_MODE = "simulado";

const { createApp } = await import("../app.js");
const { comoSistema, fecharBanco, iniciarBanco } = await import("../db/index.js");
const { definirSenha } = await import("../dominio/autenticacao.js");

let base = "";
let fecharServidor = () => {};
const SENHA = "senha-de-teste";
const sessao: Record<string, string> = {};

async function pedir(metodo: string, rota: string, quem: string, corpo?: unknown) {
  const r = await fetch(base + rota, {
    method: metodo,
    headers: { "Content-Type": "application/json", "x-sessao": sessao[quem] },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- resposta da API, conferida pelos asserts
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

const naTriagem = async (id: number) =>
  ((await pedir("GET", "/api/triagem", "bruna")).json as { id: number; status: string }[]).find((c) => c.id === id);

before(async () => {
  await iniciarBanco({ memoria: true });
  const emails = await comoSistema(async () => {
    const r: Record<string, string> = {};
    for (const u of ["ana", "bruna"]) r[u] = (await definirSenha(u, { senha: SENHA })).email;
    return r;
  });
  const servidor = createApp().listen(0);
  await new Promise((ok) => servidor.once("listening", ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  fecharServidor = () => servidor.close();
  for (const [u, email] of Object.entries(emails)) {
    const r = await fetch(`${base}/api/auth/entrar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha: SENHA }),
    });
    sessao[u] = ((await r.json()) as { token: string }).token;
  }
});

after(async () => {
  fecharServidor();
  await fecharBanco();
});

test("texto sem sentido é recusado antes de abrir o chamado", async () => {
  const antes = (await pedir("GET", "/api/chamados", "ana")).json.length;
  const r = await pedir("POST", "/api/chamados", "ana", { texto: "?????" });
  assert.equal(r.status, 400);
  assert.equal(r.json.erro, "relato_sem_sentido");
  assert.match(r.json.mensagem, /qual sistema/);
  assert.equal((await pedir("GET", "/api/chamados", "ana")).json.length, antes);
});

test("primeira rejeição deixa descrever de novo; o relato novo segue o fluxo normal", async () => {
  const aberto = await pedir("POST", "/api/chamados", "ana", { texto: "me conta uma piada #fora" });
  assert.equal(aberto.status, 201);
  assert.equal(aberto.json.status, "qualificando");
  assert.equal(aberto.json.resultado.status, "fora_do_escopo");
  assert.equal(aberto.json.rejeicoes, 1);
  assert.equal(await naTriagem(aberto.json.id), undefined);

  // Relato novo sem letras: recusado como na abertura, sem chamar o agente.
  assert.equal((await pedir("POST", `/api/chamados/${aberto.json.id}/mensagens`, "ana", { texto: "!!" })).status, 400);

  const r = await pedir("POST", `/api/chamados/${aberto.json.id}/mensagens`, "ana", { texto: "O portal de pagamentos travou ao enviar a remessa" });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "qualificando");
  assert.equal(r.json.resultado.status, "perguntando");
  assert.equal(r.json.rejeicoes, 0);
});

test("segunda rejeição seguida encerra sem ir para a fila; o analista pode trazer de volta", async () => {
  const aberto = await pedir("POST", "/api/chamados", "ana", { texto: "qual o cardápio do almoço? #fora" });
  const id = aberto.json.id as number;
  const encerrado = await pedir("POST", `/api/chamados/${id}/mensagens`, "ana", { texto: "e a previsão do tempo? #fora" });
  assert.equal(encerrado.json.status, "rejeitado");

  // Não é trabalho da fila: aparece só como rejeitado, e o chat não aceita mais mensagens.
  assert.equal((await naTriagem(id))?.status, "rejeitado");
  assert.equal((await pedir("POST", `/api/triagem/${id}/confirmar`, "bruna")).status, 400);
  assert.equal((await pedir("POST", `/api/chamados/${id}/mensagens`, "ana", { texto: "oi de novo" })).status, 409);

  const resgatado = await pedir("POST", `/api/triagem/${id}/resgatar`, "bruna");
  assert.equal(resgatado.status, 200, JSON.stringify(resgatado.json));
  assert.equal(resgatado.json.chamado.status, "aguardando_triagem");
  assert.equal(resgatado.json.chamado.resultado.status, "abstencao");
  assert.ok(resgatado.json.chamado.ajustes.some((a: string) => /Rejeição desfeita/.test(a)));
  assert.equal((await naTriagem(id))?.status, "aguardando_triagem");
  assert.equal((await pedir("POST", `/api/triagem/${id}/resgatar`, "bruna")).status, 409);
});

test("rejeição depois de uma pergunta do agente vai para o analista", async () => {
  const aberto = await pedir("POST", "/api/chamados", "ana", { texto: "O DespesaCerta não deixa enviar o reembolso" });
  assert.equal(aberto.json.resultado.status, "perguntando");
  const r = await pedir("POST", `/api/chamados/${aberto.json.id}/mensagens`, "ana", { texto: "esquece, me conta uma piada #fora" });
  assert.equal(r.json.status, "aguardando_triagem");
  assert.equal(r.json.resultado.status, "abstencao");
});
