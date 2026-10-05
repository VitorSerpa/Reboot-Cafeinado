import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

import type { QueryResult } from "pg";

import { env } from "../config/env.js";
import { configPg, db } from "../db/index.js";
import { ErroApp } from "./erros.js";

/**
 * Acesso do Hub ao banco (conector PostgreSQL do Hub), um por empresa:
 * - schema `hub_<empresa>` com views só do contexto daquela empresa, e chamados recentes sem o solicitante;
 * - papel `hub_<empresa>`, só leitura, que enxerga apenas esse schema.
 * O agente escreve o SQL. Por isso ele nunca recebe o usuário do app, que é dono de todas as tabelas.
 */

const SLUG = /^[a-z][a-z0-9_]{1,30}$/;

export const VISOES = ["contexto", "empresa", "filas", "servicos", "categorias", "procedimentos", "chamados_recentes"] as const;

export function nomeAcesso(empresa: string) {
  if (!SLUG.test(empresa)) throw new ErroApp(400, "empresa", `Empresa inválida: "${empresa}".`);
  return `hub_${empresa}`;
}

const lista = (coluna: string) => `array_to_string(array(select jsonb_array_elements_text(${coluna})), ', ')`;

/** Views do contexto da empresa. As colunas são as mesmas dos CSVs (listas viram texto separado por vírgula). */
export function sqlVisoes(empresa: string) {
  const s = nomeAcesso(empresa);
  const e = `'${empresa}'`; // seguro: validado por SLUG
  return /* sql */ `
drop schema if exists ${s} cascade;
create schema ${s};

create view ${s}.empresa with (security_barrier) as
  select nome, mercado, area, descricao from public.empresas where id = ${e};

create view ${s}.filas with (security_barrier) as
  select slug, nome, escopo from public.filas where empresa_id = ${e};

create view ${s}.servicos with (security_barrier) as
  select slug, nome, uso, acesso, apelidos, observacao from public.servicos where empresa_id = ${e};

create view ${s}.categorias with (security_barrier) as
  select slug, nome, fila_padrao, ${lista("discriminadores")} as discriminadores,
         ${lista("campos_obrigatorios")} as campos_obrigatorios, regra_de_roteamento
  from public.categorias where empresa_id = ${e};

create view ${s}.procedimentos with (security_barrier) as
  select slug, titulo, quando_aplicar, ja_sabemos, minimo_para_o_suporte, perguntas_uteis,
         evidencias, encaminhamento, quando_parar
  from public.procedimentos where empresa_id = ${e};

-- Abrangência ("é só comigo?"): relatos enviados nos últimos 7 dias, sem quem abriu.
create view ${s}.chamados_recentes with (security_barrier) as
  select id, resultado->>'aplicacao' as aplicacao, resultado->>'categoria' as categoria, status,
         floor(extract(epoch from (now() - coalesce(enviado_em, criado_em))) / 60)::int as ha_minutos,
         left(coalesce(resultado->>'resumo', ''), 200) as resumo
  from public.chamados
  where empresa_id = ${e} and status in ('aguardando_triagem', 'triado')
    and coalesce(enviado_em, criado_em) > now() - interval '7 days';

comment on view ${s}.chamados_recentes is 'Relatos de outros funcionários, não confirmação de indisponibilidade.';

-- Tudo numa linha só (como obterContexto da API): o agente lê o contexto com uma consulta no 1º turno.
create view ${s}.contexto with (security_barrier) as
  select jsonb_build_object(
    'empresa',       (select to_jsonb(x) from ${s}.empresa x),
    'filas',         (select coalesce(jsonb_agg(to_jsonb(x) order by x.nome), '[]') from ${s}.filas x),
    'servicos',      (select coalesce(jsonb_agg(to_jsonb(x) order by x.nome), '[]') from ${s}.servicos x),
    'categorias',    (select coalesce(jsonb_agg(to_jsonb(x) order by x.slug), '[]') from ${s}.categorias x),
    'procedimentos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.slug), '[]') from ${s}.procedimentos x)
  ) as contexto;
`;
}

/**
 * Verificador SCRAM-SHA-256 no formato do Postgres. O banco recebe só isto, nunca a senha:
 * um ALTER ROLE com a senha em texto puro poderia parar nos logs do Supabase.
 */
