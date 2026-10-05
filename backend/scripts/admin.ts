/**
 * Administração com o backend rodando. O Postgres embutido só aceita um processo por vez,
 * então os comandos falam com o backend (rotas /api/admin, que só atendem a própria máquina).
 *
 *   npm run gerar-token -- aurora ["descrição"]   → novo token do conector da empresa (mostrado UMA vez)
 *   npm run listar-tokens [-- aurora]             → tokens (só prefixo), com último uso e revogação
 *   npm run revogar-token -- <id>                 → revoga um token; vale na próxima requisição
 *   npm run recarregar-catalogo -- aurora         → apaga o catálogo da empresa e recarrega de dados/<empresa>/*.csv
 *   npm run exportar-catalogo -- aurora           → gera exportados/<empresa>/*.csv a partir do banco (plano B)
 *   npm run acesso-banco -- aurora                → usuário só leitura do Hub no banco (senha nova, mostrada UMA vez)
 *   npm run diagnosticar-banco -- aurora          → diagnóstico sem segredo (conexão, papel, login de teste descartável)
 *   npm run revogar-acesso-banco -- aurora        → bloqueia esse usuário
 *   npm run listar-usuarios                       → quem pode entrar (e-mail, último login, bloqueio), sem segredo
 *   npm run definir-senha -- <usuário> [e-mail] [--senha=<valor>]  → senha nova para o login (gerada, ou a escolhida)
 *   npm run criar-usuario -- <id> "<Nome>" <solicitante|analista> [e-mail]  → usuário novo na Aurora, já com senha
 *   npm run definir-agente -- aurora [uuid]       → mostra ou troca o agente da empresa (no banco: vale para todo o time)
 *   npm run listar-empresas                       → empresas, status e o que falta em cada uma
 *   npm run provisionar -- <empresa> [--recarregar-catalogo]  → cadastra ou completa a empresa a partir de dados/<empresa>/
 *   npm run status-empresa -- <empresa> <suspensa|ativa>       → suspende (ninguém entra) ou reativa
 *   npm run definir-conector -- <empresa> <slug>  → grava o slug real do conector no Hub e gera de novo o prompt
 */
import { env } from "../src/config/env.js";

const [comando, arg, descricao, ...resto] = process.argv.slice(2);

function mostrarLogin(l: { usuario: string; nome: string; perfil: string; email: string; senha: string }) {
  console.log(`Login de ${l.nome} (${l.usuario}, ${l.perfil}). Copie a senha agora: ela não aparece de novo.\n`);
  console.log(`  E-mail: ${l.email}`);
  console.log(`  Senha:  ${l.senha}\n`);
  console.log("Para trocar depois: npm run definir-senha -- " + l.usuario);
}
const base = `http://localhost:${env.port}/api/admin`;

