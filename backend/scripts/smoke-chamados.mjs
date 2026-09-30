/**
 * Smoke test do namespace /chamados: solicitante conversa com o agente pelo WebSocket, o chamado entra
 * sozinho na fila, a analista responde no mesmo chat e confirma a fila sugerida.
 * Feito para o Hub simulado (backend sem HUB_API_KEY): as respostas são previsíveis.
 *
 * Uso: node scripts/smoke-chamados.mjs [url]   (default http://localhost:3333)
 */
import { io } from "socket.io-client";

const URL = process.argv[2] ?? "http://localhost:3333";

const assert = (cond, label) => {
  if (!cond) throw new Error(`FALHOU: ${label}`);
  console.log(`ok   ${label}`);
};

async function api(rota, { cookie, corpo } = {}) {
  const resposta = await fetch(`${URL}/api${rota}`, {
    method: corpo === undefined ? "GET" : "POST",
    headers: { ...(cookie ? { cookie } : {}), ...(corpo === undefined ? {} : { "Content-Type": "application/json" }) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const json = await resposta.json();
  if (!resposta.ok) throw new Error(`${rota}: ${json.mensagem}`);
  return { json, cookie: resposta.headers.get("set-cookie")?.split(";")[0] };
}

const entrar = async (usuario) => (await api("/auth/entrar", { corpo: { usuarioId: usuario.id } })).cookie;

const conectar = (cookie) =>
  io(`${URL}/chamados`, { transports: ["websocket"], extraHeaders: cookie ? { cookie } : {} });

const emitir = (socket, evento, payload) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout em ${evento}`)), 15000);
    socket.emit(evento, payload, (r) => {
      clearTimeout(timer);
      r?.ok ? resolve(r.data) : reject(Object.assign(new Error(`${evento}: ${r?.mensagem}`), { erro: r?.erro }));
    });
  });

const esperar = (socket, evento, filtro = () => true) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando ${evento}`)), 15000);
    const ouvir = (payload) => {
      if (!filtro(payload)) return;
      clearTimeout(timer);
      socket.off(evento, ouvir);
      resolve(payload);
    };
    socket.on(evento, ouvir);
  });

const sockets = [];

try {
  const status = (await api("/status")).json;
  assert(status.hub === "simulado", "backend no Hub simulado (respostas previsíveis)");

  const usuarios = (await api("/auth/usuarios")).json;
  const [ana, carlos] = usuarios.filter((u) => u.perfil === "solicitante");
  const bruna = usuarios.find((u) => u.perfil === "analista");
  const [cookieAna, cookieCarlos, cookieBruna] = await Promise.all([entrar(ana), entrar(carlos), entrar(bruna)]);

  const anonimo = conectar(null);
  sockets.push(anonimo);
  const recusa = await new Promise((resolve) => anonimo.once("connect_error", (e) => resolve(e.message)));
  assert(recusa === "sem_sessao", "socket sem cookie de sessão é recusado");

  const solicitante = conectar(cookieAna);
  const intruso = conectar(cookieCarlos);
  const analista = conectar(cookieBruna);
  sockets.push(solicitante, intruso, analista);

  const fases = [];
  solicitante.on("chamado:agente", (p) => fases.push(p.fase));

  const aberto = await emitir(solicitante, "chamado:abrir", {
    texto: "O portal de pagamentos travou quando cliquei em enviar remessa",
  });
  const id = aberto.chamado.id;
  assert(aberto.chamado.status === "qualificando", `chamado #${id} aberto e o agente fez uma pergunta`);
  assert(aberto.turnos.at(-1).papel === "agente", "a pergunta do agente veio no ack");
  assert(
    ["pensando", "consultando", "escrevendo", "concluido"].every((f) => fases.includes(f)),
    `progresso do agente chegou ao vivo (${fases.join(" → ")})`,
  );

  let negado = null;
  await emitir(intruso, "chamado:responder", { chamadoId: id, texto: "é meu agora" }).catch((e) => (negado = e.erro));
  assert(negado === "nao_encontrado", "outro solicitante não responde o chamado alheio");

  // Sem passo de envio: quando o agente conclui, o chamado já entra na fila da triagem.
  const atualizado = esperar(solicitante, "chamado:atualizado", (e) => e.chamado.id === id && e.chamado.status === "aguardando_triagem");
  const filaPush = esperar(analista, "triagem:fila", (fila) => fila.some((c) => c.id === id));
  const respondido = await emitir(solicitante, "chamado:responder", { chamadoId: id, texto: "a tela congela e fecha sozinha" });
  assert(respondido.chamado.status === "aguardando_triagem", "com a resposta, o agente concluiu e o chamado entrou na fila");
  await atualizado;
  assert(true, "chamado:atualizado chegou para o solicitante");
  const fila = await filaPush;
  assert(fila.find((c) => c.id === id).status === "aguardando_triagem", "a analista recebeu a fila por push, sem o solicitante enviar nada");

  // O atendente responde no mesmo chat, e o solicitante recebe ao vivo.
  const chegouAoSolicitante = esperar(solicitante, "chamado:atualizado", (e) => e.chamado.id === id && e.turnos.at(-1)?.papel === "analista");
  const avisoDetalhe = esperar(analista, "triagem:chamado", (a) => a.chamadoId === id);
  const comAtendente = await emitir(analista, "chamado:mensagem", { chamadoId: id, texto: "Oi! Já estou olhando o portal." });
  assert(comAtendente.turnos.at(-1).autor === bruna.nome, "a mensagem do atendente ficou no chat do chamado, com o nome dele");
  const noSolicitante = await chegouAoSolicitante;
  assert(noSolicitante.turnos.at(-1).texto === "Oi! Já estou olhando o portal.", "o solicitante recebeu a resposta do atendente ao vivo");
  await avisoDetalhe;
  assert(true, "a analista recebeu o aviso para recarregar o detalhe");

  const deVolta = esperar(analista, "triagem:chamado", (a) => a.chamadoId === id);
  await emitir(solicitante, "chamado:mensagem", { chamadoId: id, texto: "obrigada!" });
  await deVolta;
  assert(true, "a resposta do solicitante chegou ao atendente");

  negado = null;
  await emitir(intruso, "chamado:mensagem", { chamadoId: id, texto: "oi" }).catch((e) => (negado = e.erro));
  assert(negado === "nao_encontrado", "outro solicitante não escreve no chat alheio");

  const triado = esperar(solicitante, "chamado:atualizado", (e) => e.chamado.id === id && e.chamado.status === "triado");
  await api(`/triagem/${id}/confirmar`, { cookie: cookieBruna, corpo: {} });
  await triado;
  assert(true, "a confirmação da triagem chegou ao solicitante");

  console.log("\nsmoke test do /chamados passou");
} catch (erro) {
  console.error(`\n${erro.message}`);
  process.exitCode = 1;
} finally {
  for (const s of sockets) s.close();
}