export function verificadorScram(senha: string, sal = randomBytes(16), iteracoes = 4096) {
  const salgada = pbkdf2Sync(senha, sal, iteracoes, 32, "sha256");
  const hmac = (chave: Buffer, texto: string) => createHmac("sha256", chave).update(texto).digest();
  const chaveGuardada = createHash("sha256").update(hmac(salgada, "Client Key")).digest();
  const chaveServidor = hmac(salgada, "Server Key");
  return `SCRAM-SHA-256$${iteracoes}:${sal.toString("base64")}$${chaveGuardada.toString("base64")}:${chaveServidor.toString("base64")}`;
}

/** Cria o papel, se não existir, e troca a senha. Só leitura, sem herdar nada, poucas conexões e consultas curtas. */
export function sqlPapel(empresa: string, verificador: string) {
  const s = nomeAcesso(empresa);
  if (!/^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(verificador)) {
    throw new Error("Verificador SCRAM inválido");
  }
  return /* sql */ `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = '${s}') then create role ${s}; end if;
end $$;
alter role ${s} with login noinherit nocreatedb nocreaterole connection limit 5 password '${verificador}';
alter role ${s} set search_path = ${s};
alter role ${s} set default_transaction_read_only = on;
alter role ${s} set statement_timeout = '5s';
alter role ${s} set idle_in_transaction_session_timeout = '30s';
`;
}

export function sqlPermissoes(empresa: string) {
  const s = nomeAcesso(empresa);
  return /* sql */ `
grant usage on schema ${s} to ${s};
grant select on all tables in schema ${s} to ${s};
`;
}

function exigirPostgresExterno() {
  if (!env.db.url) {
    throw new ErroApp(
      400,
      "banco",
      "O acesso do Hub ao banco só existe com DATABASE_URL apontando para um Postgres alcançável pela internet (Supabase). O Hub não alcança o PGlite local.",
    );
  }
}

/**
 * Onde o Hub se conecta: o mesmo host e porta do app. No pooler do Supabase o usuário leva o projeto
 * (`postgres.<ref>` → `hub_aurora.<ref>`); na conexão direta, é só o nome do papel.
 */
export function dadosDeConexao(empresa: string, urlDoApp = env.db.url) {
  const s = nomeAcesso(empresa);
  const u = new URL(urlDoApp);
  const usuarioApp = decodeURIComponent(u.username);
  const projeto = usuarioApp.includes(".") ? usuarioApp.slice(usuarioApp.indexOf(".") + 1) : "";
  return {
    host: u.hostname,
    porta: Number(u.port || 5432),
    banco: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
    usuario: projeto ? `${s}.${projeto}` : s,
    schema: s,
    tabelas: [...VISOES],
  };
}

type Checagem = { item: string; ok: boolean; detalhe: string };

/**
 * Entra como o Hub vai entrar (mesmo host, porta e usuário) e confere o que o papel enxerga e o que ele não pode fazer.
 * Duas conexões: a simples, como o conector "Database (PostgreSQL)", e com `search_path=public` na conexão,
 * como o toolkit PostgreSQL do Agno, que o pooler do Supabase pode recusar. As consultas usam o nome completo
 * (`hub_<empresa>.filas`), que funciona com qualquer search_path.
 */
async function verificarComoHub(empresa: string, senha: string): Promise<Checagem[]> {
  const { default: pg } = await import("pg");
  const d = dadosDeConexao(empresa);
  const u = new URL(env.db.url);
  u.username = encodeURIComponent(d.usuario);
  u.password = encodeURIComponent(senha);
  const { max: _max, idleTimeoutMillis: _ocioso, ...base } = configPg(u.toString());
  const checagens: Checagem[] = [];

  for (const toolkit of [false, true]) {
    const item = toolkit ? "conexão com search_path=public (toolkit PostgreSQL)" : "conexão simples (conector Database)";
    const cliente = new pg.Client({ ...base, ...(toolkit ? { options: "-c search_path=public" } : {}) });
    try {
      await cliente.connect();
      checagens.push({ item, ok: true, detalhe: `${d.usuario}@${d.host}:${d.porta}` });
    } catch (erro) {
      checagens.push({ item, ok: false, detalhe: (erro as Error).message });
      continue;
    }
    const tentar = async (item: string, bloqueado: boolean, sql: string, resumo: (r: QueryResult) => string) => {
      try {
        const r = await cliente.query(sql);
        checagens.push({ item, ok: !bloqueado, detalhe: bloqueado ? `deveria ter sido bloqueado (${resumo(r)})` : resumo(r) });
      } catch (erro) {
        const msg = (erro as Error).message;
        checagens.push({ item, ok: bloqueado, detalhe: bloqueado ? `bloqueado: ${msg}` : msg });
      }
    };
    await tentar(`  lê ${d.schema}.contexto`, false,
      `select jsonb_array_length(contexto->'filas') as filas, jsonb_array_length(contexto->'categorias') as categorias from ${d.schema}.contexto`,
      (r) => `${r.rows[0].filas} filas, ${r.rows[0].categorias} categorias`);
    if (!toolkit) {
      await tentar("  tabelas do app (public.chamados)", true, "select count(*) from public.chamados", (r) => `${r.rowCount} linha`);
      await tentar("  escrita", true, `insert into ${d.schema}.filas (slug, nome, escopo) values ('x', 'x', 'x')`, (r) => `${r.rowCount} linha`);
    }
    await cliente.end().catch(() => {});
  }
  return checagens;
}

