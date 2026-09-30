import { env } from "../config/env.js";
import { cargaInicialSeVazio } from "../dominio/catalogo.js";
import { db } from "./index.js";

const DESCRICAO_AURORA =
  "Distribuidora atacadista de materiais de escritório e limpeza, com matriz e duas filiais. " +
  "O Financeiro processa pagamentos a fornecedores, acompanha recebimentos, aprova despesas e faz o fechamento contábil.";

/**
 * Empresa e usuários de teste (idempotente) e a carga inicial do catálogo a partir de `dados/aurora/*.csv`.
 * O catálogo só é carregado se a empresa ainda não tem um: depois disso, o banco é a fonte da verdade
 * (recarga explícita: npm run recarregar-catalogo -- aurora).
 */
export async function semear() {
  await db.query(
    `insert into empresas (id, nome, mercado, area, agente_id, descricao)
     values ('aurora', 'Aurora Distribuição', 'Distribuição atacadista', 'Financeiro', $1, $2)
     on conflict (id) do update set agente_id = excluded.agente_id,
       descricao = case when empresas.descricao = '' then excluded.descricao else empresas.descricao end`,
    [env.hub.agenteAurora, DESCRICAO_AURORA],
  );

  const usuarios = [
    ["ana", "Ana Ribeiro", "solicitante"],
    ["carlos", "Carlos Menezes", "solicitante"],
    ["bruna", "Bruna Tavares", "analista"],
  ];
  for (const [id, nome, perfil] of usuarios) {
    await db.query(
      `insert into usuarios (id, empresa_id, nome, perfil) values ($1, 'aurora', $2, $3)
       on conflict (id) do nothing`,
      [id, nome, perfil],
    );
  }

  await cargaInicialSeVazio("aurora");
}
