# Backend — Reboot Cafeinado

API em Express 5 + TypeScript (ESM) e gateway de chat em WebSocket (socket.io)
entre cliente e suporte.

## Rodando

```bash
cp .env.example .env   # opcional: há defaults para tudo
npm install
npm run dev            # tsx watch, http://localhost:3333
```

Scripts: `dev` (watch), `build` (tsc → `dist/`), `start` (roda o build),
`typecheck`, `smoke` (ver abaixo).

O frontend sobe em paralelo, na porta 3000:

```bash
cd frontend && npm run dev
```

## Estrutura

```
src/
  server.ts               # http server + gateway do socket.io
  app.ts                  # montagem do express (cors, json, rotas, erros)
  env.ts                  # leitura de .env
  routes/index.ts         # router raiz, montado em /api
  routes/health.ts        # GET /api/health
  middlewares/            # not-found (404) e error-handler (500)
  chat/types.ts           # contrato de eventos (espelhado em frontend/lib/chat/types.ts)
  chat/store.ts           # conversas e mensagens em memória
  chat/gateway.ts         # handlers do socket.io
scripts/smoke-chat.mjs    # teste de fumaça do chat (npm run smoke)
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
