import { empresasComDossie, importarDossie } from "../dominio/empresas.js";

/**
 * Dados iniciais. Com o banco local (PGlite), importa os dossiês de `dados/<empresa>/` (cadastro, usuários e catálogo)
 * para o app funcionar sem configurar nada. No banco compartilhado (Supabase), o cadastro de empresas é explícito
 * e fica com o provisionamento: npm run provisionar -- <empresa>. Nos dois casos, nada que já está no banco é sobrescrito.
 */
export async function semear({ local }: { local: boolean }) {
  if (!local) return;
  for (const empresa of empresasComDossie()) await importarDossie(empresa);
}
