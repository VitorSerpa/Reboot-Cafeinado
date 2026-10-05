import assert from "node:assert/strict";
import { after, before, test } from "node:test";

// Antes de importar o app: banco local e Hub simulado, qualquer que seja o .env desta máquina.
process.env.DATABASE_URL = "";
process.env.HUB_MODE = "simulado";

const { comoSistema, db, fecharBanco, iniciarBanco } = await import("../db/index.js");
const empresas = await import("./empresas.js");
const { definirAgente } = await import("./agentes.js");
const { definirSenha, definirSenhaDeTodos, entrar } = await import("./autenticacao.js");
const { abrirSessao, usuarioDaSessao } = await import("./usuarios.js");
const { notaDoSistema } = await import("./chamados.js");

const UUID = "06abc3a3-1c9f-785e-8000-519434bce89a";

before(() => iniciarBanco({ memoria: true }));
after(() => fecharBanco());

test("os três dossiês do repositório são válidos", () => {
  assert.deepEqual(empresas.empresasComDossie(), ["aurora", "horizonte", "vitalis"]);
  for (const e of empresas.empresasComDossie()) {
    const d = empresas.lerDossie(e);
    assert.ok(d.usuarios.length >= 3, e);
    assert.match(d.conector_slug, /^postgres-[a-z0-9-]+$/, e);
  }
});

test("dossiê inválido diz o que está errado", () => {
  const r = empresas.Dossie.safeParse({ nome: "X", usuarios: [] });
  assert.equal(r.success, false);
  const campos = r.error!.issues.map((i) => i.path[0]);
  for (const c of ["nome", "descricao", "dominio_email", "conector_slug", "usuarios"]) assert.ok(campos.includes(c), c);
});

test("a carga inicial (banco local) traz as três empresas, com catálogo e usuários", async () => {
  const lista = await comoSistema(() => empresas.listar());
  assert.deepEqual(lista.map((e) => e.id).sort(), ["aurora", "horizonte", "vitalis"]);
  for (const e of lista) {
    assert.equal(e.filas, 4, e.id);
    assert.equal(e.categorias, 5, e.id);
    assert.equal(e.usuarios, 3, e.id);
  }
});

test("importar de novo não sobrescreve o que já está no banco", async () => {
  await comoSistema(async () => {
    await db.query("update empresas set agente_id = $2, descricao = 'editada no banco' where id = $1", ["vitalis", UUID]);
    const r = await empresas.importarDossie("vitalis");
    assert.equal(r.criada, false);
    assert.deepEqual(r.usuariosNovos, []);
    const e = await db.one<{ agente_id: string; descricao: string }>("select agente_id, descricao from empresas where id = 'vitalis'");
    assert.equal(e?.agente_id, UUID);
    assert.equal(e?.descricao, "editada no banco");
  });
});

test("o prompt de cada empresa usa o schema e a ferramenta dela, e nada de outra", async () => {
  const lista = await comoSistema(() => db.query<{ id: string; nome: string; area: string; descricao: string; conector_slug: string }>(
    "select id, nome, area, descricao, conector_slug from empresas",
  ));
  for (const e of lista) {
    const p = empresas.gerarPrompt(e);
    assert.ok(p.includes(`select contexto from hub_${e.id}.contexto`), e.id);
    assert.ok(p.includes(empresas.ferramentaDoConector(e.conector_slug)), e.id);
    assert.ok(!/\{\{|<!--/.test(p), `${e.id}: marcador ou comentário sobrando`);
    for (const outra of lista.filter((o) => o.id !== e.id)) {
      assert.ok(!p.includes(`hub_${outra.id}`) && !p.includes(outra.nome), `${e.id} cita ${outra.id}`);
    }
    assert.ok(!/PagaFlow|DespesaCerta|ContaFechamento/.test(p) || e.id === "aurora", `${e.id}: sistema da Aurora no prompt`);
  }
});

test("definir-conector grava o slug real do Hub e gera o prompt com a ferramenta certa", async () => {
  assert.equal(empresas.nomeDoConector("postgres-horizonte"), "Postgres Horizonte");
  assert.equal(empresas.ferramentaDoConector("postgres-rede-vitalis"), "postgres_rede_vitalis_query");
  await comoSistema(async () => {
    const r = await empresas.definirConector("vitalis", "postgres-rede-vitalis");
    assert.equal(r.ferramenta, "postgres_rede_vitalis_query");
    const e = await db.one<{ conector_slug: string }>("select conector_slug from empresas where id = 'vitalis'");
    assert.equal(e?.conector_slug, "postgres-rede-vitalis");
    await assert.rejects(() => empresas.definirConector("vitalis", "Postgres Vitalis"), /inválido/);
  });
});

test("status: em implantação até ter agente e login; ativa depois", async () => {
  await comoSistema(async () => {
    assert.equal(await empresas.atualizarStatus("horizonte"), "implantacao");
    await definirSenha("rafael");
    const r = await definirAgente("horizonte", UUID);
    assert.equal(r.status, "ativa");
  });
});

test("empresa suspensa: ninguém entra, e quem estava dentro sai", async () => {
  await comoSistema(async () => {
    const { email, senha } = await definirSenha("marcos", { senha: "senha-de-teste" });
    const token = await abrirSessao("marcos");
    assert.equal((await usuarioDaSessao(token))?.empresa_nome, "Instituto Horizonte");

    await empresas.definirStatus("horizonte", "suspensa");
    assert.equal(await usuarioDaSessao(token), undefined);
    await assert.rejects(() => entrar(email, senha), /suspenso/);

    await empresas.definirStatus("horizonte", "ativa");
    assert.equal((await entrar(email, senha)).empresa_id, "horizonte");
  });
});

test("senha escolhida para todos de uma empresa: entra com ela, e a senha não volta na resposta", async () => {
  await comoSistema(async () => {
    const feitos = await definirSenhaDeTodos("senha-comum", "vitalis");
    assert.deepEqual(feitos.map((u) => u.usuario).sort(), ["diego", "paula", "renata"]);
    assert.ok(feitos.every((u) => !("senha" in u)));
    assert.equal((await entrar("renata@vitalis.test", "senha-comum")).empresa_id, "vitalis");
    await assert.rejects(() => definirSenhaDeTodos("abc"), /pelo menos/);
    await assert.rejects(() => definirSenhaDeTodos("senha-comum", "inexistente"), /Nenhum usuário/);
  });
});

test("a nota do sistema traz a data de hoje, no fuso de São Paulo", () => {
  // 05/10/2026 às 01h UTC ainda é domingo, 04/10, em São Paulo.
  assert.match(notaDoSistema(0, new Date("2026-10-05T01:00:00Z")), /hoje é domingo, 04\/10\/2026\. Perguntas já feitas: 0 de 3\./);
  assert.match(notaDoSistema(3, new Date("2026-10-05T15:00:00Z")), /segunda-feira, 05\/10\/2026.*Limite atingido/);
});
