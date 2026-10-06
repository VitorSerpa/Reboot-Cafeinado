import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { env } from "../config/env.js";
import { DADOS_DIR } from "../dados/csv.js";
import { db } from "../db/index.js";
import * as acessoBanco from "./acessoBanco.js";
import { definirSenha } from "./autenticacao.js";
import { cargaInicialSeVazio, carregarDoCsv } from "./catalogo.js";
import { ErroApp } from "./erros.js";
import { encerrarSessoesDoUsuario } from "./usuarios.js";

/**
 * Empresas (tenants) do app. O cadastro oficial é a tabela `empresas`. O dossiê em `dados/<empresa>/`
 * (empresa.json + os CSVs do catálogo) é só a entrada do provisionamento: depois da primeira carga, quem manda é o banco,
 * e rodar de novo nunca sobrescreve o que já foi preenchido.
 *
 * Uma conta só no Kaffa AI Hub, com uma API Key da plataforma. Por empresa: agente, conector `postgres-<empresa>`
 * e o usuário do banco `hub_<empresa>`, que só lê as views da empresa.
 */

export const HUB_DIR = join(DADOS_DIR, "..", "hub");
const MODELO_PROMPT = join(HUB_DIR, "prompt-qualificador.modelo.md");
/** Onde ficam os prompts gerados. Os testes apontam para uma pasta temporária, para não reescrever os do repositório. */
const pastaPrompts = () => process.env.PROMPTS_DIR || join(HUB_DIR, "prompts");

const SLUG = /^[a-z][a-z0-9_]{1,30}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UsuarioDoDossie = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/, "id: letras minúsculas, números, - e _"),
  nome: z.string().min(2),
  perfil: z.enum(["solicitante", "analista"]),
  email: z.email().optional(),
});

export const Dossie = z.object({
  nome: z.string().min(2),
  mercado: z.string().min(2),
  area: z.string().min(2),
  descricao: z.string().min(20),
  dominio_email: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "domínio de e-mail, ex.: vitalis.test"),
  agente_id: z.union([z.literal(""), z.string().regex(UUID, "UUID do agente no Hub")]).default(""),
  conector_slug: z.string().regex(/^[a-z0-9-]+$/, "slug do conector no Hub, ex.: postgres-vitalis"),
  usuarios: z
    .array(UsuarioDoDossie)
    .min(2)
    .refine((u) => u.some((x) => x.perfil === "solicitante") && u.some((x) => x.perfil === "analista"), {
      message: "o dossiê precisa de pelo menos um solicitante e um analista",
    }),
});
export type Dossie = z.infer<typeof Dossie>;

/** Nome da ferramenta que o agente recebe do conector Database do Hub (`postgres-aurora` → `postgres_aurora_query`). */
export const ferramentaDoConector = (slug: string) => `${slug.replace(/-/g, "_")}_query`;

export const emailDoUsuario = (u: { id: string; email?: string }, dominio: string) => u.email ?? `${u.id}@${dominio}`;

export function validarEmpresa(empresa: string) {
  if (!SLUG.test(empresa)) throw new ErroApp(400, "empresa", `Empresa inválida: "${empresa}" (letras minúsculas, números e _).`);
  return empresa;
}

/** Empresas com dossiê no repositório (pastas de `dados/` com empresa.json). */
export function empresasComDossie() {
  return readdirSync(DADOS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && SLUG.test(d.name) && existsSync(join(DADOS_DIR, d.name, "empresa.json")))
    .map((d) => d.name)
    .sort();
}