async function chamar(metodo: "GET" | "POST", rota: string, corpo?: unknown) {
  const resposta = await fetch(base + rota, {
    method: metodo,
    headers: corpo ? { "Content-Type": "application/json" } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await resposta.json();
  if (!resposta.ok) throw new Error(json.mensagem ?? `HTTP ${resposta.status}`);
  return json;
}

try {
  switch (comando) {
    case "gerar-token": {
      const empresa = arg ?? "aurora";
      const t = await chamar("POST", `/empresas/${encodeURIComponent(empresa)}/tokens-conector`, { descricao: descricao ?? "" });
      console.log(`Token do conector de ${t.empresa} (id ${t.id}). Copie agora: ele não aparece de novo.\n\n  ${t.token}\n`);
      console.log("No Hub: conector API REST → Autenticação Bearer → cole o valor acima.");
      break;
    }
    case "listar-tokens": {
      const lista = await chamar("GET", `/tokens-conector${arg ? `?empresa=${encodeURIComponent(arg)}` : ""}`);
      if (!lista.length) console.log("Nenhum token. Gere com: npm run gerar-token -- aurora");
      for (const t of lista) {
        const estado = t.revogado_em ? `revogado em ${t.revogado_em}` : "ativo";
        console.log(`#${t.id}  ${t.empresa_id.padEnd(10)} ${t.prefixo}…  ${estado}  · último uso: ${t.ultimo_uso ?? "nunca"}  ${t.descricao}`);
      }
      break;
    }
    case "revogar-token": {
      if (!arg) throw new Error("Informe o id do token (veja em npm run listar-tokens).");
      await chamar("POST", `/tokens-conector/${encodeURIComponent(arg)}/revogar`);
      console.log(`Token #${arg} revogado.`);
      break;
    }
    case "recarregar": {
      const r = await chamar("POST", `/catalogo/${encodeURIComponent(arg ?? "aurora")}/recarregar`);
      console.log(`Catálogo de ${r.empresa} recarregado de ${r.origem}.`);
      break;
    }
    case "exportar": {
      const r = await chamar("POST", `/catalogo/${encodeURIComponent(arg ?? "aurora")}/exportar`);
      console.log(`Exportado:\n${r.arquivos.join("\n")}`);
      break;
    }
    case "acesso-banco": {
      const a = await chamar("POST", `/empresas/${encodeURIComponent(arg ?? "aurora")}/acesso-banco`);
      console.log(`Acesso do Hub ao banco (${a.schema}). Copie a senha agora: ela não aparece de novo.\n`);
      console.log(`  Host:     ${a.host}`);
      console.log(`  Porta:    ${a.porta}`);
      console.log(`  Banco:    ${a.banco}`);
      console.log(`  Usuário:  ${a.usuario}`);
      console.log(`  Senha:    ${a.senha}`);
      console.log(`  Schema:   ${a.schema}\n`);
      console.log(`Tabelas que o agente enxerga (views, só leitura): ${a.tabelas.join(", ")}\n`);
      console.log("Teste entrando como o Hub:");
      for (const c of a.checagens) console.log(`  ${c.ok ? "ok    " : "FALHOU"} ${c.item}: ${c.detalhe}`);
      console.log("\nNo Hub: Conectores → Novo conector → Database (PostgreSQL). Destino: os campos acima, SSL Mode = Obrigatório.");
      console.log("Avançado: Somente leitura ligado. Quem cola a senha no Hub é a pessoa.");
      break;
    }
    case "diagnosticar-banco": {
      const r = await chamar("POST", `/empresas/${encodeURIComponent(arg ?? "aurora")}/acesso-banco/diagnostico`);
      console.log(`Diagnóstico do acesso do Hub ao banco (${r.empresa}). Não tem segredo: pode colar a saída.\n`);
      for (const c of r.itens) console.log(`  ${c.ok ? "ok    " : "FALHOU"} ${c.item}: ${c.detalhe}`);
      break;
    }
    case "revogar-acesso-banco": {
      const r = await chamar("POST", `/empresas/${encodeURIComponent(arg ?? "aurora")}/acesso-banco/revogar`);
      console.log(`Acesso ${r.papel} bloqueado (${r.conexoes_encerradas} conexão(ões) encerrada(s)). Para liberar de novo: npm run acesso-banco -- ${r.empresa}`);
      break;
    }
    case "listar-usuarios": {
      const lista = await chamar("GET", "/usuarios");
      for (const u of lista) {
        const login = u.email
          ? `${u.email}${u.bloqueado ? "  BLOQUEADO" : ""}  · último login: ${u.ultimo_login ?? "nunca"}`
          : `sem senha: npm run definir-senha -- ${u.id}`;
        console.log(`${u.id.padEnd(12)} ${u.perfil.padEnd(12)} ${u.nome.padEnd(20)} ${login}`);
      }
      break;
    }
    case "definir-senha": {
      if (!arg) throw new Error("Informe o usuário (veja em npm run listar-usuarios).");
      // `--senha=<valor>` escolhe a senha; sem ele, o backend gera uma aleatória.
      const senha = process.argv.find((a) => a.startsWith("--senha="))?.slice("--senha=".length);
      const email = descricao && !descricao.startsWith("--") ? descricao : undefined;
      mostrarLogin(await chamar("POST", `/usuarios/${encodeURIComponent(arg)}/senha`, { email, senha }));
      break;
    }
    case "criar-usuario": {
      const [perfil, email] = resto;
      if (!arg || !descricao || !perfil) throw new Error('Uso: npm run criar-usuario -- <id> "<Nome>" <solicitante|analista> [e-mail]');
      mostrarLogin(await chamar("POST", "/usuarios", { id: arg, nome: descricao, perfil, email }));
      break;
    }
    case "definir-agente": {
      const empresa = arg ?? "aurora";
      if (!descricao) {
        const a = await chamar("GET", `/empresas/${encodeURIComponent(empresa)}/agente`);
        console.log(`Agente de ${a.empresa} no banco: ${a.agente_id || "(nenhum)"}`);
        console.log(`Para trocar: npm run definir-agente -- ${a.empresa} <uuid>`);
        break;
      }
      const r = await chamar("POST", `/empresas/${encodeURIComponent(empresa)}/agente`, { agenteId: descricao });
      console.log(`Agente de ${r.empresa}: ${r.antes || "(nenhum)"} → ${r.depois}. Status da empresa: ${r.status}.`);
      console.log("Vale para todos os backends que usam este banco, já no próximo turno de cada chamado.");
      break;
    }
    case "listar-empresas": {
      const lista = await chamar("GET", "/empresas");
      if (!lista.length) console.log("Nenhuma empresa. Provisione com: npm run provisionar -- <empresa>");
      for (const e of lista) {
        const falta = e.pendencias.length ? `falta: ${e.pendencias.join(", ")}` : "pronta";
        console.log(
          `${e.id.padEnd(11)} ${e.nome.padEnd(24)} ${e.status.padEnd(12)} ${falta.padEnd(44)} ${e.com_senha}/${e.usuarios} com login · ${e.chamados} chamado(s)`,
        );
      }
      break;
    }
    case "provisionar": {
      if (!arg) throw new Error("Uso: npm run provisionar -- <empresa> [--recarregar-catalogo]   (dossiê em dados/<empresa>/)");
      const r = await chamar("POST", `/empresas/${encodeURIComponent(arg)}/provisionar`, {
        recarregarCatalogo: [descricao, ...resto].includes("--recarregar-catalogo"),
      });
      console.log(`${r.nome} (${r.empresa}): ${r.status}${r.pendencias.length ? ` · falta: ${r.pendencias.join(", ")}` : ""}\n`);
      for (const p of r.passos) console.log(`  ${p.ok ? "ok    " : "FALTA "} ${p.passo.padEnd(24)} ${p.detalhe}`);
      if (r.senhas.length) {
        console.log("\nLogins criados agora (copie: as senhas não aparecem de novo):");
        for (const s of r.senhas) console.log(`  ${s.perfil === "analista" ? "suporte    " : "solicitante"}  ${s.email.padEnd(28)} ${s.senha}`);
      }
      if (r.acessoHub) {
        console.log("\nAcesso do Hub ao banco criado agora. Copie a senha: ela não aparece de novo.");
        console.log(`  Senha:    ${r.acessoHub.senha}`);
      }
      const c = r.hub.conector;
      console.log("\nNo Hub (uma conta, uma API Key; por empresa, um conector e um agente):");
      console.log(`  1. Conector ${c.tipo}: nome "${c.nome}" (o Hub gera o slug ${c.slug} a partir desse nome)`);
      if (c.host) console.log(`     Host ${c.host} · Porta ${c.porta} · Banco ${c.banco} · Usuário ${c.usuario} · SSL Mode ${c.ssl}`);
      console.log("     A senha do usuário do banco quem cola é a pessoa (npm run acesso-banco -- <empresa> gera outra).");
      console.log(`  2. Agente "${r.hub.agente.nome}": prompt ${r.hub.agente.prompt}, só esse conector, Haiku 4.5, temperatura 0,2, Aprendizado desligado`);
      console.log(`  3. npm run definir-agente -- ${r.empresa} <uuid do agente>`);
      break;
    }
    case "definir-conector": {
      if (!arg || !descricao) throw new Error("Uso: npm run definir-conector -- <empresa> <slug do conector no Hub>");
      const r = await chamar("POST", `/empresas/${encodeURIComponent(arg)}/conector`, { slug: descricao });
      console.log(`Conector de ${r.empresa}: ${r.antes || "(nenhum)"} → ${r.depois}. Ferramenta: ${r.ferramenta}.`);
      console.log(`Prompt gerado de novo em ${r.prompt}: atualize o System Prompt do agente no Hub.`);
      break;
    }
    case "status-empresa": {
      if (!arg || (descricao !== "suspensa" && descricao !== "ativa")) throw new Error("Uso: npm run status-empresa -- <empresa> <suspensa|ativa>");
      const r = await chamar("POST", `/empresas/${encodeURIComponent(arg)}/status`, { status: descricao });
      console.log(`${r.empresa}: ${r.status}${r.status === "suspensa" ? " (sessões encerradas; ninguém da empresa entra)" : ""}`);
      break;
    }
    default:
      console.error(
        "Comandos: gerar-token, listar-tokens, revogar-token, recarregar, exportar, acesso-banco, diagnosticar-banco, revogar-acesso-banco, " +
          "listar-usuarios, definir-senha, criar-usuario, definir-agente, listar-empresas, provisionar, status-empresa, definir-conector",
      );
      process.exit(1);
  }
} catch (erro) {
  const msg = (erro as Error).message;
  console.error(`Falhou: ${msg}${/fetch failed/i.test(msg) ? ". O backend está rodando (npm run dev)?" : ""}`);
  process.exit(1);
}
