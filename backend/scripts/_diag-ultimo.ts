// Diagnóstico temporário (só leitura): o chamado mais recente, as ferramentas e a sessão do Hub. Apagar depois.
import pg from "pg";

import { env } from "../src/config/env.js";
import { configPg } from "../src/db/index.js";

const pool = new pg.Pool(configPg(env.db.url));
const logins = await pool.query("select id, ultimo_login from usuarios order by id");
console.log("SUPABASE  último login:", JSON.stringify(logins.rows));
const doBackend = await (await fetch("http://localhost:3333/api/admin/usuarios")).json();
console.log("BACKEND   último login:", JSON.stringify(doBackend.map((u: { id: string; ultimo_login: string | null }) => ({ id: u.id, ultimo_login: u.ultimo_login }))));
const empresa = await pool.query("select id, agente_id from empresas");
console.log("agente que o backend chama (empresas.agente_id):", JSON.stringify(empresa.rows));
const { rows } = await pool.query(`
  select c.id, c.criado_em, c.hub_session_id as sessao_externa, t.id as turno, t.criado_em as turno_em, t.hub_sessao,
         (select string_agg(tc->>'tool' || case when (tc->>'isError')::bool then '(ERRO)' else '' end, ', ' order by ord)
            from jsonb_array_elements(t.tool_calls) with ordinality as x(tc, ord)) as ferramentas
  from chamados c join turnos t on t.chamado_id = c.id and t.papel = 'agente'
  order by c.id desc, t.id limit 10`);
for (const r of rows) {
  console.log(`#${r.id} (aberto ${new Date(r.criado_em).toLocaleString("pt-BR")}) turno ${r.turno} · sessão Hub ${r.hub_sessao} · externo ${r.sessao_externa}`);
  console.log(`   ferramentas: ${r.ferramentas ?? "nenhuma"}`);
}
await pool.end();
