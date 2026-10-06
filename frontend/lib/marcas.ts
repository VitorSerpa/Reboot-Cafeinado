/**
 * Cada empresa cliente vê o atendimento com a cara dela: cores, fontes, logo, nome do portal e do assistente.
 * As cores e as fontes ficam em globals.css (`:root[data-empresa="…"]`); aqui ficam os textos e o logo.
 * A tela de login é sempre Kaffa; a marca entra depois do login, pela empresa do usuário.
 */
export interface Marca {
  id: string;
  /** Nome da empresa, no título da aba e nos textos. */
  nome: string;
  /** Assinatura ao lado do símbolo, no cabeçalho. */
  assinatura: string;
  /** Símbolo da empresa (fictício), em public/marcas. */
  simbolo: string;
  /** Nome do portal de atendimento. */
  portal: string;
  /** Nome do assistente virtual, nas bolhas do chat. */
  assistente: string;
  /** Tela do solicitante, antes de abrir o chamado. */
  boasVindas: { titulo: string; texto: string; exemplo: string };
}

export const MARCAS: Record<string, Marca> = {
  aurora: {
    id: "aurora",
    nome: "Aurora Distribuição",
    assinatura: "Aurora",
    simbolo: "/marcas/aurora.svg",
    portal: "Central de Serviços",
    assistente: "Íris",
    boasVindas: {
      titulo: "Como podemos ajudar?",
      texto:
        "Pagamentos, reembolsos, fechamento contábil ou acesso aos sistemas do Financeiro: conte o que aconteceu do jeito que falaria com um colega. A Íris pergunta só o que faltar e leva o chamado para a equipe certa.",
      exemplo: "Ex.: não consigo lançar o pagamento de um fornecedor no portal",
    },
  },
  vitalis: {
    id: "vitalis",
    nome: "Rede Vitalis",
    assinatura: "vitalis",
    simbolo: "/marcas/vitalis.svg",
    portal: "Atende",
    assistente: "Vita",
    boasVindas: {
      titulo: "Olá! Em que podemos ajudar a sua clínica?",
      texto:
        "Agenda, recepção, faturamento de convênios, pedidos de material, internet ou equipamentos do balcão: descreva o problema com as suas palavras. A Vita pergunta só o necessário e avisa a equipe certa.",
      exemplo: "Ex.: a guia do convênio voltou e não consigo reenviar no faturamento",
    },
  },
  horizonte: {
    id: "horizonte",
    nome: "Instituto Horizonte",
    assinatura: "Instituto Horizonte",
    simbolo: "/marcas/horizonte.svg",
    portal: "Central de Ajuda",
    assistente: "Sofia",
    boasVindas: {
      titulo: "Central de Ajuda do Instituto",
      texto:
        "Matrícula, notas, provas online, boletos, requerimentos ou Wi-Fi do campus: conte o que aconteceu. A Sofia faz só as perguntas que faltarem e encaminha o seu pedido para a equipe certa.",
      exemplo: "Ex.: a rematrícula não aparece no portal do aluno",
    },
  },
};

const TITULO_PADRAO = "Chamado Pronto · Reboot Cafeinado";

/** Guarda a marca da aba (sessionStorage, como o token): a próxima carga já abre com ela, sem piscar o visual Kaffa. */
export const CHAVE_MARCA = "sessao:marca";

export const marcaDe = (empresaId: string | null | undefined): Marca | null => (empresaId && MARCAS[empresaId]) || null;

/** Troca o visual da página (`<html data-empresa>`) e o título da aba; `null` volta à identidade Kaffa. */
export function aplicarMarca(empresaId: string | null) {
  if (typeof document === "undefined") return;
  const marca = marcaDe(empresaId);
  const raiz = document.documentElement;
  if (marca) raiz.dataset.empresa = marca.id;
  else delete raiz.dataset.empresa;
  document.title = marca ? `${marca.portal} · ${marca.nome}` : TITULO_PADRAO;
  try {
    if (marca) window.sessionStorage.setItem(CHAVE_MARCA, marca.id);
    else window.sessionStorage.removeItem(CHAVE_MARCA);
  } catch {
    // Sem armazenamento: a marca volta quando a sessão for conferida.
  }
}

/** Roda no <head>, antes da primeira pintura: aplica a marca guardada na aba (só as conhecidas). */
export const SCRIPT_MARCA = `(function(){try{var m=sessionStorage.getItem(${JSON.stringify(CHAVE_MARCA)});if(${JSON.stringify(
  Object.keys(MARCAS),
)}.indexOf(m)>=0)document.documentElement.setAttribute("data-empresa",m)}catch(e){}})()`;
