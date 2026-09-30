# Backend — Reboot Cafeinado

API em Express 5 + TypeScript (ESM) do Chamado Pronto (agente no Kaffa AI Hub, triagem,
Postgres) e WebSocket (socket.io) com dois namespaces: `/chamados` (chat do chamado, primeiro com o agente
e depois com o atendente, e fila de triagem em tempo real) e `/` (chat ao vivo entre cliente e suporte). O fluxo do
Chamado Pronto, o Hub e o banco estão no `README.md` da raiz.

## Rodando

```bash
cp .env.example .env   # opcional: há defaults para tudo
npm install
npm run dev            # tsx watch, http://localhost:3333
```

Scripts: `dev` (watch), `build` (tsc → `dist/`), `start` (roda o build),
`typecheck`, `test` (regras do contrato e SSE), `smoke` (chat ao vivo, ver abaixo),
`smoke-chamados` (WebSocket do Chamado Pronto, com o Hub simulado), `smoke-hub` (agente real)
e os comandos de administração (`gerar-token`, `acesso-banco`, `exportar-catalogo`…) do `README.md` da raiz.

O frontend sobe em paralelo, na porta 3000:

```bash
cd frontend && npm run dev
```

## Estrutura

```
src/
  server.ts               # banco + http server + socket.io (namespaces / e /chamados)
  app.ts                  # montagem do express (cors, json, cookie, rotas, erros)
  config/env.ts           # leitura de .env
  routes/                 # GET /api/health
  rotas/index.ts          # API do Chamado Pronto em /api (sessão, chamados, triagem, admin)
  conector/               # conector API REST que o Hub consulta (/hub/v1)
  middlewares/            # not-found (404) e error-handler ({ erro, mensagem })
  db/                     # Postgres (Supabase) ou PGlite, schema e carga inicial
  dados/csv.ts            # leitura de dados/<empresa>/*.csv
  dominio/                # chamados, triagem, contrato do agente, catálogo, tokens, acesso do Hub ao banco
  dominio/eventos.ts      # barramento em memória: o domínio avisa o que mudou
  hub/                    # cliente do Kaffa AI Hub (SSE) e Hub simulado
  tempo-real/tipos.ts     # contrato do /chamados (espelhado em frontend/lib/tempo-real/tipos.ts)
  tempo-real/gateway.ts   # namespace /chamados: autentica pelo cookie e repassa os eventos às salas
  chat/types.ts           # contrato do chat ao vivo (espelhado em frontend/lib/chat/types.ts)
  chat/store.ts           # conversas e mensagens em memória
  chat/gateway.ts         # namespace / do socket.io (chat ao vivo)
scripts/smoke-chat.mjs      # teste de fumaça do chat ao vivo (npm run smoke)
scripts/smoke-chamados.mjs  # teste de fumaça do /chamados (npm run smoke-chamados)
scripts/smoke-hub.ts        # dois turnos com o agente real (npm run smoke-hub)
scripts/admin.ts            # administração com o backend rodando
```

Para uma nova rota: crie `src/routes/<nome>.ts` exportando um `Router` e registre em
`src/routes/index.ts` com `routes.use("/<nome>", <nome>Router)`.

## Chat por WebSocket

Um cliente abre um atendimento; o atendente vê a fila e entra na conversa. Cada
conversa é uma sala (`conv:<id>`) e todos os atendentes ficam numa sala comum
(`support`), que recebe as atualizações da fila.

Eventos com ack (`{ ok: true, data }` ou `{ ok: false, error }`):

| Evento | Quem envia | O que faz |
| --- | --- | --- |
| `client:start` | cliente | Abre a conversa — ou retoma, passando `conversationId` |
| `support:auth` | atendente | Valida o `SUPPORT_TOKEN` e devolve a fila |
| `support:join` | atendente | Entra na conversa, recebe histórico e zera as não lidas |
| `message:send` | ambos | Envia mensagem (rejeita vazia, >2000 chars ou conversa encerrada) |
| `conversation:close` | atendente | Encerra o atendimento |

Eventos enviados pelo servidor: `message:new`, `conversation:created`,
`conversation:updated`, `presence:update` e `typing:update` (este último
disparado pelo `typing:set`, que não tem ack).

O cliente só acessa a própria conversa; o atendente precisa do token para
qualquer operação da fila.

Teste de fumaça (com o servidor rodando) — sobe um cliente e um atendente reais
e confere a troca de mensagens ponta a ponta:

```bash
cd backend && npm run smoke
```

### Frontend

As telas estão em `frontend/`: `/chat` (cliente) e `/suporte` (atendente, pede o
token). O contrato de eventos é duplicado em `frontend/lib/chat/types.ts` —
mexeu em um, atualize o outro.

## Variáveis de ambiente

| Var | Default | Descrição |
| --- | --- | --- |
| `PORT` | `3333` | Porta HTTP |
| `NODE_ENV` | `development` | Em `development` o handler de erro devolve o stack |
| `CORS_ORIGIN` | `http://localhost:3000` | Origens permitidas (HTTP e WebSocket), separadas por vírgula |
| `SUPPORT_TOKEN` | `suporte-dev` | Segredo do painel de suporte — placeholder até haver login real |
| `SESSION_SECRET` | `dev-somente-local` | Assina o cookie de sessão do Chamado Pronto (API e handshake do `/chamados`) |
| `DATABASE_URL` | vazio | Postgres (Supabase). Vazio = PGlite em `PGLITE_DIR` |
| `DATABASE_SSL_CA` | vazio | Certificado da CA do Supabase, para verificar o servidor |
| `PGLITE_DIR` | `~/.reboot-cafeinado/pgdata` | Pasta do Postgres embutido |
| `HUB_MODE` | `real` com chave, senão `simulado` | `simulado` usa respostas fixas, sem custo |
| `HUB_BASE_URL` | `https://belatrix.ai` | Endereço do Kaffa AI Hub |
| `HUB_API_KEY` | vazio | Chave do Hub; com ela, o modo vira `real` |
| `HUB_AGENTE_AURORA` | `06aadae6-…` | Agente Qualificador Aurora |
| `HUB_TIMEOUT_MS` | `90000` | Tempo máximo de um turno do agente |
