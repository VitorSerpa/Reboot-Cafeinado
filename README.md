# Reboot Cafeinado — Chamado Pronto

Projeto do Reboot Cafeinado (Kaffa Journeys 2026): o funcionário descreve o problema em texto livre, o agente **Qualificador Aurora** no Kaffa AI Hub pergunta só o que falta e sugere a fila. Quando o agente conclui, o chamado entra direto na fila (não há passo de "enviar para o suporte"), e o atendente responde **no mesmo chat** em que o agente qualificou, além de confirmar ou corrigir a fila na tela de triagem. O chat e a fila andam em **tempo real, por WebSocket** (socket.io).

```
frontend/  Next 16 + Tailwind 4, identidade visual Kaffa:
           login (solicitante ou suporte), /chamado (solicitante), /triagem (suporte)
backend/   Express 5 + TypeScript + socket.io: API, regras sobre a resposta do agente, cliente do Hub (SSE),
           Postgres, WebSocket (/chamados), login com e-mail e senha
dados/aurora/*.csv   carga inicial do contexto da Aurora no Postgres (o banco é a fonte da verdade)
hub/prompt-qualificador-aurora.md          prompt em uso hoje no Hub (conector CSV)
hub/prompt-qualificador-aurora-v4-banco.md prompt v4, para o conector PostgreSQL (banco no Supabase)
hub/prompt-qualificador-aurora-v3-api.md   prompt v3, para quando o app for publicado e o conector de API for ligado
docs/hub-recursos.md   o que existe no Hub e o histórico de mudanças
```

## Rodar

Duas janelas de terminal:

```bash
cd backend
npm install
npm run dev
```

```bash
cd frontend
npm install
npm run dev
```

Abra http://localhost:3000 (se a porta estiver ocupada, o Next sobe na 3001; em desenvolvimento o backend aceita qualquer porta de localhost) e entre com e-mail e senha, escolhendo o tipo de login: **Solicitante** (abre chamado) ou **Suporte** (triagem e resposta no chat, perfil `analista` no banco). Usuários de teste por empresa: Aurora, Ana e Carlos (suporte: Bruna); Vitalis, Paula e Diego (suporte: Renata); Horizonte, Marcos e Lúcia (suporte: Rafael). A empresa sai do login: cada um só vê a própria. Entrar pelo tipo errado é recusado.

**Senhas:** ficam na própria tabela `usuarios` (colunas `email` e `senha_hash`, só o hash scrypt; 5 erros seguidos bloqueiam por 15 minutos). Com o banco local (PGlite), em desenvolvimento, quem ainda não tem senha ganha uma ao subir o backend, e o terminal mostra **uma vez só** o e-mail (`<usuário>@<empresa>.test`) e a senha. **Com o Supabase, que o time compartilha, a subida não cria senhas**: elas ficariam só no terminal de quem subiu. Para criar ou trocar, com o backend rodando:

```bash
cd backend
npm run definir-senha -- ana
```

`definir-senha` troca a senha por uma aleatória ou pela escolhida (`-- ana --senha=12345`; mínimo de 5 caracteres no protótipo) e aceita um e-mail (`-- ana ana@empresa.com`), `listar-usuarios` mostra quem tem senha e `criar-usuario -- <id> "<Nome>" <solicitante|analista> [e-mail]` cria outro usuário.

Cada aba guarda a própria sessão: dá para deixar o suporte na triagem numa aba e o solicitante em outra, no mesmo navegador.

As telas e a API são protegidas pelo login:

- sem sessão, `/chamado` e `/triagem` voltam para a tela de entrada, e nada da tela aparece antes de a sessão ser conferida;
- o solicitante não abre a triagem e o suporte não abre chamados nem responde ao assistente no lugar do solicitante (403 na API e no WebSocket);
- cada login é uma sessão na tabela `sessoes` (8 h). **Sair** encerra a sessão no banco e derruba o WebSocket dela, e trocar a senha encerra todas as sessões do usuário. A aba que perde a sessão volta sozinha para o login.

