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

/**
 * A sessão desta aba acabou (saiu em outra aba, venceu, senha trocada): esquece o token e volta para o login.
 * Na própria tela de login só esquece, para não recarregar sem fim.
 */
export function sessaoTerminou() {
  const tinhaSessao = Boolean(tokenDaAba());
  esquecerTokenDaAba();
  if (saindo || typeof window === "undefined" || window.location.pathname === "/") return;
  // Quem nunca entrou nesta aba só vai para o login, sem o aviso de sessão encerrada.
  window.location.replace(tinhaSessao ? "/?sessao=encerrada" : "/");
}

/** Saída pedida pela própria pessoa: o WebSocket que cai em seguida não mostra o aviso de sessão encerrada. */
let saindo = false;
export function marcarSaida() {
  saindo = true;
}
