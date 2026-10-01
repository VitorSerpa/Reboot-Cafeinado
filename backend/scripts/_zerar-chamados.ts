// Temporário: zera o histórico de chamados (chamados, turnos, triagens) e reinicia a numeração. Apagar depois.
import pg from "pg";

import { env } from "../src/config/env.js";
import { configPg } from "../src/db/index.js";

const pool = new pg.Pool(configPg(env.db.url));
const c = await pool.connect();
try {
  await c.query("begin");
  await c.query("truncate table triagens, turnos, chamados restart identity");
  await c.query("commit");
} catch (erro) {
  await c.query("rollback");
  throw erro;
} finally {
  c.release();
}
const r = await pool.query(`select (select count(*) from chamados)::int as chamados, (select count(*) from turnos)::int as turnos,
  (select count(*) from triagens)::int as triagens, (select count(*) from usuarios)::int as usuarios,
  (select count(*) from usuarios where senha_hash is not null)::int as com_senha,
  (select count(*) from categorias)::int as categorias, (select count(*) from filas)::int as filas`);
console.log(`banco ${new URL(env.db.url).hostname} · depois:`, JSON.stringify(r.rows[0]));
await pool.end();
