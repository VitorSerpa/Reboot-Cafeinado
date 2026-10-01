import cookieParser from "cookie-parser";
import type { Namespace, Server, Socket } from "socket.io";

import { env } from "../config/env.js";
import * as chamados from "../dominio/chamados.js";
import { ErroApp } from "../dominio/erros.js";
import { eventos } from "../dominio/eventos.js";
import * as triagem from "../dominio/triagem.js";
import { buscarUsuario, COOKIE_SESSAO, idDoToken } from "../dominio/usuarios.js";
import type { Ack, ClienteParaServidor, DadosSocket, EstadoChamado, ServidorParaCliente } from "./tipos.js";

type NamespaceChamados = Namespace<ClienteParaServidor, ServidorParaCliente, never, DadosSocket>;
type SocketChamados = Socket<ClienteParaServidor, ServidorParaCliente, never, DadosSocket>;

const salaUsuario = (id: string) => `usuario:${id}`;
const salaTriagem = (empresaId: string) => `triagem:${empresaId}`;

/** Lê o cookie de sessão assinado do handshake — o mesmo que a API REST usa. */
function idDoCookie(cabecalho: string | undefined): string | null {
  for (const parte of (cabecalho ?? "").split(";")) {
    const [nome, ...resto] = parte.trim().split("=");
    if (nome !== COOKIE_SESSAO) continue;
    const valor = decodeURIComponent(resto.join("="));
    const id = valor.startsWith("s:") ? cookieParser.signedCookie(valor, env.sessionSecret) : false;
    return typeof id === "string" ? id : null;
  }
  return null;
}

async function estado(chamadoId: number, usuario: DadosSocket["usuario"]): Promise<EstadoChamado> {
  const chamado = await chamados.carregarComAcesso(usuario, chamadoId);
  return { chamado, turnos: await chamados.turnos(chamado.id) };
}

/** Roda a ação e devolve no ack o resultado ou o erro no formato da API REST. */
async function responderCom<T>(ack: Ack<T> | undefined, acao: () => Promise<T>) {
  try {
    const data = await acao();
    ack?.({ ok: true, data });
  } catch (erro) {
    if (erro instanceof ErroApp) {
      ack?.({ ok: false, erro: erro.codigo, mensagem: erro.message, extra: erro.extra });
      return;
    }
    console.error("[tempo-real] erro não tratado:", erro);
    ack?.({ ok: false, erro: "interno", mensagem: "Algo deu errado do nosso lado. Tente de novo em instantes." });
  }
}

/**
 * Namespace `/chamados`: o chat do chamado (primeiro com o agente, depois com o atendente) e a fila de triagem em tempo real.
 * Cada usuário fica na própria sala (`usuario:<id>`); analistas também na sala da empresa (`triagem:<empresa>`).
 * A empresa e o usuário saem do cookie de sessão, nunca do que o navegador manda nos eventos.
 */
export function criarGatewayChamados(io: Server) {
  const nsp = io.of("/chamados") as unknown as NamespaceChamados;

  nsp.use(async (socket, next) => {
    try {
      // O token da aba vem antes do cookie: o cookie é um só por navegador, e a reconexão da triagem chegaria
      // como o solicitante que entrou em outra aba (sem a sala da fila, a tela parava de atualizar).
      const token = socket.handshake.auth?.token;
      const id = token ? idDoToken(token) : idDoCookie(socket.handshake.headers.cookie);
      const usuario = id ? await buscarUsuario(id) : undefined;
      if (!usuario) return next(new Error("sem_sessao"));
      socket.data.usuario = usuario;
      next();
    } catch (erro) {
      next(erro as Error);
    }
  });

  nsp.on("connection", (socket: SocketChamados) => {
    const usuario = socket.data.usuario;
    socket.join(salaUsuario(usuario.id));
    if (usuario.perfil === "analista") socket.join(salaTriagem(usuario.empresa_id));

    socket.on("chamado:abrir", (payload, ack) =>
      responderCom(ack, async () => {
        const chamado = await chamados.abrirChamado(usuario, String(payload?.texto ?? ""));
        return estado(chamado.id, usuario);
      }),
    );

    socket.on("chamado:responder", (payload, ack) =>
      responderCom(ack, async () => {
        const id = Number(payload?.chamadoId);
        if (!Number.isInteger(id) || id <= 0) throw new ErroApp(400, "id", "Identificador inválido.");
        const chamado = await chamados.responder(usuario, id, String(payload?.texto ?? ""));
        return estado(chamado.id, usuario);
      }),
    );

    socket.on("chamado:mensagem", (payload, ack) =>
      responderCom(ack, async () => {
        const id = Number(payload?.chamadoId);
        if (!Number.isInteger(id) || id <= 0) throw new ErroApp(400, "id", "Identificador inválido.");
        const chamado = await chamados.enviarMensagem(usuario, id, String(payload?.texto ?? ""));
        return estado(chamado.id, usuario);
      }),
    );
  });

  eventos.on("agente", ({ solicitanteId, ...progresso }) => {
    nsp.to(salaUsuario(solicitanteId)).emit("chamado:agente", progresso);
  });

  eventos.on("chamado", async ({ chamadoId, empresaId, solicitanteId }) => {
    try {
      const chamado = await chamados.carregarComAcesso(
        { id: solicitanteId, empresa_id: empresaId, nome: "", perfil: "solicitante" },
        chamadoId,
      );
      nsp.to(salaUsuario(solicitanteId)).emit("chamado:atualizado", { chamado, turnos: await chamados.turnos(chamadoId) });

      if (chamado.status === "aguardando_triagem" || chamado.status === "triado") {
        nsp.to(salaTriagem(empresaId)).emit("triagem:fila", await triagem.filaDaEmpresa(empresaId));
        nsp.to(salaTriagem(empresaId)).emit("triagem:chamado", { chamadoId });
      }
    } catch (erro) {
      console.error(`[tempo-real] falha ao avisar a mudança do chamado #${chamadoId}:`, erro);
    }
  });

  return nsp;
}
