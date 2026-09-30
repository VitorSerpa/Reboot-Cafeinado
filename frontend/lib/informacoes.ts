/** Campos que a tela já mostra à parte ("Sistema", "Categoria") e que o agente às vezes repete em `informacoes`. */
const JA_EXIBIDOS = new Set(["aplicacao", "aplicação", "sistema", "app", "categoria"]);

const ROTULOS: Record<string, string> = {
  mensagem_exata: "Mensagem na tela",
  o_que_o_sistema_respondeu: "O que o sistema respondeu",
  o_que_apareceu: "O que apareceu na tela",
  o_que_tentava: "O que estava tentando fazer",
  operacao_pretendida: "Operação pretendida",
  etapa_em_que_ocorre: "Em que etapa acontece",
  funcao_bloqueada: "Função bloqueada",
  quando_comecou: "Quando começou",
  outros_colegas_afetados: "Outros colegas afetados",
  abrangencia: "Abrangência",
  local_escritorio_ou_casa: "Escritório ou casa",
  o_que_nao_conecta: "O que não conecta",
  ja_funcionou_antes_para_voce: "Já funcionou antes",
  colegas_do_mesmo_cargo_conseguem: "Colegas do mesmo cargo conseguem",
};

function rotulo(chave: string) {
  return ROTULOS[chave] ?? chave.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function valor(v: unknown): string {
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** Pares rótulo/valor para exibir, sem vazios e sem repetir o que já aparece à parte. */
export function camposInformados(informacoes: Record<string, unknown> | null | undefined): [string, string][] {
  return Object.entries(informacoes ?? {})
    .filter(([k, v]) => v !== null && v !== "" && !JA_EXIBIDOS.has(k.toLowerCase()))
    .map(([k, v]) => [rotulo(k), valor(v)]);
}
