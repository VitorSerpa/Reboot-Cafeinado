import { db } from "../db/index.js";
import { carregarComAcesso, turnos, type Chamado } from "./chamados.js";
import { ErroApp } from "./erros.js";
import { avisarChamado } from "./eventos.js";
import type { Usuario } from "./usuarios.js";

function exigirAnalista(usuario: Usuario) {
  if (usuario.perfil !== "analista") throw new ErroApp(403, "perfil", "Só analistas acessam a triagem.");
}

/** Fila da empresa: pendentes primeiro, e entre elas as abstenções e casos de segurança no topo. */
export async function fila(usuario: Usuario) {
  exigirAnalista(usuario);
  return filaDaEmpresa(usuario.empresa_id);
}

/** A mesma fila, sem checar perfil: o gateway do WebSocket a manda para a sala de triagem da empresa. */
export async function filaDaEmpresa(empresaId: string) {
  return db.query(
    `select c.id, c.status, c.texto_inicial, c.enviado_em, c.qualificado_sem_ia, c.n_perguntas,
            c.resultado->>'status' as resultado_status,
            c.resultado->>'fila_sugerida' as fila_sugerida,
            (c.resultado->>'confianca')::float as confianca,
            c.resultado->>'resumo' as resumo,
            u.nome as solicitante, t.fila_final, t.corrigiu
     from chamados c
     join usuarios u on u.id = c.solicitante_id
     left join triagens t on t.chamado_id = c.id
     where c.empresa_id = $1 and c.status in ('aguardando_triagem', 'triado')
     order by (c.status = 'triado'),
              (c.resultado->>'status' not in ('abstencao', 'seguranca')),
              c.enviado_em desc
     limit 100`,
    [empresaId],
  );
}

export async function detalhe(usuario: Usuario, id: number) {
  exigirAnalista(usuario);
  const chamado = await carregarComAcesso(usuario, id);
  const solicitante = await db.one<{ nome: string }>("select nome from usuarios where id = $1", [chamado.solicitante_id]);
  const triagem = await db.one("select * from triagens where chamado_id = $1", [id]);
  return { chamado, solicitante: solicitante?.nome ?? chamado.solicitante_id, turnos: await turnos(id), triagem: triagem ?? null };
}

async function registrar(usuario: Usuario, chamado: Chamado, filaFinal: string, motivo: string | null) {
  if (chamado.status !== "aguardando_triagem") throw new ErroApp(409, "fora_de_fluxo", "Este chamado não está aguardando triagem.");
  const valida = await db.one("select 1 from filas where empresa_id = $1 and slug = $2", [chamado.empresa_id, filaFinal]);
  if (!valida) throw new ErroApp(400, "fila_invalida", "Escolha uma fila do catálogo.");

  const sugerida = chamado.resultado?.fila_sugerida ?? null;
  const corrigiu = sugerida !== filaFinal || chamado.resultado?.status !== "pronto";
  await db.query(
    `insert into triagens (chamado_id, analista_id, fila_final, corrigiu, motivo) values ($1, $2, $3, $4, $5)`,
    [chamado.id, usuario.id, filaFinal, corrigiu, motivo],
  );
  await db.query(`update chamados set status = 'triado', atualizado_em = now() where id = $1`, [chamado.id]);
  avisarChamado(chamado);
  return detalhe(usuario, chamado.id);
}

export async function confirmar(usuario: Usuario, id: number) {
  exigirAnalista(usuario);
  const chamado = await carregarComAcesso(usuario, id);
  if (chamado.resultado?.status !== "pronto" || !chamado.resultado.fila_sugerida) {
    throw new ErroApp(400, "sem_sugestao", "Não há fila sugerida para confirmar. Escolha a fila e registre o motivo.");
  }
  return registrar(usuario, chamado, chamado.resultado.fila_sugerida, null);
}

export async function corrigir(usuario: Usuario, id: number, filaFinal: string, motivo: string) {
  exigirAnalista(usuario);
  if (!motivo.trim()) throw new ErroApp(400, "motivo", "Explique em uma frase por que esta é a fila certa.");
  const chamado = await carregarComAcesso(usuario, id);
  return registrar(usuario, chamado, filaFinal, motivo.trim());
}
