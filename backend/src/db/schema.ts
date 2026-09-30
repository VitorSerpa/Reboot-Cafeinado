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

create table if not exists filas (
  empresa_id  text not null references empresas(id),
  slug        text not null,
  nome        text not null,
  escopo      text not null,
  primary key (empresa_id, slug)
);

create table if not exists aplicacoes (
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
alter table aplicacoes add column if not exists uso         text not null default '';
alter table aplicacoes add column if not exists acesso      text not null default '';
alter table aplicacoes add column if not exists observacao  text not null default '';

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

-- status: qualificando (com o agente) → aguardando_triagem (com o suporte, no mesmo chat) → triado
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
`;

/**
 * No Supabase, o schema public fica exposto pela Data API (papéis anon e authenticated), e o app não usa essa API.
 * RLS ligado sem nenhuma política bloqueia esses papéis. O app entra como dono das tabelas e não é afetado.
 * O Hub lê o banco por outro caminho: views só leitura no schema hub_<empresa> (dominio/acessoBanco.ts).
 */
export const TABELAS = [
  "empresas", "usuarios", "filas", "aplicacoes", "tokens_conector",
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
