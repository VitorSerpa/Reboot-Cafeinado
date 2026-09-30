import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { lerCsvDaEmpresa } from "../dados/csv.js";
import { db } from "../db/index.js";
import { ErroApp } from "./erros.js";

/**
 * Contexto de uma empresa no Postgres: aplicações, filas, categorias e procedimentos.
 * O banco é a fonte da verdade; os CSVs de `dados/<empresa>/` são só a carga inicial.
 */

const lista = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

/** Carrega o catálogo a partir dos CSVs. `substituir` apaga o que existe antes (recarga explícita). */
export async function carregarDoCsv(empresa: string, { substituir }: { substituir: boolean }) {
  if (substituir) {
    for (const tabela of ["procedimentos", "categorias", "aplicacoes", "filas"]) {
      await db.query(`delete from ${tabela} where empresa_id = $1`, [empresa]);
    }
  }

  for (const f of lerCsvDaEmpresa(empresa, "filas")) {
    await db.query(
      `insert into filas (empresa_id, slug, nome, escopo) values ($1, $2, $3, $4)
       on conflict (empresa_id, slug) do update set nome = excluded.nome, escopo = excluded.escopo`,
      [empresa, f.slug, f.nome, f.escopo],
    );
  }
  for (const a of lerCsvDaEmpresa(empresa, "aplicacoes")) {
    await db.query(
      `insert into aplicacoes (empresa_id, slug, nome, apelidos, uso, acesso, observacao) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (empresa_id, slug) do update set nome = excluded.nome, apelidos = excluded.apelidos,
         uso = excluded.uso, acesso = excluded.acesso, observacao = excluded.observacao`,
      [empresa, a.slug, a.nome, a.apelidos, a.uso, a.acesso, a.observacao],
    );
  }
  for (const c of lerCsvDaEmpresa(empresa, "categorias")) {
    await db.query(
      `insert into categorias (empresa_id, slug, nome, fila_padrao, discriminadores, campos_obrigatorios, regra_de_roteamento)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (empresa_id, slug) do update set nome = excluded.nome, fila_padrao = excluded.fila_padrao,
         discriminadores = excluded.discriminadores, campos_obrigatorios = excluded.campos_obrigatorios,
         regra_de_roteamento = excluded.regra_de_roteamento`,
      [
        empresa,
        c.slug,
        c.nome,
        c.fila_padrao,
        JSON.stringify(lista(c.discriminadores)),
        JSON.stringify(lista(c.campos_obrigatorios)),
        c.regra_de_roteamento,
      ],
    );
  }
  for (const p of lerCsvDaEmpresa(empresa, "procedimentos")) {
    await db.query(
      `insert into procedimentos (empresa_id, slug, titulo, quando_aplicar, ja_sabemos, minimo_para_o_suporte,
         perguntas_uteis, evidencias, encaminhamento, quando_parar)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (empresa_id, slug) do update set titulo = excluded.titulo, quando_aplicar = excluded.quando_aplicar,
         ja_sabemos = excluded.ja_sabemos, minimo_para_o_suporte = excluded.minimo_para_o_suporte,
         perguntas_uteis = excluded.perguntas_uteis, evidencias = excluded.evidencias,
         encaminhamento = excluded.encaminhamento, quando_parar = excluded.quando_parar`,
      [
        empresa,
        p.slug,
        p.titulo,
        p.quando_aplicar,
        p.ja_sabemos,
        p.minimo_para_o_suporte,
        p.perguntas_uteis,
        p.evidencias,
        p.encaminhamento,
        p.quando_parar,
      ],
    );
  }
}

/** Carga inicial: só roda se a empresa ainda não tem categorias. Depois disso, quem manda é o banco. */
export async function cargaInicialSeVazio(empresa: string) {
  const existe = await db.one("select 1 from categorias where empresa_id = $1 limit 1", [empresa]);
  if (!existe) await carregarDoCsv(empresa, { substituir: false });
}

export async function filas(empresa: string) {
  return db.query<{ slug: string; nome: string; escopo: string }>(
    "select slug, nome, escopo from filas where empresa_id = $1 order by nome",
    [empresa],
  );
}

export async function aplicacoes(empresa: string) {
  const linhas = await db.query<{ slug: string; nome: string; uso: string; acesso: string; apelidos: string; observacao: string }>(
    "select slug, nome, uso, acesso, apelidos, observacao from aplicacoes where empresa_id = $1 order by nome",
    [empresa],
  );
  return linhas.map((a) => ({ ...a, apelidos: lista(a.apelidos) }));
}

export async function categorias(empresa: string) {
  return db.query<{
    slug: string;
    nome: string;
    fila_padrao: string;
    discriminadores: string[];
    campos_obrigatorios: string[];
    regra_de_roteamento: string;
  }>(
    `select slug, nome, fila_padrao, discriminadores, campos_obrigatorios, regra_de_roteamento
     from categorias where empresa_id = $1 order by slug`,
    [empresa],
  );
}

export async function procedimentos(empresa: string) {
  return db.query(
    `select slug, titulo, quando_aplicar, ja_sabemos, minimo_para_o_suporte, perguntas_uteis, evidencias, encaminhamento, quando_parar
     from procedimentos where empresa_id = $1 order by slug`,
    [empresa],
  );
}

