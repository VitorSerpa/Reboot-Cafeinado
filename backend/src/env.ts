import "dotenv/config";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3333),
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  /** Segredo compartilhado do painel de suporte — placeholder até existir autenticação real. */
  supportToken: process.env.SUPPORT_TOKEN ?? "suporte-dev",
};
