import "dotenv/config";

import { homedir } from "node:os";
import { join } from "node:path";

const vazio = (v: string | undefined) => (v ?? "").trim();

const hubApiKey = vazio(process.env.HUB_API_KEY);
const hubModeExplicito = vazio(process.env.HUB_MODE).toLowerCase();

export const env = {
  nodeEnv: vazio(process.env.NODE_ENV) || "development",
  port: Number(vazio(process.env.PORT) || 3333),
  /** Origens permitidas pelo CORS (HTTP e WebSocket). */
  corsOrigin: (vazio(process.env.CORS_ORIGIN) || "http://localhost:3000")
    .split(",")
    .map((origem) => origem.trim())
    .filter(Boolean),
  sessionSecret: vazio(process.env.SESSION_SECRET) || "dev-somente-local",

  db: {
    url: vazio(process.env.DATABASE_URL),
    // Certificado da CA do Supabase (Database Settings → SSL). Sem ele, a conexão é cifrada mas o certificado não é verificado.
    sslCa: vazio(process.env.DATABASE_SSL_CA),
    // Fora da pasta do OneDrive: o sync trava arquivos do banco.
    pgliteDir: vazio(process.env.PGLITE_DIR) || join(homedir(), ".reboot-cafeinado", "pgdata"),
  },

  hub: {
    modo: (hubModeExplicito || (hubApiKey ? "real" : "simulado")) as "real" | "simulado",
    baseUrl: (vazio(process.env.HUB_BASE_URL) || "https://belatrix.ai").replace(/\/+$/, ""),
    apiKey: hubApiKey,
    timeoutMs: Number(vazio(process.env.HUB_TIMEOUT_MS) || 90000),
  },
};

if (env.hub.modo === "real" && !env.hub.apiKey) {
  throw new Error("HUB_MODE=real exige HUB_API_KEY no .env");
}
