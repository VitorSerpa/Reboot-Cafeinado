import type { Request, Response } from "express";

export function notFound(req: Request, res: Response) {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
}