export function lerDossie(empresa: string): Dossie {
  validarEmpresa(empresa);
  const caminho = join(DADOS_DIR, empresa, "empresa.json");
  if (!existsSync(caminho)) throw new ErroApp(404, "dossie", `Não há dossiê em dados/${empresa}/empresa.json.`);
  const lido = Dossie.safeParse(JSON.parse(readFileSync(caminho, "utf8")));
  if (!lido.success) {
    const problemas = lido.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`).join("; ");
    throw new ErroApp(400, "dossie", `dados/${empresa}/empresa.json inválido: ${problemas}`);
  }
  return lido.data;
}

/**
 * Cadastro, usuários e catálogo a partir do dossiê. Idempotente: cria o que falta e preenche só campos vazios.
 * Não cria senhas nem o acesso do Hub (isso é do `provisionar`).
 */
export async function importarDossie(empresa: string, opcoes: { recarregarCatalogo?: boolean } = {}) {
  const d = lerDossie(empresa);
  const [cadastro] = await db.query<{ criada: boolean }>(
    `insert into empresas (id, nome, mercado, area, descricao, agente_id, dominio_email, conector_slug, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'implantacao')
     on conflict (id) do update set
       descricao     = case when empresas.descricao = '' then excluded.descricao else empresas.descricao end,
       agente_id     = case when empresas.agente_id = '' then excluded.agente_id else empresas.agente_id end,
       dominio_email = case when empresas.dominio_email = '' then excluded.dominio_email else empresas.dominio_email end,
       conector_slug = case when empresas.conector_slug = '' then excluded.conector_slug else empresas.conector_slug end
     returning (xmax = 0) as criada`,
    [empresa, d.nome, d.mercado, d.area, d.descricao, d.agente_id, d.dominio_email, d.conector_slug],
  );

  const usuariosNovos: string[] = [];
  for (const u of d.usuarios) {
    const existente = await db.one<{ empresa_id: string }>("select empresa_id from usuarios where id = $1", [u.id]);
    if (existente && existente.empresa_id !== empresa) {
      throw new ErroApp(409, "usuario", `O usuário "${u.id}" já existe na empresa "${existente.empresa_id}". Use outro id no dossiê.`);
    }
    if (existente) continue;
    await db.query("insert into usuarios (id, empresa_id, nome, perfil, email) values ($1, $2, $3, $4, $5)", [
      u.id,
      empresa,
      u.nome,
      u.perfil,
      emailDoUsuario(u, d.dominio_email).toLowerCase(),
    ]);
    usuariosNovos.push(u.id);
  }

  if (opcoes.recarregarCatalogo) await carregarDoCsv(empresa, { substituir: true });
  else await cargaInicialSeVazio(empresa);

  return { empresa, criada: Boolean(cadastro?.criada), usuariosNovos, dossie: d };
}

/** Prompt do agente da empresa: o modelo comum com o nome, o schema e a ferramenta dela. */
export function gerarPrompt(e: { id: string; nome: string; area: string; descricao: string; conector_slug: string }) {
  const valores: Record<string, string> = {
    EMPRESA: e.nome,
    AREA: e.area,
    DESCRICAO: e.descricao,
    SCHEMA: acessoBanco.nomeAcesso(e.id),
    FERRAMENTA: ferramentaDoConector(e.conector_slug),
    CONECTOR: e.conector_slug,
  };
  const texto = readFileSync(MODELO_PROMPT, "utf8").replace(/\{\{([A-Z]+)\}\}/g, (marca, chave: string) => {
    if (!(chave in valores)) throw new Error(`Marcador desconhecido no modelo do prompt: ${marca}`);
    return valores[chave];
  });
  return texto.replace(/^<!--[\s\S]*?-->\s*/, "");
}

type Passo = { passo: string; ok: boolean; detalhe: string };

interface EstadoEmpresa {
  id: string;
  nome: string;
  area: string;
  descricao: string;
  status: "implantacao" | "ativa" | "suspensa";
  agente_id: string;
  conector_slug: string;
  usuarios: number;
  com_senha: number;
  categorias: number;
  filas: number;
  chamados: number;
  acesso_hub: boolean;
}

async function estado(empresa?: string) {
  return db.query<EstadoEmpresa>(
    `select e.id, e.nome, e.area, e.descricao, e.status, e.agente_id, e.conector_slug,
            (select count(*)::int from usuarios u where u.empresa_id = e.id) as usuarios,
            (select count(*)::int from usuarios u where u.empresa_id = e.id and u.senha_hash is not null) as com_senha,
            (select count(*)::int from categorias c where c.empresa_id = e.id) as categorias,
            (select count(*)::int from filas f where f.empresa_id = e.id) as filas,
            (select count(*)::int from chamados c where c.empresa_id = e.id) as chamados,
            exists (select 1 from pg_roles r where r.rolname = 'hub_' || e.id and r.rolcanlogin) as acesso_hub
     from empresas e ${empresa ? "where e.id = $1" : ""} order by e.criada_em, e.id`,
    empresa ? [empresa] : [],
  );
}

/** O Hub só alcança um Postgres na internet: com o PGlite local, o acesso do Hub não é exigido. */
const exigeAcessoHub = () => Boolean(env.db.url);

/** O que falta para a empresa atender. Vazio = pronta. */
function pendencias(e: EstadoEmpresa) {
  const faltam: string[] = [];
  if (!e.categorias || !e.filas) faltam.push("catálogo");
  if (!e.com_senha) faltam.push("usuários com senha");
  if (exigeAcessoHub() && !e.acesso_hub) faltam.push("acesso do Hub ao banco");
  if (!e.agente_id) faltam.push("agente no Hub");
  return faltam;
}

/** `implantacao` ↔ `ativa` conforme o que falta. `suspensa` só muda por decisão explícita. */
export async function atualizarStatus(empresa: string) {
  const [e] = await estado(empresa);
  if (!e) throw new ErroApp(404, "empresa", `Empresa "${empresa}" não existe.`);
  if (e.status === "suspensa") return e.status;
  const novo = pendencias(e).length ? "implantacao" : "ativa";
  if (novo !== e.status) await db.query("update empresas set status = $2 where id = $1", [empresa, novo]);
  return novo;
}

/**
 * Provisiona (ou completa) uma empresa a partir do dossiê. Idempotente: rodar de novo só faz o que falta.
 * Senhas novas e a senha do acesso do Hub aparecem só nesta resposta (o banco guarda o hash).
 */
export async function provisionar(empresa: string, opcoes: { recarregarCatalogo?: boolean } = {}) {
  validarEmpresa(empresa);
  const passos: Passo[] = [];
  const importado = await importarDossie(empresa, opcoes);
  passos.push({ passo: "cadastro", ok: true, detalhe: importado.criada ? "empresa criada" : "empresa já existia (nada sobrescrito)" });

  let [e] = await estado(empresa);
  passos.push({
    passo: "catálogo",
    ok: e.categorias > 0 && e.filas > 0,
    detalhe: `${e.filas} filas, ${e.categorias} categorias${opcoes.recarregarCatalogo ? " (recarregado dos CSVs)" : ""}`,
  });

  const semSenha = await db.query<{ id: string }>(
    "select id from usuarios where empresa_id = $1 and senha_hash is null order by perfil desc, id",
    [empresa],
  );
  const senhas = [];
  for (const u of semSenha) senhas.push(await definirSenha(u.id));
  passos.push({
    passo: "usuários",
    ok: true,
    detalhe: `${e.usuarios} usuário(s)${importado.usuariosNovos.length ? `, novos: ${importado.usuariosNovos.join(", ")}` : ""}${senhas.length ? `; ${senhas.length} senha(s) criada(s)` : ""}`,
  });

  let acessoHub: Awaited<ReturnType<typeof acessoBanco.liberar>> | null = null;
  if (!exigeAcessoHub()) {
    passos.push({ passo: "acesso do Hub ao banco", ok: true, detalhe: "não se aplica: banco local (PGlite), o Hub não alcança" });
  } else if (e.acesso_hub) {
    passos.push({ passo: "acesso do Hub ao banco", ok: true, detalhe: `${acessoBanco.nomeAcesso(empresa)} já existe (senha mantida)` });
  } else {
    acessoHub = await acessoBanco.liberar(empresa);
    const falhas = acessoHub.checagens.filter((c) => !c.ok && !/toolkit/.test(c.item));
    passos.push({
      passo: "acesso do Hub ao banco",
      ok: falhas.length === 0,
      detalhe: falhas.length ? `criado, mas ${falhas.map((c) => c.item).join(", ")} falhou` : `${acessoHub.usuario} criado`,
    });
  }
  await acessoBanco.atualizarVisoes();

  mkdirSync(pastaPrompts(), { recursive: true });
  const arquivoPrompt = join(pastaPrompts(), `${empresa}.md`);
  writeFileSync(arquivoPrompt, gerarPrompt(e));
  passos.push({ passo: "prompt do agente", ok: true, detalhe: `hub/prompts/${empresa}.md (ferramenta ${ferramentaDoConector(e.conector_slug)})` });

  passos.push({
    passo: "agente no Hub",
    ok: Boolean(e.agente_id),
    detalhe: e.agente_id || `pendente: crie o agente e rode npm run definir-agente -- ${empresa} <uuid>`,
  });

  const status = await atualizarStatus(empresa);
  [e] = await estado(empresa);
  return {
    empresa,
    nome: e.nome,
    status,
    pendencias: pendencias(e),
    passos,
    senhas,
    acessoHub,
    hub: {
      conector: {
        tipo: "Database (PostgreSQL)",
        slug: e.conector_slug,
        // O Hub gera o slug a partir do nome (e não deixa mudar depois): "Postgres Vitalis" → postgres-vitalis.
        nome: nomeDoConector(e.conector_slug),
        ...(exigeAcessoHub() ? acessoBanco.dadosDeConexao(empresa) : {}),
        ssl: "Preferido",
      },
      agente: { nome: `Qualificador ${e.nome}`, prompt: `hub/prompts/${empresa}.md`, ferramenta: ferramentaDoConector(e.conector_slug) },
    },
  };
}

/** Nome que, no Hub, gera exatamente este slug (o Hub deriva o slug do nome): postgres-horizonte → "Postgres Horizonte". */
export const nomeDoConector = (slug: string) =>
  slug
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");

/**
 * Grava o slug real do conector da empresa no Hub e gera de novo o prompt (o nome da ferramenta sai do slug).
 * Para quando o Hub criou o conector com outro slug: ele deriva o slug do nome.
 */
export async function definirConector(empresa: string, slug: string) {
  validarEmpresa(empresa);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new ErroApp(400, "conector", `Slug inválido: "${slug}" (letras minúsculas, números e hífens).`);
  const atual = await db.one<{ conector_slug: string }>("select conector_slug from empresas where id = $1", [empresa]);
  if (!atual) throw new ErroApp(404, "empresa", `Empresa "${empresa}" não existe.`);
  await db.query("update empresas set conector_slug = $2 where id = $1", [empresa, slug]);
  const [e] = await estado(empresa);
  mkdirSync(pastaPrompts(), { recursive: true });
  writeFileSync(join(pastaPrompts(), `${empresa}.md`), gerarPrompt(e));
  return { empresa, antes: atual.conector_slug, depois: slug, ferramenta: ferramentaDoConector(slug), prompt: `hub/prompts/${empresa}.md` };
}

export async function listar() {
  return (await estado()).map((e) => ({ ...e, descricao: undefined, pendencias: pendencias(e) }));
}

/** Suspender bloqueia o login de todos da empresa (e o acesso do Hub, se existir); reativar volta a calcular o status. */
export async function definirStatus(empresa: string, status: "suspensa" | "ativa") {
  const [e] = await estado(validarEmpresa(empresa));
  if (!e) throw new ErroApp(404, "empresa", `Empresa "${empresa}" não existe.`);
  if (status === "suspensa") {
    await db.query("update empresas set status = 'suspensa' where id = $1", [empresa]);
    // Encerra as sessões e derruba na hora o WebSocket de quem estiver dentro.
    for (const u of await db.query<{ id: string }>("select id from usuarios where empresa_id = $1", [empresa])) {
      await encerrarSessoesDoUsuario(u.id);
    }
    if (e.acesso_hub) await acessoBanco.revogar(empresa);
    return { empresa, status: "suspensa" as const };
  }
  await db.query("update empresas set status = 'implantacao' where id = $1", [empresa]);
  return { empresa, status: await atualizarStatus(empresa) };
}
