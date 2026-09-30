/** Erro com status HTTP e mensagem pronta para a tela. */
export class ErroApp extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ErroApp";
  }
}
