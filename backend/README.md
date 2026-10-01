# Backend — Reboot Cafeinado

API em Express 5 + TypeScript (ESM) do Chamado Pronto (agente no Kaffa AI Hub, triagem,
Postgres, login com e-mail e senha) e WebSocket (socket.io) no namespace `/chamados`: o chat do chamado,
primeiro com o agente e depois com o suporte, e a fila de triagem em tempo real. O fluxo do
Chamado Pronto, o Hub e o banco estão no `README.md` da raiz.

## Rodando

```bash
cp .env.example .env   # opcional: há defaults para tudo
npm install
npm run dev            # tsx watch, http://localhost:3333
```

Scripts: `dev` (watch), `build` (tsc → `dist/`), `start` (roda o build),
`typecheck`, `test` (regras do contrato, SSE e hash de senha),
`smoke-chamados` (login e WebSocket do Chamado Pronto, com o Hub simulado), `smoke-hub` (agente real)
e os comandos de administração (`definir-senha`, `gerar-token`, `acesso-banco`, `exportar-catalogo`…) do `README.md` da raiz.

O frontend sobe em paralelo, na porta 3000:

```bash
cd frontend && npm run dev
```

## Estrutura

```
src/
  server.ts               # banco + http server + socket.io (/chamados); em dev, cria as senhas que faltam
  app.ts                  # montagem do express (cors, json, cookie, rotas, erros)
  config/env.ts           # leitura de .env
  routes/                 # GET /api/health
  rotas/index.ts          # API do Chamado Pronto em /api (login, chamados, triagem, admin)
  conector/               # conector API REST que o Hub consulta (/hub/v1)
  middlewares/            # not-found (404) e error-handler ({ erro, mensagem })
  db/                     # Postgres (Supabase) ou PGlite, schema e carga inicial
  dados/csv.ts            # leitura de dados/<empresa>/*.csv
  dominio/                # chamados, triagem, contrato do agente, catálogo, tokens, acesso do Hub ao banco
  dominio/autenticacao.ts # login (e-mail e senha em `usuarios`, hash scrypt, bloqueio após 5 erros)
  dominio/usuarios.ts     # usuário e sessão (cookie assinado e token da aba)
  dominio/eventos.ts      # barramento em memória: o domínio avisa o que mudou
  hub/                    # cliente do Kaffa AI Hub (SSE) e Hub simulado
  tempo-real/tipos.ts     # contrato do /chamados (espelhado em frontend/lib/tempo-real/tipos.ts)
  tempo-real/gateway.ts   # namespace /chamados: autentica pelo token da aba (ou cookie) e repassa os eventos às salas
sql/usuarios-login.sql      # as colunas de login, para aplicar à mão no SQL Editor do Supabase
scripts/smoke-chamados.mjs  # teste de fumaça do login e do /chamados (npm run smoke-chamados)
scripts/smoke-hub.ts        # dois turnos com o agente real (npm run smoke-hub)
scripts/admin.ts            # administração com o backend rodando
```

Para uma nova rota: crie `src/routes/<nome>.ts` exportando um `Router` e registre em
`src/routes/index.ts` com `routes.use("/<nome>", <nome>Router)`.

## Login

Dois tipos: **solicitante** e **suporte** (perfil `analista` no banco). `POST /api/auth/entrar` recebe
`{ email, senha, perfil }` e recusa quem entra pelo tipo errado. A resposta traz o token da aba (o frontend guarda
no `sessionStorage`) e grava o cookie assinado de reserva; a API (cabeçalho `x-sessao`) e o handshake do
WebSocket usam o token antes do cookie, para cada aba ficar com o próprio usuário.

## Variáveis de ambiente

| Var | Default | Descrição |
| --- | --- | --- |
| `PORT` | `3333` | Porta HTTP |
| `NODE_ENV` | `development` | Em `development` o handler de erro devolve o stack, e o backend cria as senhas que faltam ao subir |
| `CORS_ORIGIN` | `http://localhost:3000` | Origens permitidas (HTTP e WebSocket), separadas por vírgula |
| `SESSION_SECRET` | `dev-somente-local` | Assina a sessão (cookie e token da aba), na API e no handshake do `/chamados` |
| `DATABASE_URL` | vazio | Postgres (Supabase). Vazio = PGlite em `PGLITE_DIR` |
| `DATABASE_SSL_CA` | vazio | Certificado da CA do Supabase, para verificar o servidor |
| `PGLITE_DIR` | `~/.reboot-cafeinado/pgdata` | Pasta do Postgres embutido |
| `HUB_MODE` | `real` com chave, senão `simulado` | `simulado` usa respostas fixas, sem custo |
| `HUB_BASE_URL` | `https://belatrix.ai` | Endereço do Kaffa AI Hub |
| `HUB_API_KEY` | vazio | Chave do Hub; com ela, o modo vira `real` |
| `HUB_AGENTE_AURORA` | `06abc3a3-…` | Agente Qualificador Aurora |
| `HUB_TIMEOUT_MS` | `90000` | Tempo máximo de um turno do agente |