/** Cria ou recria o acesso da empresa com uma senha nova. A senha só existe na resposta desta chamada. */
export async function liberar(empresa: string) {
  exigirPostgresExterno();
  const existe = await db.one("select 1 from empresas where id = $1", [empresa]);
  if (!existe) throw new ErroApp(404, "empresa", `Empresa "${empresa}" não existe.`);
  const senha = randomBytes(24).toString("base64url");
  // Uma mensagem só = uma transação só: ou tudo fica pronto, ou nada muda.
  await db.exec(sqlVisoes(empresa) + sqlPapel(empresa, verificadorScram(senha)) + sqlPermissoes(empresa));
  const checagens = await verificarComoHub(empresa, senha);
  // Daqui a conexão direta funciona (IPv6); do Hub, não. O Hub precisa do Session pooler.
  if (/^db\..+\.supabase\.co$/.test(new URL(env.db.url).hostname)) {
    checagens.unshift({
      item: "host para o Hub",
      ok: false,
      detalhe: "a DATABASE_URL usa a conexão direta do Supabase, que é só IPv6 no plano gratuito, e o Hub não alcança. Troque pela URI do Session pooler (Connect → Session pooler) e rode de novo",
    });
  }
  return { ...dadosDeConexao(empresa), senha, checagens };
}

/** Bloqueia o login do papel e encerra as conexões abertas por ele. As views continuam, sem ninguém para lê-las. */
export async function revogar(empresa: string) {
  exigirPostgresExterno();
  const s = nomeAcesso(empresa);
  const existe = await db.one("select 1 from pg_roles where rolname = $1", [s]);
  if (!existe) throw new ErroApp(404, "acesso", `Não há acesso do Hub para "${empresa}".`);
  await db.exec(`alter role ${s} with nologin password null;`);
  const encerradas = await db
    .query<{ pid: number }>("select pg_terminate_backend(pid) as pid from pg_stat_activity where usename = $1", [s])
    .then((l) => l.length)
    .catch(() => 0);
  return { empresa, papel: s, conexoes_encerradas: encerradas };
}

/**
 * Na subida do backend, recria as views das empresas que já têm acesso, para a definição acompanhar o código.
 * As permissões voltam junto; a senha não muda.
 */
export async function atualizarVisoes() {
  if (!env.db.url) return [];
  const empresas = await db.query<{ id: string; login: boolean }>(
    `select e.id, r.rolcanlogin as login from empresas e join pg_roles r on r.rolname = 'hub_' || e.id order by e.id`,
  );
  for (const { id } of empresas) await db.exec(sqlVisoes(id) + sqlPermissoes(id));
  return empresas;
}

/**
 * Diagnóstico sem segredo: como o app está conectado, o estado do papel da empresa e um login de teste
 * pelo mesmo host com um papel descartável (criado, testado e apagado). A senha do papel da empresa não muda.
 */
