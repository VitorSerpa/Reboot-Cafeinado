/**
 * Smoke test do agente real, sem banco nem app: dois turnos na mesma conversa.
 * Uso: npm run smoke-hub   (precisa de HUB_API_KEY no .env; gasta ~1–2 centavos de dólar)
 */
import { randomUUID } from "node:crypto";

import { env } from "../src/config/env.js";
import { lerContrato } from "../src/dominio/contrato.js";
import { hubReal } from "../src/hub/runtime.js";

if (!env.hub.apiKey) {
  console.error("Preencha HUB_API_KEY no backend/.env antes de rodar.");
  process.exit(1);
}

// O mesmo ID externo nos dois turnos: é por ele que o Hub mantém a conversa.
const sessaoExterna = `smoke-${randomUUID()}`;
const turnos = [
  "Relato inicial do solicitante:\nnão consigo lançar um pagamento no portal\n\n[Sistema: perguntas já feitas: 0 de 3.]",
  "Resposta do solicitante:\napareceu 'remessa recusada pelo banco'\n\n[Sistema: perguntas já feitas: 1 de 3.]",
];

console.log(`ID externo da conversa: ${sessaoExterna}`);
const sessoesHub: (string | null)[] = [];
for (const [i, mensagem] of turnos.entries()) {
  const r = await hubReal.conversar({ agenteId: env.hub.agenteAurora, mensagem, sessaoExterna });
  sessoesHub.push(r.sessionId);
  const contrato = lerContrato(r.texto);
  const contagem = r.eventos.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e]: (acc[e] ?? 0) + 1 }), {});
  console.log(`\n=== turno ${i + 1} · sessão no Hub ${r.sessionId}`);
  console.log("eventos:", Object.entries(contagem).map(([e, n]) => `${e}×${n}`).join(", ") || "(nenhum)");
  console.log("ferramentas:", r.toolCalls.map((t) => `${t.tool}${t.isError ? " (ERRO)" : ""}`).join(", ") || "(nenhuma)");
  console.log("tokens:", r.tokens, "latência ms:", r.latenciaMs);
  if (r.erros.length) console.log("erros:", r.erros);
  console.log(contrato.ok ? contrato.contrato : `FORA DO FORMATO: ${contrato.erro}\n${r.texto}`);
}

console.log(
  sessoesHub[0] && sessoesHub[0] === sessoesHub[1]
    ? "\n✔ Os dois turnos ficaram na MESMA sessão do Hub: a conversa tem memória."
    : `\n✖ Sessões diferentes no Hub (${sessoesHub.join(" → ")}): o 2º turno não enxergou o 1º.`,
);
