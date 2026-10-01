import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";

import { opcoesCors } from "./config/cors.js";
import { env } from "./config/env.js";
import { rotasConector } from "./conector/app.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { notFound } from "./middlewares/not-found.js";
import { routes } from "./routes/index.js";
import { rotas } from "./rotas/index.js";

export function createApp() {
  const app = express();

  app.use(cors(opcoesCors));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser(env.sessionSecret));

  // /api/health (infra) e as rotas do Chamado Pronto (sessão, chamados, triagem, administração).
  app.use("/api", routes, rotas);
  // Conector API REST que o Kaffa AI Hub consulta.
  app.use("/hub/v1", rotasConector);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