/** Tudo o que o agente precisa para qualificar um chamado da empresa, numa chamada só. */
export async function contexto(empresa: string) {
  const dados = await db.one<{ nome: string; mercado: string; area: string; descricao: string }>(
    "select nome, mercado, area, descricao from empresas where id = $1",
    [empresa],
  );
  if (!dados) throw new ErroApp(404, "empresa", "Empresa não encontrada.");
  const [f, a, c, p] = await Promise.all([filas(empresa), aplicacoes(empresa), categorias(empresa), procedimentos(empresa)]);
  return { empresa: dados, filas: f, aplicacoes: a, categorias: c, procedimentos: p };
}

export async function categoria(empresa: string, slug: string) {
  const todas = await categorias(empresa);
  const achada = todas.find((c) => c.slug === slug);
  if (!achada) {
    throw new ErroApp(404, "categoria", `Categoria "${slug}" não existe. Categorias válidas: ${todas.map((c) => c.slug).join(", ")}.`);
  }
  return achada;
}

/** Pontua aplicações pelo termo buscado: nome e slug valem mais que apelido, que vale mais que uso. */
export function pontuarAplicacao(termo: string, a: { slug: string; nome: string; apelidos: string[]; uso: string }) {
  const t = normalizar(termo);
  if (!t) return 0;
  if (normalizar(a.nome) === t || a.slug === t) return 100;
  if (a.apelidos.some((ap) => normalizar(ap) === t)) return 90;
  if (normalizar(a.nome).includes(t) || t.includes(normalizar(a.nome))) return 70;
  if (a.apelidos.some((ap) => t.includes(normalizar(ap)) || normalizar(ap).includes(t))) return 60;
  const palavras = t.split(/\s+/).filter((p) => p.length > 3);
  if (palavras.some((p) => normalizar(a.uso).includes(p))) return 30;
  return 0;
}

export async function buscarAplicacoes(empresa: string, termo: string) {
  const todas = await aplicacoes(empresa);
  const achadas = todas
    .map((a) => ({ ...a, relevancia: pontuarAplicacao(termo, a) }))
    .filter((a) => a.relevancia > 0)
    .sort((x, y) => y.relevancia - x.relevancia);
  return { termo, encontradas: achadas, fora_do_catalogo: achadas.length === 0 };
}

/**
 * Chamados enviados recentemente sobre a mesma aplicação: indica abrangência ("é só comigo?").
 * São relatos, não confirmação de indisponibilidade.
 */
export async function chamadosAbertos(empresa: string, aplicacao: string, horas: number) {
  const janela = Math.min(Math.max(Math.round(horas) || 24, 1), 168);
  const linhas = await db.query<{ id: number; status: string; minutos: number; resumo: string | null }>(
    `select id, status,
            floor(extract(epoch from (now() - coalesce(enviado_em, criado_em))) / 60)::int as minutos,
            resultado->>'resumo' as resumo
     from chamados
     where empresa_id = $1 and resultado->>'aplicacao' = $2
       and status in ('aguardando_triagem', 'triado')
       and coalesce(enviado_em, criado_em) > now() - make_interval(hours => $3)
     order by coalesce(enviado_em, criado_em) desc limit 20`,
    [empresa, aplicacao, janela],
  );
  return {
    aplicacao,
    janela_horas: janela,
    total: linhas.length,
    observacao: "São relatos de outros funcionários, não confirmação de indisponibilidade.",
    chamados: linhas.map((l) => ({ id: l.id, status: l.status, ha_minutos: l.minutos, resumo: (l.resumo ?? "").slice(0, 200) })),
  };
}

const CSV_COLUNAS = {
  aplicacoes: ["slug", "nome", "uso", "acesso", "apelidos", "observacao"],
  categorias: ["slug", "nome", "fila_padrao", "discriminadores", "campos_obrigatorios", "regra_de_roteamento"],
  filas: ["slug", "nome", "escopo"],
  procedimentos: [
    "slug",
    "titulo",
    "quando_aplicar",
    "ja_sabemos",
    "minimo_para_o_suporte",
    "perguntas_uteis",
    "evidencias",
    "encaminhamento",
    "quando_parar",
  ],
} as const;

const celula = (v: unknown) => {
  const s = Array.isArray(v) ? v.join(", ") : String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Plano B: exporta o catálogo do banco nos CSVs que o conector CSV do Hub aceita. */
export async function exportarCsv(empresa: string, pasta: string) {
  const dados = await contexto(empresa);
  mkdirSync(pasta, { recursive: true });
  const arquivos: string[] = [];
  for (const [nome, colunas] of Object.entries(CSV_COLUNAS)) {
    const linhas = (dados[nome as keyof typeof CSV_COLUNAS] as Record<string, unknown>[]).map((l) =>
      colunas.map((c) => celula(l[c])).join(","),
    );
    const caminho = join(pasta, `${nome}.csv`);
    writeFileSync(caminho, [colunas.join(","), ...linhas].join("\n") + "\n");
    arquivos.push(caminho);
  }
  return arquivos;
}
