import type { Namespace, Server, Socket } from "socket.io";

import { comEmpresa, comoSistema } from "../db/index.js";
import * as chamados from "../dominio/chamados.js";
import { ErroApp } from "../dominio/erros.js";
import { eventos } from "../dominio/eventos.js";
import * as triagem from "../dominio/triagem.js";
import { COOKIE_SESSAO, hashDaSessao, usuarioDaSessao } from "../dominio/usuarios.js";
import type { Ack, ClienteParaServidor, DadosSocket, EstadoChamado, ServidorParaCliente } from "./tipos.js";

type NamespaceChamados = Namespace<ClienteParaServidor, ServidorParaCliente, never, DadosSocket>;
type SocketChamados = Socket<ClienteParaServidor, ServidorParaCliente, never, DadosSocket>;

const salaUsuario = (id: string) => `usuario:${id}`;
const salaTriagem = (empresaId: string) => `triagem:${empresaId}`;

const salaSessao = (hash: string) => `sessao:${hash}`;

/** Lê o token de sessão do cookie do handshake — o mesmo que a API REST usa. */
function tokenDoCookie(cabecalho: string | undefined): string | null {
  for (const parte of (cabecalho ?? "").split(";")) {
    const [nome, ...resto] = parte.trim().split("=");
    if (nome === COOKIE_SESSAO) return decodeURIComponent(resto.join("="));
  }
  return null;
}

async function estado(chamadoId: number, usuario: DadosSocket["usuario"]): Promise<EstadoChamado> {
  const chamado = await chamados.carregarComAcesso(usuario, chamadoId);
  return { chamado, turnos: await chamados.turnos(chamado.id) };
}

/** Roda a ação com os dados da empresa do usuário (RLS) e devolve no ack o resultado ou o erro no formato da API REST. */
function responderCom<T>(usuario: DadosSocket["usuario"], ack: Ack<T> | undefined, acao: () => Promise<T>) {
  return comEmpresa(usuario.empresa_id, () => devolverNoAck(ack, acao));
}

async function devolverNoAck<T>(ack: Ack<T> | undefined, acao: () => Promise<T>) {
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
      const token = socket.handshake.auth?.token || tokenDoCookie(socket.handshake.headers.cookie);
      // Antes de saber quem é, não há empresa: a sessão é da plataforma.
      const usuario = await comoSistema(() => usuarioDaSessao(token));
      if (!usuario) return next(new Error("sem_sessao"));
      socket.data.usuario = usuario;
      socket.data.sessao = hashDaSessao(token);
      next();
    } catch (erro) {
      next(erro as Error);
    }
  });

  nsp.on("connection", (socket: SocketChamados) => {
    const usuario = socket.data.usuario;
    socket.join([salaUsuario(usuario.id), salaSessao(socket.data.sessao)]);
    if (usuario.perfil === "analista") socket.join(salaTriagem(usuario.empresa_id));

    socket.on("chamado:abrir", (payload, ack) =>
      responderCom(usuario, ack, async () => {
        const chamado = await chamados.abrirChamado(usuario, String(payload?.texto ?? ""));
        return estado(chamado.id, usuario);
      }),
    );

    socket.on("chamado:responder", (payload, ack) =>
      responderCom(usuario, ack, async () => {
        const id = Number(payload?.chamadoId);
        if (!Number.isInteger(id) || id <= 0) throw new ErroApp(400, "id", "Identificador inválido.");
        const chamado = await chamados.responder(usuario, id, String(payload?.texto ?? ""));
        return estado(chamado.id, usuario);
      }),
    );

    socket.on("chamado:mensagem", (payload, ack) =>
      responderCom(usuario, ack, async () => {
        const id = Number(payload?.chamadoId);
        if (!Number.isInteger(id) || id <= 0) throw new ErroApp(400, "id", "Identificador inválido.");
        const chamado = await chamados.enviarMensagem(usuario, id, String(payload?.texto ?? ""));
        return estado(chamado.id, usuario);
      }),
    );
  });

  // Sair (ou senha nova) derruba na hora o WebSocket dessa sessão; a reconexão é recusada no handshake.
  eventos.on("sessao", (e) => {
    nsp.in("sessao" in e ? salaSessao(e.sessao) : salaUsuario(e.usuarioId)).disconnectSockets(true);
  });

  eventos.on("agente", ({ solicitanteId, ...progresso }) => {
    nsp.to(salaUsuario(solicitanteId)).emit("chamado:agente", progresso);
  });

  // O aviso roda com a empresa do chamado: o que vai para a sala da triagem só pode ser dela.
  eventos.on("chamado", ({ chamadoId, empresaId, solicitanteId }) =>
    comEmpresa(empresaId, async () => {
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
    }),
  );

  return nsp;
}