- **Sem `.env`, o backend usa o Hub simulado:** respostas fixas, sem chave e sem custo. O cabeçalho mostra "Hub: simulado".
- **Banco:** Postgres embutido (PGlite), em `~/.reboot-cafeinado/pgdata`, fora do OneDrive. Para usar o Supabase (ou outro Postgres), preencha `DATABASE_URL`: veja [Banco no Supabase](#banco-no-supabase). Para zerar os dados, apague essa pasta com o backend parado.

## Tempo real (WebSocket)

O backend tem um servidor socket.io (`/socket.io`, porta 3333) com o namespace:

- **`/chamados`**: o Chamado Pronto. O handshake usa a mesma sessão da API (token da aba ou cookie); sem sessão, a conexão é recusada, e sair derruba a conexão aberta. Cada usuário fica na sala `usuario:<id>`, e cada analista também na sala `triagem:<empresa>`.

| Evento | Direção | O que faz |
|---|---|---|
| `chamado:abrir` `{ texto }` | solicitante → servidor | Abre o chamado; o ack traz o estado quando o agente termina o turno |
| `chamado:responder` `{ chamadoId, texto }` | solicitante → servidor | Responde à pergunta do agente |
| `chamado:mensagem` `{ chamadoId, texto }` | solicitante ou atendente → servidor | Depois que o agente conclui: mensagem no chat do chamado, entre o solicitante e o atendente (analista da empresa) |
| `chamado:agente` | servidor → solicitante | Fase do agente, ao vivo: `pensando`, `consultando` (com a ferramenta), `escrevendo`, `tentando_de_novo`, `concluido` |
| `chamado:atualizado` | servidor → solicitante | Estado completo do chamado a cada mudança, inclusive mensagem do atendente e decisão da triagem |
| `triagem:fila` | servidor → analistas | Fila da empresa, já ordenada, quando um chamado entra nela, recebe mensagem ou é triado |
| `triagem:chamado` | servidor → analistas | Um chamado da fila mudou (inclusive mensagem nova); quem estiver com ele aberto recarrega o detalhe |

Os erros do ack têm o mesmo formato da API REST (`{ erro, mensagem, ... }`); `hub_indisponivel` continua abrindo o formulário curto. A contingência e as decisões da triagem continuam na API REST, e o servidor avisa pelo WebSocket. O domínio publica as mudanças num barramento em memória (`backend/src/dominio/eventos.ts`), e o gateway (`backend/src/tempo-real/gateway.ts`) repassa às salas.

O frontend fala com a API pelo rewrite do Next (`/api`) e abre o WebSocket direto no backend (`NEXT_PUBLIC_API_URL`, ou o mesmo host da página na porta 3333). O cookie de sessão vale nos dois porque cookie não depende da porta.

Teste de ponta a ponta, com o backend rodando no Hub simulado:

```bash
cd backend
npm run smoke-chamados
```

## Ligar no agente real

1. `cd backend` e copie `.env.example` para `.env`.
2. Preencha `HUB_API_KEY=` com a sua chave.
3. Reinicie o backend. O terminal deve mostrar `Hub: real (https://belatrix.ai, uma API Key da plataforma)` e a lista de empresas com o agente de cada uma, e o cabeçalho do app, "Hub: real".

O agente de cada empresa fica no banco, e não no `.env`: veja [Empresas](#empresas-multiempresa).

## Empresas (multiempresa)

Cada empresa cliente é um registro na tabela `empresas`, que é o cadastro oficial. O app usa **uma conta só no Kaffa AI Hub, com uma API Key da plataforma**. Cada empresa tem lá o seu agente, o seu conector `postgres-<empresa>` e o seu usuário do banco `hub_<empresa>`, que só lê as views da empresa.

**O isolamento é garantido pelo banco (RLS).** O backend atende cada requisição no papel `app_runtime`, com a empresa do usuário logado (`app.empresa_id`). O Postgres só devolve, e só aceita gravar, linhas dessa empresa: um `where empresa_id` esquecido no código não vaza nada. O papel não lê senha, e-mail, sessão nem token, e uma consulta sem empresa no contexto é recusada. Login, sessão, cadastro e administração rodam como a plataforma. Os testes estão em `backend/src/db/isolamento.test.ts` e `backend/src/rotas/multiempresa.test.ts`.

**Dossiê:** `dados/<empresa>/empresa.json` (nome, mercado, área, descrição, domínio de e-mail, agente, slug do conector e usuários de teste), mais os 4 CSVs do catálogo e os roteiros de teste em `roteiros.md`. O dossiê é só a entrada: depois da primeira carga, quem manda é o banco, e rodar de novo não sobrescreve nada. Hoje há três: Aurora Distribuição (`aurora`), Rede Vitalis (`vitalis`) e Instituto Horizonte (`horizonte`).

**Com o banco local (PGlite),** a subida importa todos os dossiês e cria as senhas, mostradas no terminal. **Com o Supabase, o cadastro é explícito**, com o backend rodando:

```bash
npm run provisionar -- vitalis
```

O comando é idempotente: rodar de novo só faz o que falta.
1. Cadastra a empresa (status `implantacao`), os usuários e o catálogo.
2. Cria as senhas de quem ainda não tem. Elas aparecem uma vez só.
3. Cria o usuário só leitura do Hub (`hub_vitalis`) e as views. A senha aparece uma vez só.
4. Gera o prompt do agente em `hub/prompts/vitalis.md`, a partir do modelo comum `hub/prompt-qualificador.modelo.md`, com o schema e a ferramenta da empresa.
5. Mostra o que criar no Hub: o conector Database (PostgreSQL) `postgres-vitalis` e o agente "Qualificador Rede Vitalis".

Depois de criar o agente no Hub, rode `npm run definir-agente -- vitalis <uuid>`. Com tudo pronto, o status passa a `ativa`. Enquanto a empresa não tem agente, os chamados dela vão para o formulário curto, e nada se perde.

| Comando | O que faz |
|---|---|
| `npm run listar-empresas` | Empresas, status e o que falta em cada uma |
| `npm run provisionar -- <empresa> [--recarregar-catalogo]` | Cadastra ou completa a empresa a partir do dossiê |
| `npm run definir-agente -- <empresa> [uuid]` | Mostra ou troca o agente. Vale para todos que usam o banco, já no próximo turno |
| `npm run status-empresa -- <empresa> suspensa` | Ninguém da empresa entra, as sessões caem na hora e o acesso do Hub é bloqueado |
| `npm run status-empresa -- <empresa> ativa` | Reativa |
| `npm run definir-conector -- <empresa> <slug>` | Grava o slug real do conector no Hub e gera de novo o prompt. O Hub deriva o slug do nome do conector e não deixa mudar depois: "Postgres Horizonte" vira `postgres-horizonte` |

## Contexto no banco

O contexto da empresa (aplicações, filas, categorias e procedimentos) fica no **Postgres do app**. Os CSVs de `dados/<empresa>/` são só a carga inicial, feita no provisionamento da empresa. Depois disso, quem manda é o banco.

O agente lê esse contexto por um de três caminhos:

| Caminho | Quando serve | Como liberar |
|---|---|---|
| **Conector PostgreSQL do Hub** (principal) | Banco no Supabase: o Hub alcança o banco | `npm run acesso-banco -- aurora` |
| Conector CSV "Catálogo Aurora" (plano B) | Banco local (PGlite): o Hub não alcança | `npm run exportar-catalogo -- aurora` e trocar os arquivos no conector |
| Conector API REST (`/hub/v1`) | App publicado (D5) | `npm run gerar-token -- aurora` |

### Banco no Supabase

1. Crie um projeto no Supabase, de preferência na região São Paulo, e guarde a senha do banco.
2. Em **Connect**, copie a URI do **Session pooler**. A conexão direta do plano gratuito é só IPv6, e o Hub pode não alcançá-la.
3. Em `backend/.env`, preencha `DATABASE_URL` com essa URI, trocando `[YOUR-PASSWORD]` pela senha. Na senha, `@` vira `%40`, `#` vira `%23` e `/` vira `%2F`.
4. Opcional: baixe o certificado em Database Settings → SSL Configuration e aponte `DATABASE_SSL_CA` para ele. Assim o app verifica o servidor.
5. Suba o backend. O terminal deve mostrar `banco: postgres (…pooler.supabase.com, …)`. As tabelas e a carga inicial da Aurora são criadas na primeira subida, e o que faltar (como as colunas de login em `usuarios`) a cada subida. Se preferir aplicar à mão, o SQL está em `backend/sql/usuarios-login.sql`, para colar no SQL Editor.

O app não usa a Data API do Supabase, que publica o schema `public`. Por isso todas as tabelas ficam com RLS ligado e sem política, e os papéis `anon` e `authenticated` perdem o acesso a elas. Se quiser, desligue a Data API em Project Settings → Data API.

**Plano gratuito:** um projeto parado por 7 dias é pausado. Confira se ele está ativo antes do Gate 3 e da apresentação.

### Acesso do Hub ao banco (conector PostgreSQL)

O agente escreve o SQL, então o Hub **nunca** recebe o usuário `postgres` do app. Cada empresa tem um usuário próprio, só de leitura:

- **schema `hub_aurora`**, com views só da Aurora: `contexto` (uma linha com tudo em JSON), `empresa`, `filas`, `aplicacoes`, `categorias`, `procedimentos` e `chamados_recentes` (os últimos 7 dias, sem quem abriu);
- **usuário `hub_aurora`**, que só enxerga esse schema: não lê as tabelas do app (chamados, usuários, tokens) nem as de outra empresa, e não escreve em nada. Tem limite de 5 conexões e consultas de até 5 s.

```bash
npm run acesso-banco -- aurora
```

O comando cria o schema, as views e o usuário, com uma senha nova, e mostra os campos do conector: host, porta, banco, usuário, senha e schema. **A senha aparece só uma vez.** O banco guarda só o verificador SCRAM, nunca a senha. Em seguida, o comando entra como o Hub, pelo mesmo pooler, e confere que o usuário lê o contexto e que as tabelas do app e a escrita estão bloqueadas.

- Rodar de novo troca a senha. Atualize o conector no Hub.
- `npm run revogar-acesso-banco -- aurora` bloqueia o usuário e encerra as conexões abertas.
- As views são recriadas a cada subida do backend, e a senha continua a mesma.

No Hub, crie o conector em **Conectores → Novo conector → Database (PostgreSQL)**. Não use o toolkit "PostgreSQL": ele não tem SSL Mode nem modo só leitura.

| Aba | Campo | Valor |
|---|---|---|
| Básico | Nome / Slug | Contexto Aurora / `contexto-aurora` |
| Destino | Host, Porta, Usuário, Nome do Banco | os do `acesso-banco` (porta 5432, banco `postgres`, usuário `hub_aurora.<ref>`) |
| Destino | Senha | a do `acesso-banco`, colada pela pessoa |
| Destino | SSL Mode | Obrigatório |
| Avançado | Somente leitura | ligado |
| Recursos | — | só aparece depois de salvar: conferir que lista as views de `hub_aurora` |

No agente, use o prompt `hub/prompt-qualificador-aurora-v4-banco.md`. No primeiro turno, ele lê tudo com `select contexto from hub_aurora.contexto`. Os nomes vão completos porque o conector pode fixar outro `search_path`.

### Conector de API (para quando o app for publicado)

**Ele já está pronto no backend**, na mesma porta do app, em `/hub/v1`, com o OpenAPI em `/hub/v1/openapi.json`. A empresa sai do token, então o agente não consegue pedir dados de outra empresa.

| Operação | Rota | Para quê |
|---|---|---|
| `obterContexto` | `GET /hub/v1/contexto` | Tudo da empresa numa chamada (~9 KB) |
| `obterCategoria` | `GET /hub/v1/categorias/{slug}` | Ficha de uma categoria |
| `buscarAplicacao` | `GET /hub/v1/aplicacoes?busca=portal` | Resolve nome ou apelido; avisa quando está fora do catálogo |
| `listarChamadosAbertos` | `GET /hub/v1/chamados-abertos?aplicacao=pagaflow` | Outros chamados recentes da mesma aplicação (abrangência) |

### Testar o conector de API localmente

Com o backend rodando, gere um token e consulte, trocando `<token>` pelo valor gerado:

```bash
npm run gerar-token -- aurora "teste local"
```

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3333/hub/v1/contexto
```

**Quando o app for publicado (D5),** o conector **API REST** do Hub importa o OpenAPI de `https://<endereço do app>/hub/v1/openapi.json`, com autenticação **Bearer** e um token gerado para ele. Aí o agente troca o conector CSV por esse, com o prompt de `hub/prompt-qualificador-aurora-v3-api.md`.

### Tokens do conector

Cada empresa tem um ou mais tokens, guardados no banco: só o hash e um prefixo para identificar. É o token que diz à API de qual empresa é o pedido. Empresa nova, token novo; nada muda no `.env`.

| Comando | O que faz |
|---|---|
| `npm run gerar-token -- <empresa> "descrição"` | Cria um token e mostra o valor uma única vez |
| `npm run listar-tokens` (ou `-- <empresa>`) | Lista pelo prefixo, com último uso e revogação |
| `npm run revogar-token -- <id>` | Revoga; vale já na próxima consulta do Hub |

Para trocar um token sem derrubar o conector: gere o novo, atualize no Hub e só então revogue o antigo.

### Administrar o catálogo (com o backend rodando)

```bash
npm run recarregar-catalogo -- aurora
```
Apaga o catálogo da Aurora no banco e recarrega de `dados/aurora/*.csv`.

```bash
npm run exportar-catalogo -- aurora
```
Gera `exportados/aurora/*.csv` a partir do banco. É o plano B, quando o banco é local e o Hub não alcança: no Hub, Conectores → Catálogo Aurora → Editar → Configuração → remova os 4 arquivos, solte os novos, **preencha Row Limit = 100** e salve.

## Testar com o agente real

### 1. Smoke test, sem o app (~1–2 centavos de dólar)

```bash
cd backend
npm run smoke-hub
```

Dois turnos na mesma sessão ("não consigo lançar um pagamento no portal" → "apareceu remessa recusada pelo banco"). O que conferir em cada turno:

| O que aparece | O que significa |
|---|---|
| `eventos: session_started, …, content, completed` | O runtime responde em SSE no formato esperado |
| A mesma `sessão` nos dois turnos | A continuidade de conversa funciona |
| `ferramentas: …_catalogo_triagem` | O agente consultou o Catálogo Aurora **sem ninguém pedir** |
| JSON impresso com `status`, `fila_sugerida`, `confianca` | O agente seguiu o contrato |
| `FORA DO FORMATO` | O agente não respondeu em JSON. O app pede de novo uma vez; se continuar, vira abstenção |
| `Hub respondeu 401/404/…` | Problema de chave ou de rota. Mande a saída |

### 2. Pelo app

Entre como **Ana** e abra um chamado para cada caso. Depois entre como **Bruna** e revise cada um na triagem.

Envie só o relato. Depois, **responda apenas o que o agente perguntar**, usando a ficha do que o solicitante sabe. Se ele perguntar algo que não está na ficha, responda "não sei". É isso que torna o teste repetível: o agente precisa descobrir o que perguntar.

| # | Relato | O que o solicitante sabe | Esperado |
|---|---|---|---|
| 1 | "Não consigo pagar o fornecedor pelo portal" | Aparece "Remessa recusada pelo banco". Só com esse fornecedor; outros pagamentos saem. Só com ele? Não sabe | 1 pergunta → **Operações Financeiras** |
| 2 | "O portal de pagamentos travou quando cliquei em enviar remessa" | A tela congela e fecha sozinha, sem mensagem. Aconteceu duas vezes hoje. Se colegas têm o problema: não sabe | 0–1 pergunta → **Aplicações Corporativas** |
| 3 | "Não consigo abrir o módulo de aprovação do DespesaCerta" | Aparece "Você não tem permissão para acessar este módulo". Nunca usou: foi promovida a coordenadora esta semana. O gestor consegue | 2 perguntas (o que aparece; se já funcionou ou se colegas conseguem) → **Identidade e Acessos** |
| 4 | "O sistema está fora" | Não sabe qual sistema nem se é com outros: responde "não sei" a tudo | **Abstenção**, com a dúvida escrita |
| 5 | "O SAP não abre" | Acessa por um link interno no navegador; tentava lançar uma nota | **Abstenção**: aplicação fora do catálogo |
| 6 | "Acho que alguém entrou na minha conta e mudou meus dados bancários" | Recebeu um e-mail de alteração que não fez | **Segurança**: encerra e orienta, sem perguntas |

Em cada caso, na tela da Bruna, anote:
- quantas perguntas o agente fez;
- a fila sugerida e a confiança;
- se aparecem **consultas do agente ao catálogo**;
- a lista **"O que o app ajustou"**, que mostra quando o app corrigiu o agente.

A conversa completa, os tokens e o tempo ficam no fim do detalhe. No Hub, as sessões aparecem em **Monitorar → Sessões**.

**Se algo falhar:** copie o que apareceu no terminal do backend e a lista "O que o app ajustou".

### 3. Caminhos de erro (funcionam com o Hub simulado)

Com o Hub simulado, estas palavras no relato disparam as falhas:
- `#hub-fora`: o assistente fica indisponível e aparece o formulário curto (contingência);
- `#json-ruim`: o agente responde fora do formato, e o app tenta de novo;
- `#tool-erro`: a consulta ao catálogo falha, e o app força a abstenção.

## O que o app garante por cima do agente

Estas regras ficam em `backend/src/dominio/contrato.ts`, com testes em `npm test`:

- no máximo 3 perguntas; na 4ª, o app encerra e manda para triagem humana;
- discriminador sem resposta limita a confiança a 0,6;
- confiança abaixo de 0,7 vira abstenção;
- fila fora do catálogo vira abstenção;
- consulta ao catálogo que falhou e não foi refeita vira abstenção;
- fila sugerida sem nenhuma consulta ao catálogo que deu certo (fila adivinhada) vira abstenção;
- resposta fora do formato: uma nova tentativa e, se falhar de novo, triagem humana;
- Hub indisponível: formulário curto, e o chamado não se perde;
- a empresa sai sempre do usuário logado, e cada solicitante só vê os próprios chamados.

## Limitações do protótipo

- As sessões vencem 8 horas depois do login, sem renovar com o uso. Não há tela para ver ou encerrar as sessões abertas: trocar a senha (`definir-senha`) encerra todas.
- Uma empresa só (Aurora). As tabelas já separam por empresa.
- O texto do agente aparece inteiro ao final do turno, não aos poucos: ele responde em JSON, que só vale depois de validado. O que chega ao vivo é a fase do agente.
- O barramento de eventos fica em memória: com mais de uma instância do backend, seria preciso um adapter do socket.io (Redis, por exemplo).
- Sem precedentes nem medição (semana 3, no plano técnico).
