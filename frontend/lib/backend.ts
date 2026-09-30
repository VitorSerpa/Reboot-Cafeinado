/**
 * Endereço do backend para o WebSocket. A API REST passa pelo rewrite do Next (/api), mas o socket vai direto.
 * Sem NEXT_PUBLIC_API_URL, usa o mesmo host da página na porta 3333: assim o cookie de sessão
 * (gravado para o host, não para a porta) também chega no handshake.
 */
export function urlDoBackend(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window === "undefined") return "http://localhost:3333";
  return `${window.location.protocol}//${window.location.hostname}:3333`;
}
