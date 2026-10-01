import { createServer } from "node:http";

import { Server } from "socket.io";

import { createApp } from "./app.js";
import { opcoesCors } from "./config/cors.js";
import { env } from "./config/env.js";
import { iniciarBanco } from "./db/index.js";
import * as acessoBanco from "./dominio/acessoBanco.js";
import * as agentes from "./dominio/agentes.js";
import * as autenticacao from "./dominio/autenticacao.js";
import * as tokens from "./dominio/tokens.js";
import { criarGatewayChamados } from "./tempo-real/gateway.js";

const banco = await iniciarBanco();
const ativos = await tokens.ativosPorEmpresa();
const acessos = await acessoBanco.atualizarVisoes();
const agenteAurora = (await agentes.agentesPorEmpresa()).find((e) => e.id === "aurora")?.agente_id;
// Com o banco local, em desenvolvimento, quem ainda não tem senha ganha uma agora (mostrada só nesta subida).
// No banco compartilhado, só avisa: a senha nova ficaria só neste terminal.
const semSenha = (await autenticacao.listarLogins()).filter((l) => !l.email);
const senhasNovas = autenticacao.criaSenhasNaSubida(env.nodeEnv, Boolean(env.db.url))
  ? await Promise.all(semSenha.map((l) => autenticacao.definirSenha(l.id)))
  : [];
// Mostra já, antes de abrir a porta: se a subida falhar depois (porta ocupada), as senhas não se perdem.
if (senhasNovas.length) {
  console.log("[backend] senhas criadas agora para quem não tinha (copie: não aparecem de novo):");
  for (const s of senhasNovas) {
    console.log(`           ${s.perfil === "analista" ? "suporte    " : "solicitante"}  ${s.email.padEnd(24)} ${s.senha}`);
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
  console.log(`[backend] socket em ws://localhost:${env.port}/socket.io  ·  namespace /chamados (chamado e triagem)`);
  console.log(
    `[backend] Hub: ${env.hub.modo}${env.hub.modo === "real" ? ` (${env.hub.baseUrl})` : " — respostas fixas, sem chave"}`,
  );
  // O agente vem do banco e vale para todos que usam o mesmo banco; o .env só o preenche na primeira carga.
  console.log(`[backend] agente da aurora (no banco): ${agenteAurora ?? "—"}`);
  if (agenteAurora && agenteAurora !== env.hub.agenteAurora) {
    console.log(
      `[backend] o .env pede o agente ${env.hub.agenteAurora}, mas quem manda é o banco. ` +
        `Para trocar para todos: npm run definir-agente -- aurora ${env.hub.agenteAurora}`,
    );
  }
  console.log(
    `[backend] conector de API em /hub/v1 (OpenAPI em /hub/v1/openapi.json) · ` +
      (ativos.length ? `tokens ativos: ${ativos.map((a) => `${a.empresa_id} (${a.total})`).join(", ")}` : "nenhum token ativo"),
  );
  console.log(
    `[backend] acesso do Hub ao banco (conector PostgreSQL): ` +
      (!env.db.url
        ? "indisponível com o PGlite local (o Hub não alcança esta máquina)"
        : acessos.length
          ? acessos.map((a) => `hub_${a.id}${a.login ? "" : " (revogado)"}`).join(", ")
          : "nenhum; crie com npm run acesso-banco -- aurora"),
  );
  if (!senhasNovas.length && semSenha.length) {
    console.log(
      `[backend] sem senha (não conseguem entrar): ${semSenha.map((l) => l.id).join(", ")} · npm run definir-senha -- <usuário>` +
        (env.db.url ? " (banco compartilhado: a subida não cria senhas)" : ""),
    );
  }
});
