/**
 * Smoke test do gateway de chat: sobe um cliente e um atendente, troca mensagens
 * e confere que cada lado recebeu o que o outro enviou.
 *
 * Uso: node scripts/smoke-chat.mjs [url]   (default http://localhost:3333)
 */
import { io } from "socket.io-client";

const URL = process.argv[2] ?? "http://localhost:3333";
const TOKEN = process.env.SUPPORT_TOKEN ?? "suporte-dev";

const emit = (socket, event, payload) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout em ${event}`)), 5000);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      res?.ok ? resolve(res.data) : reject(new Error(`${event}: ${res?.error}`));
    });
  });

const waitFor = (socket, event) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando ${event}`)), 5000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const assert = (cond, label) => {
  if (!cond) throw new Error(`FALHOU: ${label}`);
  console.log(`ok   ${label}`);
};

const client = io(URL, { transports: ["websocket"] });
const support = io(URL, { transports: ["websocket"] });
const intruder = io(URL, { transports: ["websocket"] });

try {
  const supportAuth = await emit(support, "support:auth", { name: "Ana (suporte)", token: TOKEN });
  assert(Array.isArray(supportAuth.conversations), "suporte autenticado e recebeu a fila");

  const created = waitFor(support, "conversation:created");
  const started = await emit(client, "client:start", {
    name: "Cliente Teste",
    subject: "Pedido atrasado",
  });
  const conversationId = started.conversation.id;
  assert(!!conversationId, "cliente abriu conversa");
  assert((await created).id === conversationId, "suporte foi notificado da nova conversa");

  // Antes de entrar na conversa, o suporte só acompanha a fila via conversation:updated.
  const queueUpdate = waitFor(support, "conversation:updated");
  await emit(client, "message:send", { conversationId, body: "Oi, meu pedido não chegou" });
  const updated = await queueUpdate;
  assert(updated.lastMessage === "Oi, meu pedido não chegou", "fila do suporte mostra a última msg");
  assert(updated.unreadForSupport === 1, "fila do suporte conta não lidas");

  const joined = await emit(support, "support:join", { conversationId });
  assert(joined.messages.length === 1, "suporte recebeu o histórico ao entrar");
  assert(joined.conversation.unreadForSupport === 0, "não lidas zeradas ao entrar");

  const clientSees = waitFor(client, "message:new");
  await emit(support, "message:send", { conversationId, body: "Bom dia! Já verifico para você" });
  assert((await clientSees).body === "Bom dia! Já verifico para você", "cliente recebeu msg do suporte");

  // Já dentro da conversa, o suporte recebe as mensagens em tempo real.
  const supportSees = waitFor(support, "message:new");
  await emit(client, "message:send", { conversationId, body: "Obrigado!" });
  assert((await supportSees).body === "Obrigado!", "suporte recebeu msg do cliente em tempo real");

  const closed = waitFor(client, "message:new");
  await emit(support, "conversation:close", { conversationId });
  assert((await closed).from === "system", "encerramento avisado na conversa");

  let rejected = false;
  await emit(client, "message:send", { conversationId, body: "ainda estou aí?" }).catch(() => {
    rejected = true;
  });
  assert(rejected, "conversa encerrada não aceita novas mensagens");

  let tokenRejected = false;
  await emit(intruder, "support:auth", { name: "Xereta", token: "errado" }).catch(() => {
    tokenRejected = true;
  });
  assert(tokenRejected, "token de suporte inválido é recusado");

  let queueDenied = false;
  await emit(intruder, "support:join", { conversationId }).catch(() => {
    queueDenied = true;
  });
  assert(queueDenied, "socket sem papel de suporte não entra na conversa");

  console.log("\nsmoke test passou");
} catch (err) {
  console.error(`\n${err.message}`);
  process.exitCode = 1;
} finally {
  client.close();
  support.close();
  intruder.close();
}
