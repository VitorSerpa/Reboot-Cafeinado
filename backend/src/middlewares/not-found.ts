import type { Request, Response } from "express";

export function notFound(req: Request, res: Response) {
  res.status(404).json({ erro: "rota", mensagem: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
}
