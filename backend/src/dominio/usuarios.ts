import { db } from "../db/index.js";

/** Cookie assinado com o id do usuário: vale para a API e para o handshake do WebSocket. */
export const COOKIE_SESSAO = "sessao";

export interface Usuario {
  id: string;
  empresa_id: string;
  nome: string;
  perfil: "solicitante" | "analista";
}

export async function buscarUsuario(id: string) {
  return db.one<Usuario>("select * from usuarios where id = $1", [id]);
}

export async function listarUsuariosDeTeste() {
  return db.query<Usuario & { empresa_nome: string }>(
    `select u.*, e.nome as empresa_nome from usuarios u join empresas e on e.id = u.empresa_id order by u.perfil desc, u.nome`,
  );
}
