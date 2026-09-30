import type { Turno } from "@/lib/api";

const ROTULO: Partial<Record<Turno["papel"], string>> = { agente: "Assistente", analista: "Suporte" };

/**
 * Turnos do chamado como chat: primeiro o agente qualifica, depois o atendente responde na mesma conversa.
 * As bolhas de quem está olhando (`visao`) ficam à direita.
 */
export function Conversa({ turnos, visao }: { turnos: Turno[]; visao: "solicitante" | "analista" }) {
  return turnos.map((t) => {
    const propria = t.papel === visao;
    const rotulo = t.papel === "sistema" || propria ? null : [t.autor, ROTULO[t.papel]].filter(Boolean).join(" · ");
    return (
      <div key={t.id} className={`bolha ${t.papel} ${propria ? "propria" : ""}`}>
        {rotulo && <span className="autor">{rotulo}</span>}
        {t.texto}
      </div>
    );
  });
}
