import type { ErrorRequestHandler } from "express";

import { env } from "../config/env.js";
import { ErroApp } from "../dominio/erros.js";

/** Express 5 repassa para cá os erros dos handlers async. O corpo `{ erro, mensagem }` é o que o frontend lê. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ErroApp) {
    res.status(err.status).json({ erro: err.codigo, mensagem: err.message, ...err.extra });
    return;
  }

  console.error("[backend] erro não tratado:", err);

  // Erros do próprio Express (JSON malformado, corpo grande demais) trazem o status.
  const status = typeof err?.status === "number" ? err.status : 500;

  res.status(status).json({
    erro: status === 500 ? "interno" : "requisicao",
    mensagem: status === 500 ? "Algo deu errado do nosso lado. Tente de novo em instantes." : err.message,
    ...(env.nodeEnv === "development" ? { stack: err?.stack } : {}),
  });
};
