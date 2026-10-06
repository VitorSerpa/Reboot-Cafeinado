export const SCHEMA = /* sql */ `
create table if not exists empresas (
  id          text primary key,
  nome        text not null,
  mercado     text not null,
  area        text not null,
  agente_id   text not null
);

create table if not exists usuarios (
  id          text primary key,
  empresa_id  text not null references empresas(id),
  nome        text not null,
  perfil      text not null check (perfil in ('solicitante', 'analista'))
);

-- Login do usuário (perfil solicitante ou analista, o "suporte"): e-mail e senha na própria tabela.
-- Guarda só o hash (scrypt, com sal próprio); a senha aparece uma vez, ao definir. Sem senha, não entra.
-- Depois de 5 erros seguidos, o login fica bloqueado por 15 minutos.
alter table usuarios add column if not exists email             text;
alter table usuarios add column if not exists senha_hash        text;
alter table usuarios add column if not exists tentativas_falhas int not null default 0;
alter table usuarios add column if not exists bloqueado_ate     timestamptz;
alter table usuarios add column if not exists ultimo_login      timestamptz;
alter table usuarios add column if not exists senha_definida_em timestamptz;
create unique index if not exists usuarios_email_unico on usuarios (lower(email));

-- A primeira versão do login usava uma tabela à parte (autenticacao): traz o que houver e apaga a tabela.
do $$
begin
  if to_regclass('public.autenticacao') is not null then
    update usuarios u set email = a.email, senha_hash = a.senha_hash, tentativas_falhas = a.tentativas_falhas,
           bloqueado_ate = a.bloqueado_ate, ultimo_login = a.ultimo_login, senha_definida_em = a.senha_definida_em
    from autenticacao a where a.usuario_id = u.id and u.senha_hash is null;
    drop table autenticacao;
  end if;
end $$;

-- Sessões de login: uma por entrada (cookie e token da aba têm o mesmo valor). Guarda só o hash do token.
-- Sair encerra a sessão; trocar a senha encerra todas as do usuário. Vencem 8 horas depois do login.
create table if not exists sessoes (
  hash         text primary key,
  usuario_id   text not null references usuarios(id) on delete cascade,
  criada_em    timestamptz not null default now(),
  expira_em    timestamptz not null,
  encerrada_em timestamptz
);
create index if not exists sessoes_usuario on sessoes (usuario_id);

create table if not exists filas (
  empresa_id  text not null references empresas(id),
  slug        text not null,
  nome        text not null,
  escopo      text not null,
  primary key (empresa_id, slug)
);

-- O catálogo chama de "serviços" o que antes eram "aplicações": os sistemas e serviços que a empresa usa.
-- Banco antigo: renomeia. Banco em que a renomeação foi feita à mão e a tabela antiga voltou: junta e apaga a antiga
-- (as views do Hub que dependiam dela caem junto e são recriadas na subida, em acessoBanco.atualizarVisoes).
do $$
begin
  if to_regclass('public.aplicacoes') is not null and to_regclass('public.servicos') is null then
    alter table public.aplicacoes rename to servicos;
  elsif to_regclass('public.aplicacoes') is not null then
    insert into public.servicos (empresa_id, slug, nome, apelidos, uso, acesso, observacao)
      select empresa_id, slug, nome, apelidos, uso, acesso, observacao from public.aplicacoes
      on conflict (empresa_id, slug) do nothing;
    drop table public.aplicacoes cascade;
  end if;
end $$;

create table if not exists servicos (
  empresa_id  text not null references empresas(id),
  slug        text not null,
  nome        text not null,
  apelidos    text not null,
  primary key (empresa_id, slug)
);

-- Tokens do conector (/hub/v1): um ou mais por empresa. Guarda só o hash; o valor aparece uma vez, ao gerar.
create table if not exists tokens_conector (
  id           serial primary key,
  empresa_id   text not null references empresas(id),
  hash         text not null unique,
  prefixo      text not null,
  descricao    text not null default '',
  criado_em    timestamptz not null default now(),
  ultimo_uso   timestamptz,
  revogado_em  timestamptz
);

-- Contexto completo da empresa: é a fonte da verdade que o agente consulta pelo conector (/hub/v1).
alter table empresas   add column if not exists descricao   text not null default '';
alter table servicos   add column if not exists uso         text not null default '';
alter table servicos   add column if not exists acesso      text not null default '';
alter table servicos   add column if not exists observacao  text not null default '';

create table if not exists categorias (
  empresa_id            text not null references empresas(id),
  slug                  text not null,
  nome                  text not null,
  fila_padrao           text not null,
  discriminadores       jsonb not null default '[]',
  campos_obrigatorios   jsonb not null default '[]',
  regra_de_roteamento   text not null,
  primary key (empresa_id, slug)
);

create table if not exists procedimentos (
  empresa_id              text not null references empresas(id),
  slug                    text not null,
  titulo                  text not null,
  quando_aplicar          text not null,
  ja_sabemos              text not null,
  minimo_para_o_suporte   text not null,
  perguntas_uteis         text not null,
  evidencias              text not null,
  encaminhamento          text not null,
  quando_parar            text not null,
  primary key (empresa_id, slug)
);

-- status: qualificando (com o agente) → aguardando_triagem (com o suporte, no mesmo chat) → triado.
-- rejeitado: o agente considerou fora do escopo duas vezes seguidas; não entra na fila, e o analista pode trazer de volta.
create table if not exists chamados (
  id                  serial primary key,
  empresa_id          text not null references empresas(id),
  solicitante_id      text not null references usuarios(id),
  status              text not null,
  texto_inicial       text not null,
  hub_session_id      text,
  n_perguntas         int not null default 0,
  resultado           jsonb,
  ajustes             jsonb not null default '[]',
  qualificado_sem_ia  boolean not null default false,
  tokens_input        int not null default 0,
  tokens_output       int not null default 0,
  latencia_ms         int not null default 0,
  criado_em           timestamptz not null default now(),
  enviado_em          timestamptz,
  atualizado_em       timestamptz not null default now()
);

create table if not exists turnos (
  id            serial primary key,
  chamado_id    int not null references chamados(id),
  papel         text not null check (papel in ('solicitante', 'agente', 'sistema')),
  texto         text not null,
  bruto         text,
  tool_calls    jsonb not null default '[]',
  tokens_input  int,
  tokens_output int,
  latencia_ms   int,
  criado_em     timestamptz not null default now()
);

-- ID interno da sessão no Hub (Monitorar → Sessões), para diagnóstico.
alter table turnos add column if not exists hub_sessao text;

-- Depois do agente, o atendente responde no mesmo chat: turno com papel 'analista' e quem escreveu.
alter table turnos add column if not exists autor_id text references usuarios(id);
alter table turnos drop constraint if exists turnos_papel_check;
alter table turnos add constraint turnos_papel_check check (papel in ('solicitante', 'agente', 'analista', 'sistema'));

-- Rejeições seguidas do agente (fora do escopo). Volta a zero quando o solicitante descreve um problema de verdade.
alter table chamados add column if not exists rejeicoes int not null default 0;

-- Não existe mais o passo "enviar para o suporte": o que ficou parado nele entra na fila.
update chamados set status = 'aguardando_triagem', enviado_em = coalesce(enviado_em, atualizado_em)
where status = 'pronto_para_envio';

create table if not exists triagens (
  chamado_id    int primary key references chamados(id),
  analista_id   text not null references usuarios(id),
  fila_final    text not null,
  corrigiu      boolean not null,
  motivo        text,
  criado_em     timestamptz not null default now()
);

-- Cadastro de empresas: é o registro oficial de quem usa o app (o dossiê em dados/<empresa>/ é só a entrada do
-- provisionamento). 'implantacao' enquanto falta algo (agente, acesso do Hub); 'suspensa' não entra no app.
alter table empresas add column if not exists status        text not null default 'ativa';
alter table empresas add column if not exists dominio_email text not null default '';
alter table empresas add column if not exists conector_slug text not null default '';
alter table empresas add column if not exists criada_em     timestamptz not null default now();
alter table empresas drop constraint if exists empresas_status_check;
alter table empresas add constraint empresas_status_check check (status in ('implantacao', 'ativa', 'suspensa'));
`;

