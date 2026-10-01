import { db } from "../db/index.js";
import { ErroApp } from "./erros.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validarAgenteId(agenteId: string) {
  const id = agenteId.trim();
  if (!UUID.test(id)) {
    throw new ErroApp(400, "agente", `"${agenteId}" não é o UUID de um agente do Hub (ex.: 06abc3a3-1c9f-785e-8000-519434bce89a).`);
  }
  return id.toLowerCase();
}

/** O agente que o backend chama, por empresa. Vem do banco, não do .env. */
export async function agentesPorEmpresa() {
  return db.query<{ id: string; agente_id: string }>("select id, agente_id from empresas order by id");
}

/** Troca o agente da empresa para todos os backends que usam este banco, já no próximo turno. */
export async function definirAgente(empresa: string, agenteId: string) {
  const novo = validarAgenteId(agenteId);
  const atual = await db.one<{ agente_id: string }>("select agente_id from empresas where id = $1", [empresa]);
  if (!atual) throw new ErroApp(404, "empresa", `Empresa "${empresa}" não existe.`);
  await db.query("update empresas set agente_id = $2 where id = $1", [empresa, novo]);
  return { empresa, antes: atual.agente_id, depois: novo };
}
