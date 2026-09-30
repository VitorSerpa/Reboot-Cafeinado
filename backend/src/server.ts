import { createServer } from "node:http";

import { Server } from "socket.io";

import { createApp } from "./app.js";
import { createChatGateway } from "./chat/gateway.js";
import { env } from "./config/env.js";
import { iniciarBanco } from "./db/index.js";
import * as acessoBanco from "./dominio/acessoBanco.js";
import * as tokens from "./dominio/tokens.js";
import { criarGatewayChamados } from "./tempo-real/gateway.js";

const banco = await iniciarBanco();
const ativos = await tokens.ativosPorEmpresa();
const acessos = await acessoBanco.atualizarVisoes();

const httpServer = createServer(createApp());

// Um servidor socket.io, dois namespaces: `/` (chat ao vivo com o suporte) e `/chamados` (agente e triagem).
const io = new Server(httpServer, {
  path: "/socket.io",
  cors: { origin: env.corsOrigin, credentials: true },
});
createChatGateway(io);
criarGatewayChamados(io);

httpServer.listen(env.port, () => {
  console.log(`[backend] http://localhost:${env.port}/api (${env.nodeEnv})  ·  banco: ${banco}`);
  console.log(`[backend] socket em ws://localhost:${env.port}/socket.io  ·  namespaces: / (chat ao vivo), /chamados (agente e triagem)`);
  console.log(
    `[backend] Hub: ${env.hub.modo}${env.hub.modo === "real" ? ` (${env.hub.baseUrl}, agente ${env.hub.agenteAurora})` : " — respostas fixas, sem chave"}`,
  );
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
});