/**
 * No Supabase, o schema public fica exposto pela Data API (papéis anon e authenticated), e o app não usa essa API.
 * RLS ligado sem nenhuma política bloqueia esses papéis. O app entra como dono das tabelas e não é afetado.
 * O Hub lê o banco por outro caminho: views só leitura no schema hub_<empresa> (dominio/acessoBanco.ts).
 */
export const TABELAS = [
  "empresas", "usuarios", "sessoes", "filas", "servicos", "tokens_conector",
  "categorias", "procedimentos", "chamados", "turnos", "triagens",
] as const;

export const PROTECAO = /* sql */ `
do $$
declare t text;
begin
  foreach t in array array[${TABELAS.map((t) => `'${t}'`).join(", ")}] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from anon, authenticated;
    revoke all on all sequences in schema public from anon, authenticated;
  end if;
end $$;
`;

/** Tabelas com `empresa_id`: a política compara com a empresa do contexto. Turnos e triagens vão pelo chamado. */
const COM_EMPRESA = ["usuarios", "filas", "servicos", "categorias", "procedimentos", "chamados", "tokens_conector"] as const;
const PELO_CHAMADO = ["turnos", "triagens"] as const;

const politica = (tabela: string, condicao: string) => `
drop policy if exists isolamento_empresa on public.${tabela};
create policy isolamento_empresa on public.${tabela} to app_runtime using (${condicao}) with check (${condicao});`;

