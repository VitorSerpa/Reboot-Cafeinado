import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

// Antes de importar o app: banco em memória, Hub simulado. Nada sai desta máquina.
process.env.DATABASE_URL = "";
process.env.HUB_MODE = "simulado";

const { createApp } = await import("../app.js");
const { comoSistema, fecharBanco, iniciarBanco } = await import("../db/index.js");
const { definirSenha } = await import("../dominio/autenticacao.js");
const tokens = await import("../dominio/tokens.js");
const empresas = await import("../dominio/empresas.js");

let base = "";
let fecharServidor = () => {};
const SENHA = "senha-de-teste";
const sessao: Record<string, string> = {};

async function pedir(metodo: string, rota: string, quem?: string, corpo?: unknown) {
  const r = await fetch(base + rota, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(quem ? { "x-sessao": sessao[quem] } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- resposta da API, conferida pelos asserts
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

/** Abre um chamado e o manda para a fila pelo formulário curto (determinístico, sem depender do agente). */
async function chamadoNaFila(quem: string, texto: string) {
  const aberto = await pedir("POST", "/api/chamados", quem, { texto });
  // Empresa sem agente (ou Hub fora): a resposta é o formulário curto, com o id do chamado.
  const id = aberto.json?.id ?? aberto.json?.chamadoId;
  assert.ok(id, `chamado de ${quem}: ${JSON.stringify(aberto.json)}`);
  if (aberto.json?.status !== "aguardando_triagem") {
    const r = await pedir("POST", `/api/chamados/${id}/contingencia`, quem, { campos: { o_que_tentava: texto } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  return Number(id);
}

before(async () => {
  await iniciarBanco({ memoria: true });
  const emails = await comoSistema(async () => {
    const r: Record<string, string> = {};
    for (const u of ["ana", "bruna", "paula", "renata"]) r[u] = (await definirSenha(u, { senha: SENHA })).email;
    return r;
  });
  const servidor = createApp().listen(0);
  await new Promise((ok) => servidor.once("listening", ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  fecharServidor = () => servidor.close();
  for (const [u, email] of Object.entries(emails)) {
    const r = await pedir("POST", "/api/auth/entrar", undefined, { email, senha: SENHA });
    assert.equal(r.status, 200, `${u}: ${JSON.stringify(r.json)}`);
    sessao[u] = r.json.token;
  }
});

after(async () => {
  fecharServidor();
  await fecharBanco();
});

test("cada usuário vê a própria empresa no /auth/me", async () => {
  assert.equal((await pedir("GET", "/api/auth/me", "renata")).json.empresa_nome, "Rede Vitalis");
  assert.equal((await pedir("GET", "/api/auth/me", "ana")).json.empresa_nome, "Aurora Distribuição");
});

test("chamados, triagem e catálogo não cruzam a fronteira da empresa", async () => {
  const daAurora = await chamadoNaFila("ana", "Não consigo pagar o fornecedor pelo portal");
  const daVitalis = await chamadoNaFila("paula", "A guia do convênio voltou e não consigo reenviar");

  const filaVitalis = await pedir("GET", "/api/triagem", "renata");
  assert.equal(filaVitalis.status, 200);
  assert.ok(filaVitalis.json.some((c: { id: number }) => c.id === daVitalis));
  assert.ok(!filaVitalis.json.some((c: { id: number }) => c.id === daAurora));

  assert.equal((await pedir("GET", `/api/triagem/${daAurora}`, "renata")).status, 404);
  assert.equal((await pedir("GET", `/api/triagem/${daVitalis}`, "bruna")).status, 404);
  assert.equal((await pedir("GET", `/api/chamados/${daAurora}`, "paula")).status, 404);
  assert.equal((await pedir("POST", `/api/triagem/${daAurora}/corrigir`, "renata", { fila: "acessos", motivo: "x" })).status, 404);

  const catalogo = await pedir("GET", "/api/catalogo", "renata");
  assert.deepEqual(catalogo.json.filas.map((f: { slug: string }) => f.slug).sort(), [
    "acessos",
    "processos-administrativos",
    "rede-equipamentos",
    "sistemas-clinicas",
  ]);
});

test("o conector /hub/v1 só entrega a empresa do token", async () => {
  const { token } = await comoSistema(() => tokens.gerar("vitalis", "teste"));
  const r = await fetch(`${base}/hub/v1/contexto`, { headers: { Authorization: `Bearer ${token}` } });
  const contexto = (await r.json()) as { empresa: { nome: string }; filas: { slug: string }[] };
  assert.equal(r.status, 200);
  assert.equal(contexto.empresa.nome, "Rede Vitalis");
  assert.ok(contexto.filas.every((f: { slug: string }) => !["operacoes-financeiras", "secretaria-financeiro"].includes(f.slug)));
});

test("empresa suspensa perde o acesso na hora", async () => {
  await comoSistema(() => empresas.definirStatus("vitalis", "suspensa"));
  assert.equal((await pedir("GET", "/api/auth/me", "renata")).status, 401);
  assert.equal((await pedir("GET", "/api/auth/me", "ana")).status, 200);
});
