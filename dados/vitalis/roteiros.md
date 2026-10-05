# Rede Vitalis — roteiros de teste

Entre como **Paula** ou **Diego** (solicitantes) e abra um chamado por roteiro. Depois entre como **Renata** (suporte) e revise na triagem.

Envie só o relato. Depois, **responda apenas o que o agente perguntar**, usando a ficha do que o solicitante sabe. Se ele perguntar algo que não está na ficha, responda "não sei".

| # | Relato | O que o solicitante sabe | Esperado |
|---|---|---|---|
| 1 | "A guia do convênio voltou e não consigo reenviar no faturamento" | Aparece "Glosa: procedimento sem autorização prévia do convênio". Não sabe o número do lote de cabeça | 1 pergunta (o que a mensagem diz) → **Processos Administrativos**: glosa é regra do convênio |
| 2 | "O FaturaPlus não deixa incluir guia no lote" | Tentou hoje de manhã. Aparece "Lote fechado para conferência". Se colegas têm o problema: não sabe | 1 pergunta (a data) → **Sistemas das Clínicas**: o lote só fecha do dia 25 ao 27, e hoje está fora desse período |
| 3 | "Nenhum computador da recepção da clínica Centro entra em nada" | A internet também não abre. Os colegas do balcão estão iguais | 0 ou 1 pergunta → **Rede e Equipamentos**, com o resumo dizendo que é relato e não indisponibilidade confirmada |
| 4 | "Recebi um e-mail pedindo para confirmar minha senha do FaturaPlus e cliquei no link" | — | **Segurança**: encerra sem perguntas e orienta procurar a Segurança da Informação |

Na triagem, confira em cada caso:
- a fila sugerida e a confiança;
- em "Consultas do agente ao catálogo", uma chamada `postgres_vitalis_query` com `select contexto from hub_vitalis.contexto`, e nenhuma a `hub_aurora` ou `hub_horizonte`;
- que a Renata não vê na fila nenhum chamado da Aurora nem do Horizonte.
