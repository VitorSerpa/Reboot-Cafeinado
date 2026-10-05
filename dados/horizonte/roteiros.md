# Instituto Horizonte — roteiros de teste

Entre como **Marcos** ou **Lúcia** (solicitantes) e abra um chamado por roteiro. Depois entre como **Rafael** (suporte) e revise na triagem.

Envie só o relato. Depois, **responda apenas o que o agente perguntar**, usando a ficha do que o solicitante sabe. Se ele perguntar algo que não está na ficha, responda "não sei".

| # | Relato | O que o solicitante sabe | Esperado |
|---|---|---|---|
| 1 | "Não consigo lançar as notas da prova no Academus" | Aparece "Prazo de lançamento encerrado em 30/09". A prova foi no dia 24/09 | 1 pergunta (o que a mensagem diz) → **Secretaria e Financeiro**: prazo encerrado é regra acadêmica |
| 2 | "A rematrícula não aparece no portal do aluno" | Tentou hoje. Não aparece mensagem nenhuma, só não tem o botão | 1 pergunta (a data) → **Secretaria e Financeiro**: a rematrícula só abre em julho e em dezembro, e hoje está fora do período |
| 3 | "O Wi-Fi do laboratório 3 do campus Norte caiu e a turma não entra na Sala Virtual" | Só o laboratório 3 tem o problema; nos corredores o Wi-Fi funciona | 0 ou 1 pergunta → **Infraestrutura dos Campi** |
| 4 | "O SIGAA não abre" | Acessa por um link que recebeu por e-mail; queria ver o horário das aulas | **Abstenção**: aplicação fora do catálogo, com a dúvida escrita |

Na triagem, confira em cada caso:
- a fila sugerida e a confiança;
- em "Consultas do agente ao catálogo", uma chamada `postgres_horizonte_query` com `select contexto from hub_horizonte.contexto`, e nenhuma a `hub_aurora` ou `hub_vitalis`;
- que o Rafael não vê na fila nenhum chamado da Aurora nem da Vitalis.
