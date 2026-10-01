/**
 * Token de sessão desta aba (sessionStorage: cada aba tem o seu). O cookie de sessão é um só por navegador;
 * com o token, a aba do suporte continua como o suporte mesmo que outra aba entre como solicitante.
 * Sem token (aba nova, armazenamento bloqueado), a API e o WebSocket caem no cookie.
 */
const CHAVE = "sessao:token";

export function tokenDaAba(): string | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}

export function guardarTokenDaAba(token: string | undefined) {
  if (!token) return;
  try {
    window.sessionStorage.setItem(CHAVE, token);
  } catch {
    // Sem armazenamento: segue pelo cookie.
  }
}

export function esquecerTokenDaAba() {
  try {
    window.sessionStorage.removeItem(CHAVE);
  } catch {
    // nada a fazer
  }
}
