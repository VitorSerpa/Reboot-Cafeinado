/**
 * Endereço do backend para o WebSocket. A API REST sempre vai pelo mesmo domínio (/api).
 * - Com NEXT_PUBLIC_API_URL, usa esse endereço.
 * - Na Vercel, o backend é um serviço do mesmo domínio: o vercel.json manda /socket.io para ele.
 * - Localmente, o socket vai direto ao backend: mesmo host da página, na porta 3333. Assim o cookie de sessão
 *   (gravado para o host, não para a porta) também chega no handshake.
 */
export function urlDoBackend(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window === "undefined") return "http://localhost:3333";
  // Sem porta na URL (HTTPS publicado, como na Vercel): o backend responde no mesmo domínio.
  if (process.env.NEXT_PUBLIC_VERCEL_ENV || !window.location.port) return window.location.origin;
  return `${window.location.protocol}//${window.location.hostname}:3333`;
}
