import type { ErrorRequestHandler } from "express";

import { env } from "../env.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error("[backend] erro não tratado:", err);

  const status = typeof err?.status === "number" ? err.status : 500;

  res.status(status).json({
    error: status === 500 ? "Erro interno do servidor" : err.message,
    ...(env.nodeEnv === "development" ? { stack: err?.stack } : {}),
  });
};
