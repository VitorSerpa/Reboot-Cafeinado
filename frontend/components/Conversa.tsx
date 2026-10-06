import type { Turno } from "@/lib/api";
import { useMarca } from "@/lib/useMarca";

const ROTULO: Partial<Record<Turno["papel"], string>> = { agente: "Assistente", analista: "Suporte" };

/**
 * Turnos do chamado como chat: primeiro o agente qualifica, depois o atendente responde na mesma conversa.
 * As bolhas de quem está olhando (`visao`) ficam à direita. Com a marca de uma empresa, o assistente tem o nome dela.
 */
export function Conversa({ turnos, visao }: { turnos: Turno[]; visao: "solicitante" | "analista" }) {
  const marca = useMarca();
  return turnos.map((t) => {
    const propria = t.papel === visao;
    const autor = t.papel === "agente" && marca ? marca.assistente : t.autor;
    const rotulo = t.papel === "sistema" || propria ? null : [autor, ROTULO[t.papel]].filter(Boolean).join(" · ");
    return (
      <div key={t.id} className={`bolha ${t.papel} ${propria ? "propria" : ""}`}>
        {rotulo && <span className="autor">{rotulo}</span>}
        {t.texto}
      </div>
    );
  });
}