/**
 * Isolamento por empresa garantido pelo banco (RLS). O backend atende cada requisição no papel `app_runtime`, com
 * `app.empresa_id` definido (db/index.ts): um `where empresa_id` esquecido não vaza nada, porque o banco só devolve
 * linhas da empresa do contexto. Sem empresa no contexto, `current_setting` volta nulo e nada aparece.
 * O papel tem o mínimo: lê o contexto e grava chamados, turnos e triagens; não vê senha, sessão nem token.
 * O dono das tabelas (migrações, cadastro, login, administração) não passa pelo RLS: ele não é forçado.
 */
export const ISOLAMENTO = /* sql */ `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime nologin noinherit;
  end if;
  -- Quem roda as migrações (o dono das tabelas) precisa poder assumir o papel: SET ROLE app_runtime.
  -- No Postgres 16+, criar o papel só dá o direito de administrá-lo, não o de assumi-lo (no Supabase, o postgres
  -- não é superusuário): a concessão precisa do WITH SET TRUE. Conceder de novo só atualiza a opção.
  begin
    execute format('grant app_runtime to %I with set true', current_user);
  exception when syntax_error then
    execute format('grant app_runtime to %I', current_user); -- Postgres 15 ou anterior
  end;
end $$;

grant usage on schema public to app_runtime;
revoke all on ${TABELAS.map((t) => `public.${t}`).join(", ")} from app_runtime;
grant select on public.empresas, public.filas, public.servicos, public.categorias, public.procedimentos to app_runtime;
grant select (id, empresa_id, nome, perfil) on public.usuarios to app_runtime;
grant select, insert, update on public.chamados to app_runtime;
grant select, insert on public.turnos, public.triagens to app_runtime;
grant usage, select on sequence public.chamados_id_seq, public.turnos_id_seq to app_runtime;
${politica("empresas", "id = current_setting('app.empresa_id', true)")}
${COM_EMPRESA.map((t) => politica(t, "empresa_id = current_setting('app.empresa_id', true)")).join("\n")}
${PELO_CHAMADO.map((t) => politica(t, `exists (select 1 from public.chamados c where c.id = ${t}.chamado_id)`)).join("\n")}
`;
