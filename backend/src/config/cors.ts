import { env } from "./env.js";

const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Origem aceita pelo CORS (HTTP e WebSocket): as de CORS_ORIGIN e, em desenvolvimento, qualquer porta de localhost.
 * Se a 3000 estiver ocupada, o Next sobe na 3001; sem isso, o socket do chat e da triagem seria recusado.
 */
export function origemPermitida(origem: string | undefined, lista = env.corsOrigin, nodeEnv = env.nodeEnv) {
  if (!origem) return true; // sem Origin: curl, scripts e o rewrite do Next
  return lista.includes(origem) || (nodeEnv === "development" && LOCALHOST.test(origem));
}

/** No formato que o pacote cors e o socket.io aceitam. */
export const opcoesCors = {
  origin: (origem: string | undefined, responder: (erro: Error | null, permitido?: boolean) => void) =>
    responder(null, origemPermitida(origem)),
  credentials: true,
};
