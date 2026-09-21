import { createServer } from "node:http";

import { createApp } from "./app.js";
import { createChatGateway } from "./chat/gateway.js";
import { env } from "./env.js";

const app = createApp();
const httpServer = createServer(app);

createChatGateway(httpServer);

httpServer.listen(env.port, () => {
  console.log(`[backend] http  em http://localhost:${env.port} (${env.nodeEnv})`);
  console.log(`[backend] socket em ws://localhost:${env.port}/socket.io`);
});
