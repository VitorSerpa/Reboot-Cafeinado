import { createServer } from "node:http";

import { Server } from "socket.io";

import { createApp } from "./app.js";
import { opcoesCors } from "./config/cors.js";
import { env } from "./config/env.js";
import { comoSistema, iniciarBanco, PAPEL_EMPRESA } from "./db/index.js";
import * as acessoBanco from "./dominio/acessoBanco.js";
import * as autenticacao from "./dominio/autenticacao.js";
import * as empresas from "./dominio/empresas.js";
import * as tokens from "./dominio/tokens.js";
import { criarGatewayChamados } from "./tempo-real/gateway.js";

const banco = await iniciarBanco();

// A subida é da plataforma: enxerga todas as empresas.
const subida = await comoSistema(async () => {
  const ativos = await tokens.ativosPorEmpresa();
  await acessoBanco.atualizarVisoes();
  // Com o banco local, em desenvolvimento, quem ainda não tem senha ganha uma agora (mostrada só nesta subida).
  // No banco compartilhado, só avisa: a senha nova ficaria só neste terminal.
  const semSenha = (await autenticacao.listarLogins()).filter((l) => !l.email);
  const senhasNovas = autenticacao.criaSenhasNaSubida(env.nodeEnv, Boolean(env.db.url))
    ? await Promise.all(semSenha.map((l) => autenticacao.definirSenha(l.id)))
    : [];
  for (const e of await empresas.listar()) await empresas.atualizarStatus(e.id);
  return { ativos, semSenha, senhasNovas, lista: await empresas.listar() };
});

// Mostra já, antes de abrir a porta: se a subida falhar depois (porta ocupada), as senhas não se perdem.
if (subida.senhasNovas.length) {
  console.log("[backend] senhas criadas agora para quem não tinha (copie: não aparecem de novo):");
  for (const s of subida.senhasNovas) {
    console.log(`           ${s.perfil === "analista" ? "suporte    " : "solicitante"}  ${s.email.padEnd(28)} ${s.senha}`);
  }
  console.log("           para trocar depois: npm run definir-senha -- <usuário>");
}

const httpServer = createServer(createApp());

// socket.io no namespace `/chamados`: o chat do chamado (agente e depois suporte) e a fila da triagem.
const io = new Server(httpServer, {
  path: "/socket.io",
  cors: opcoesCors,
});
criarGatewayChamados(io);

httpServer.listen(env.port, () => {
  console.log(`[backend] http://localhost:${env.port}/api (${env.nodeEnv})  ·  banco: ${banco}`);
  console.log(`[backend] isolamento por empresa: RLS no banco (as consultas das empresas rodam como ${PAPEL_EMPRESA})`);
  console.log(`[backend] socket em ws://localhost:${env.port}/socket.io  ·  namespace /chamados (chamado e triagem)`);
  console.log(
    `[backend] Hub: ${env.hub.modo}${env.hub.modo === "real" ? ` (${env.hub.baseUrl}, uma API Key da plataforma)` : " — respostas fixas, sem chave"}`,
  );

  if (!subida.lista.length) {
    const dossies = empresas.empresasComDossie();
    console.log(
      `[backend] nenhuma empresa no banco. Provisione com npm run provisionar -- <empresa>` +
        (dossies.length ? ` (dossiês em dados/: ${dossies.join(", ")})` : ""),
    );
  } else {
    console.log("[backend] empresas:");
    for (const e of subida.lista) {
      const situacao = e.pendencias.length ? `falta: ${e.pendencias.join(", ")}` : `agente ${e.agente_id.slice(0, 8)}…`;
      console.log(
        `           ${e.id.padEnd(11)} ${e.nome.padEnd(24)} ${e.status.padEnd(12)} ${situacao}  ·  ${e.com_senha}/${e.usuarios} com login · ${e.chamados} chamado(s)`,
      );
    }
  }

  console.log(
    `[backend] conector de API em /hub/v1 (OpenAPI em /hub/v1/openapi.json) · ` +
      (subida.ativos.length ? `tokens ativos: ${subida.ativos.map((a) => `${a.empresa_id} (${a.total})`).join(", ")}` : "nenhum token ativo"),
  );
  if (!subida.senhasNovas.length && subida.semSenha.length) {
    console.log(
      `[backend] sem senha (não conseguem entrar): ${subida.semSenha.map((l) => l.id).join(", ")} · npm run definir-senha -- <usuário>` +
        (env.db.url ? " (banco compartilhado: a subida não cria senhas)" : ""),
    );
  }
});
