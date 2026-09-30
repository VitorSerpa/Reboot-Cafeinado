import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Raiz dos dados sintéticos do repositório (`dados/<empresa>/*.csv`). */
export const DADOS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dados");

/** CSV com aspas e vírgulas dentro de campos (RFC 4180, o suficiente para os nossos arquivos). */
export function parseCsv(texto: string): Record<string, string>[] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let entreAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreAspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') {
        entreAspas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreAspas = true;
    } else if (c === ",") {
      linha.push(campo);
      campo = "";
    } else if (c === "\n") {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else if (c !== "\r") {
      campo += c;
    }
  }
  if (campo || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }

  const [cabecalho, ...resto] = linhas.filter((l) => l.some((v) => v !== ""));
  if (!cabecalho) return [];
  return resto.map((l) => Object.fromEntries(cabecalho.map((col, i) => [col, l[i] ?? ""])));
}

export function lerCsvDaEmpresa(empresa: string, arquivo: string): Record<string, string>[] {
  return parseCsv(readFileSync(join(DADOS_DIR, empresa, `${arquivo}.csv`), "utf8"));
}
