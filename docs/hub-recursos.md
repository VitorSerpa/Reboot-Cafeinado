# Recursos no Kaffa AI Hub (tenant `reboot-cafeinado`)

| Recurso | ID | Estado em 28/09/2026 |
|---|---|---|
| Agente **Qualificador Aurora**, o que o app chama (`HUB_AGENTE_AURORA`) | `06abc3a3-1c9f-785e-8000-519434bce89a` | Desde 01/10. Conector: Postgres Aurora (banco no Supabase, usuário `hub_aurora`). Prompt: `hub/prompt-qualificador-aurora-v4-banco.md` |
| Agente antigo (slug `teste`), sem uso | `06aadae6-b808-72cb-8000-b3f61092c8e8` | v6. Haiku 4.5, temperature 0,2, max tokens 4096, markdown ligado. Prompt inline v2 = `hub/prompt-qualificador-aurora.md`. Conector: Catálogo Aurora (CSV). **Aprendizado desligado** |
| Conector **Catálogo Aurora** (slug `catalogo-triagem`, toolkit CSV) | `06ab3f2e-643d-7959-8000-f4ed434d24e4` | 4 arquivos de `dados/aurora/`: aplicacoes, categorias, filas, procedimentos (só Aurora, sem coluna tenant). `row_limit` = 100 |

## Histórico

- **28/09** — Agente: nome "Teste" → "Qualificador Aurora"; descrição nova; prompt trocado da referência `{{system-prompt-teste}}` (Prompt da biblioteca) pelo texto inline do repositório. O Prompt `system-prompt-teste` da biblioteca ficou sem uso, e a referência antiga continua listada em `config.prompt_library_refs`, sem efeito.
- **28/09** — Conector: nome "Catálogo de triagem" → "Catálogo Aurora"; removidos os 5 CSVs com Aurora, Vitalis e Horizonte misturadas (inclusive `empresas.csv`); enviados os 4 CSVs só da Aurora; `row_limit` 100 reenviado junto (a tela mostra o campo vazio mesmo salvo).

- **28/09 (v6)** — Prompt v2, depois do teste real do chamado #34:
  - ler `categorias`, `aplicacoes` e `procedimentos` uma vez, no 1º turno, sem reler;
  - seguir `perguntas_uteis` do procedimento, com o discriminador antes do nome do sistema, e deduzir o sistema pela operação (remessa → PagaFlow);
  - chaves de `informacoes` = `campos_obrigatorios` da categoria;
  - nunca dizer a fila ao solicitante.

  **Aprendizado desligado.** No #34, o agente chamou `log_decision` e gravou o contexto do chamado na memória, que valia para os chamados seguintes.

## Próximo recurso: conector "Contexto Aurora" do tipo Database (PostgreSQL), com o banco no Supabase

- Novo conector → **Database (PostgreSQL)**, e não o toolkit "PostgreSQL". Visto em 29/09, sem salvar:
  - o toolkit só tem Db Name, Host, Port, User e Password, sem SSL e sem schema;
  - o Database tem as abas Básico, Destino (host, porta, usuário, senha, banco, SSL Mode), Recursos ("Salve para detectar recursos") e Avançado (tempo limite, **Somente leitura**, descrições das ferramentas);
  - a documentação do Hub (`/docs`) não tem artigo sobre conectores.
- Campos de `npm run acesso-banco -- aurora`: host e porta do **Session pooler** do Supabase, banco `postgres`, usuário `hub_aurora.<ref>`, SSL Mode Obrigatório, Somente leitura ligado. Quem cola a senha é a pessoa, não o Claude.
- O usuário `hub_aurora` só lê as views do schema `hub_aurora`. `select contexto from hub_aurora.contexto` traz tudo numa linha (nomes sempre completos: o conector pode fixar `search_path=public`); `chamados_recentes` serve para a abrangência.
- Nomes das ferramentas: **a confirmar depois de salvar** (aba Recursos) ou no primeiro `tool_call`. O app já reconhece como consulta ao catálogo os nomes do toolkit do Agno (`run_query`, `show_tables` etc.). Se o conector Database usar outros, é preciso ajustar `eFerramentaDeCatalogo` e o filtro da triagem.
- Ao ligar no agente: desligar o conector CSV "Catálogo Aurora" do agente (ele continua existindo como plano B) e aplicar `hub/prompt-qualificador-aurora-v4-banco.md`.
- O `acesso-banco` testa as duas formas de conexão: a simples, como o conector Database, e com `search_path=public`, como o toolkit, que o pooler pode recusar.

## Depois: conector API REST "Contexto Aurora" (quando o app for publicado, D5)

- URL do OpenAPI: `https://<endereço do app>/hub/v1/openapi.json`. As rotas ficam em `/hub/v1`, na mesma porta do app.
- Autenticação: Bearer, com um token gerado por `npm run gerar-token -- aurora` (fica no banco, só o hash). Quem coloca o token no Hub é a pessoa, não o Claude.
- Ao ligar no agente: desligar o conector CSV "Catálogo Aurora" do agente (ele continua existindo como plano B) e aplicar `hub/prompt-qualificador-aurora-v3-api.md`.
- Com o conector PostgreSQL ligado, a API é opcional. Com o banco local, o plano B é o conector CSV, com os arquivos gerados por `npm run exportar-catalogo -- aurora`.

## Sessão da conversa no runtime (descoberto em 28/09)

O `session_id` do corpo de `POST /runtime/v1/chat/agents/{uuid}` é tratado como **ID externo**: se já existe uma sessão com esse ID externo, a conversa continua; se não, o Hub abre uma sessão nova e grava o valor como ID externo dela. Mandar de volta o ID interno que chega no evento `session_started` abre uma sessão nova a cada turno, e o agente perde o histórico. Por isso o app gera um ID por chamado (`chamado-<id>-<uuid>`) e manda o mesmo em todos os turnos. O ID interno fica em `turnos.hub_sessao`, para achar a conversa em Monitorar → Sessões.

## Observações

- O slug do conector ficou `catalogo-triagem` de propósito: o nome das ferramentas que o agente recebe depende dele (`query_file_catalogo_triagem` etc.).
- O nome do agente não aceita `·` ("Use apenas letras, números, espaços e pontuação básica").
- Para trocar os CSVs: Conectores → Catálogo Aurora → Editar → Configuração → remover e soltar os arquivos → **preencher Row Limit = 100** → Salvar.
