import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

import { db } from "../db/index.js";
import { ErroApp } from "./erros.js";
import { buscarUsuario, type Usuario } from "./usuarios.js";

/** Parâmetros do scrypt (custo, bloco, paralelismo) e tamanho do hash. Ficam gravados no hash: dá para subir depois. */
const SCRYPT = { N: 16384, r: 8, p: 1, tamanho: 64 };
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MIN = 15;
export const SENHA_MIN = 10;

/** Os dois tipos de login: o solicitante abre chamados; o suporte (perfil analista) faz a triagem e responde. */
export const NOME_DO_PERFIL: Record<Usuario["perfil"], string> = { solicitante: "solicitante", analista: "suporte" };

const ERRO_CREDENCIAIS = () => new ErroApp(401, "credenciais", "E-mail ou senha incorretos.");

function derivar(senha: string, sal: Buffer, tamanho: number, opcoes: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(senha.normalize("NFKC"), sal, tamanho, { ...opcoes, maxmem: 64 * 1024 * 1024 }, (erro, chave) =>
      erro ? reject(erro) : resolve(chave),
    ),
  );
}

/** `scrypt$N$r$p$<sal>$<hash>`, em base64. */
export async function gerarHash(senha: string) {
  const sal = randomBytes(16);
  const hash = await derivar(senha, sal, SCRYPT.tamanho, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${sal.toString("base64")}$${hash.toString("base64")}`;
}

export async function conferirHash(senha: string, guardado: string) {
  const [algoritmo, N, r, p, sal, hash] = guardado.split("$");
  if (algoritmo !== "scrypt" || !sal || !hash) return false;
  const esperado = Buffer.from(hash, "base64");
  const calculado = await derivar(senha, Buffer.from(sal, "base64"), esperado.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(calculado, esperado);
}

/** Hash de uma senha qualquer: quem erra o e-mail espera o mesmo tempo de quem erra a senha. */
const hashFalso = gerarHash(randomBytes(16).toString("hex"));

/**
 * Confere e-mail e senha e, com `perfil`, que o login é do tipo escolhido na tela (solicitante ou suporte).
 * E-mail ou senha errados dão sempre a mesma mensagem, para não revelar quais e-mails existem.
 */
export async function entrar(email: string, senha: string, perfil?: Usuario["perfil"]): Promise<Usuario> {
  const login = await db.one<{ id: string; senha_hash: string | null; bloqueado: boolean }>(
    `select id, senha_hash, coalesce(bloqueado_ate > now(), false) as bloqueado
     from usuarios where lower(email) = lower($1)`,
    [email.trim()],
  );
  if (!login?.senha_hash) {
    await conferirHash(senha, await hashFalso);
    throw ERRO_CREDENCIAIS();
  }
  if (login.bloqueado) {
    throw new ErroApp(429, "bloqueado", `Muitas tentativas erradas. Tente de novo em até ${BLOQUEIO_MIN} minutos.`);
  }

  if (!(await conferirHash(senha, login.senha_hash))) {
    await db.query(
      `update usuarios set
         tentativas_falhas = tentativas_falhas + 1,
         bloqueado_ate = case when tentativas_falhas + 1 >= $2 then now() + make_interval(mins => $3) else bloqueado_ate end
       where id = $1`,
      [login.id, MAX_TENTATIVAS, BLOQUEIO_MIN],
    );
    throw ERRO_CREDENCIAIS();
  }

  await db.query(`update usuarios set tentativas_falhas = 0, bloqueado_ate = null, ultimo_login = now() where id = $1`, [login.id]);
  const usuario = await buscarUsuario(login.id);
  if (!usuario) throw ERRO_CREDENCIAIS();
  // A senha está certa: aqui já dá para dizer qual é o tipo certo de login.
  if (perfil && usuario.perfil !== perfil) {
    throw new ErroApp(403, "tipo_de_login", `Este login é de ${NOME_DO_PERFIL[usuario.perfil]}. Entre pela opção "${NOME_DO_PERFIL[usuario.perfil]}".`);
  }
  return usuario;
}

/** Senha aleatória legível (sem caracteres ambíguos), para mostrar uma vez. */
function senhaAleatoria() {
  const alfabeto = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(16), (b) => alfabeto[b % alfabeto.length]).join("");
}

/**
 * Define (ou troca) o e-mail e a senha de um usuário e desbloqueia o login.
 * Sem `senha`, gera uma aleatória. O valor só existe na resposta: o banco guarda o hash.
 */
export async function definirSenha(usuarioId: string, opcoes: { email?: string; senha?: string } = {}) {
  const usuario = await db.one<Usuario & { email: string | null }>(
    "select id, empresa_id, nome, perfil, email from usuarios where id = $1",
    [usuarioId],
  );
  if (!usuario) throw new ErroApp(404, "usuario", `Usuário "${usuarioId}" não existe.`);

  const email = (opcoes.email ?? usuario.email ?? `${usuario.id}@${usuario.empresa_id}.test`).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroApp(400, "email", "E-mail inválido.");
  const senha = opcoes.senha ?? senhaAleatoria();
  if (senha.length < SENHA_MIN) throw new ErroApp(400, "senha", `A senha precisa de pelo menos ${SENHA_MIN} caracteres.`);

  const emUso = await db.one("select 1 from usuarios where lower(email) = $1 and id <> $2", [email, usuarioId]);
  if (emUso) throw new ErroApp(409, "email_em_uso", `O e-mail ${email} já é de outro usuário.`);

  await db.query(
    `update usuarios set email = $2, senha_hash = $3, tentativas_falhas = 0, bloqueado_ate = null, senha_definida_em = now()
     where id = $1`,
    [usuarioId, email, await gerarHash(senha)],
  );
  return { usuario: usuario.id, nome: usuario.nome, perfil: usuario.perfil, email, senha };
}

/** Cria um usuário na empresa (ou atualiza nome e perfil) e já define a senha. */
export async function criarUsuario(dados: { id: string; nome: string; perfil: string; empresa: string; email?: string }) {
  const id = dados.id.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id)) throw new ErroApp(400, "id", "Id: letras minúsculas, números, - e _ (2 a 40).");
  if (dados.perfil !== "solicitante" && dados.perfil !== "analista") {
    throw new ErroApp(400, "perfil", 'Perfil: "solicitante" ou "analista" (suporte).');
  }
  if (!dados.nome.trim()) throw new ErroApp(400, "nome", "Informe o nome.");
  const empresa = await db.one("select 1 from empresas where id = $1", [dados.empresa]);
  if (!empresa) throw new ErroApp(404, "empresa", `Empresa "${dados.empresa}" não existe.`);

  await db.query(
    `insert into usuarios (id, empresa_id, nome, perfil) values ($1, $2, $3, $4)
     on conflict (id) do update set nome = excluded.nome, perfil = excluded.perfil`,
    [id, dados.empresa, dados.nome.trim(), dados.perfil],
  );
  return definirSenha(id, { email: dados.email });
}

/** Quem pode entrar (sem segredo): para o terminal do backend e o comando de administração. */
export async function listarLogins() {
  return db.query<{ id: string; nome: string; perfil: Usuario["perfil"]; email: string | null; ultimo_login: string | null; bloqueado: boolean }>(
    `select id, nome, perfil, case when senha_hash is null then null else email end as email, ultimo_login,
            coalesce(bloqueado_ate > now(), false) as bloqueado
     from usuarios order by empresa_id, perfil desc, nome`,
  );
}
