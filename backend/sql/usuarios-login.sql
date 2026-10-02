-- Login com e-mail e senha na tabela `usuarios`, para rodar no SQL Editor do Supabase.
-- É o mesmo que o backend faz sozinho ao subir com DATABASE_URL apontando para o banco (src/db/schema.ts).
-- Pode rodar mais de uma vez: nada é apagado (a não ser a tabela `autenticacao` da primeira versão, depois de copiada).

alter table public.usuarios add column if not exists email             text;
alter table public.usuarios add column if not exists senha_hash        text;   -- scrypt com sal próprio; nunca a senha
alter table public.usuarios add column if not exists tentativas_falhas int not null default 0;
alter table public.usuarios add column if not exists bloqueado_ate     timestamptz;
alter table public.usuarios add column if not exists ultimo_login      timestamptz;
alter table public.usuarios add column if not exists senha_definida_em timestamptz;

-- E-mail único, sem diferenciar maiúsculas.
create unique index if not exists usuarios_email_unico on public.usuarios (lower(email));

-- Se a primeira versão do login (tabela autenticacao) chegou a ser criada, copia e apaga.
do $$
begin
  if to_regclass('public.autenticacao') is not null then
    update public.usuarios u set email = a.email, senha_hash = a.senha_hash, tentativas_falhas = a.tentativas_falhas,
           bloqueado_ate = a.bloqueado_ate, ultimo_login = a.ultimo_login, senha_definida_em = a.senha_definida_em
    from public.autenticacao a where a.usuario_id = u.id and u.senha_hash is null;
    drop table public.autenticacao;
  end if;
end $$;

-- Como as outras tabelas do app: RLS ligado e sem política, e a Data API (anon/authenticated) sem acesso.
-- A tabela agora guarda hash de senha: a Data API (/rest/v1) não pode ler.
alter table public.usuarios enable row level security;
revoke all on public.usuarios from anon, authenticated;

-- Sessões de login (o backend também cria ao subir): uma por entrada, com o hash do token.
create table if not exists public.sessoes (
  hash         text primary key,
  usuario_id   text not null references public.usuarios(id) on delete cascade,
  criada_em    timestamptz not null default now(),
  expira_em    timestamptz not null,
  encerrada_em timestamptz
);
create index if not exists sessoes_usuario on public.sessoes (usuario_id);
alter table public.sessoes enable row level security;
revoke all on public.sessoes from anon, authenticated;

-- As senhas não se criam aqui (o hash é feito pelo app). Com o backend ligado neste banco:
--   npm run definir-senha -- ana      (mostra o e-mail e a senha uma vez)
-- ou, em desenvolvimento, o backend cria para quem não tiver e mostra no terminal ao subir.