export async function diagnosticar(empresa: string) {
  exigirPostgresExterno();
  const s = nomeAcesso(empresa);
  const u = new URL(env.db.url);
  const d = dadosDeConexao(empresa);
  const itens: Checagem[] = [];

  const direta = /^db\..+\.supabase\.co$/.test(u.hostname);
  const tipo = /pooler\.supabase\.com$/.test(u.hostname)
    ? u.port === "6543" ? "pooler, modo transaction" : "pooler, modo session"
    : direta ? "conexão direta: só IPv6 no plano gratuito, o Hub pode não alcançar" : "outro host";
  const usuarioApp = decodeURIComponent(u.username).replace(/\..+$/, ".<ref>");
  itens.push({ item: "conexão do app", ok: !direta, detalhe: `${u.hostname}:${u.port || 5432} (${tipo}), usuário ${usuarioApp}` });
  itens.push({ item: "o Hub deve usar", ok: !direta, detalhe: `host ${d.host}, porta ${d.porta}, banco ${d.banco}, usuário ${d.usuario.replace(/\..+$/, ".<ref>")}` });

  const versao = await db.one<{ v: string }>("select current_setting('server_version') as v");
  itens.push({ item: "versão do Postgres", ok: true, detalhe: versao?.v ?? "?" });

  const papel = await db.one<{ rolcanlogin: boolean; rolconnlimit: number; rolconfig: string[] | null; conexoes: number }>(
    `select r.rolcanlogin, r.rolconnlimit, r.rolconfig,
            (select count(*)::int from pg_stat_activity where usename = r.rolname) as conexoes
     from pg_roles r where r.rolname = $1`,
    [s],
  );
  itens.push(
    papel
      ? { item: `papel ${s}`, ok: papel.rolcanlogin, detalhe: `login ${papel.rolcanlogin ? "liberado" : "BLOQUEADO"}, limite ${papel.rolconnlimit}, ${papel.conexoes} conexão(ões) agora, config: ${(papel.rolconfig ?? []).join("; ")}` }
      : { item: `papel ${s}`, ok: false, detalhe: "não existe: rode npm run acesso-banco -- " + empresa },
  );
  const visoes = await db.query<{ n: number }>(
    "select count(*)::int as n from information_schema.views where table_schema = $1", [s],
  );
  itens.push({ item: `views em ${s}`, ok: (visoes[0]?.n ?? 0) === VISOES.length, detalhe: `${visoes[0]?.n ?? 0} de ${VISOES.length}` });

  // Conexões abertas pelo papel: se o Hub autenticou, a última consulta mostra o que o teste dele fez.
  const sessoes = await db.query<{ inicio: string; mudou: string; estado: string; app: string; consulta: string }>(
    `select to_char(backend_start at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI:SS') as inicio,
            to_char(state_change at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI:SS') as mudou,
            coalesce(state, '?') as estado, coalesce(application_name, '') as app, left(coalesce(query, ''), 160) as consulta
     from pg_stat_activity where usename = $1 order by state_change desc nulls last`,
    [s],
  ).catch(() => []);
  for (const [i, x] of sessoes.entries()) {
    itens.push({ item: `conexão ${i + 1} de ${s}`, ok: true, detalhe: `aberta ${x.inicio}, última atividade ${x.mudou}, ${x.estado}, app "${x.app}", última consulta: ${x.consulta.replace(/s+/g, " ")}` });
  }

  // Login de teste com um papel descartável, pelo mesmo caminho que o Hub usa.
  const { default: pg } = await import("pg");
  const teste = `hub_diag_${randomBytes(3).toString("hex")}`;
  const senha = randomBytes(24).toString("base64url");
  const projeto = d.usuario.includes(".") ? d.usuario.slice(d.usuario.indexOf(".") + 1) : "";
  await db.exec(`create role ${teste} login connection limit 2 password '${verificadorScram(senha)}';`);
  try {
    for (const usuario of projeto ? [`${teste}.${projeto}`, teste] : [teste]) {
      const alvo = new URL(env.db.url);
      alvo.username = encodeURIComponent(usuario);
      alvo.password = encodeURIComponent(senha);
      const { max: _max, idleTimeoutMillis: _ocioso, ...base } = configPg(alvo.toString());
      const cliente = new pg.Client(base);
      const rotulo = `login de teste como ${usuario.replace(/\..+$/, ".<ref>")}`;
      try {
        await cliente.connect();
        await cliente.query("select 1");
        itens.push({ item: rotulo, ok: true, detalhe: "entrou" });
      } catch (erro) {
        const e = erro as Error & { code?: string };
        // No pooler, o usuário sem ".<ref>" é recusado de propósito: mostra por que o Hub precisa do sufixo.
        const esperado = projeto && usuario === teste && /tenant identifier|ENOIDENTIFIER|Tenant or user not found/i.test(e.message);
        itens.push({
          item: rotulo,
          ok: !!esperado,
          detalhe: esperado ? "recusado, como esperado: no pooler o usuário precisa do .<ref>" : `${e.code ? `[${e.code}] ` : ""}${e.message}`,
        });
      } finally {
        await cliente.end().catch(() => {});
      }
    }
  } finally {
    await db.exec(`drop role if exists ${teste};`).catch(async () => {
      await db.exec(`alter role ${teste} with nologin password null;`).catch(() => {});
      itens.push({ item: "limpeza", ok: false, detalhe: `o papel ${teste} ficou bloqueado, sem login; apague depois` });
    });
  }
  return { empresa, itens };
}
